/**
 * Entry CRUD — generic over any content-type.
 *
 *   GET    /api/entries/:pluralName
 *   POST   /api/entries/:pluralName
 *   GET    /api/entries/:pluralName/:id
 *   PATCH  /api/entries/:pluralName/:id
 *   DELETE /api/entries/:pluralName/:id
 *
 * The legacy /api/posts routes are kept as a thin shim over these for
 * compatibility while the client migrates.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { get, query, run } from "./db";
import {
  Attribute,
  ContentType,
  getContentTypeByPluralName,
} from "./content-types";
import { NOTES_COLUMN } from "./schema-sync";

const ErrorSchema = z.object({ error: z.string() });
const EntrySchema = z.record(z.string(), z.any());

type Bindings = { DB: D1Database; UPLOADS: R2Bucket };

/**
 * Written into the OpenAPI spec (and from there `/llms.txt`) so an agent that
 * only ever reads the machine contract still finds the brief.
 */
const NOTES_DOC =
  `Every entry has a "${NOTES_COLUMN}" string — the author's brief: freeform context for ` +
  "whoever writes the content (the angle to take, first-hand experience to draw on, " +
  "what to avoid). Read it before generating or editing an entry and treat it " +
  "as the author's own material, not as content to publish verbatim. It never travels " +
  `on /api/entries/** (a public route); read it from GET /api/notes/{pluralName}/{id} ` +
  "and write it back through the entry PATCH.";

function quote(ident: string): string {
  return '"' + ident.replace(/"/g, '""') + '"';
}

/**
 * Entry reads are public — `clawnify.json` declares `GET /api/entries/**`, and
 * app-router classifies *every* caller on a declared public route as `public`
 * before it resolves identity, so there is no caller to branch on here even for
 * the signed-in editor. Access control belongs to the route, not to a header
 * test: notes are unconditionally absent from this payload and live on
 * `/api/notes/*`, which is outside the public glob and therefore gated by the
 * perimeter (`**` matches zero-or-more segments, so a sub-route under
 * `/api/entries/` would have inherited the public grant).
 */
function withoutNotes<T extends Record<string, unknown>>(row: T): T {
  const { [NOTES_COLUMN]: _internal, ...rest } = row;
  return rest as T;
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/['"]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "untitled"
  );
}

/** Ensure a uid attribute (slug-style) is unique across the table. */
async function uniqueValue(
  table: string,
  column: string,
  base: string,
  excludeId?: number | string,
): Promise<string> {
  let candidate = base;
  let n = 2;
  while (true) {
    const row = await get<{ id: number }>(
      `SELECT id FROM ${quote(table)} WHERE ${quote(column)} = ? AND id IS NOT ?`,
      [candidate, excludeId ?? -1],
    );
    if (!row) return candidate;
    candidate = `${base}-${n++}`;
  }
}

/**
 * Coerce + validate an incoming value for a given attribute. Throws on bad input.
 * Returns the SQL-bindable value (string|number|null).
 */
function coerce(value: unknown, attr: Attribute, fieldName: string): unknown {
  if (value === null || value === undefined) return null;
  switch (attr.type) {
    case "boolean":
      return value ? 1 : 0;
    case "integer":
      return Math.trunc(Number(value));
    case "decimal":
      return Number(value);
    case "json":
      return typeof value === "string" ? value : JSON.stringify(value);
    case "richtext":
      return typeof value === "string" ? value : JSON.stringify(value);
    case "enumeration":
      if ("enum" in attr && attr.enum && !attr.enum.includes(String(value))) {
        throw new Error(`${fieldName}: not in enum [${attr.enum.join(", ")}]`);
      }
      return String(value);
    default:
      return String(value);
  }
}

/** Notes are free text; an empty string is stored as NULL so "has notes" stays a null check. */
function coerceNotes(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value);
  return s.trim() === "" ? null : s;
}

async function findUidAttribute(ct: ContentType): Promise<[string, Attribute & { type: "uid" }] | null> {
  for (const [name, attr] of Object.entries(ct.attributes)) {
    if (attr.type === "uid") return [name, attr as Attribute & { type: "uid" }];
  }
  return null;
}

