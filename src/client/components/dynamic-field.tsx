import { useRef, useState } from "react";
import { ImagePlus, Code, Eye } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { RichEditor } from "./rich-editor";
import { StatusPill } from "./status-pill";
import { api } from "@/lib/api";
import type { Attribute, EnumerationAttribute } from "@/lib/content-types";
import { customFieldByUid } from "@/lib/custom-fields";
import { cn } from "@/lib/utils";

interface FieldProps {
  value: unknown;
  attr: Attribute;
  fieldKey: string;
  onChange: (value: unknown) => void;
  contextValues: Record<string, unknown>;
  publicOrigin?: string;
}

export function DynamicField(props: FieldProps) {
  const { attr } = props;
  const custom = customFieldByUid(attr.customField);
  if (custom) {
    return (
      <custom.Input
        value={props.value}
        attr={attr}
        fieldKey={props.fieldKey}
        onChange={props.onChange}
      />
    );
  }
  switch (attr.type) {
    case "boolean":
      return <BooleanField {...props} />;
    case "enumeration":
      return <EnumerationField {...props} attr={attr as EnumerationAttribute} />;
    case "image":
      return <ImageField {...props} />;
    case "html":
      return <HtmlField {...props} />;
    case "richtext":
      return <RichTextField {...props} />;
    case "json":
      return <JsonField {...props} />;
    case "date":
      return <DateField {...props} />;
    case "datetime":
      return <DateTimeField {...props} />;
    case "integer":
    case "decimal":
      return <NumberField {...props} />;
    case "text":
      return <LongTextField {...props} />;
    case "uid":
      return <UidField {...props} />;
    case "string":
    default:
      return <StringField {...props} />;
  }
}

// ── Implementations ─────────────────────────────────────────────────

function StringField({ value, onChange }: FieldProps) {
  return (
    <Input value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className="h-8" />
  );
}

function LongTextField({ value, onChange }: FieldProps) {
  return (
    <Textarea
      value={String(value ?? "")}
      onChange={(e) => onChange(e.target.value)}
      className="min-h-[60px] text-sm"
    />
  );
}

function UidField({ value, onChange, publicOrigin, fieldKey }: FieldProps) {
  const slug = String(value ?? "");
  const previewUrl = publicOrigin ? `${publicOrigin}/${slug}` : `/${slug}`;
  return (
    <div className="flex flex-col gap-1 flex-1">
      <Input
        value={slug}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 font-mono text-xs"
        data-field={fieldKey}
      />
      <a
        href={previewUrl}
        target="_blank"
        rel="noreferrer"
        className="text-xs text-muted-foreground hover:text-foreground truncate"
      >
        🌐 {previewUrl}
      </a>
    </div>
  );
}

function NumberField({ value, attr, onChange }: FieldProps) {
  return (
    <Input
      type="number"
      value={value === null || value === undefined ? "" : String(value)}
      step={attr.type === "integer" ? 1 : "any"}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      className="h-8 w-44"
    />
  );
}

function BooleanField({ value, onChange }: FieldProps) {
  return <Switch checked={!!value} onCheckedChange={(v) => onChange(v)} />;
}

function EnumerationField({
  value,
  onChange,
  attr,
  fieldKey,
}: FieldProps & { attr: EnumerationAttribute }) {
  const isStatus = fieldKey === "status" && attr.enum.every((v) => v === "draft" || v === "live");
  const v = String(value ?? attr.enum[0] ?? "");
  return (
    <Select value={v} onValueChange={(next) => onChange(next)}>
      {isStatus ? (
        <SelectTrigger className="h-7 w-auto border-0 bg-transparent p-0 shadow-none focus:ring-0 gap-0 [&>svg]:hidden">
          <StatusPill status={(v as "draft" | "live") ?? "draft"} withChevron />
        </SelectTrigger>
      ) : (
        <SelectTrigger className="h-8 w-auto">
          <span>{v}</span>
        </SelectTrigger>
      )}
      <SelectContent>
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

function ImageField({ value, onChange }: FieldProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const url = typeof value === "string" ? value : null;

  async function pick(file: File) {
    const { url } = await api.uploadImage(file);
    onChange(url);
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
        <div className="relative inline-block group">
          <img
            src={url}
            alt=""
            className="h-32 rounded-md object-cover cursor-pointer"
            onClick={() => fileRef.current?.click()}
          />
          <button
            onClick={() => onChange(null)}
            className="absolute -top-1 -right-1 size-5 rounded-full bg-foreground text-background text-xs flex items-center justify-center opacity-0 group-hover:opacity-100"
          >
            ×
          </button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          className="gap-1.5"
        >
          <ImagePlus className="size-3.5" />
          Upload image
        </Button>
      )}
    </>
  );
}

function HtmlField({ value, onChange }: FieldProps) {
  const [tab, setTab] = useState<"code" | "preview">("code");
  const html = typeof value === "string" ? value : "";
  return (
    <div className="w-full rounded-md border border-input overflow-hidden">
      <div className="flex items-center border-b border-input bg-muted/40 text-xs">
        <TabButton active={tab === "code"} onClick={() => setTab("code")} icon={<Code className="size-3.5" />}>
          Code
        </TabButton>
        <TabButton active={tab === "preview"} onClick={() => setTab("preview")} icon={<Eye className="size-3.5" />}>
          Preview
        </TabButton>
      </div>
      {tab === "code" ? (
        <textarea
          value={html}
          onChange={(e) => onChange(e.target.value)}
          placeholder="<div>Your HTML here…</div>"
          className="w-full min-h-[200px] bg-background px-2 py-1.5 text-sm font-mono outline-none"
        />
      ) : (
        <iframe
          srcDoc={html}
          sandbox=""
          className="w-full min-h-[200px] bg-white"
          title="HTML preview"
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      type="button"
      className={cn(
        "inline-flex items-center gap-1 px-2.5 py-1.5 border-b-2 -mb-px",
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function DateField({ value, onChange }: FieldProps) {
  return (
    <Input
      type="date"
      value={String(value ?? "")}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-44"
    />
  );
}

function DateTimeField({ value, onChange }: FieldProps) {
  const v = typeof value === "string" ? value.replace(" ", "T").slice(0, 16) : "";
  return (
    <Input
      type="datetime-local"
      value={v}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-56"
    />
  );
}

function RichTextField({ value, onChange }: FieldProps) {
  return <RichEditor value={String(value ?? '{"type":"doc","content":[]}')} onChange={onChange} />;
}

function JsonField({ value, onChange }: FieldProps) {
  const display = typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value, null, 2);
  return (
    <Textarea
      value={display}
      onChange={(e) => onChange(e.target.value)}
      className={cn("min-h-[120px] font-mono text-xs")}
    />
  );
}
