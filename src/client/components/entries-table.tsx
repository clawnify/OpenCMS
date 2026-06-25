import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { Sparkles, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DynamicCell } from "./dynamic-cell";
import { FieldEditor } from "./field-editor";
import { api } from "@/lib/api";
import {
  fieldLabel,
  visibleFieldEntries,
  type Attribute,
  type ContentType,
  type Entry,
} from "@/lib/content-types";
import { cn } from "@/lib/utils";

interface EntriesTableProps {
  contentType: ContentType;
  entries: Entry[];
  onOpen: (id: number) => void;
  onPatch: (id: number, patch: Record<string, unknown>) => void;
  onContentTypeChange: () => void;
  selectedId: number | null;
}

/** Default column widths per attribute type. */
const DEFAULT_WIDTH: Record<string, number> = {
  boolean: 110,
  enumeration: 130,
  image: 90,
  html: 240,
  string: 200,
  text: 240,
  uid: 200,
  integer: 110,
  decimal: 110,
  date: 130,
  datetime: 170,
  richtext: 320,
  json: 240,
};

export function EntriesTable({
  contentType,
  entries,
  onOpen,
  onPatch,
  onContentTypeChange,
  selectedId,
}: EntriesTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [regeneratingCell, setRegeneratingCell] = useState<string | null>(null);

  async function regenerateCell(entryId: number, fieldKey: string) {
    const cellId = `${entryId}:${fieldKey}`;
    setRegeneratingCell(cellId);
    try {
      const { value } = await api.aiGenerateField(
        contentType.info.pluralName,
        entryId,
        fieldKey,
      );
      onPatch(entryId, { [fieldKey]: value });
    } catch (e) {
      console.error("AI regenerate failed", e);
    } finally {
      setRegeneratingCell(null);
    }
  }

  const columns = useMemo<ColumnDef<Entry>[]>(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && "indeterminate")
            }
            onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <CellStop>
            <Checkbox
              checked={row.getIsSelected()}
              onCheckedChange={(v) => row.toggleSelected(!!v)}
              aria-label="Select row"
            />
          </CellStop>
        ),
        enableSorting: false,
        size: 40,
      },
      ...visibleFieldEntries(contentType).map(([key, attr]): ColumnDef<Entry> => ({
        id: key,
        accessorFn: (row) => row[key],
        header: () => (
          <ColumnHeader
            contentType={contentType}
            fieldKey={key}
            attr={attr}
            entries={entries}
            onContentTypeChange={onContentTypeChange}
            onPatch={onPatch}
          />
        ),
        size: DEFAULT_WIDTH[attr.type] ?? 180,
        cell: ({ row }) => {
          const cellId = `${row.original.id}:${key}`;
          const aiEnabled = !!attr.aiConfig?.enabled;
          const hasValue = isNonEmpty(row.original[key]);
          const busy = regeneratingCell === cellId;
          return (
            <CellStop>
              <div className="relative group/cell">
                <DynamicCell
                  value={row.original[key]}
                  attr={attr}
                  fieldKey={key}
                  onCommit={(value) => onPatch(row.original.id, { [key]: value })}
                  onOpenSheet={() => onOpen(row.original.id)}
                />
                {aiEnabled && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      regenerateCell(row.original.id, key);
                    }}
                    disabled={busy}
                    className={cn(
                      "absolute -top-0.5 right-0 size-5 rounded bg-background/90 border border-border shadow-sm inline-flex items-center justify-center text-muted-foreground hover:text-foreground",
                      busy ? "opacity-100" : "opacity-0 group-hover/cell:opacity-100",
                    )}
                    title={busy ? "Generating…" : hasValue ? "Regenerate with AI" : "Generate with AI"}
                  >
                    {busy ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Sparkles className="size-3" />
                    )}
                  </button>
                )}
              </div>
            </CellStop>
          );
        },
      })),
    ],
    [contentType, entries, onOpen, onPatch, onContentTypeChange, regeneratingCell],
  );

  const table = useReactTable({
    data: entries,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableRowSelection: true,
    getRowId: (row) => String(row.id),
    defaultColumn: { minSize: 60, size: 160, maxSize: 480 },
  });

  return (
    <div className="flex-1 overflow-auto">
      <Table
        className="border-collapse [&_th]:border-r [&_th]:border-border [&_td]:border-r [&_td]:border-border [&_th:last-child]:border-r-0 [&_td:last-child]:border-r-0"
        style={{ tableLayout: "fixed", width: table.getTotalSize() }}
      >
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id} className="hover:bg-transparent">
              {hg.headers.map((h) => (
                <TableHead
                  key={h.id}
                  style={{
                    width: `${h.getSize()}px`,
                    maxWidth: `${h.column.columnDef.maxSize ?? h.getSize()}px`,
                  }}
                  className="text-xs uppercase tracking-wide text-muted-foreground font-medium overflow-hidden text-ellipsis"
                >
                  {h.isPlaceholder
                    ? null
                    : flexRender(h.column.columnDef.header, h.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-32 text-center text-muted-foreground"
              >
                No entries yet. Click + to create one.
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                onDoubleClick={() => onOpen(row.original.id)}
                className={cn(
                  "group",
                  selectedId === row.original.id && "bg-accent/40",
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    style={{
                      width: `${cell.column.getSize()}px`,
                      maxWidth: `${cell.column.columnDef.maxSize ?? cell.column.getSize()}px`,
                    }}
                    className="py-2 overflow-hidden"
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function ColumnHeader({
  contentType,
  fieldKey,
  attr,
  entries,
  onContentTypeChange,
  onPatch,
}: {
  contentType: ContentType;
  fieldKey: string;
  attr: Attribute;
  entries: Entry[];
  onContentTypeChange: () => void;
  onPatch: (id: number, patch: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const aiEnabled = !!attr.aiConfig?.enabled;
  const label = fieldLabel(fieldKey, attr);

  async function regenerateAll() {
    setBulkBusy(true);
    try {
      for (const e of entries) {
        try {
          const { value } = await api.aiGenerateField(
            contentType.info.pluralName,
            Number(e.id),
            fieldKey,
          );
          onPatch(Number(e.id), { [fieldKey]: value });
        } catch (err) {
          console.error("Bulk AI failed for row", e.id, err);
        }
      }
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="truncate">{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "ml-auto inline-flex items-center justify-center size-5 rounded hover:bg-accent",
              aiEnabled ? "text-foreground" : "text-muted-foreground/50 hover:text-foreground",
            )}
            title={aiEnabled ? "AI is on for this column" : "Configure AI for this column"}
          >
            <Sparkles className="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="end" sideOffset={6} className="w-80 p-0">
          <FieldEditor
            fieldKey={fieldKey}
            attribute={attr}
            siblingFieldKeys={Object.keys(contentType.attributes).filter((k) => k !== fieldKey)}
            onCommit={async (next) => {
              await api.patchContentType(contentType.uid, {
                attributes: { ...contentType.attributes, [fieldKey]: next },
              });
              onContentTypeChange();
              setOpen(false);
            }}
          />
          {aiEnabled && entries.length > 0 && (
            <div className="border-t border-border px-3 py-2 bg-muted/40">
              <Button
                variant="ghost"
                size="sm"
                onClick={regenerateAll}
                disabled={bulkBusy}
                className="h-7 w-full justify-start gap-1.5 text-xs"
              >
                {bulkBusy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                Regenerate for all {entries.length} {entries.length === 1 ? "row" : "rows"}
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function isNonEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim() !== "";
  return true;
}

function CellStop({ children }: { children: React.ReactNode }) {
  return <div onClick={(e) => e.stopPropagation()}>{children}</div>;
}
