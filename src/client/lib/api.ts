import type { ContentType, Entry } from "./content-types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body && typeof body === "object" && "error" in body) msg = String(body.error);
    } catch {
      /* noop */
    }
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  // ── Content types ────────────────────────────────────────────────
  listContentTypes: () => fetch("/api/content-types").then(json<ContentType[]>),
  getContentType: (uid: string) =>
    fetch(`/api/content-types/${encodeURIComponent(uid)}`).then(json<ContentType>),
  createContentType: (
    contentType: Omit<ContentType, "created_at" | "updated_at"> & { created_at?: string; updated_at?: string },
  ) =>
    fetch("/api/content-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType }),
    }).then(json<ContentType>),
  patchContentType: (
    uid: string,
    patch: Partial<Pick<ContentType, "info" | "options" | "attributes">> & {
      applyDestructive?: boolean;
    },
  ) =>
    fetch(`/api/content-types/${encodeURIComponent(uid)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(json<ContentType>),
  deleteContentType: (uid: string) =>
    fetch(`/api/content-types/${encodeURIComponent(uid)}`, { method: "DELETE" }).then(
      json<{ ok: true }>,
    ),

  // ── Entries (any library) ───────────────────────────────────────
  //
  // Reads go to /api/admin/entries/* — the public /api/entries/** now serves
  // published rows only, and the editor has to see drafts. Writes stay on the
  // public path: it is declared public for GET alone, so POST/PATCH/DELETE are
  // already gated by the perimeter.
  listEntries: (pluralName: string) =>
    fetch(`/api/admin/entries/${encodeURIComponent(pluralName)}`).then(json<Entry[]>),
  getEntry: (pluralName: string, id: number | string) =>
    fetch(`/api/admin/entries/${encodeURIComponent(pluralName)}/${id}`).then(json<Entry>),
  createEntry: (pluralName: string, body: Record<string, unknown> = {}) =>
    fetch(`/api/entries/${encodeURIComponent(pluralName)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(json<Entry>),
  updateEntry: (pluralName: string, id: number | string, body: Record<string, unknown>) =>
    fetch(`/api/entries/${encodeURIComponent(pluralName)}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(json<Entry>),
  deleteEntry: (pluralName: string, id: number | string) =>
    fetch(`/api/entries/${encodeURIComponent(pluralName)}/${id}`, { method: "DELETE" }).then(
      json<{ ok: true }>,
    ),

  // The author's brief. Deliberately its own endpoint: entry reads are a public
  // route, notes are not (see src/server/routes-entries.ts). Written back
  // through updateEntry like any other value.
  getNotes: (pluralName: string, id: number | string) =>
    fetch(`/api/notes/${encodeURIComponent(pluralName)}/${id}`).then(
      json<{ notes: string | null }>,
    ),

  // ── Uploads ─────────────────────────────────────────────────────
  uploadImage: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/uploads", { method: "POST", body: fd });
    return json<{ url: string; filename: string }>(res);
  },

  // ── AI ──────────────────────────────────────────────────────────
  aiGenerateField: (pluralName: string, entryId: number | string, fieldKey: string) =>
    fetch("/api/ai/generate-field", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pluralName, entryId, fieldKey }),
    }).then(json<{ value: unknown }>),
};
