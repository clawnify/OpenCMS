/**
 * Content-type registry — schema-as-data stored in D1.
 *
 * Each library (collection-type) is one row: a JSON `attributes` map
 * plus identity (uid, kind, collection_name) and display info.
 */

import { get, query, run } from "./db";

// ── Types ─────────────────────────────────────────────────────────────

/** The base attribute types we support. */
export type AttributeType =
  | "string"
  | "text"
  | "richtext"
  | "integer"
  | "decimal"
  | "boolean"
  | "date"
  | "datetime"
  | "image"
  | "html"
  | "enumeration"
  | "json"
  | "uid";

/**
 * Whether each attribute type's column can hold structure. Everything false is
 * stored as text or a number, so an object or array reaching one of them can
 * only be flattened — `String({})` is `"[object Object]"`, `String(["a","b"])`
 * is `"a,b"`. Both are silent and lossy.
 *
 * This lives here, with the type union it describes, because two unrelated
 * writers need the same answer: the entry CRUD layer coercing a submitted
 * value, and the schema syncer rendering a column DEFAULT into DDL.
 *
 * It is a total map rather than a set of the two true cases on purpose. A set
 * answers "no" for a type nobody has classified yet, so adding a member to
 * AttributeType would silently start rejecting valid writes to it. As a
 * `Record<AttributeType, …>` the same edit is a compile error until the new
 * type is answered for.
 */
const HOLDS_STRUCTURE: Record<AttributeType, boolean> = {
  json: true,
  richtext: true,
  string: false,
  text: false,
  integer: false,
  decimal: false,
  boolean: false,
  date: false,
  datetime: false,
  image: false,
  html: false,
  enumeration: false,
  uid: false,
};

/**
 * True when a value for this attribute type may be an object or array.
 *
 * Takes a plain string because one caller reads the type out of a stored
 * attribute map, which is JSON and therefore untyped. An unrecognised type is
 * treated as unable to hold structure — the safe answer, since it is the one
 * that refuses the write rather than storing a flattened value.
 */
export function holdsStructure(type: string): boolean {
  return HOLDS_STRUCTURE[type as AttributeType] ?? false;
}

/**
 * Reject an attribute map whose defaults cannot survive being stored.
 *
 * A default is not written through the entry API — it is rendered straight into
 * the column's DDL and then applied by SQLite to every row that omits the
 * field. So an object default on a text column is worse than the same value
 * sent as a write: no request ever carries it, nothing can validate it at write
 * time, and SQLite cannot ALTER COLUMN to take it back. It has to be refused at
 * the door that installs it.
 *
 * Returns the error message, or null when every default is storable.
 */
export function invalidDefault(
  attributes: Record<string, { type?: string; default?: unknown }>,
): string | null {
  for (const [name, attr] of Object.entries(attributes ?? {})) {
    const value = attr?.default;
    if (value === null || value === undefined) continue;
    if (typeof value !== "object") continue;
    if (holdsStructure(String(attr?.type))) continue;
    return (
      `${name}: a "${attr?.type}" field cannot default to ` +
      `${Array.isArray(value) ? "an array" : "an object"}. ` +
      `Use a string default, or declare the field as "json".`
    );
  }
  return null;
}

/** Per-attribute AI auto-fill config. Lives inside the attribute JSON blob. */
export interface AIConfig {
  enabled: boolean;
  /**
   * Prompt sent as the system message. Supports `{{fieldKey}}` interpolation;
   * any keys referenced narrow the dependency set used by the auto-trigger.
   */
  systemPrompt: string;
  /** Default true. When true, auto-fire once the dependency set is filled. */
  autoFillOnEmpty?: boolean;
  /** Override the default OpenRouter model. */
  model?: string;
}

export interface BaseAttribute {
  type: AttributeType;
  required?: boolean;
  unique?: boolean;
  default?: unknown;
  /** Locked = built-in, can be renamed/hidden but not deleted/type-changed. */
  configurable?: boolean;
  aiConfig?: AIConfig;
}

export interface StringAttribute extends BaseAttribute {
  type: "string";
  minLength?: number;
  maxLength?: number;
  regex?: string;
}

export interface TextAttribute extends BaseAttribute {
  type: "text" | "richtext";
  minLength?: number;
  maxLength?: number;
}

export interface NumberAttribute extends BaseAttribute {
  type: "integer" | "decimal";
  min?: number;
  max?: number;
}

export interface EnumerationAttribute extends BaseAttribute {
  type: "enumeration";
  enum: string[];
  enumName?: string;
}

export interface ImageAttribute extends BaseAttribute {
  type: "image";
  /** Hint for AI image generation; ignored otherwise. */
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
}

export interface HtmlAttribute extends BaseAttribute {
  type: "html";
}

export interface UidAttribute extends BaseAttribute {
  type: "uid";
  targetField?: string;
}

export type Attribute =
  | StringAttribute
  | TextAttribute
  | NumberAttribute
  | EnumerationAttribute
  | ImageAttribute
  | HtmlAttribute
  | UidAttribute
  | (BaseAttribute & { type: "boolean" | "date" | "datetime" | "json" });

export interface ContentTypeInfo {
  singularName: string;
  pluralName: string;
  displayName: string;
  description?: string;
  /**
   * The library's standing brief: house style that applies to every entry here,
   * as opposed to the per-entry `notes` column, which briefs one entry. Same
   * concept at two scopes — see NOTES_DOC in routes-entries.ts. Read by
   * buildSystemPrompt and by GET /api/notes/{pluralName}, so an agent writing an
   * entry can find the conventions without being told they exist.
   */
  notes?: string;
}

