import { useEffect, useRef, useState } from "react";
import { ImageIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { StatusPill } from "./status-pill";
import { api } from "@/lib/api";
import type { Attribute, EnumerationAttribute, MediaAttribute } from "@/lib/content-types";
import { cn } from "@/lib/utils";

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
  const { attr } = props;
  switch (attr.type) {
    case "boolean":
      return <BooleanCell {...props} />;
    case "enumeration":
      return <EnumerationCell {...props} attr={attr as EnumerationAttribute} />;
    case "media":
      return <MediaCell {...props} attr={attr as MediaAttribute} />;
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
    <Select
      value={yes ? "yes" : "no"}
      onValueChange={(v) => onCommit(v === "yes")}
    >
      <SelectTrigger className="h-7 w-auto border-0 bg-transparent p-0 shadow-none focus:ring-0 text-sm text-muted-foreground hover:text-foreground gap-1 [&>svg]:opacity-50">
        <span>{yes ? "Yes" : "No"}</span>
      </SelectTrigger>
      <SelectContent align="start">
        <SelectItem value="no">No</SelectItem>
        <SelectItem value="yes">Yes</SelectItem>
      </SelectContent>
    </Select>
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

function MediaCell({ value, onCommit }: CellProps & { attr: MediaAttribute }) {
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

function DateCell({ value, onCommit }: CellProps) {
  return (
    <input
      type="date"
      value={String(value ?? "")}
      onChange={(e) => onCommit(e.target.value)}
      className="bg-transparent text-sm tabular-nums text-muted-foreground focus:outline-none focus:text-foreground"
    />
  );
}

function DateTimeCell({ value, onCommit }: CellProps) {
  const v = typeof value === "string" ? value.replace(" ", "T").slice(0, 16) : "";
  return (
    <input
      type="datetime-local"
      value={v}
      onChange={(e) => onCommit(e.target.value)}
      className="bg-transparent text-sm tabular-nums text-muted-foreground focus:outline-none focus:text-foreground"
    />
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
