import { useEffect, useState, useCallback, useMemo } from "react";
import { Plus, Search, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Sidebar } from "./components/sidebar";
import { EntriesTable } from "./components/entries-table";
import { EntryEditor } from "./components/entry-editor";
import { useRouter } from "./hooks/use-router";
import { useContentTypes } from "./hooks/use-content-types";
import { api } from "./lib/api";
import type { ContentType, Entry } from "./lib/content-types";

export function App() {
  const { path, navigate } = useRouter();
  const { list: contentTypes, refresh: refreshContentTypes, setList: setContentTypes } =
    useContentTypes();

  const route = parseRoute(path, contentTypes);

  const activeCT: ContentType | null = useMemo(() => {
    if (!route) return contentTypes[0] ?? null;
    return contentTypes.find((c) => c.info.pluralName === route.pluralName) ?? null;
  }, [contentTypes, route]);

  const [entries, setEntries] = useState<Entry[]>([]);
  const [active, setActive] = useState<Entry | null>(null);

  const loadEntries = useCallback(async () => {
    if (!activeCT) {
      setEntries([]);
      return;
    }
    const list = await api.listEntries(activeCT.info.pluralName);
    setEntries(list);
  }, [activeCT]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const selectedId = route?.entryId ?? null;

  useEffect(() => {
    if (selectedId == null || !activeCT) {
      setActive(null);
      return;
    }
    const cached = entries.find((e) => e.id === selectedId);
    if (cached) {
      setActive(cached);
      return;
    }
    api
      .getEntry(activeCT.info.pluralName, selectedId)
      .then(setActive)
      .catch(() => navigate(`/${activeCT.info.pluralName}`));
  }, [selectedId, entries, activeCT, navigate]);

  async function createEntry() {
    if (!activeCT) return;
    const created = await api.createEntry(activeCT.info.pluralName);
    setEntries((p) => [created, ...p]);
    navigate(`/${activeCT.info.pluralName}/${created.id}`);
  }

  function onEntryChange(updated: Entry) {
    setEntries((list) => list.map((e) => (e.id === updated.id ? updated : e)));
    setActive(updated);
  }

  async function patchEntry(id: number, patch: Record<string, unknown>) {
    if (!activeCT) return;
    setEntries((list) => list.map((e) => (e.id === id ? ({ ...e, ...patch } as Entry) : e)));
    try {
      const saved = await api.updateEntry(activeCT.info.pluralName, id, patch);
      onEntryChange(saved);
    } catch (err) {
      console.error(err);
      loadEntries();
    }
  }

  async function onDelete() {
    if (!active || !activeCT) return;
    const label = String(active.title ?? active.name ?? `Entry #${active.id}`);
    if (!window.confirm(`Delete "${label}"?`)) return;
    await api.deleteEntry(activeCT.info.pluralName, Number(active.id));
    setEntries((list) => list.filter((e) => e.id !== active.id));
    navigate(`/${activeCT.info.pluralName}`);
  }

  const collections = contentTypes.map((ct) => ({
    id: ct.info.pluralName,
    label: ct.info.displayName,
    count: activeCT?.info.pluralName === ct.info.pluralName ? entries.length : undefined,
  }));

  return (
    <div className="h-screen flex bg-background text-foreground overflow-hidden">
      <Sidebar
        collections={collections}
        activeId={activeCT?.info.pluralName ?? ""}
        onSelect={(id) => navigate(`/${id}`)}
        contentTypes={contentTypes}
        onContentTypesChange={refreshContentTypes}
      />
      <main className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-2 px-3 h-10 border-b border-border">
          <Button
            variant="ghost"
            size="sm"
            onClick={createEntry}
            className="h-7 w-7 p-0"
            title="New entry"
            disabled={!activeCT}
          >
            <Plus className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Filter">
            <Filter className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Search">
            <Search className="size-4" />
          </Button>
        </div>
        {activeCT ? (
          <EntriesTable
            contentType={activeCT}
            entries={entries}
            onOpen={(id) => navigate(`/${activeCT.info.pluralName}/${id}`)}
            onPatch={patchEntry}
            selectedId={selectedId}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            No libraries yet. Create one from the sidebar.
          </div>
        )}
      </main>

      <Sheet
        open={!!active}
        onOpenChange={(open) => {
          if (!open && activeCT) navigate(`/${activeCT.info.pluralName}`);
        }}
      >
        <SheetContent
          side="right"
          showCloseButton={false}
          overlayClassName="bg-white/40 backdrop-blur-none supports-backdrop-filter:backdrop-blur-none"
          className="w-full sm:max-w-[80vw] lg:max-w-[1200px] p-0 gap-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {active && activeCT && (
            <>
              <SheetTitle className="sr-only">
                Edit {activeCT.info.singularName}: {String(active.title ?? active.name ?? active.id)}
              </SheetTitle>
              <SheetDescription className="sr-only">
                Edit fields and rich-text content for the selected entry.
              </SheetDescription>
              <EntryEditor
                key={active.id}
                contentType={activeCT}
                entry={active}
                onChange={onEntryChange}
                onClose={() => navigate(`/${activeCT.info.pluralName}`)}
                onDelete={onDelete}
              />
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

interface RouteMatch {
  pluralName: string;
  entryId: number | null;
}

function parseRoute(path: string, contentTypes: ContentType[]): RouteMatch | null {
  const trimmed = path.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!trimmed) return null;
  const parts = trimmed.split("/");
  const pluralName = parts[0];
  // Only treat as a route if the plural name matches a known library, so we
  // don't trip on unrelated paths during dev.
  if (!contentTypes.find((c) => c.info.pluralName === pluralName)) return { pluralName, entryId: null };
  const entryId = parts[1] ? Number(parts[1]) : null;
  return { pluralName, entryId: Number.isFinite(entryId) ? entryId : null };
}
