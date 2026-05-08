import { useMemo, useRef, useState, useEffect } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ImageIcon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { POSTS_FIELDS, resolveLabel, isHidden, useFieldConfig } from "@/lib/fields";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusPill } from "./status-pill";
import { api } from "@/lib/api";
import type { Post, PostPatch } from "@/lib/types";
import { cn } from "@/lib/utils";

interface PostsTableProps {
  posts: Post[];
  onOpen: (id: number) => void;
  onPatch: (id: number, patch: PostPatch) => void;
  selectedId: number | null;
}

export function PostsTable({ posts, onOpen, onPatch, selectedId }: PostsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const { config } = useFieldConfig();

  const labelOf = (key: string) => {
    const def = POSTS_FIELDS.find((f) => f.key === key);
    return def ? resolveLabel(def, config) : key;
  };
  const visible = (key: string) => {
    const def = POSTS_FIELDS.find((f) => f.key === key);
    return def ? !isHidden(def, config) : true;
  };

  const columns = useMemo<ColumnDef<Post>[]>(
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
      {
        accessorKey: "featured",
        header: labelOf("featured"),
        cell: ({ row }) => (
          <CellStop>
            <InlineSelect
              value={row.original.featured ? "yes" : "no"}
              options={[
                { value: "no", label: "No" },
                { value: "yes", label: "Yes" },
              ]}
              onChange={(v) => onPatch(row.original.id, { featured: v === "yes" ? 1 : 0 })}
            />
          </CellStop>
        ),
        size: 100,
      },
      {
        accessorKey: "status",
        header: labelOf("status"),
        cell: ({ row }) => (
          <CellStop>
            <Select
              value={row.original.status}
              onValueChange={(v: "draft" | "live") => onPatch(row.original.id, { status: v })}
            >
              <SelectTrigger className="h-7 w-auto border-0 bg-transparent p-0 shadow-none focus:ring-0 gap-0 [&>svg]:hidden">
                <StatusPill status={row.original.status} withChevron />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value="draft">
                  <StatusPill status="draft" />
                </SelectItem>
                <SelectItem value="live">
                  <StatusPill status="live" />
                </SelectItem>
              </SelectContent>
            </Select>
          </CellStop>
        ),
        size: 110,
      },
      {
        accessorKey: "image_url",
        header: labelOf("image_url"),
        cell: ({ row }) => (
          <CellStop>
            <InlineImage
              url={row.original.image_url}
              onChange={(url) => onPatch(row.original.id, { image_url: url })}
            />
          </CellStop>
        ),
        size: 80,
      },
      {
        accessorKey: "title",
        header: labelOf("title"),
        cell: ({ row }) => (
          <CellStop>
            <InlineText
              value={row.original.title}
              onCommit={(v) => onPatch(row.original.id, { title: v })}
              className="font-medium"
            />
          </CellStop>
        ),
        size: 220,
      },
      {
        accessorKey: "slug",
        header: labelOf("slug"),
        cell: ({ row }) => (
          <CellStop>
            <InlineText
              value={row.original.slug}
              onCommit={(v) => onPatch(row.original.id, { slug: v })}
              className="font-mono text-xs text-muted-foreground"
            />
          </CellStop>
        ),
        size: 200,
      },
      {
        accessorKey: "description",
        header: labelOf("description"),
        cell: ({ row }) => (
          <CellStop>
            <InlineText
              value={row.original.description}
              placeholder="—"
              onCommit={(v) => onPatch(row.original.id, { description: v })}
              className="text-muted-foreground"
            />
          </CellStop>
        ),
        size: 240,
      },
      {
        accessorKey: "category",
        header: labelOf("category"),
        cell: ({ row }) => (
          <CellStop>
            <InlineText
              value={row.original.category}
              placeholder="—"
              onCommit={(v) => onPatch(row.original.id, { category: v })}
              className="text-muted-foreground"
            />
          </CellStop>
        ),
        size: 140,
      },
      {
        accessorKey: "post_date",
        header: labelOf("post_date"),
        cell: ({ row }) => (
          <CellStop>
            <input
              type="date"
              value={row.original.post_date}
              onChange={(e) => onPatch(row.original.id, { post_date: e.target.value })}
              className="bg-transparent text-sm tabular-nums text-muted-foreground focus:outline-none focus:text-foreground"
            />
          </CellStop>
        ),
        size: 130,
      },
      {
        accessorKey: "author",
        header: labelOf("author"),
        cell: ({ row }) => (
          <CellStop>
            <InlineText
              value={row.original.author}
              placeholder="—"
              onCommit={(v) => onPatch(row.original.id, { author: v })}
              className="text-muted-foreground"
            />
          </CellStop>
        ),
        size: 140,
      },
      {
        accessorKey: "content",
        header: labelOf("content"),
        cell: ({ row }) => (
          <button
            onClick={() => onOpen(row.original.id)}
            className="block w-full text-left text-sm text-muted-foreground truncate hover:text-foreground"
            title="Open rich-text editor"
          >
            {previewContent(row.original.content) || (
              <span className="italic">Click to edit content</span>
            )}
          </button>
        ),
        size: 320,
      },
    ],
    [onOpen, onPatch, config],
  );

  const visibleColumns = useMemo(
    () => columns.filter((c) => {
      const key = "accessorKey" in c ? (c.accessorKey as string) : c.id;
      if (!key || key === "select") return true;
      return visible(key);
    }),
    [columns, config],
  );

  const table = useReactTable({
    data: posts,
    columns: visibleColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableRowSelection: true,
    getRowId: (row) => String(row.id),
    defaultColumn: {
      minSize: 60,
      size: 160,
      maxSize: 400,
    },
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
                  style={{ width: `${h.getSize()}px`, maxWidth: `${h.column.columnDef.maxSize ?? h.getSize()}px` }}
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
              <TableCell colSpan={visibleColumns.length} className="h-32 text-center text-muted-foreground">
                No posts yet. Click + to create one.
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
                    style={{ width: `${cell.column.getSize()}px`, maxWidth: `${cell.column.columnDef.maxSize ?? cell.column.getSize()}px` }}
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

function previewContent(json: string): string {
  try {
    const doc = JSON.parse(json);
    let out = "";
    function walk(node: { text?: string; content?: unknown[] }) {
      if (typeof node?.text === "string") out += node.text + " ";
      const children = node?.content as Array<{ text?: string; content?: unknown[] }> | undefined;
      children?.forEach(walk);
    }
    walk(doc);
    return out.trim();
  } catch {
    return "";
  }
}

function InlineText({
  value,
  onCommit,
  className,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <input
      value={local}
      placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== value) onCommit(local);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setLocal(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={cn(
        "w-full bg-transparent text-sm focus:outline-none border-0 ring-0 px-0 py-0",
        className,
      )}
    />
  );
}

function InlineSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-7 w-auto border-0 bg-transparent p-0 shadow-none focus:ring-0 text-sm text-muted-foreground hover:text-foreground gap-1 [&>svg]:opacity-50">
        <span>{options.find((o) => o.value === value)?.label}</span>
      </SelectTrigger>
      <SelectContent align="start">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function InlineImage({
  url,
  onChange,
}: {
  url: string | null;
  onChange: (url: string | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function pick(file: File) {
    setBusy(true);
    try {
      const res = await api.uploadImage(file);
      onChange(res.url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) pick(f);
          e.target.value = "";
        }}
      />
      {url ? (
        <button
          onClick={() => fileRef.current?.click()}
          className="block h-8 w-12 rounded overflow-hidden ring-1 ring-border hover:ring-ring"
          title="Replace image"
        >
          <img src={url} alt="" className={cn("h-full w-full object-cover", busy && "opacity-50")} />
        </button>
      ) : (
        <button
          onClick={() => fileRef.current?.click()}
          className="h-8 w-12 rounded bg-muted hover:bg-accent flex items-center justify-center text-muted-foreground"
          title="Upload image"
        >
          <ImageIcon className="size-3" />
        </button>
      )}
    </>
  );
}
