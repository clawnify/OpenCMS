import { useState } from "react";
import { Database, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { FieldsPanel } from "./fields-panel";
import { CollectionMenuDialog } from "./collection-menu-dialog";

interface Collection {
  id: string;
  label: string;
  count: number;
}

type SidebarTab = "libraries" | "fields";

export function Sidebar({
  collections,
  activeId,
  onSelect,
}: {
  collections: Collection[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const [tab, setTab] = useState<SidebarTab>("libraries");
  const [menuFor, setMenuFor] = useState<Collection | null>(null);

  return (
    <aside className="w-64 border-r border-border bg-sidebar h-full flex flex-col">
      <div className="px-3 pt-4 pb-2 flex gap-1 text-xs">
        <TabButton active={tab === "libraries"} onClick={() => setTab("libraries")}>
          Libraries
        </TabButton>
        <TabButton active={tab === "fields"} onClick={() => setTab("fields")}>
          Fields
        </TabButton>
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === "libraries" ? (
          <div className="px-2 py-2 space-y-0.5">
            {collections.map((c) => (
              <CollectionRow
                key={c.id}
                collection={c}
                active={activeId === c.id}
                onSelect={() => onSelect(c.id)}
                onMenu={() => setMenuFor(c)}
              />
            ))}
          </div>
        ) : (
          <FieldsPanel />
        )}
      </div>

      <CollectionMenuDialog collection={menuFor} onClose={() => setMenuFor(null)} />
    </aside>
  );
}

function CollectionRow({
  collection,
  active,
  onSelect,
  onMenu,
}: {
  collection: Collection;
  active: boolean;
  onSelect: () => void;
  onMenu: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-center rounded-md",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent/50",
      )}
    >
      <button
        onClick={onSelect}
        className="flex-1 flex items-center gap-2 px-2 py-1.5 text-sm min-w-0"
      >
        <Database className="size-3.5 opacity-70 shrink-0" />
        <span className="truncate text-left">{collection.label}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {collection.count}
        </span>
      </button>
      <button
        onClick={onMenu}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition mr-1 size-6 inline-flex items-center justify-center rounded hover:bg-background/60 text-muted-foreground hover:text-foreground"
        title="Library options"
        aria-label="Library options"
      >
        <MoreHorizontal className="size-3.5" />
      </button>
    </div>
  );
}

function TabButton({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-2 py-1 rounded-md transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
