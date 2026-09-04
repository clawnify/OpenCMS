/**
 * Mini-migration runner — diff the live SQL columns of a content-type's
 * table against the desired `attributes` JSON, emit ALTER TABLE.
 *
 *   - No relations / FKs.
 *   - Raw `ALTER TABLE` (SQLite/D1 supports ADD COLUMN, and DROP COLUMN
 *     since SQLite 3.35; D1 ships a recent enough SQLite).
 *   - Destructive ops (column drops, type changes) are surfaced via
 *     `diffTableAgainstSchema` so the UI can confirm before applying.
 */

import type { Attribute, AttributeType, ContentType } from "./content-types";
import { get, query, run } from "./db";

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

/**
 * The author's brief for an entry — freeform context written for whoever (or
 * whatever) produces the content: the angle, the first-hand experience worth
 * telling, source material, what to avoid.
 *
 * It's a platform column rather than a content-type attribute because it isn't
 * part of the content model: it's input to the work, not a piece of it. That
 * buys three things a regular field can't — it exists in every library with no
 * setup, it never becomes a table column, and a schema edit can't drop it.
 */
export const NOTES_COLUMN = "notes";

/** Columns the platform owns on every collection, independent of `attributes`. */
export const PLATFORM_COLUMNS = ["id", "created_at", "updated_at", NOTES_COLUMN];

/** Map an attribute type onto a concrete SQLite affinity. */
export function sqliteAffinity(attr: Attribute): string {
  switch (attr.type) {
    case "integer":
    case "boolean":
      return "INTEGER";
    case "decimal":
      return "REAL";
    case "json":
    case "richtext":
    case "text":
    case "string":
    case "uid":
    case "enumeration":
    case "image":
    case "html":
    case "date":
    case "datetime":
    default:
      return "TEXT";
  }
}

/**
 * SQL literal for a default value, or null if not set.
 *
 * Structure is serialized, never `String()`-ed: this literal is baked into the
 * column DDL, so `String({})` here does not corrupt one write, it makes
 * "[object Object]" the stored value of every row that omits the field. SQLite
 * has no DDL that changes a column default, so taking one back means rebuilding
 * the table.
 *
 * The route that installs an attribute map refuses an object default on a
 * non-structured field outright (see invalidDefault). This is the read-back
 * side of that rule, and it is deliberately lossless rather than strict: it
 * runs during boot schema-sync over content types that are ALREADY stored, so
 * throwing on a default written before that check existed would turn stale data
 * into a dead app. Serializing keeps the value recoverable instead.
 */
function defaultLiteral(attr: Attribute): string | null {
  if (attr.default === undefined || attr.default === null) return null;
  if (typeof attr.default === "boolean") return attr.default ? "1" : "0";
  if (typeof attr.default === "number") return String(attr.default);
  const literal =
    typeof attr.default === "object" ? JSON.stringify(attr.default) : String(attr.default);
  return `'${literal.replace(/'/g, "''")}'`;
}

/** Compose the column definition for a CREATE TABLE / ADD COLUMN clause. */
function columnDef(name: string, attr: Attribute): string {
  const parts = [quote(name), sqliteAffinity(attr)];
  // NOT NULL only honoured at column-add time when a default exists; SQLite
  // forbids adding NOT NULL columns without a default.
  if (attr.required && attr.default !== undefined) parts.push("NOT NULL");
  const def = defaultLiteral(attr);
  if (def !== null) parts.push(`DEFAULT ${def}`);
  if (attr.unique) parts.push("UNIQUE");
  return parts.join(" ");
}

