/**
 * Custom-field registry.
 *
 * A custom field is a bespoke widget layered on top of one of the built-in
 * base types for storage. An attribute opts in with:
 *
 *     { type: <baseType>, customField: <uid>, options?: {...} }
 *
 * Because `type` stays a real base type, the server (schema-sync, SQL affinity,
 * entry coercion) is entirely unaware of custom fields — only the three client
 * render paths consult this registry: the field-editor type picker, the entry
 * editor input (dynamic-field), and the table cell (dynamic-cell).
 *
 * Grounded in real CRM/outreach spreadsheets: Score, Badge, URL, Email, Phone,
 * Tags cover the columns that base types render badly. Adding a seventh field =
 * one entry here, no migration.
 */

import { useEffect, useRef, useState } from "react";
import {
  AtSign,
  ExternalLink,
  Gauge,
  Link2,
  Phone as PhoneIcon,
  Tag,
  Tags as TagsIcon,
  X,
  type LucideIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Pill } from "@/components/status-pill";
import type { AttributeType, Attribute, EnumerationAttribute } from "@/lib/content-types";
import { cn, pillColor } from "@/lib/utils";

// ── Prop contracts (mirror dynamic-field / dynamic-cell) ──────────────

export interface CustomFieldInputProps {
  value: unknown;
  attr: Attribute;
  fieldKey: string;
  onChange: (value: unknown) => void;
}

export interface CustomFieldCellProps {
  value: unknown;
  attr: Attribute;
  fieldKey: string;
  onCommit: (value: unknown) => void;
  onOpenSheet: () => void;
}

