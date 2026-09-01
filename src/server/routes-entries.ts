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

/**
 * `WHERE status = 'live'` — applied to the PUBLIC entry reads only.
 *
 * A new entry defaults to `status: "draft"`, and these reads used to return
 * every row whatever its status, so a draft was world-readable the moment it was
 * saved. The consuming site filtered `status === "live"` in its own code, which
 * hides drafts on the page but not from anyone calling the API directly.
 *
 * There is deliberately NO caller check here. app-router resolves a declared
 * public route to `authMethod = "public"` BEFORE it looks at IP, token or
 * cookie, so every caller on `/api/entries/**` arrives stamped
 * `X-Clawnify-Caller: public` with no identity headers — including the signed-in
 * editor. Branching on `caller()` would therefore hide drafts from the very UI
 * that authors them. Access control belongs to the route: the editor reads
 * `/api/admin/entries/*`, which is outside the public glob and so gated by the
 * perimeter, exactly like `/api/notes/*`.
 *
 * Only applied to content types that actually declare a `status` attribute:
 * `draftAndPublish` is optional and is not added to types created through the
 * UI, so filtering unconditionally would emit SQL against a missing column and
 * 500 every collection without one.
 */
function publishedOnlyClause(ct: ContentType): string {
  const hasStatus = Boolean((ct.attributes as Record<string, unknown> | undefined)?.status);
  return hasStatus ? ` WHERE status = 'live'` : "";
}

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
  "and write it back through the entry PATCH. " +
  "Each LIBRARY has a brief of its own too — the standing conventions every entry in it " +
  "follows (house style, markup to use, what the surface rendering it supports). Read it " +
  "from GET /api/notes/{pluralName} before writing any entry in that library, and treat " +
  "it as binding unless the entry's own notes override it.";

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

/**
 * Resolve the `{id}` path segment to a numeric row id. An all-digit segment is
 * an id; anything else is looked up against the type's uid (slug) column,
 * which the create path keeps unique per collection — so the slug a caller
 * already knows (from the entry's URL, or from having created it) addresses
 * the entry without a list-and-map round trip. Returns null when nothing
 * matches, or when the segment is non-numeric and the type has no uid.
 */
async function resolveEntryId(ct: ContentType, segment: string): Promise<number | null> {
  if (/^\d+$/.test(segment)) return Number(segment);
  const uidEntry = await findUidAttribute(ct);
  if (!uidEntry) return null;
  const row = await get<{ id: number }>(
    `SELECT id FROM ${quote(ct.collectionName)} WHERE ${quote(uidEntry[0])} = ?`,
    [segment],
  );
  return row ? row.id : null;
}

