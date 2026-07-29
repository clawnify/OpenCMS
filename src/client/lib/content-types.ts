/**
 * Client mirror of the server content-type shape (src/server/content-types.ts).
 */

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

/** Per-attribute AI auto-fill config. Lives inside the attribute JSON blob. */
export interface AIConfig {
  enabled: boolean;
  systemPrompt: string;
  /** Default true. */
  autoFillOnEmpty?: boolean;
  model?: string;
}

export interface BaseAttribute {
  type: AttributeType;
  required?: boolean;
  unique?: boolean;
  default?: unknown;
  /** false = locked / built-in (rename + hide ok, but no delete or type change). */
  configurable?: boolean;
  /** Optional display override — populated client-side only. */
  displayName?: string;
  /** Hidden from the table view. */
  hidden?: boolean;
  aiConfig?: AIConfig;
}

export interface EnumerationAttribute extends BaseAttribute {
  type: "enumeration";
  enum: string[];
}

export interface ImageAttribute extends BaseAttribute {
  type: "image";
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
  | BaseAttribute
  | EnumerationAttribute
  | ImageAttribute
  | HtmlAttribute
  | UidAttribute;

export interface ContentTypeInfo {
  singularName: string;
  pluralName: string;
  displayName: string;
  description?: string;
}

export interface ContentType {
  uid: string;
  kind: "collectionType" | "singleType";
  collectionName: string;
  info: ContentTypeInfo;
  options: Record<string, unknown>;
  attributes: Record<string, Attribute>;
  created_at: string;
  updated_at: string;
}

export type Entry = Record<string, unknown> & { id: number };

/**
 * The author's brief for an entry (see src/server/schema-sync.ts). It's a
 * platform column on every collection rather than an attribute, so it never
 * appears in `attributes`, the table, or the field editor — the Notes panel in
 * entry-editor.tsx owns it.
 */
export const NOTES_KEY = "notes";

/** Column names the platform owns — a field can't be named after one of these. */
export const PLATFORM_COLUMNS = ["id", "created_at", "updated_at", NOTES_KEY];

/** Sensible default label for a field. */
export function fieldLabel(key: string, attr: Attribute): string {
  if (attr.displayName?.trim()) return attr.displayName;
  return key
    .replace(/_/g, " ")
    .replace(/([A-Z])/g, " $1")
    .trim()
    .replace(/^./, (s) => s.toUpperCase());
}

export function isFieldLocked(attr: Attribute): boolean {
  return attr.configurable === false;
}

export function visibleFieldEntries(ct: ContentType): Array<[string, Attribute]> {
  return Object.entries(ct.attributes).filter(([, a]) => !a.hidden);
}

/** Find the first uid attribute (typically `slug`). */
export function uidAttributeOf(ct: ContentType): [string, UidAttribute] | null {
  for (const [k, a] of Object.entries(ct.attributes)) {
    if (a.type === "uid") return [k, a as UidAttribute];
  }
  return null;
}
