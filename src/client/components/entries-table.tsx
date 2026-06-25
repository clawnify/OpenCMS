import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { Sparkles, Loader2, Plus, Maximize } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DynamicCell } from "./dynamic-cell";
import { FieldEditor, ALL_TYPES, TYPE_ICON, TYPE_LABEL } from "./field-editor";
import { api } from "@/lib/api";
import {
  fieldLabel,
  visibleFieldEntries,
  type Attribute,
  type AttributeType,
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
  const [regeneratingRow, setRegeneratingRow] = useState<number | null>(null);
  const [activeRow, setActiveRow] = useState<number | null>(null);
  // Which column currently has a focused cell — drives AI-icon visibility.
  const [focusedColumn, setFocusedColumn] = useState<string | null>(null);

  const aiFieldKeys = useMemo(
    () =>
      visibleFieldEntries(contentType)
        .filter(([, attr]) => attr.aiConfig?.enabled)
        .map(([key]) => key),
    [contentType],
  );

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

  // Regenerate every AI-enabled column for one row, sequentially.
  async function regenerateRow(entryId: number) {
    if (!aiFieldKeys.length) return;
    setRegeneratingRow(entryId);
    try {
      for (const fieldKey of aiFieldKeys) {
        try {
          const { value } = await api.aiGenerateField(
            contentType.info.pluralName,
            entryId,
            fieldKey,
          );
          onPatch(entryId, { [fieldKey]: value });
        } catch (e) {
          console.error("AI row regenerate failed", fieldKey, e);
        }
      }
    } finally {
      setRegeneratingRow(null);
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
        cell: ({ row }) => {
          const id = row.original.id;
          const revealed = activeRow === id || row.getIsSelected();
          const rowBusy = regeneratingRow === id;
          return (
            <CellStop>
              <div className="flex items-center gap-1">
                <Checkbox
                  checked={row.getIsSelected()}
                  onCheckedChange={(v) => row.toggleSelected(!!v)}
                  aria-label="Select row"
                />
                <button
                  onClick={() => onOpen(id)}
                  title="Open entry"
                  className={cn(
                    "inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground",
                    revealed ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                  )}
                >
                  <Maximize className="size-3.5" />
                </button>
                {aiFieldKeys.length > 0 && (
                  <button
                    onClick={() => regenerateRow(id)}
                    disabled={rowBusy}
                    title={rowBusy ? "Regenerating…" : "Regenerate AI fields"}
                    className={cn(
                      "inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground",
                      revealed || rowBusy ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                    )}
                  >
                    {rowBusy ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="size-3.5" />
                    )}
                  </button>
                )}
              </div>
            </CellStop>
          );
        },
        enableSorting: false,
        size: 96,
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
            focused={focusedColumn === key}
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
      {
        id: "__add_column__",
        header: () => (
          <AddColumnHeader
            contentType={contentType}
            onContentTypeChange={onContentTypeChange}
          />
        ),
        cell: () => null,
        enableSorting: false,
        size: 44,
      },
    ],
    [
      contentType,
      entries,
      onOpen,
      onPatch,
      onContentTypeChange,
      regeneratingCell,
      regeneratingRow,
      activeRow,
      aiFieldKeys,
      focusedColumn,
    ],
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
    <div
      className="flex-1 overflow-auto [&>[data-slot=table-container]]:overflow-x-visible"
      onFocus={(e) => {
        const f = (e.target as HTMLElement).getAttribute("data-field");
        if (f) setFocusedColumn(f);
      }}
      onBlur={() => setFocusedColumn(null)}
    >
      <Table
        className="border-collapse [&_th]:border-r [&_th]:border-border [&_td]:border-r [&_td]:border-border [&_th:last-child]:border-r-0 [&_td:last-child]:border-r-0 [&_tbody_tr:last-child]:border-b [&_tbody_tr:last-child]:border-border"
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
                onClick={() => setActiveRow(row.original.id)}
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
  focused,
  onContentTypeChange,
  onPatch,
}: {
  contentType: ContentType;
  fieldKey: string;
  attr: Attribute;
  entries: Entry[];
  focused: boolean;
  onContentTypeChange: () => void;
  onPatch: (id: number, patch: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const aiEnabled = !!attr.aiConfig?.enabled;
  const label = fieldLabel(fieldKey, attr);
  // Always visible when AI is on (or the popover/focus is active); otherwise
  // only on column-name hover.
  const showAi = aiEnabled || focused || open;

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
    <div className="group/col flex items-center gap-1.5">
      <span className="truncate">{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "ml-auto inline-flex items-center justify-center size-5 rounded-sm transition-opacity hover:bg-accent",
              aiEnabled ? "text-foreground" : "text-muted-foreground/50 hover:text-foreground",
              showAi ? "opacity-100" : "opacity-0 group-hover/col:opacity-100",
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

/** Trailing "+" column header — adds a new field/column to the library. */
function AddColumnHeader({
  contentType,
  onContentTypeChange,
}: {
  contentType: ContentType;
  onContentTypeChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [type, setType] = useState<AttributeType>("string");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const k = key.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!k) return setError("Field key is required.");
    if (k in contentType.attributes) return setError(`Field "${k}" already exists.`);
    setBusy(true);
    setError(null);
    try {
      const attr: Attribute =
        type === "enumeration"
          ? ({ type: "enumeration", enum: ["option_a", "option_b"] } as Attribute)
          : ({ type } as Attribute);
      await api.patchContentType(contentType.uid, {
        attributes: { ...contentType.attributes, [k]: attr },
      });
      onContentTypeChange();
      setKey("");
      setType("string");
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Add field"
          className="mx-auto flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" sideOffset={6} className="w-72 p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Field key</label>
            <Input
              autoFocus
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="my_field"
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Type</label>
            <Select value={type} onValueChange={(t: AttributeType) => setType(t)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALL_TYPES.map((t) => {
                  const Icon = TYPE_ICON[t];
                  return (
                    <SelectItem key={t} value={t}>
                      <span className="inline-flex items-center gap-2">
                        <Icon className="size-3.5 opacity-60" />
                        {TYPE_LABEL[t]}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" size="sm" disabled={busy} className="w-full">
            {busy ? "Adding…" : "Add field"}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
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
