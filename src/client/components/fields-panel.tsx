import { useState } from "react";
import {
  ToggleLeft,
  CircleDot,
  Image as ImageIcon,
  Type,
  Link2,
  AlignLeft,
  Calendar,
  FileText,
  Eye,
  EyeOff,
  RotateCcw,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  POSTS_FIELDS,
  resolveLabel,
  isHidden,
  useFieldConfig,
  type FieldDef,
  type FieldType,
} from "@/lib/fields";
import { cn } from "@/lib/utils";

const TYPE_ICON: Record<FieldType, typeof Type> = {
  boolean: ToggleLeft,
  select: CircleDot,
  image: ImageIcon,
  text: Type,
  slug: Link2,
  longtext: AlignLeft,
  date: Calendar,
  richtext: FileText,
};

const TYPE_LABEL: Record<FieldType, string> = {
  boolean: "Boolean",
  select: "Select",
  image: "Image",
  text: "Text",
  slug: "Slug",
  longtext: "Long text",
  date: "Date",
  richtext: "Rich text",
};

export function FieldsPanel() {
  const { config } = useFieldConfig();

  return (
    <div className="px-1.5 py-1">
      <div className="px-2 pt-1 pb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        Posts schema
      </div>
      {POSTS_FIELDS.map((field) => (
        <FieldRow key={field.key} field={field} label={resolveLabel(field, config)} hidden={isHidden(field, config)} />
      ))}
    </div>
  );
}

function FieldRow({ field, label, hidden }: { field: FieldDef; label: string; hidden: boolean }) {
  const [open, setOpen] = useState(false);
  const Icon = TYPE_ICON[field.type];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-sidebar-accent/60 text-left",
            hidden && "opacity-50",
          )}
        >
          <Icon className="size-3.5 text-muted-foreground shrink-0" />
          <span className="flex-1 truncate">{label}</span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {TYPE_LABEL[field.type]}
          </span>
          {hidden && <EyeOff className="size-3 text-muted-foreground" />}
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" sideOffset={8} className="w-72 p-0">
        <FieldEditor field={field} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

function FieldEditor({ field, onClose }: { field: FieldDef; onClose: () => void }) {
  const { config, update, reset } = useFieldConfig();
  const Icon = TYPE_ICON[field.type];
  const current = config[field.key] ?? {};
  const label = current.label ?? field.defaultLabel;
  const hidden = !!current.hidden;
  const isOverridden = !!current.label || !!current.hidden;

  return (
    <div className="text-sm">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
        <Icon className="size-4 text-muted-foreground" />
        <span className="font-medium">{field.defaultLabel}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {TYPE_LABEL[field.type]}
        </span>
      </div>

      <div className="px-3 py-3 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={`label-${field.key}`} className="text-xs text-muted-foreground font-normal">
            Display label
          </Label>
          <Input
            id={`label-${field.key}`}
            value={label}
            onChange={(e) => update(field.key, { label: e.target.value })}
            className="h-8"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground font-normal">Field key</Label>
          <Input value={field.key} readOnly className="h-8 font-mono text-xs bg-muted" />
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-2">
            {hidden ? (
              <EyeOff className="size-4 text-muted-foreground" />
            ) : (
              <Eye className="size-4 text-muted-foreground" />
            )}
            <Label htmlFor={`hide-${field.key}`} className="text-sm font-normal">
              Show in table
            </Label>
          </div>
          <Switch
            id={`hide-${field.key}`}
            checked={!hidden}
            disabled={field.required}
            onCheckedChange={(v) => update(field.key, { hidden: !v })}
          />
        </div>
        {field.required && (
          <p className="text-xs text-muted-foreground -mt-2">
            Required fields can't be hidden.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border px-3 py-2 bg-muted/40">
        <Button
          variant="ghost"
          size="sm"
          disabled={!isOverridden}
          onClick={() => reset(field.key)}
          className="h-7 text-xs gap-1.5"
        >
          <RotateCcw className="size-3" />
          Reset
        </Button>
        <Button size="sm" onClick={onClose} className="h-7 text-xs">
          Done
        </Button>
      </div>
    </div>
  );
}
