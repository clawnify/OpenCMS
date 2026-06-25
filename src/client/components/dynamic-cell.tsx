import { useEffect, useRef, useState } from "react";
import { ImageIcon, Code as CodeIcon, Calendar as CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { StatusPill } from "./status-pill";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/api";
import type { Attribute, EnumerationAttribute } from "@/lib/content-types";
import { cn, pillColor } from "@/lib/utils";

// Free-text fields that name a category-like value render as colored data pills.
const CATEGORICAL_KEYS = new Set(["category", "author", "tag", "type", "owner"]);

interface CellProps {
  value: unknown;
  attr: Attribute;
  fieldKey: string;
  onCommit: (value: unknown) => void;
  onOpenSheet: () => void;
}

/**
 * Render the inline editor for a given attribute type. The richtext + json
 * cells defer to the slide-in sheet rather than editing in place.
 */
export function DynamicCell(props: CellProps) {
  const { attr, fieldKey } = props;
  if (
    (attr.type === "string" || attr.type === "text") &&
    CATEGORICAL_KEYS.has(fieldKey)
  ) {
    return <PillCell {...props} />;
  }
  switch (attr.type) {
    case "boolean":
      return <BooleanCell {...props} />;
    case "enumeration":
      return <EnumerationCell {...props} attr={attr as EnumerationAttribute} />;
    case "image":
      return <ImageCell {...props} />;
    case "html":
      return <HtmlCell {...props} />;
    case "richtext":
      return <RichTextPreviewCell {...props} />;
    case "date":
      return <DateCell {...props} />;
    case "datetime":
      return <DateTimeCell {...props} />;
    case "integer":
    case "decimal":
      return <NumberCell {...props} />;
    case "json":
      return <JsonPreviewCell {...props} />;
    case "uid":
      return <TextCell {...props} className="font-mono text-xs text-muted-foreground" />;
    case "text":
      return <TextCell {...props} className="text-muted-foreground" placeholder="—" />;
    case "string":
    default:
      return <TextCell {...props} />;
  }
}

// ── Implementations ─────────────────────────────────────────────────

function TextCell({
  value,
  onCommit,
  className,
  placeholder,
  fieldKey,
}: CellProps & { className?: string; placeholder?: string }) {
  const [local, setLocal] = useState(String(value ?? ""));
  useEffect(() => setLocal(String(value ?? "")), [value]);
  return (
    <input
      value={local}
      placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== String(value ?? "")) onCommit(local);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setLocal(String(value ?? ""));
          (e.target as HTMLInputElement).blur();
        }
      }}
      data-field={fieldKey}
      className={cn(
        "w-full bg-transparent text-sm focus:outline-none border-0 ring-0 px-0 py-0",
        className,
      )}
    />
  );
}

/** Categorical free-text (category, author, tag) shown as a stable colored
 *  data pill; click to edit inline. */
function PillCell({ value, onCommit, fieldKey }: CellProps) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(String(value ?? ""));
  useEffect(() => setLocal(String(value ?? "")), [value]);
  const str = String(value ?? "").trim();

  if (editing) {
    return (
      <input
        autoFocus
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (local !== String(value ?? "")) onCommit(local);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setLocal(String(value ?? ""));
            setEditing(false);
          }
        }}
        data-field={fieldKey}
        className="w-full bg-transparent text-sm focus:outline-none border-0 ring-0 px-0 py-0"
      />
    );
  }

  if (!str) {
    return (
      <button
        onClick={() => setEditing(true)}
        data-field={fieldKey}
        className="text-sm italic text-muted-foreground/60 hover:text-foreground"
      >
        —
      </button>
    );
  }

  const c = pillColor(str.toLowerCase());
  return (
    <button
      onClick={() => setEditing(true)}
      data-field={fieldKey}
      title={str}
      className="inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      {str}
    </button>
  );
}

function NumberCell({ value, onCommit, fieldKey }: CellProps) {
  const [local, setLocal] = useState(String(value ?? ""));
  useEffect(() => setLocal(String(value ?? "")), [value]);
  return (
    <input
      type="number"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        const n = local === "" ? null : Number(local);
        if (n !== value) onCommit(n);
      }}
      data-field={fieldKey}
      className="w-full bg-transparent text-sm tabular-nums focus:outline-none border-0 ring-0 px-0 py-0"
    />
  );
}

function BooleanCell({ value, onCommit }: CellProps) {
  const yes = !!value;
  return (
    <Checkbox
      checked={yes}
      onCheckedChange={(v) => onCommit(v === true)}
      aria-label="Toggle"
    />
  );
}

