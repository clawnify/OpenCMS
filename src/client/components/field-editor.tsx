import { useEffect, useState } from "react";
import {
  ToggleLeft,
  CircleDot,
  Image as ImageIcon,
  Type,
  Link2,
  AlignLeft,
  Calendar,
  Clock,
  FileText,
  Hash,
  Braces,
  Code,
  Sparkles,
  Eye,
  EyeOff,
  Trash2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type AIConfig,
  type Attribute,
  type AttributeType,
  type EnumerationAttribute,
  isFieldLocked,
} from "@/lib/content-types";
import { CUSTOM_FIELDS, customFieldByUid } from "@/lib/custom-fields";

export const TYPE_ICON: Record<AttributeType, typeof Type> = {
  string: Type,
  text: AlignLeft,
  richtext: FileText,
  integer: Hash,
  decimal: Hash,
  boolean: ToggleLeft,
  date: Calendar,
  datetime: Clock,
  image: ImageIcon,
  html: Code,
  enumeration: CircleDot,
  json: Braces,
  uid: Link2,
};

export const TYPE_LABEL: Record<AttributeType, string> = {
  string: "Text",
  text: "Long text",
  richtext: "Rich text",
  integer: "Integer",
  decimal: "Decimal",
  boolean: "Boolean",
  date: "Date",
  datetime: "Date & time",
  image: "Image",
  html: "HTML",
  enumeration: "Enumeration",
  json: "JSON",
  uid: "Slug",
};

export const ALL_TYPES: AttributeType[] = [
  "string",
  "text",
  "richtext",
  "integer",
  "decimal",
  "boolean",
  "date",
  "datetime",
  "image",
  "html",
  "enumeration",
  "json",
  "uid",
];

interface FieldEditorProps {
  fieldKey: string;
  attribute: Attribute;
  /** Other field keys in the same library — surfaced as {{key}} chips users can insert into the AI prompt. */
  siblingFieldKeys?: string[];
  onCommit: (next: Attribute) => Promise<void> | void;
  onRemove?: () => Promise<void> | void;
}