export function registerEntryRoutes(app: OpenAPIHono<{ Bindings: Bindings }>) {
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/entries/{pluralName}",
      description: `List every entry in a library, newest first. ${NOTES_DOC}`,
      request: { params: z.object({ pluralName: z.string() }) },
      responses: {
        200: { content: { "application/json": { schema: z.array(EntrySchema) } }, description: "OK" },
        404: { content: { "application/json": { schema: ErrorSchema } }, description: "Unknown library" },
      },
    }),
    async (c) => {
      const ct = await getContentTypeByPluralName(c.req.valid("param").pluralName);
      if (!ct) return c.json({ error: "Library not found" }, 404);
      const rows = await query<Record<string, unknown>>(
        `SELECT * FROM ${quote(ct.collectionName)} ORDER BY updated_at DESC, id DESC`,
      );
      return c.json(rows.map(withoutNotes), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/entries/{pluralName}/{id}",
      description: `Get one entry. ${NOTES_DOC}`,
      request: { params: z.object({ pluralName: z.string(), id: z.string() }) },
      responses: {
        200: { content: { "application/json": { schema: EntrySchema } }, description: "OK" },
        404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
      },
    }),
    async (c) => {
      const { pluralName, id } = c.req.valid("param");
      const ct = await getContentTypeByPluralName(pluralName);
      if (!ct) return c.json({ error: "Library not found" }, 404);
      const row = await get<Record<string, unknown>>(
        `SELECT * FROM ${quote(ct.collectionName)} WHERE id = ?`,
        [id],
      );
      if (!row) return c.json({ error: "Not found" }, 404);
      return c.json(withoutNotes(row), 200);
    },
  );

  // The brief lives off the public `/api/entries/**` glob on purpose — see
  // withoutNotes(). Nothing here checks the caller: `/api/notes/*` is undeclared
  // in clawnify.json, so app-router refuses anonymous requests at the edge, and
  // agent calls (which dispatch straight to the Worker) pass through.
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/notes/{pluralName}/{id}",
      description: `Read one entry's author brief. ${NOTES_DOC}`,
      request: { params: z.object({ pluralName: z.string(), id: z.string() }) },
      responses: {
        200: {
          content: { "application/json": { schema: z.object({ notes: z.string().nullable() }) } },
          description: "OK",
        },
        404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
      },
    }),
    async (c) => {
      const { pluralName, id } = c.req.valid("param");
      const ct = await getContentTypeByPluralName(pluralName);
      if (!ct) return c.json({ error: "Library not found" }, 404);
      const row = await get<Record<string, unknown>>(
        `SELECT ${quote(NOTES_COLUMN)} FROM ${quote(ct.collectionName)} WHERE id = ?`,
        [id],
      );
      if (!row) return c.json({ error: "Not found" }, 404);
      const value = row[NOTES_COLUMN];
      return c.json({ notes: typeof value === "string" ? value : null }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/entries/{pluralName}",
      description: `Create an entry. ${NOTES_DOC}`,
      request: {
        params: z.object({ pluralName: z.string() }),
        body: { content: { "application/json": { schema: z.record(z.string(), z.any()) } } },
      },
      responses: {
        200: { content: { "application/json": { schema: EntrySchema } }, description: "Created" },
        400: { content: { "application/json": { schema: ErrorSchema } }, description: "Bad input" },
        404: { content: { "application/json": { schema: ErrorSchema } }, description: "Unknown library" },
      },
    }),
    async (c) => {
      const { pluralName } = c.req.valid("param");
      const ct = await getContentTypeByPluralName(pluralName);
      if (!ct) return c.json({ error: "Library not found" }, 404);
      const body = c.req.valid("json") as Record<string, unknown>;

      const uidEntry = await findUidAttribute(ct);
      const cols: string[] = [];
      const placeholders: string[] = [];
      const params: unknown[] = [];

      for (const [name, attr] of Object.entries(ct.attributes)) {
        if (uidEntry && uidEntry[0] === name) continue; // handle separately
        if (body[name] === undefined) continue;
        cols.push(quote(name));
        placeholders.push("?");
        params.push(coerce(body[name], attr, name));
      }

      // `notes` is a platform column, not an attribute, so it isn't covered by
      // the loop above.
      if (body[NOTES_COLUMN] !== undefined) {
        cols.push(quote(NOTES_COLUMN));
        placeholders.push("?");
        params.push(coerceNotes(body[NOTES_COLUMN]));
      }

      // Auto-generate uid (slug) from its targetField if not provided
      if (uidEntry) {
        const [uidName, uidAttr] = uidEntry;
        const provided = body[uidName];
        let base: string;
        if (typeof provided === "string" && provided.trim()) {
          base = slugify(provided);
        } else {
          const target = uidAttr.targetField ?? "title";
          const sourceVal = body[target] ?? "untitled";
          base = slugify(String(sourceVal));
        }
        const uniq = await uniqueValue(ct.collectionName, uidName, base);
        cols.push(quote(uidName));
        placeholders.push("?");
        params.push(uniq);
      }

      if (cols.length === 0) {
        // Insert a row with only defaults — SQLite needs an explicit DEFAULT VALUES
        await run(`INSERT INTO ${quote(ct.collectionName)} DEFAULT VALUES`);
      } else {
        await run(
          `INSERT INTO ${quote(ct.collectionName)} (${cols.join(", ")}) VALUES (${placeholders.join(", ")})`,
          params,
        );
      }
      const created = await get(
        `SELECT * FROM ${quote(ct.collectionName)} WHERE id = (SELECT MAX(id) FROM ${quote(ct.collectionName)})`,
      );
      return c.json(created!, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/api/entries/{pluralName}/{id}",
      description: `Update any subset of an entry's fields. ${NOTES_DOC}`,
      request: {
        params: z.object({ pluralName: z.string(), id: z.string() }),
        body: { content: { "application/json": { schema: z.record(z.string(), z.any()) } } },
      },
      responses: {
        200: { content: { "application/json": { schema: EntrySchema } }, description: "Updated" },
        404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
      },
    }),
    async (c) => {
      const { pluralName, id } = c.req.valid("param");
      const ct = await getContentTypeByPluralName(pluralName);
      if (!ct) return c.json({ error: "Library not found" }, 404);
      const row = await get(`SELECT * FROM ${quote(ct.collectionName)} WHERE id = ?`, [id]);
      if (!row) return c.json({ error: "Not found" }, 404);
      const body = c.req.valid("json") as Record<string, unknown>;

      const sets: string[] = [];
      const params: unknown[] = [];

      for (const [name, attr] of Object.entries(ct.attributes)) {
        if (!(name in body)) continue;
        if (attr.type === "uid") {
          const provided = body[name];
          if (typeof provided === "string" && provided.trim()) {
            const uniq = await uniqueValue(ct.collectionName, name, slugify(provided), id);
            sets.push(`${quote(name)} = ?`);
            params.push(uniq);
          }
          continue;
        }
        sets.push(`${quote(name)} = ?`);
        params.push(coerce(body[name], attr, name));
      }

      // `notes` is a platform column, not an attribute (see the POST handler).
      if (NOTES_COLUMN in body) {
        sets.push(`${quote(NOTES_COLUMN)} = ?`);
        params.push(coerceNotes(body[NOTES_COLUMN]));
      }

      if (sets.length === 0) return c.json(row, 200);
      sets.push(`updated_at = datetime('now')`);
      params.push(id);
      await run(
        `UPDATE ${quote(ct.collectionName)} SET ${sets.join(", ")} WHERE id = ?`,
        params,
      );
      const next = await get(`SELECT * FROM ${quote(ct.collectionName)} WHERE id = ?`, [id]);
      return c.json(next!, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/api/entries/{pluralName}/{id}",
      request: { params: z.object({ pluralName: z.string(), id: z.string() }) },
      responses: {
        200: { content: { "application/json": { schema: z.object({ ok: z.boolean() }) } }, description: "Deleted" },
        404: { content: { "application/json": { schema: ErrorSchema } }, description: "Unknown library" },
      },
    }),
    async (c) => {
      const { pluralName, id } = c.req.valid("param");
      const ct = await getContentTypeByPluralName(pluralName);
      if (!ct) return c.json({ error: "Library not found" }, 404);
      await run(`DELETE FROM ${quote(ct.collectionName)} WHERE id = ?`, [id]);
      return c.json({ ok: true }, 200);
    },
  );
}
