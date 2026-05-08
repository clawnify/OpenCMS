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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useFieldConfig, type FieldDef, type FieldType } from "@/lib/fields";

export const TYPE_ICON: Record<FieldType, typeof Type> = {
  boolean: ToggleLeft,
  select: CircleDot,
  image: ImageIcon,
  text: Type,
  slug: Link2,
  longtext: AlignLeft,
  date: Calendar,
  richtext: FileText,
};

export const TYPE_LABEL: Record<FieldType, string> = {
  boolean: "Boolean",
  select: "Select",
  image: "Image",
  text: "Text",
  slug: "Slug",
  longtext: "Long text",
  date: "Date",
  richtext: "Rich text",
};

export function FieldEditor({
  field,
  variant = "popover",
}: {
  field: FieldDef;
  variant?: "popover" | "dialog";
}) {
  const { config, update, reset } = useFieldConfig();
  const Icon = TYPE_ICON[field.type];
  const current = config[field.key] ?? {};
  const label = current.label ?? field.defaultLabel;
  const hidden = !!current.hidden;
  const isOverridden = !!current.label || !!current.hidden;

  return (
    <div className="text-sm">
      {variant === "popover" && (
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
          <Icon className="size-4 text-muted-foreground" />
          <span className="font-medium">{field.defaultLabel}</span>
          <span className="ml-auto text-xs text-muted-foreground">
            {TYPE_LABEL[field.type]}
          </span>
        </div>
      )}

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
        <span className="text-xs text-muted-foreground">
          {isOverridden ? "Customised" : "Default"}
        </span>
      </div>
    </div>
  );
}
