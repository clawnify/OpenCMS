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
  | "media"
  | "enumeration"
  | "json"
  | "uid";

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
}

export interface EnumerationAttribute extends BaseAttribute {
  type: "enumeration";
  enum: string[];
}

export interface MediaAttribute extends BaseAttribute {
  type: "media";
  multiple?: boolean;
  allowedTypes?: Array<"images" | "videos" | "files" | "audios">;
}

export interface UidAttribute extends BaseAttribute {
  type: "uid";
  targetField?: string;
}

export type Attribute = BaseAttribute | EnumerationAttribute | MediaAttribute | UidAttribute;

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