export interface ContentTypeOptions {
  draftAndPublish?: boolean;
}

export interface ContentType {
  uid: string;
  kind: "collectionType" | "singleType";
  collectionName: string;
  info: ContentTypeInfo;
  options: ContentTypeOptions;
  attributes: Record<string, Attribute>;
  created_at: string;
  updated_at: string;
}

/** Row shape as it lives in the `content_types` D1 table (JSON cols are strings). */
interface ContentTypeRow {
  uid: string;
  kind: string;
  collection_name: string;
  info: string;
  options: string;
  attributes: string;
  created_at: string;
  updated_at: string;
}

// The `content_types` table itself is provisioned by the repo-root
// schema.sql at deploy time, so no runtime bootstrap is needed.

// ── CRUD ──────────────────────────────────────────────────────────────

function rowToContentType(row: ContentTypeRow): ContentType {
  return {
    uid: row.uid,
    kind: row.kind as ContentType["kind"],
    collectionName: row.collection_name,
    info: JSON.parse(row.info),
    options: JSON.parse(row.options),
    attributes: JSON.parse(row.attributes),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listContentTypes(): Promise<ContentType[]> {
  const rows = await query<ContentTypeRow>(
    "SELECT * FROM content_types ORDER BY created_at ASC",
  );
  return rows.map(rowToContentType);
}

export async function getContentType(uid: string): Promise<ContentType | null> {
  const row = await get<ContentTypeRow>(
    "SELECT * FROM content_types WHERE uid = ?",
    [uid],
  );
  return row ? rowToContentType(row) : null;
}

export async function getContentTypeByPluralName(
  pluralName: string,
): Promise<ContentType | null> {
  const rows = await query<ContentTypeRow>("SELECT * FROM content_types");
  for (const row of rows) {
    const ct = rowToContentType(row);
    if (ct.info.pluralName === pluralName) return ct;
  }
  return null;
}

export async function upsertContentType(ct: Omit<ContentType, "created_at" | "updated_at">) {
  const exists = await get("SELECT uid FROM content_types WHERE uid = ?", [ct.uid]);
  if (exists) {
    await run(
      "UPDATE content_types SET kind = ?, collection_name = ?, info = ?, options = ?, attributes = ?, updated_at = datetime('now') WHERE uid = ?",
      [
        ct.kind,
        ct.collectionName,
        JSON.stringify(ct.info),
        JSON.stringify(ct.options),
        JSON.stringify(ct.attributes),
        ct.uid,
      ],
    );
  } else {
    await run(
      "INSERT INTO content_types (uid, kind, collection_name, info, options, attributes) VALUES (?, ?, ?, ?, ?, ?)",
      [
        ct.uid,
        ct.kind,
        ct.collectionName,
        JSON.stringify(ct.info),
        JSON.stringify(ct.options),
        JSON.stringify(ct.attributes),
      ],
    );
  }
}

export async function deleteContentType(uid: string) {
  await run("DELETE FROM content_types WHERE uid = ?", [uid]);
}

// ── Built-in seed: Posts ──────────────────────────────────────────────

export const POSTS_UID = "api::post.post";
export const POSTS_TABLE = "posts";

export const POSTS_SEED: Omit<ContentType, "created_at" | "updated_at"> = {
  uid: POSTS_UID,
  kind: "collectionType",
  collectionName: POSTS_TABLE,
  info: {
    singularName: "post",
    pluralName: "posts",
    displayName: "Posts",
    description: "Blog posts.",
  },
  options: { draftAndPublish: true },
  attributes: {
    title: { type: "string", required: true, configurable: false },
    slug: { type: "uid", targetField: "title", required: true, configurable: false },
    status: {
      type: "enumeration",
      enum: ["draft", "live"],
      default: "draft",
      required: true,
      configurable: false,
    },
    description: { type: "text" },
    content: { type: "richtext", default: '{"type":"doc","content":[]}' },
    image_url: { type: "image" },
    featured: { type: "boolean", default: false },
    category: { type: "string" },
    author: { type: "string" },
    post_date: { type: "date" },
  },
};

export async function seedBuiltInsIfMissing() {
  const posts = await getContentType(POSTS_UID);
  if (!posts) await upsertContentType(POSTS_SEED);
}

/**
 * One-shot upgrade for DBs created before the image/html field-type split:
 * rewrite any `media` attributes to `image` (single only). The SQL column
 * type is unchanged (both are TEXT), so this is a JSON-blob rewrite only.
 */
export async function migrateMediaToImage() {
  const cts = await listContentTypes();
  for (const ct of cts) {
    let dirty = false;
    const next: Record<string, Attribute> = {};
    for (const [k, attr] of Object.entries(ct.attributes)) {
      // Older shape may still carry { type: "media", allowedTypes, multiple }
      const t = (attr as { type: string }).type;
      if (t === "media") {
        next[k] = { type: "image", configurable: attr.configurable } as ImageAttribute;
        dirty = true;
      } else {
        next[k] = attr;
      }
    }
    if (dirty) {
      await upsertContentType({
        uid: ct.uid,
        kind: ct.kind,
        collectionName: ct.collectionName,
        info: ct.info,
        options: ct.options,
        attributes: next,
      });
    }
  }
}
