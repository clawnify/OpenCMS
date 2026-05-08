import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DynamicCell } from "./dynamic-cell";
import {
  fieldLabel,
  visibleFieldEntries,
  type ContentType,
  type Entry,
} from "@/lib/content-types";
import { cn } from "@/lib/utils";

interface EntriesTableProps {
  contentType: ContentType;
  entries: Entry[];
  onOpen: (id: number) => void;
  onPatch: (id: number, patch: Record<string, unknown>) => void;
  selectedId: number | null;
}

/** Default column widths per attribute type. */
const DEFAULT_WIDTH: Record<string, number> = {
  boolean: 110,
  enumeration: 130,
  media: 90,
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
  selectedId,
}: EntriesTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);

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
        header: fieldLabel(key, attr),
        size: DEFAULT_WIDTH[attr.type] ?? 180,
        cell: ({ row }) => (
          <CellStop>
            <DynamicCell
              value={row.original[key]}
              attr={attr}
              fieldKey={key}
              onCommit={(value) => onPatch(row.original.id, { [key]: value })}
              onOpenSheet={() => onOpen(row.original.id)}
            />
          </CellStop>
        ),
      })),
    ],
    [contentType, onOpen, onPatch],
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

function CellStop({ children }: { children: React.ReactNode }) {
  return <div onClick={(e) => e.stopPropagation()}>{children}</div>;
}
