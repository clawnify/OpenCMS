import { Database } from "lucide-react";
import { cn } from "@/lib/utils";

interface Collection {
  id: string;
  label: string;
  count: number;
}

export function Sidebar({
  collections,
  activeId,
  onSelect,
}: {
  collections: Collection[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="w-64 border-r border-border bg-sidebar h-full flex flex-col">
      <div className="px-3 pt-4 pb-2 flex gap-1 text-xs">
        <TabButton active>Collections</TabButton>
        <TabButton>Fields</TabButton>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {collections.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={cn(
              "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm",
              activeId === c.id
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/50",
            )}
          >
            <Database className="size-3.5 opacity-70" />
            <span className="flex-1 text-left">{c.label}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{c.count}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function TabButton({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return (
    <button
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