function quote(ident: string): string {
  return '"' + ident.replace(/"/g, '""') + '"';
}

/** What syncTableToSchema would do, before doing it. Useful for dry-runs / data-loss prompts. */
export interface SchemaDiff {
  add: Array<{ name: string; sql: string }>;
  drop: Array<{ name: string; sql: string }>;
  /** Type changes — SQLite can't ALTER COLUMN TYPE, so this is informational only. */
  retype: Array<{ name: string; from: string; to: string }>;
}

export async function diffTableAgainstSchema(
  ct: ContentType,
): Promise<SchemaDiff> {
  await ensureBaseTable(ct);

  const cols = await query<ColumnInfo>(`PRAGMA table_info(${quote(ct.collectionName)})`);
  const colByName = new Map(cols.map((c) => [c.name, c]));
  const desired = new Set([...PLATFORM_COLUMNS, ...Object.keys(ct.attributes)]);

  const add: SchemaDiff["add"] = [];
  const drop: SchemaDiff["drop"] = [];
  const retype: SchemaDiff["retype"] = [];

  for (const [name, attr] of Object.entries(ct.attributes)) {
    if (!colByName.has(name)) {
      add.push({
        name,
        sql: `ALTER TABLE ${quote(ct.collectionName)} ADD COLUMN ${columnDef(name, attr)}`,
      });
    } else {
      const desiredAffinity = sqliteAffinity(attr);
      const currentAffinity = (colByName.get(name)!.type || "").toUpperCase();
      if (currentAffinity && currentAffinity !== desiredAffinity) {
        retype.push({ name, from: currentAffinity, to: desiredAffinity });
      }
    }
  }

  for (const col of cols) {
    if (!desired.has(col.name)) {
      drop.push({
        name: col.name,
        sql: `ALTER TABLE ${quote(ct.collectionName)} DROP COLUMN ${quote(col.name)}`,
      });
    }
  }

  return { add, drop, retype };
}

/**
 * Idempotent sync: ensure the table exists with the platform columns
 * (id/created_at/updated_at), then apply non-destructive adds. Drops
 * are NOT applied here — call applyDestructive(...) explicitly after
 * a confirmation flow.
 */
export async function syncTableToSchema(ct: ContentType) {
  await ensureBaseTable(ct);
  const diff = await diffTableAgainstSchema(ct);
  for (const a of diff.add) {
    await run(a.sql.replace(/\n/g, " "));
  }
  await ensureUidIndexes(ct);
}

/** Values of one uid column that more than one row carries, with the rows. */
async function duplicateValues(
  ct: ContentType,
  column: string,
): Promise<Array<{ value: string; ids: number[] }>> {
  const rows = await query<{ value: string; ids: string }>(
    `SELECT ${quote(column)} AS value, GROUP_CONCAT(id) AS ids FROM ${quote(ct.collectionName)} ` +
      `WHERE ${quote(column)} IS NOT NULL GROUP BY ${quote(column)} HAVING COUNT(*) > 1`,
  );
  return rows.map((row) => ({ value: row.value, ids: String(row.ids).split(",").map(Number) }));
}

/**
 * Index every uid (slug) column, unique where the data allows it.
 *
 * Entry routes resolve by slug and the create path de-dupes in application
 * code, so the column needs an index either way — and it needs the UNIQUE one
 * to make that de-dupe a constraint rather than a check-then-insert that two
 * concurrent creates can both pass. UNIQUE can't ride on the column itself
 * (attributes arrive via ADD COLUMN, which SQLite forbids to carry UNIQUE), and
 * CREATE UNIQUE INDEX refuses to build over existing duplicates — which, with
 * this running at boot, would take the whole instance down. So: unique index
 * when the column is clean, plain index plus a report when it isn't. Nothing
 * here renames a row — a duplicate is somebody's published URL, and which one
 * moves is the editor's call. Once they've fixed it, the next call upgrades
 * the index (the entry PATCH path calls this after a slug rename).
 */
export async function ensureUidIndexes(ct: ContentType): Promise<void> {
  const table = quote(ct.collectionName);
  for (const [name, attr] of Object.entries(ct.attributes)) {
    if (attr.type !== "uid") continue;
    const plain = quote(uidIndexName(ct.collectionName, name));
    const unique = uidUniqueIndexName(ct.collectionName, name);
    if (await indexExists(unique)) continue;
    const dupes = await duplicateValues(ct, name);
    if (dupes.length === 0) {
      // Two names, build-then-drop: the column is never without an index, a
      // duplicate landing between the scan and the build fails this CREATE
      // and leaves the plain index standing, and every statement is
      // idempotent, so isolates booting at the same moment can't trip each
      // other up.
      await run(`CREATE UNIQUE INDEX IF NOT EXISTS ${quote(unique)} ON ${table} (${quote(name)})`);
      await run(`DROP INDEX IF EXISTS ${plain}`);
      continue;
    }
    await run(`CREATE INDEX IF NOT EXISTS ${plain} ON ${table} (${quote(name)})`);
    console.warn(
      `${ct.collectionName}.${name}: not unique yet, duplicates: ` +
        dupes.map((d) => `'${d.value}' on ids ${d.ids.join(", ")}`).join("; "),
    );
  }
}

/** sqlite_master rather than PRAGMA index_list: identical on D1 and plain SQLite. */
async function indexExists(name: string): Promise<boolean> {
  const row = await get<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?",
    [name],
  );
  return Boolean(row);
}

/** Apply destructive ops — column drops. Caller is responsible for confirming. */
export async function applyDestructive(ct: ContentType) {
  const diff = await diffTableAgainstSchema(ct);
  for (const d of diff.drop) {
    // SQLite refuses to drop an indexed column, so remove the uid lookup
    // index first, whichever shape it has (no-op for columns that never had one).
    await run(`DROP INDEX IF EXISTS ${quote(uidIndexName(ct.collectionName, d.name))}`);
    await run(`DROP INDEX IF EXISTS ${quote(uidUniqueIndexName(ct.collectionName, d.name))}`);
    await run(d.sql.replace(/\n/g, " "));
  }
}

/** The plain lookup index — what a uid column has while duplicates block the unique one. */
function uidIndexName(table: string, column: string): string {
  return `idx_${table}_${column}`;
}

/** The unique index; a different name so it can be built before the plain one is dropped. */
function uidUniqueIndexName(table: string, column: string): string {
  return `uidx_${table}_${column}`;
}

async function ensureBaseTable(ct: ContentType) {
  await run(
    `CREATE TABLE IF NOT EXISTS ${quote(ct.collectionName)} (` +
      "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
      "created_at TEXT NOT NULL DEFAULT (datetime('now')), " +
      "updated_at TEXT NOT NULL DEFAULT (datetime('now')), " +
      `${quote(NOTES_COLUMN)} TEXT` +
      ")",
  );
  // Tables created before `notes` existed need it added. SQLite has no
  // ADD COLUMN IF NOT EXISTS, so check the live columns first.
  const cols = await query<ColumnInfo>(`PRAGMA table_info(${quote(ct.collectionName)})`);
  if (!cols.some((col) => col.name === NOTES_COLUMN)) {
    await run(
      `ALTER TABLE ${quote(ct.collectionName)} ADD COLUMN ${quote(NOTES_COLUMN)} TEXT`,
    );
  }
}

/** Map an Attribute back to a runtime TS type — used by the entry CRUD layer. */
export function jsTypeOf(attr: Attribute): "string" | "number" | "boolean" {
  if (attr.type === "integer" || attr.type === "decimal") return "number";
  if (attr.type === "boolean") return "boolean";
  return "string";
}

export const ATTRIBUTE_TYPES: AttributeType[] = [
  "string",
  "text",
  "richtext",
  "integer",
  "decimal",
  "boolean",
  "date",
  "datetime",
  "image",
  "html",
  "enumeration",
  "json",
  "uid",
];
