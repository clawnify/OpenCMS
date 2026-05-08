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
import { query } from "./db";

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

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
    case "media":
    case "date":
    case "datetime":
    default:
      return "TEXT";
  }
}

/** SQL literal for a default value, or null if not set. */
function defaultLiteral(attr: Attribute): string | null {
  if (attr.default === undefined || attr.default === null) return null;
  if (typeof attr.default === "boolean") return attr.default ? "1" : "0";
  if (typeof attr.default === "number") return String(attr.default);
  return `'${String(attr.default).replace(/'/g, "''")}'`;
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
  db: D1Database,
  ct: ContentType,
): Promise<SchemaDiff> {
  await ensureBaseTable(db, ct);

  const cols = await query<ColumnInfo>(`PRAGMA table_info(${quote(ct.collectionName)})`);
  const colByName = new Map(cols.map((c) => [c.name, c]));
  const desired = new Set(["id", "created_at", "updated_at", ...Object.keys(ct.attributes)]);

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
export async function syncTableToSchema(db: D1Database, ct: ContentType) {
  await ensureBaseTable(db, ct);
  const diff = await diffTableAgainstSchema(db, ct);
  for (const a of diff.add) {
    await db.exec(a.sql.replace(/\n/g, " "));
  }
}

/** Apply destructive ops — column drops. Caller is responsible for confirming. */
export async function applyDestructive(db: D1Database, ct: ContentType) {
  const diff = await diffTableAgainstSchema(db, ct);
  for (const d of diff.drop) {
    await db.exec(d.sql.replace(/\n/g, " "));
  }
}

async function ensureBaseTable(db: D1Database, ct: ContentType) {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS ${quote(ct.collectionName)} (` +
      "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
      "created_at TEXT NOT NULL DEFAULT (datetime('now')), " +
      "updated_at TEXT NOT NULL DEFAULT (datetime('now'))" +
      ");",
  );
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
  "media",
  "enumeration",
  "json",
  "uid",
];