function EnumerationCell({
  value,
  onCommit,
  attr,
  fieldKey,
}: CellProps & { attr: EnumerationAttribute }) {
  const isStatus = fieldKey === "status" && attr.enum.every((v) => v === "draft" || v === "live");
  const v = String(value ?? attr.enum[0] ?? "");
  return (
    <Select value={v} onValueChange={(next) => onCommit(next)}>
      {isStatus ? (
        <SelectTrigger className="h-7 w-auto border-0 bg-transparent p-0 shadow-none focus:ring-0 gap-0 [&>svg]:hidden">
          <StatusPill status={(v as "draft" | "live") ?? "draft"} withChevron />
        </SelectTrigger>
      ) : (
        <SelectTrigger className="h-7 w-auto border-0 bg-transparent p-0 shadow-none focus:ring-0 text-sm text-muted-foreground hover:text-foreground gap-1 [&>svg]:opacity-50">
          <span>{v}</span>
        </SelectTrigger>
      )}
      <SelectContent align="start">
        {attr.enum.map((opt) =>
          isStatus ? (
            <SelectItem key={opt} value={opt}>
              <StatusPill status={opt as "draft" | "live"} />
            </SelectItem>
          ) : (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ),
        )}
      </SelectContent>
    </Select>
  );
}

function ImageCell({ value, onCommit }: CellProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const url = typeof value === "string" ? value : null;

  async function pick(file: File) {
    setBusy(true);
    try {
      const res = await api.uploadImage(file);
      onCommit(res.url);
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
          <img
            src={url}
            alt=""
            className={cn("h-full w-full object-cover", busy && "opacity-50")}
          />
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

function HtmlCell({ value, onOpenSheet }: CellProps) {
  const html = typeof value === "string" ? value.trim() : "";
  return (
    <button
      onClick={onOpenSheet}
      className="block w-full text-left text-xs font-mono text-muted-foreground truncate hover:text-foreground"
      title="Open HTML editor"
    >
      {html ? (
        <span className="inline-flex items-center gap-1">
          <CodeIcon className="size-3 opacity-60" />
          {html.replace(/\s+/g, " ").slice(0, 80)}
        </span>
      ) : (
        <span className="italic">Click to edit HTML</span>
      )}
    </button>
  );
}

/** Parse a "YYYY-MM-DD" string into a local Date (no timezone shift). */
function parseDateOnly(s: unknown): Date | undefined {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(s)) return undefined;
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function DateCell({ value, onCommit, fieldKey }: CellProps) {
  const date = parseDateOnly(value);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          data-field={fieldKey}
          className="flex items-center gap-1.5 text-sm tabular-nums text-muted-foreground hover:text-foreground focus:outline-none"
        >
          <CalendarIcon className="size-3.5 opacity-60" />
          {date ? format(date, "MMM d, yyyy") : <span className="italic">Pick a date</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={date}
          onSelect={(d) => onCommit(d ? toDateOnly(d) : null)}
        />
      </PopoverContent>
    </Popover>
  );
}

function DateTimeCell({ value, onCommit, fieldKey }: CellProps) {
  const str = typeof value === "string" ? value : "";
  const datePart = str.slice(0, 10);
  const timePart = str.replace(" ", "T").slice(11, 16) || "00:00";
  const date = parseDateOnly(datePart);

  function commit(nextDate: Date | undefined, nextTime: string) {
    const dPart = nextDate ? toDateOnly(nextDate) : datePart;
    if (!dPart) return onCommit(null);
    onCommit(`${dPart}T${nextTime || "00:00"}`);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          data-field={fieldKey}
          className="flex items-center gap-1.5 text-sm tabular-nums text-muted-foreground hover:text-foreground focus:outline-none"
        >
          <CalendarIcon className="size-3.5 opacity-60" />
          {date ? `${format(date, "MMM d, yyyy")} ${timePart}` : <span className="italic">Pick a date</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={date}
          onSelect={(d) => commit(d, timePart)}
        />
        <div className="border-t border-border p-2">
          <input
            type="time"
            value={timePart}
            onChange={(e) => commit(date, e.target.value)}
            className="w-full rounded-sm border border-input bg-transparent px-2 py-1 text-sm tabular-nums focus:border-ring focus:outline-none"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RichTextPreviewCell({ value, onOpenSheet }: CellProps) {
  return (
    <button
      onClick={onOpenSheet}
      className="block w-full text-left text-sm text-muted-foreground truncate hover:text-foreground"
      title="Open rich-text editor"
    >
      {previewRichText(value) || <span className="italic">Click to edit content</span>}
    </button>
  );
}

function JsonPreviewCell({ value, onOpenSheet }: CellProps) {
  const display =
    typeof value === "string"
      ? value
      : value === null || value === undefined
        ? ""
        : JSON.stringify(value);
  return (
    <button
      onClick={onOpenSheet}
      className="block w-full text-left text-xs font-mono text-muted-foreground truncate hover:text-foreground"
      title="Open JSON editor"
    >
      {display || <span className="italic">Click to edit JSON</span>}
    </button>
  );
}

function previewRichText(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const doc = JSON.parse(value);
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