export function FieldEditor({
  fieldKey,
  attribute,
  siblingFieldKeys,
  onCommit,
  onRemove,
}: FieldEditorProps) {
  const [draft, setDraft] = useState<Attribute>(attribute);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(attribute), [attribute]);

  const locked = isFieldLocked(attribute);
  const typeChanged = draft.type !== attribute.type;
  const dirty = JSON.stringify(draft) !== JSON.stringify(attribute);
  const customDef = customFieldByUid(draft.customField);

  function patchDraft(p: Partial<Attribute>) {
    setDraft((d) => ({ ...d, ...p }) as Attribute);
  }

  /** Type picker value = a custom-field uid, or a base type. */
  function selectType(v: string) {
    const def = customFieldByUid(v);
    if (def) {
      patchDraft({
        type: def.baseType,
        customField: def.uid,
        options: def.defaultOptions ? { ...def.defaultOptions } : {},
      });
    } else {
      patchDraft({ type: v as AttributeType, customField: undefined, options: undefined });
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onCommit(draft);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="text-sm flex flex-col min-h-0">
      <div className="px-3 py-3 space-y-3 flex-1 overflow-y-auto min-h-0">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground font-normal">Display label</Label>
            <Input
              value={draft.displayName ?? ""}
              placeholder={fieldKey}
              onChange={(e) => patchDraft({ displayName: e.target.value })}
              className="h-8"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground font-normal">Field key</Label>
            <Input value={fieldKey} readOnly className="h-8 font-mono text-xs bg-muted" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground font-normal">Type</Label>
          <Select
            value={draft.customField ?? draft.type}
            disabled={locked}
            onValueChange={selectType}
          >
            <SelectTrigger className="h-8">
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
              <div className="px-2 pt-2 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                Custom
              </div>
              {CUSTOM_FIELDS.map((f) => {
                const Icon = f.icon;
                return (
                  <SelectItem key={f.uid} value={f.uid}>
                    <span className="inline-flex items-center gap-2">
                      <Icon className="size-3.5 opacity-60" />
                      {f.label}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {locked && (
            <p className="text-xs text-muted-foreground">
              Built-in field — type can't be changed.
            </p>
          )}
        </div>

        {draft.type === "enumeration" && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground font-normal">
              Enum values (one per line)
            </Label>
            <textarea
              value={((draft as EnumerationAttribute).enum ?? []).join("\n")}
              onChange={(e) =>
                patchDraft({
                  enum: e.target.value
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean),
                } as Partial<EnumerationAttribute>)
              }
              className="w-full min-h-[80px] rounded-md border border-input bg-transparent px-2 py-1.5 text-sm font-mono"
              placeholder="draft&#10;live"
            />
          </div>
        )}

        {customDef?.OptionsEditor && (
          <customDef.OptionsEditor
            options={draft.options ?? {}}
            onChange={(options) => patchDraft({ options })}
          />
        )}

        <div className="grid grid-cols-2 gap-3 pt-1">
          <Toggle
            label="Required"
            checked={!!draft.required}
            disabled={locked}
            onChange={(v) => patchDraft({ required: v })}
          />
          <Toggle
            label={draft.hidden ? "Hidden" : "Show in table"}
            icon={draft.hidden ? EyeOff : Eye}
            checked={!draft.hidden}
            onChange={(v) => patchDraft({ hidden: !v })}
          />
        </div>

        <AISection
          fieldKey={fieldKey}
          value={draft.aiConfig}
          siblingFieldKeys={siblingFieldKeys ?? []}
          onChange={(aiConfig) => patchDraft({ aiConfig } as Partial<Attribute>)}
        />

        {typeChanged && (
          <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 text-xs px-2.5 py-2">
            Changing the type may discard existing values in this column. Saving will trigger
            a destructive migration after confirmation.
          </div>
        )}

        {error && (
          <div className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1.5">
            {error}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border px-3 py-2 bg-muted/40 shrink-0">
        {locked || !onRemove ? (
          <span className="text-xs text-muted-foreground">{locked ? "Built-in" : ""}</span>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            disabled={busy}
            className="h-7 text-xs gap-1.5 text-destructive hover:text-destructive"
          >
            <Trash2 className="size-3" />
            Delete field
          </Button>
        )}
        <Button size="sm" onClick={save} disabled={busy || !dirty} className="h-7">
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
  icon: Icon,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  icon?: typeof Eye;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="text-sm font-normal flex items-center gap-1.5">
        {Icon && <Icon className="size-4 text-muted-foreground" />}
        {label}
      </Label>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

function AISection({
  fieldKey,
  value,
  siblingFieldKeys,
  onChange,
}: {
  fieldKey: string;
  value: AIConfig | undefined;
  siblingFieldKeys: string[];
  onChange: (next: AIConfig | undefined) => void;
}) {
  const enabled = !!value?.enabled;
  const cfg: AIConfig = value ?? { enabled: false, systemPrompt: "", autoFillOnEmpty: true };

  function patch(p: Partial<AIConfig>) {
    onChange({ ...cfg, ...p });
  }

  function insertRef(key: string) {
    patch({ systemPrompt: `${cfg.systemPrompt}{{${key}}}` });
  }

  return (
    <div className="rounded-md border border-border bg-muted/30">
      <div className="flex items-center justify-between px-3 py-2">
        <Label className="text-sm font-normal flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-muted-foreground" />
          Fill with AI
        </Label>
        <Switch
          checked={enabled}
          onCheckedChange={(v) =>
            v
              ? patch({ enabled: true })
              : onChange(undefined)
          }
        />
      </div>
      {enabled && (
        <div className="border-t border-border px-3 pt-2.5 pb-3 space-y-2">
          <Label className="text-xs text-muted-foreground font-normal">
            What to generate?
          </Label>
          <textarea
            value={cfg.systemPrompt}
            onChange={(e) => patch({ systemPrompt: e.target.value })}
            placeholder={`Describe how to generate "${fieldKey}". Reference other fields with {{key}}.`}
            className="w-full min-h-[80px] rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
          {siblingFieldKeys.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {siblingFieldKeys.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => insertRef(k)}
                  className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-background border border-input hover:border-foreground/40 hover:bg-accent"
                  title={`Insert {{${k}}} into the prompt`}
                >
                  {`{{${k}}}`}
                </button>
              ))}
            </div>
          )}
          <div className="pt-1">
            <Toggle
              label="Auto-fill when empty"
              checked={cfg.autoFillOnEmpty !== false}
              onChange={(v) => patch({ autoFillOnEmpty: v })}
            />
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Fires once when this cell is empty and every referenced field is filled.
            If no <code className="font-mono">{`{{key}}`}</code> refs are used, waits for
            every non-AI field to be filled.
          </p>
        </div>
      )}
    </div>
  );
}
