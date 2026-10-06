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
  holdsStructure,
} from "./content-types";
import { NOTES_COLUMN, PLATFORM_COLUMNS, ensureUidIndexes } from "./schema-sync";

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

/**
 * Upper bound on `?limit`. A list call is a single unindexed table scan, so the
 * cap is what stops one request from reading a whole library into memory; a
 * caller that genuinely wants everything omits `limit` and gets the historical
 * unbounded response.
 */
const MAX_LIMIT = 500;

/**
 * Page size assumed when a caller asks for a `page` without saying how big one
 * is. Matches the sibling templates' shared `paginate()` default, so the number
 * means the same thing across the fleet.
 */
const DEFAULT_PAGE_SIZE = 25;

/**
 * `?limit`, `?page` and `?fields` on the list routes — all optional, and a
 * request that sends none of them gets byte-for-byte what it got before they
 * existed. That is deliberate: these routes are declared public in
 * `clawnify.json`, so the callers are sites and third-party tools this repo
 * cannot see, and silently truncating or trimming their responses would break
 * pages rather than speed them up.
 *
 * The cost they exist to remove is real: a row carries every field of the
 * entry, richtext bodies included, so listing a content library to render an
 * index — or to let an agent pick an entry to edit — transfers the entire
 * corpus to read a column of titles.
 *
 * Query values arrive as strings, so they are typed as strings here (which is
 * also what the OpenAPI spec should say) and parsed below, where a bad value
 * can return the same `{ error }` shape as every other failure in this file
 * instead of a raw validation dump.
 */
const ListQuerySchema = z.object({
  limit: z.string().optional().openapi({
    param: { name: "limit", in: "query" },
    description: `Maximum number of entries to return, 1-${MAX_LIMIT}. Omit to return every entry.`,
    example: "25",
  }),
  page: z.string().optional().openapi({
    param: { name: "page", in: "query" },
    description: `1-based page number. Implies a default \`limit\` of ${DEFAULT_PAGE_SIZE} when limit is absent.`,
    example: "2",
  }),
  fields: z.string().optional().openapi({
    param: { name: "fields", in: "query" },
    description:
      "Comma-separated field names to return, e.g. `title,slug,status`. `id` is always " +
      "included so the entries stay addressable. Omit to return every field. Use it to " +
      "list a library without transferring its richtext bodies.",
    example: "title,slug,status",
  }),
});

/** Response header carrying the unpaged total, sent only when the caller pages. */
const TotalCountHeader = {
  "X-Total-Count": {
    schema: { type: "integer" as const },
    description:
      "Total entries matching the request, ignoring limit/page. Sent only when limit or page is present.",
  },
};

type ListWindow = { limit: number | null; offset: number; columns: string[] | null };

/** Parse a positive integer query value; null means "absent", undefined means "malformed". */
function parseCount(raw: string | undefined, min: number): number | null | undefined {
  if (raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) return undefined;
  return n;
}

/**
 * Which columns a caller may ask for: the type's own attributes plus the
 * platform columns, minus `notes`. Notes are excluded rather than merely
 * stripped after the fact, so `?fields=notes` is a 400 and never a silently
 * empty column — the brief is served from `/api/notes/*` alone.
 */
function selectableColumns(ct: ContentType): Set<string> {
  const cols = new Set<string>(Object.keys(ct.attributes));
  for (const col of PLATFORM_COLUMNS) cols.add(col);
  cols.delete(NOTES_COLUMN);
  return cols;
}

/** Parse the list query into a SQL window, or return the message to 400 with. */
function parseListWindow(
  ct: ContentType,
  q: { limit?: string; page?: string; fields?: string },
): ListWindow | { error: string } {
  const limit = parseCount(q.limit, 1);
  if (limit === undefined) return { error: `limit must be an integer between 1 and ${MAX_LIMIT}` };
  if (limit !== null && limit > MAX_LIMIT) {
    return { error: `limit must be an integer between 1 and ${MAX_LIMIT}` };
  }

  const page = parseCount(q.page, 1);
  if (page === undefined) return { error: "page must be an integer of 1 or more" };
  // Asking for a page IS asking to paginate, so a page with no size gets the
  // house default rather than an unbounded read that ignores the parameter.
  const pageSize = limit ?? (page === null ? null : DEFAULT_PAGE_SIZE);
  const offset = page === null ? 0 : (page - 1) * (pageSize as number);

  let columns: string[] | null = null;
  if (q.fields !== undefined) {
    const allowed = selectableColumns(ct);
    const asked = q.fields
      .split(",")
      .map((f) => f.trim())
      .filter((f) => f !== "");
    if (asked.length === 0) return { error: "fields must list at least one field name" };
    const unknown = asked.filter((f) => !allowed.has(f));
    if (unknown.length > 0) {
      return {
        error: `unknown field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. Known fields: ${[...allowed].sort().join(", ")}`,
      };
    }
    // `id` addresses the entry on every other route, so it rides along even
    // when it was not asked for; a list of rows nothing can be done with is
    // not worth serving.
    columns = ["id", ...asked.filter((f) => f !== "id")];
  }

  return { limit: pageSize, offset, columns };
}