/** The `{id}` segment of every single-entry route accepts either handle. */
const IdParam = z.string().openapi({
  description:
    "Numeric id, or the entry's slug (uid). An all-digit segment is treated as an id.",
});

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
        `SELECT * FROM ${quote(ct.collectionName)}${publishedOnlyClause(ct)} ORDER BY updated_at DESC, id DESC`,
      );
      return c.json(rows.map(withoutNotes), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/entries/{pluralName}/{id}",
      description: `Get one entry. ${NOTES_DOC}`,
      request: { params: z.object({ pluralName: z.string(), id: IdParam }) },
      responses: {
        200: { content: { "application/json": { schema: EntrySchema } }, description: "OK" },
        404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
      },
    }),
    async (c) => {
      const { pluralName, id } = c.req.valid("param");
      const ct = await getContentTypeByPluralName(pluralName);
      if (!ct) return c.json({ error: "Library not found" }, 404);
      const entryId = await resolveEntryId(ct, id);
      const row =
        entryId === null
          ? undefined
          : await get<Record<string, unknown>>(
              `SELECT * FROM ${quote(ct.collectionName)} WHERE id = ?`,
              [entryId],
            );
      if (!row) return c.json({ error: "Not found" }, 404);
      // A draft fetched by id is 404 to the public, not 403: confirming that an
      // id exists is itself a leak, and the list above already hides it.
      if (publishedOnlyClause(ct) && row.status !== "live") {
        return c.json({ error: "Not found" }, 404);
      }
      return c.json(withoutNotes(row), 200);
    },
  );

  // Editor reads. Same rows as the public list, minus the published-only filter,
  // so authors can see and edit their own drafts.
  //
  // `/api/admin/*` is UNDECLARED in clawnify.json — exactly like `/api/notes/*` —
  // so app-router refuses anonymous callers at the edge and this needs no header
  // test of its own. That is the whole reason it exists as a separate path
  // instead of a query flag on the public route: a `?includeDrafts=1` on a
  // declared-public route is reachable by anyone.
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/admin/entries/{pluralName}",
      description: "List every entry in a library including drafts. Editor-only; not a public route.",
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
      path: "/api/admin/entries/{pluralName}/{id}",
      description: "Get one entry, draft or live. Editor-only; not a public route.",
      request: { params: z.object({ pluralName: z.string(), id: IdParam }) },
      responses: {
        200: { content: { "application/json": { schema: EntrySchema } }, description: "OK" },
        404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
      },
    }),
    async (c) => {
      const { pluralName, id } = c.req.valid("param");
      const ct = await getContentTypeByPluralName(pluralName);
      if (!ct) return c.json({ error: "Library not found" }, 404);
      const entryId = await resolveEntryId(ct, id);
      const row =
        entryId === null
          ? undefined
          : await get<Record<string, unknown>>(
              `SELECT * FROM ${quote(ct.collectionName)} WHERE id = ?`,
              [entryId],
            );
      if (!row) return c.json({ error: "Not found" }, 404);
      return c.json(withoutNotes(row), 200);
    },
  );

  // The library's own brief — the conventions that hold for every entry in it,
  // as opposed to the per-entry brief below. It lives on the content type
  // (`info.notes`) rather than in a row, because it outlives every entry and
  // there is exactly one of it. Served from the same `/api/notes/*` prefix so
  // "where are the notes" has one answer, and gated the same way: undeclared in
  // clawnify.json, so the edge refuses anonymous callers.
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/notes/{pluralName}",
      description: `Read a library's standing brief. ${NOTES_DOC}`,
      request: { params: z.object({ pluralName: z.string() }) },
      responses: {
        200: {
          content: { "application/json": { schema: z.object({ notes: z.string().nullable() }) } },
          description: "OK",
        },
        404: { content: { "application/json": { schema: ErrorSchema } }, description: "Unknown library" },
      },
    }),
    async (c) => {
      const ct = await getContentTypeByPluralName(c.req.valid("param").pluralName);
      if (!ct) return c.json({ error: "Library not found" }, 404);
      const value = ct.info.notes;
      return c.json({ notes: typeof value === "string" && value.trim() ? value : null }, 200);
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
      request: { params: z.object({ pluralName: z.string(), id: IdParam }) },
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
      const entryId = await resolveEntryId(ct, id);
      const row =
        entryId === null
          ? undefined
          : await get<Record<string, unknown>>(
              `SELECT ${quote(NOTES_COLUMN)} FROM ${quote(ct.collectionName)} WHERE id = ?`,
              [entryId],
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

      // Recover the new row by this insert's own rowid, not MAX(id): two
      // concurrent creates each get their own row back.
      const inserted =
        cols.length === 0
          ? // Insert a row with only defaults — SQLite needs an explicit DEFAULT VALUES
            await run(`INSERT INTO ${quote(ct.collectionName)} DEFAULT VALUES`)
          : await run(
              `INSERT INTO ${quote(ct.collectionName)} (${cols.join(", ")}) VALUES (${placeholders.join(", ")})`,
              params,
            );
      // lastInsertRowid is 0 on bindings that don't surface insert meta; only
      // then fall back to the (racy) MAX(id) recovery this used to rely on.
      const created = inserted.lastInsertRowid
        ? await get(`SELECT * FROM ${quote(ct.collectionName)} WHERE id = ?`, [
            inserted.lastInsertRowid,
          ])
        : await get(
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
        params: z.object({ pluralName: z.string(), id: IdParam }),
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
      const entryId = await resolveEntryId(ct, id);
      const row =
        entryId === null
          ? undefined
          : await get(`SELECT * FROM ${quote(ct.collectionName)} WHERE id = ?`, [entryId]);
      if (!row) return c.json({ error: "Not found" }, 404);
      const body = c.req.valid("json") as Record<string, unknown>;

      const sets: string[] = [];
      const params: unknown[] = [];

      for (const [name, attr] of Object.entries(ct.attributes)) {
        if (!(name in body)) continue;
        if (attr.type === "uid") {
          const provided = body[name];
          if (typeof provided === "string" && provided.trim()) {
            const uniq = await uniqueValue(ct.collectionName, name, slugify(provided), entryId!);
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
      params.push(entryId);
      await run(
        `UPDATE ${quote(ct.collectionName)} SET ${sets.join(", ")} WHERE id = ?`,
        params,
      );
      const next = await get(`SELECT * FROM ${quote(ct.collectionName)} WHERE id = ?`, [entryId]);
      return c.json(next!, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/api/entries/{pluralName}/{id}",
      request: { params: z.object({ pluralName: z.string(), id: IdParam }) },
      responses: {
        200: { content: { "application/json": { schema: z.object({ ok: z.boolean() }) } }, description: "Deleted" },
        404: { content: { "application/json": { schema: ErrorSchema } }, description: "Unknown library" },
      },
    }),
    async (c) => {
      const { pluralName, id } = c.req.valid("param");
      const ct = await getContentTypeByPluralName(pluralName);
      if (!ct) return c.json({ error: "Library not found" }, 404);
      // Delete is idempotent: an already-gone entry (unresolvable slug included)
      // is a success, matching the numeric-id behavior.
      const entryId = await resolveEntryId(ct, id);
      if (entryId !== null) {
        await run(`DELETE FROM ${quote(ct.collectionName)} WHERE id = ?`, [entryId]);
      }
      return c.json({ ok: true }, 200);
    },
  );
}