export interface CustomFieldOptionsProps {
  options: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

export interface CustomFieldDef {
  uid: string;
  label: string;
  icon: LucideIcon;
  /** Underlying storage type. Drives SQL affinity + coercion server-side. */
  baseType: AttributeType;
  defaultOptions?: Record<string, unknown>;
  Input: React.FC<CustomFieldInputProps>;
  Cell: React.FC<CustomFieldCellProps>;
  /** Optional config UI rendered in the field editor. */
  OptionsEditor?: React.FC<CustomFieldOptionsProps>;
}

// ── Badge colors ──────────────────────────────────────────────────────

type PaletteKey = "green" | "amber" | "red" | "gray";

const PALETTE: Record<PaletteKey, string> = {
  green: "rgb(4 120 87)", // emerald-700
  amber: "rgb(180 83 9)", // amber-700
  red: "rgb(185 28 28)", // red-700
  gray: "rgb(82 82 91)", // zinc-600
};

/**
 * Opinionated meaning for common status-like words, so a freshly imported
 * enum looks right without anyone assigning colors: positive/high → green,
 * warm/medium → amber, urgent/negative → red, low/neutral → gray.
 */
const SEMANTIC: Record<string, PaletteKey> = {
  high: "green", won: "green", verified: "green", active: "green",
  live: "green", published: "green", approved: "green", qualified: "green",
  hot: "green", complete: "green", done: "green", success: "green",
  medium: "amber", warm: "amber", strong: "amber", inferred: "amber",
  negotiating: "amber", "in progress": "amber", proposal: "amber",
  immediate: "red", urgent: "red", lost: "red", rejected: "red",
  critical: "red", blocked: "red", churned: "red", overdue: "red",
  low: "gray", monitor: "gray", general: "gray", cold: "gray",
  new: "gray", draft: "gray", pending: "gray", inactive: "gray",
  unqualified: "gray",
};

/** Resolve a badge value to `{ bg, text }`: explicit → semantic → stable hash. */
export function badgeColor(
  value: string,
  colors?: Record<string, string>,
): { bg: string; text: string } {
  if (colors && colors[value]) {
    const text = colors[value];
    return { text, bg: `color-mix(in srgb, ${text} 14%, transparent)` };
  }
  const key = value.toLowerCase().replace(/[[\]()]/g, "").trim();
  const sem = SEMANTIC[key];
  if (sem) {
    const text = PALETTE[sem];
    return { text, bg: `color-mix(in srgb, ${text} 14%, transparent)` };
  }
  return pillColor(value); // stable per-value hash color
}

// ── Score colors ──────────────────────────────────────────────────────

function scoreColor(pct: number): string {
  if (pct >= 0.7) return PALETTE.green;
  if (pct >= 0.4) return PALETTE.amber;
  return PALETTE.red;
}

// ── Shared helpers ─────────────────────────────────────────────────────

function numOpt(options: unknown, key: string, fallback: number): number {
  const v = (options as Record<string, unknown> | undefined)?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // Fall back to delimiter split (imported "a; b; c" text).
      return value.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

// ── Badge widget (shared by cell + input) ──────────────────────────────

function BadgeSelect({
  value,
  attr,
  onChange,
  variant,
}: {
  value: unknown;
  attr: Attribute;
  onChange: (v: string) => void;
  variant: "cell" | "input";
}) {
  // Badge is an enumeration rendered as pills — values live in `attr.enum`
  // (the canonical constrained-set primitive, validated server-side), not a
  // parallel options list. `options.colors` is the only badge-specific config.
  const values = (attr as EnumerationAttribute).enum ?? [];
  const colors = (attr.options?.colors as Record<string, string>) ?? undefined;
  const current = value == null ? "" : String(value);
  // Always offer the current value even if it's not in the configured set.
  const options = current && !values.includes(current) ? [current, ...values] : values;

  const c = current ? badgeColor(current, colors) : null;

  return (
    <Select value={current} onValueChange={onChange}>
      <SelectTrigger
        className={cn(
          "w-auto border-0 bg-transparent p-0 shadow-none focus:ring-0 gap-0 [&>svg]:hidden",
          variant === "cell" ? "h-7" : "h-8",
        )}
      >
        {c ? (
          <Pill label={current} bg={c.bg} text={c.text} withChevron />
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </SelectTrigger>
      <SelectContent align="start">
        {options.map((opt) => {
          const oc = badgeColor(opt, colors);
          return (
            <SelectItem key={opt} value={opt}>
              <Pill label={opt} bg={oc.bg} text={oc.text} />
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

// ── Link-like widget (url / email / phone) ─────────────────────────────

function hrefFor(kind: "url" | "email" | "phone", raw: string): string {
  const v = raw.trim();
  if (kind === "email") return `mailto:${v}`;
  if (kind === "phone") return `tel:${v.replace(/[^\d+]/g, "")}`;
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

function LinkCell({
  value,
  onCommit,
  fieldKey,
  kind,
  icon: Icon,
}: CustomFieldCellProps & { kind: "url" | "email" | "phone"; icon: LucideIcon }) {
  const [local, setLocal] = useState(String(value ?? ""));
  useEffect(() => setLocal(String(value ?? "")), [value]);
  const str = String(value ?? "").trim();

  return (
    <div className="flex items-center gap-1">
      <input
        value={local}
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
        className="min-w-0 flex-1 bg-transparent text-sm text-sky-700 focus:outline-none border-0 ring-0 px-0 py-0"
      />
      {str && (
        <a
          href={hrefFor(kind, str)}
          target={kind === "url" ? "_blank" : undefined}
          rel="noreferrer"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          title={`Open ${str}`}
          onClick={(e) => e.stopPropagation()}
        >
          <Icon className="size-3.5" />
        </a>
      )}
    </div>
  );
}

function LinkInput({
  value,
  onChange,
  fieldKey,
  kind,
  type,
}: CustomFieldInputProps & { kind: "url" | "email" | "phone"; type: string }) {
  const str = String(value ?? "").trim();
  return (
    <div className="flex flex-col gap-1 flex-1">
      <Input
        type={type}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        className="h-8"
        data-field={fieldKey}
      />
      {str && (
        <a
          href={hrefFor(kind, str)}
          target={kind === "url" ? "_blank" : undefined}
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-sky-700 hover:underline truncate"
        >
          <ExternalLink className="size-3" />
          {hrefFor(kind, str)}
        </a>
      )}
    </div>
  );
}

// ── Score widget ───────────────────────────────────────────────────────

function ScoreBar({ value, attr }: { value: unknown; attr: Attribute }) {
  const min = numOpt(attr.options, "min", 0);
  const max = numOpt(attr.options, "max", 100);
  const n = value == null || value === "" ? null : Number(value);
  const pct = n == null ? 0 : Math.max(0, Math.min(1, (n - min) / (max - min || 1)));
  const color = scoreColor(pct);
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="relative h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${pct * 100}%`, backgroundColor: color }}
        />
      </div>
      <span className="tabular-nums text-xs font-medium w-8 text-right" style={{ color: n == null ? undefined : color }}>
        {n == null ? "—" : n}
      </span>
    </div>
  );
}

function ScoreCell({ value, attr, onCommit, fieldKey }: CustomFieldCellProps) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(String(value ?? ""));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setLocal(String(value ?? "")), [value]);
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  if (editing) {
    return (
      <input
        ref={ref}
        type="number"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          setEditing(false);
          const next = local === "" ? null : Number(local);
          if (next !== value) onCommit(next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setLocal(String(value ?? ""));
            setEditing(false);
          }
        }}
        data-field={fieldKey}
        className="w-16 bg-transparent text-sm tabular-nums focus:outline-none border-0 ring-0 px-0 py-0"
      />
    );
  }
  return (
    <button onClick={() => setEditing(true)} data-field={fieldKey} className="block w-full min-w-[100px]">
      <ScoreBar value={value} attr={attr} />
    </button>
  );
}

function ScoreInput({ value, attr, onChange, fieldKey }: CustomFieldInputProps) {
  return (
    <div className="flex flex-col gap-2 w-56">
      <Input
        type="number"
        value={value == null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="h-8"
        data-field={fieldKey}
      />
      <ScoreBar value={value} attr={attr} />
    </div>
  );
}

// ── Tags widget ────────────────────────────────────────────────────────

function TagsCell({ value, onOpenSheet }: CustomFieldCellProps) {
  const tags = parseTags(value);
  if (tags.length === 0) {
    return (
      <button
        onClick={onOpenSheet}
        className="text-sm italic text-muted-foreground/60 hover:text-foreground"
      >
        Add tags
      </button>
    );
  }
  const shown = tags.slice(0, 3);
  return (
    <button onClick={onOpenSheet} className="flex flex-wrap items-center gap-1 max-w-full" title={tags.join(", ")}>
      {shown.map((t) => {
        const c = pillColor(t.toLowerCase());
        return <Pill key={t} label={t} bg={c.bg} text={c.text} />;
      })}
      {tags.length > shown.length && (
        <span className="text-xs text-muted-foreground">+{tags.length - shown.length}</span>
      )}
    </button>
  );
}

function TagsInput({ value, onChange, fieldKey }: CustomFieldInputProps) {
  const tags = parseTags(value);
  const [draft, setDraft] = useState("");

  function commit(next: string[]) {
    onChange(JSON.stringify(next));
  }
  function add(raw: string) {
    const t = raw.trim();
    if (!t || tags.includes(t)) return;
    commit([...tags, t]);
    setDraft("");
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input px-2 py-1.5 min-h-8 w-full">
      {tags.map((t) => {
        const c = pillColor(t.toLowerCase());
        return (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full pl-2 pr-1 py-0.5 text-xs font-medium"
            style={{ backgroundColor: c.bg, color: c.text }}
          >
            {t}
            <button
              type="button"
              onClick={() => commit(tags.filter((x) => x !== t))}
              className="opacity-60 hover:opacity-100"
              aria-label={`Remove ${t}`}
            >
              <X className="size-3" />
            </button>
          </span>
        );
      })}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && tags.length) {
            commit(tags.slice(0, -1));
          }
        }}
        onBlur={() => add(draft)}
        placeholder={tags.length ? "" : "Add a tag…"}
        data-field={fieldKey}
        className="flex-1 min-w-[80px] bg-transparent text-sm focus:outline-none"
      />
    </div>
  );
}

// ── Options editors ────────────────────────────────────────────────────

function ScoreOptions({ options, onChange }: CustomFieldOptionsProps) {
  const min = numOpt(options, "min", 0);
  const max = numOpt(options, "max", 100);
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="space-y-1.5 text-xs text-muted-foreground font-normal">
        Min
        <Input
          type="number"
          value={min}
          onChange={(e) => onChange({ ...options, min: Number(e.target.value) })}
          className="h-8"
        />
      </label>
      <label className="space-y-1.5 text-xs text-muted-foreground font-normal">
        Max
        <Input
          type="number"
          value={max}
          onChange={(e) => onChange({ ...options, max: Number(e.target.value) })}
          className="h-8"
        />
      </label>
    </div>
  );
}

// ── The registry ───────────────────────────────────────────────────────

export const CUSTOM_FIELDS: CustomFieldDef[] = [
  {
    uid: "clawnify::score.score",
    label: "Score",
    icon: Gauge,
    baseType: "integer",
    defaultOptions: { min: 0, max: 100 },
    Input: ScoreInput,
    Cell: ScoreCell,
    OptionsEditor: ScoreOptions,
  },
  {
    // An enumeration rendered as colored pills — values live in `attr.enum`,
    // edited via the field editor's existing enum textarea (shown for
    // enumeration types), so no bespoke options editor is needed.
    uid: "clawnify::badge.badge",
    label: "Badge",
    icon: Tag,
    baseType: "enumeration",
    Input: (p) => <BadgeSelect value={p.value} attr={p.attr} onChange={p.onChange} variant="input" />,
    Cell: (p) => <BadgeSelect value={p.value} attr={p.attr} onChange={p.onCommit} variant="cell" />,
  },
  {
    uid: "clawnify::url.url",
    label: "URL",
    icon: Link2,
    baseType: "string",
    Input: (p) => <LinkInput {...p} kind="url" type="url" />,
    Cell: (p) => <LinkCell {...p} kind="url" icon={ExternalLink} />,
  },
  {
    uid: "clawnify::email.email",
    label: "Email",
    icon: AtSign,
    baseType: "string",
    Input: (p) => <LinkInput {...p} kind="email" type="email" />,
    Cell: (p) => <LinkCell {...p} kind="email" icon={AtSign} />,
  },
  {
    uid: "clawnify::phone.phone",
    label: "Phone",
    icon: PhoneIcon,
    baseType: "string",
    Input: (p) => <LinkInput {...p} kind="phone" type="tel" />,
    Cell: (p) => <LinkCell {...p} kind="phone" icon={PhoneIcon} />,
  },
  {
    uid: "clawnify::tags.tags",
    label: "Tags",
    icon: TagsIcon,
    baseType: "json",
    Input: TagsInput,
    Cell: TagsCell,
  },
];

const BY_UID = new Map(CUSTOM_FIELDS.map((f) => [f.uid, f]));

export function customFieldByUid(uid: string | undefined): CustomFieldDef | undefined {
  return uid ? BY_UID.get(uid) : undefined;
}
