import { useMemo } from "react";
import { TriangleAlert } from "lucide-react";
import { uidAttributeOf, type ContentType, type Entry } from "@/lib/content-types";

interface SlugDuplicatesBannerProps {
  contentType: ContentType;
  entries: Entry[];
  onOpen: (id: number) => void;
}

/**
 * Entries that share a slug, with a way to the one place they get fixed: the
 * entry editor. The server keeps new slugs unique but never renames an
 * existing one on its own — a duplicate is somebody's published URL, and which
 * entry moves is the editor's decision — so until every group here is
 * resolved the column has no unique index behind it (see
 * src/server/schema-sync.ts). Computed from the admin list the table already
 * loads: no extra request, and it disappears the moment the last rename lands.
 */
export function SlugDuplicatesBanner({ contentType, entries, onOpen }: SlugDuplicatesBannerProps) {
  const uid = uidAttributeOf(contentType);
  const groups = useMemo(() => {
    if (!uid) return [];
    const byValue = new Map<string, number[]>();
    for (const entry of entries) {
      const value = entry[uid[0]];
      if (typeof value !== "string" || !value) continue;
      byValue.set(value, [...(byValue.get(value) ?? []), entry.id]);
    }
    return [...byValue].filter(([, ids]) => ids.length > 1);
  }, [entries, uid]);

  if (!uid || groups.length === 0) return null;
  const [key] = uid;

  return (
    <div
      role="status"
      className="mx-4 my-3 flex gap-3 rounded-md border border-warning/30 bg-warning-tint px-3 py-2.5 text-sm text-foreground"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <div className="flex flex-col gap-1.5 min-w-0">
        <p>
          {groups.length === 1 ? "One " : `${groups.length} `}
          {key} {groups.length === 1 ? "is" : "values are"} shared by more than one{" "}
          {contentType.info.singularName}. Links resolve to only one of them — open an entry and
          give it its own {key}.
        </p>
        <ul className="flex flex-col gap-1">
          {groups.map(([value, ids]) => (
            <li key={value} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <code className="font-mono text-xs bg-background/60 rounded px-1 py-0.5">{value}</code>
              {ids.map((id) => {
                const entry = entries.find((e) => e.id === id);
                const label = String(entry?.title ?? entry?.name ?? `#${id}`);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onOpen(id)}
                    aria-label={`Open ${label} to change its ${key}`}
                    className="text-xs underline underline-offset-2 hover:text-warning truncate max-w-[16rem]"
                  >
                    {label}
                  </button>
                );
              })}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