/**
 * `?fields` on a single-entry read. Same whitelist as the list, so a caller that
 * learned the parameter on one route is not silently ignored on the other — the
 * quietest way for a public API to lie about what it accepts.
 */
const FieldsQuerySchema = z.object({ fields: ListQuerySchema.shape.fields });

function parseFields(ct: ContentType, q: { fields?: string }): string[] | null | { error: string } {
  const win = parseListWindow(ct, { fields: q.fields });
  return "error" in win ? win : win.columns;
}

/** SQL fragment + bindings for the window. Empty when the caller asked for no bound. */
function windowClause(win: ListWindow): { sql: string; params: number[] } {
  if (win.limit === null && win.offset === 0) return { sql: "", params: [] };
  // SQLite rejects OFFSET without LIMIT; -1 is its documented "no limit".
  return { sql: " LIMIT ? OFFSET ?", params: [win.limit ?? -1, win.offset] };
}

/**
 * The unpaged total behind `X-Total-Count`. Only run when the caller pages, so a
 * plain list call still costs exactly one query.
 */
async function countEntries(ct: ContentType, where: string): Promise<number> {
  const row = await get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${quote(ct.collectionName)}${where}`,
  );
  return row?.n ?? 0;
}

function selectList(win: ListWindow): string {
  return win.columns ? win.columns.map(quote).join(", ") : "*";
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

/**
 * Appended to the write routes' descriptions so the rule is in the OpenAPI spec
 * an agent reads before it writes, not only in the 400 it gets afterwards.
 */
const WRITE_DOC =
  'Only "json" and "richtext" fields accept an object or array; every other field type ' +
  "holds text, and sending structure to one is a 400 rather than a stored " +
  '"[object Object]". Send a string, or declare the field as "json".';

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
 * The unique index behind a uid column (see ensureUidIndexes) is the backstop
 * for the check-then-insert above: when two concurrent writes both pass the
 * check, the second INSERT/UPDATE fails here instead of minting a duplicate.
 * Same message on D1 and plain SQLite.
 */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}

/**
 * A write the caller got wrong — a value the declared field cannot hold. Its
 * own class so the handlers can answer 400 with the message, and so a genuine
 * fault further down still surfaces as a 500 instead of being reported as the
 * caller's fault.
 */
class FieldError extends Error {}

/**
 * Reject a value the field cannot hold, rather than letting String() or
 * Number() turn it into a stored `"[object Object]"` or NaN.
 *
 * This is the whole reason the write path validates at all. `String({})` does
 * not fail, it succeeds with garbage, so without this the request is a 200
 * carrying a destroyed payload — and the two shapes below are the ones that
 * reach a string or number column by accident:
 *
 *   - an object or array sent to anything but json/richtext,
 *   - a value that is not a number sent to integer/decimal.
 *
 * Neither can be salvaged by guessing. Serializing an object into a field the
 * author declared `string` would invent a type the schema does not have, and
 * the value would come back out as a string, so the round trip would still not
 * be the one the caller asked for. The error instead names the type that does
 * hold structure, because "declare the field json" is the actual fix.
 */
function assertHoldable(value: unknown, attr: Attribute, fieldName: string): void {
  if (typeof value === "object" && !holdsStructure(attr.type)) {
    throw new FieldError(
      `${fieldName}: a "${attr.type}" field holds text, not ${Array.isArray(value) ? "an array" : "an object"}. ` +
        `Send a string, or declare this field as "json" to store structured values.`,
    );
  }
}

/**
 * Coerce + validate an incoming value for a given attribute. Throws FieldError
 * on bad input. Returns the SQL-bindable value (string|number|null).
 */
function coerce(value: unknown, attr: Attribute, fieldName: string): unknown {
  if (value === null || value === undefined) return null;
  assertHoldable(value, attr, fieldName);
  switch (attr.type) {
    case "boolean":
      return value ? 1 : 0;
    case "integer":
    case "decimal": {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        throw new FieldError(`${fieldName}: expected a number, got ${JSON.stringify(value)}`);
      }
      return attr.type === "integer" ? Math.trunc(n) : n;
    }
    case "json":
      return typeof value === "string" ? value : JSON.stringify(value);
    case "richtext":
      return typeof value === "string" ? value : JSON.stringify(value);
    case "enumeration":
      if ("enum" in attr && attr.enum && !attr.enum.includes(String(value))) {
        throw new FieldError(`${fieldName}: not in enum [${attr.enum.join(", ")}]`);
      }
      return String(value);
    default:
      return String(value);
  }
}

/**
 * Notes are free text; an empty string is stored as NULL so "has notes" stays a
 * null check. An object here is the same lossy write as above — the brief is
 * prose, and `String({})` would file "[object Object]" as the author's brief.
 */
function coerceNotes(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    throw new FieldError(`${NOTES_COLUMN}: expected a string, got ${Array.isArray(value) ? "an array" : "an object"}`);
  }
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
      description:
        "List the entries in a library, newest first. Returns every entry and every field " +
        "unless `limit`, `page` or `fields` narrows it — prefer `fields` when you only need " +
        `a few columns, since an entry carries its full richtext body. ${NOTES_DOC}`,
      request: { params: z.object({ pluralName: z.string() }), query: ListQuerySchema },
      responses: {
        200: {
          content: { "application/json": { schema: z.array(EntrySchema) } },
          headers: TotalCountHeader,
          description: "OK",
        },
        400: { content: { "application/json": { schema: ErrorSchema } }, description: "Bad query" },
        404: { content: { "application/json": { schema: ErrorSchema } }, description: "Unknown library" },
      },
    }),
    async (c) => {
      const ct = await getContentTypeByPluralName(c.req.valid("param").pluralName);
      if (!ct) return c.json({ error: "Library not found" }, 404);
      const win = parseListWindow(ct, c.req.valid("query"));
      if ("error" in win) return c.json({ error: win.error }, 400);
      const where = publishedOnlyClause(ct);
      const window = windowClause(win);
      const rows = await query<Record<string, unknown>>(
        `SELECT ${selectList(win)} FROM ${quote(ct.collectionName)}${where} ORDER BY updated_at DESC, id DESC${window.sql}`,
        window.params,
      );
      if (window.sql) c.header("X-Total-Count", String(await countEntries(ct, where)));
      return c.json(rows.map(withoutNotes), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/entries/{pluralName}/{id}",
      description: `Get one entry. ${NOTES_DOC}`,
      request: {
        params: z.object({ pluralName: z.string(), id: IdParam }),
        query: FieldsQuerySchema,
      },
      responses: {
        200: { content: { "application/json": { schema: EntrySchema } }, description: "OK" },
        400: { content: { "application/json": { schema: ErrorSchema } }, description: "Bad query" },
        404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
      },
    }),
    async (c) => {
      const { pluralName, id } = c.req.valid("param");
      const ct = await getContentTypeByPluralName(pluralName);
      if (!ct) return c.json({ error: "Library not found" }, 404);
      const fields = parseFields(ct, c.req.valid("query"));
      if (fields && "error" in fields) return c.json({ error: fields.error }, 400);
      // `status` decides the draft check below, so it is read whatever the
      // caller selected and dropped again before the row goes out.
      const select = fields ? [...new Set([...fields, "status"])] : null;
      const entryId = await resolveEntryId(ct, id);
      const row =
        entryId === null
          ? undefined
          : await get<Record<string, unknown>>(
              `SELECT ${select ? select.map(quote).join(", ") : "*"} FROM ${quote(ct.collectionName)} WHERE id = ?`,
              [entryId],
            );
      if (!row) return c.json({ error: "Not found" }, 404);
      // A draft fetched by id is 404 to the public, not 403: confirming that an
      // id exists is itself a leak, and the list above already hides it.
      if (publishedOnlyClause(ct) && row.status !== "live") {
        return c.json({ error: "Not found" }, 404);
      }
      if (fields && !fields.includes("status")) delete row.status;
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
      description:
        "List the entries in a library including drafts, newest first. Takes the same " +
        "`limit`, `page` and `fields` as the public list. Editor-only; not a public route.",
      request: { params: z.object({ pluralName: z.string() }), query: ListQuerySchema },
      responses: {
        200: {
          content: { "application/json": { schema: z.array(EntrySchema) } },
          headers: TotalCountHeader,
          description: "OK",
        },
        400: { content: { "application/json": { schema: ErrorSchema } }, description: "Bad query" },
        404: { content: { "application/json": { schema: ErrorSchema } }, description: "Unknown library" },
      },
    }),
    async (c) => {
      const ct = await getContentTypeByPluralName(c.req.valid("param").pluralName);
      if (!ct) return c.json({ error: "Library not found" }, 404);
      const win = parseListWindow(ct, c.req.valid("query"));
      if ("error" in win) return c.json({ error: win.error }, 400);
      const window = windowClause(win);
      const rows = await query<Record<string, unknown>>(
        `SELECT ${selectList(win)} FROM ${quote(ct.collectionName)} ORDER BY updated_at DESC, id DESC${window.sql}`,
        window.params,
      );
      if (window.sql) c.header("X-Total-Count", String(await countEntries(ct, "")));
      return c.json(rows.map(withoutNotes), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/admin/entries/{pluralName}/{id}",
      description: "Get one entry, draft or live. Takes the same `fields`. Editor-only; not a public route.",
      request: {
        params: z.object({ pluralName: z.string(), id: IdParam }),
        query: FieldsQuerySchema,
      },
      responses: {
        200: { content: { "application/json": { schema: EntrySchema } }, description: "OK" },
        400: { content: { "application/json": { schema: ErrorSchema } }, description: "Bad query" },
        404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
      },
    }),
    async (c) => {
      const { pluralName, id } = c.req.valid("param");
      const ct = await getContentTypeByPluralName(pluralName);
      if (!ct) return c.json({ error: "Library not found" }, 404);
      const fields = parseFields(ct, c.req.valid("query"));
      if (fields && "error" in fields) return c.json({ error: fields.error }, 400);
      const entryId = await resolveEntryId(ct, id);
      const row =
        entryId === null
          ? undefined
          : await get<Record<string, unknown>>(
              `SELECT ${fields ? fields.map(quote).join(", ") : "*"} FROM ${quote(ct.collectionName)} WHERE id = ?`,
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
      description: `Create an entry. ${WRITE_DOC} ${NOTES_DOC}`,
      request: {
        params: z.object({ pluralName: z.string() }),
        body: { content: { "application/json": { schema: z.record(z.string(), z.any()) } } },
      },
      responses: {
        200: { content: { "application/json": { schema: EntrySchema } }, description: "Created" },
        400: { content: { "application/json": { schema: ErrorSchema } }, description: "Bad input" },
        404: { content: { "application/json": { schema: ErrorSchema } }, description: "Unknown library" },
        409: { content: { "application/json": { schema: ErrorSchema } }, description: "Slug taken by a concurrent write" },
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

      try {
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
      } catch (err) {
        if (err instanceof FieldError) return c.json({ error: err.message }, 400);
        throw err;
      }

      // Auto-generate uid (slug) from its targetField if not provided
      let uidValue: { name: string; value: string } | null = null;
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
        uidValue = { name: uidName, value: uniq };
      }

      // Recover the new row by this insert's own rowid, not MAX(id): two
      // concurrent creates each get their own row back.
      let inserted;
      try {
        inserted =
          cols.length === 0
            ? // Insert a row with only defaults — SQLite needs an explicit DEFAULT VALUES
              await run(`INSERT INTO ${quote(ct.collectionName)} DEFAULT VALUES`)
            : await run(
                `INSERT INTO ${quote(ct.collectionName)} (${cols.join(", ")}) VALUES (${placeholders.join(", ")})`,
                params,
              );
      } catch (err) {
        if (!isUniqueViolation(err) || !uidValue) throw err;
        return c.json({ error: `${uidValue.name} '${uidValue.value}' was just taken by another write, retry` }, 409);
      }
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
      description: `Update any subset of an entry's fields. ${WRITE_DOC} ${NOTES_DOC}`,
      request: {
        params: z.object({ pluralName: z.string(), id: IdParam }),
        body: { content: { "application/json": { schema: z.record(z.string(), z.any()) } } },
      },
      responses: {
        200: { content: { "application/json": { schema: EntrySchema } }, description: "Updated" },
        400: { content: { "application/json": { schema: ErrorSchema } }, description: "Bad input" },
        404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
        409: { content: { "application/json": { schema: ErrorSchema } }, description: "Slug taken by a concurrent write" },
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
      let renamedUid: { name: string; value: string } | null = null;

      try {
        for (const [name, attr] of Object.entries(ct.attributes)) {
          if (!(name in body)) continue;
          if (attr.type === "uid") {
            const provided = body[name];
            if (typeof provided === "string" && provided.trim()) {
              const uniq = await uniqueValue(ct.collectionName, name, slugify(provided), entryId!);
              sets.push(`${quote(name)} = ?`);
              params.push(uniq);
              renamedUid = { name, value: uniq };
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
      } catch (err) {
        if (err instanceof FieldError) return c.json({ error: err.message }, 400);
        throw err;
      }

      if (sets.length === 0) return c.json(row, 200);
      sets.push(`updated_at = datetime('now')`);
      params.push(entryId);
      try {
        await run(
          `UPDATE ${quote(ct.collectionName)} SET ${sets.join(", ")} WHERE id = ?`,
          params,
        );
      } catch (err) {
        if (!isUniqueViolation(err) || !renamedUid) throw err;
        return c.json({ error: `${renamedUid.name} '${renamedUid.value}' was just taken by another write, retry` }, 409);
      }
      // A slug rename is how an editor clears the duplicates that kept this
      // column on a plain index; if this was the last one, upgrade now rather
      // than at the next boot. No-op once the index is already unique.
      if (renamedUid) await ensureUidIndexes(ct);
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
