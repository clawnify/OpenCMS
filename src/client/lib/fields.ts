import { useEffect, useState, useCallback } from "react";

export type FieldType =
  | "boolean"
  | "select"
  | "image"
  | "text"
  | "slug"
  | "longtext"
  | "date"
  | "richtext";

export interface FieldDef {
  key: string;
  defaultLabel: string;
  type: FieldType;
  /** True if this field is part of the row identity and can't be hidden. */
  required?: boolean;
}

/** Fixed schema for the Posts collection (matches the D1 `posts` table). */
export const POSTS_FIELDS: FieldDef[] = [
  { key: "featured", defaultLabel: "Featured", type: "boolean" },
  { key: "status", defaultLabel: "Status", type: "select", required: true },
  { key: "image_url", defaultLabel: "Image", type: "image" },
  { key: "title", defaultLabel: "Title", type: "text", required: true },
  { key: "slug", defaultLabel: "Slug", type: "slug", required: true },
  { key: "description", defaultLabel: "Description", type: "longtext" },
  { key: "category", defaultLabel: "Category", type: "text" },
  { key: "post_date", defaultLabel: "Date", type: "date" },
  { key: "author", defaultLabel: "Author", type: "text" },
  { key: "content", defaultLabel: "Content", type: "richtext" },
];

export interface FieldOverride {
  label?: string;
  hidden?: boolean;
  order?: number;
}

export type FieldConfig = Record<string, FieldOverride>;

const STORAGE_KEY = "cms.field-config.posts";

function load(): FieldConfig {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as FieldConfig) : {};
  } catch {
    return {};
  }
}

function save(config: FieldConfig) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    window.dispatchEvent(new CustomEvent("cms:field-config-change"));
  } catch {
    /* noop */
  }
}

export function useFieldConfig() {
  const [config, setConfig] = useState<FieldConfig>(load);

  useEffect(() => {
    const onChange = () => setConfig(load());
    window.addEventListener("cms:field-config-change", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("cms:field-config-change", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const update = useCallback((key: string, patch: FieldOverride) => {
    const next = load();
    next[key] = { ...(next[key] ?? {}), ...patch };
    save(next);
    setConfig(next);
  }, []);

  const reset = useCallback((key: string) => {
    const next = load();
    delete next[key];
    save(next);
    setConfig(next);
  }, []);

  return { config, update, reset };
}

export function resolveLabel(field: FieldDef, config: FieldConfig): string {
  return config[field.key]?.label?.trim() || field.defaultLabel;
}

export function isHidden(field: FieldDef, config: FieldConfig): boolean {
  if (field.required) return false;
  return !!config[field.key]?.hidden;
}
