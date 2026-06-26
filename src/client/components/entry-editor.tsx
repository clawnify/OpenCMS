import { useEffect, useRef, useState } from "react";
import { X, Trash2, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { DynamicField } from "./dynamic-field";
import { api } from "@/lib/api";
import {
  fieldLabel,
  type Attribute,
  type ContentType,
  type Entry,
} from "@/lib/content-types";
import { cn } from "@/lib/utils";

interface EntryEditorProps {
  contentType: ContentType;
  entry: Entry;
  onChange: (entry: Entry) => void;
  onClose: () => void;
  onDelete: () => void;
  publicOrigin?: string;
}

export function EntryEditor({
  contentType,
  entry,
  onChange,
  onClose,
  onDelete,
  publicOrigin,
}: EntryEditorProps) {
  const [local, setLocal] = useState<Entry>(entry);
  const [savingState, setSavingState] = useState<"saved" | "saving" | "error">("saved");
  const [generating, setGenerating] = useState<Record<string, boolean>>({});
  // Track which AI fields we've already auto-triggered in this session so a
  // single failure doesn't loop, and a successful fill doesn't re-trigger on
  // remount-induced local changes.
  const autoAttemptedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setLocal(entry);
    autoAttemptedRef.current = new Set();
  }, [entry.id]);

  function patch(p: Record<string, unknown>) {
    const next = { ...local, ...p };
    setLocal(next);
    setSavingState("saving");
    schedule(
      contentType.info.pluralName,
      Number(entry.id),
      p,
      (saved) => {
        // Don't write the server response back into `local`: the fields are
        // controlled by it, and a save that lands mid-typing would reset the
        // input to a slightly-older value, bouncing the cursor and scrambling
        // words. `local` (the optimistic edit buffer) is the source of truth
        // while the editor is open; the list still updates via onChange.
        onChange(saved);
        setSavingState("saved");
      },
      () => setSavingState("error"),
    );
  }

  async function runAIGeneration(fieldKey: string) {
    setGenerating((g) => ({ ...g, [fieldKey]: true }));
    try {
      const { value } = await api.aiGenerateField(
        contentType.info.pluralName,
        Number(entry.id),
        fieldKey,
      );
      patch({ [fieldKey]: value });
    } catch (e) {
      console.error("AI generation failed", fieldKey, e);
    } finally {
      setGenerating((g) => {
        const next = { ...g };
        delete next[fieldKey];
        return next;
      });
    }
  }

  // Auto-fill: after the local state settles, fire any AI-enabled empty cells
  // whose dependency set is fully populated. One attempt per (session, field).
  useEffect(() => {
    const t = setTimeout(() => {
      for (const [key, attr] of Object.entries(contentType.attributes)) {
        if (!shouldAutoTrigger(key, attr, local, contentType.attributes, autoAttemptedRef.current)) {
          continue;
        }
        autoAttemptedRef.current.add(key);
        runAIGeneration(key);
      }
    }, 400);
    return () => clearTimeout(t);
    // We intentionally watch local — the trigger re-evaluates on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);

  // Find the publish action — only meaningful for an enumeration named "status"
  // with draft/live values, matching the Posts seed convention.
  const statusAttr = contentType.attributes.status;
  const supportsPublish =
    statusAttr?.type === "enumeration" &&
    "enum" in statusAttr &&
    Array.isArray(statusAttr.enum) &&
    statusAttr.enum.includes("draft") &&
    statusAttr.enum.includes("live");

  async function togglePublish() {
    if (!supportsPublish) return;
    const next = local.status === "live" ? "draft" : "live";
    const saved = await api.updateEntry(contentType.info.pluralName, Number(entry.id), {
      status: next,
    });
    setLocal(saved);
    onChange(saved);
  }

  const contextValues: Record<string, unknown> = local;

  const entries = Object.entries(contentType.attributes);
  const top = entries.filter(([, a]) => a.type !== "richtext" && a.type !== "json" && a.type !== "html" && a.type !== "image");
  const bottom = entries.filter(([, a]) => a.type === "richtext" || a.type === "json" || a.type === "html" || a.type === "image");

  return (
    <div className="flex h-full flex-col bg-background border-l border-border">
      <div className="flex items-center gap-2 px-4 h-12 border-b border-border">
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0">
          <X className="size-4" />
        </Button>
        <div className="flex-1" />
        <span
          className={cn(
            "text-xs",
            savingState === "saved" && "text-muted-foreground",
            savingState === "saving" && "text-muted-foreground",
            savingState === "error" && "text-destructive",
          )}
        >
          {savingState === "saving"
            ? "Saving…"
            : savingState === "error"
              ? "Error"
              : "Saved"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </Button>
        {supportsPublish && (
          <Button onClick={togglePublish} size="sm" className="h-7">
            {local.status === "live" ? "Unpublish" : "Publish"}
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="space-y-4 max-w-2xl">
          {top.map(([key, attr]) => (
            <FieldRow
              key={key}
              label={fieldLabel(key, attr)}
              required={attr.required}
              aiEnabled={!!attr.aiConfig?.enabled}
              generating={!!generating[key]}
              onRegenerate={() => runAIGeneration(key)}
            >
              <DynamicField
                value={local[key]}
                attr={attr}
                fieldKey={key}
                contextValues={contextValues}
                publicOrigin={publicOrigin}
                onChange={(v) => patch({ [key]: v })}
              />
            </FieldRow>
          ))}

          {bottom.length > 0 && (
            <>
              <Separator className="my-2" />
              {bottom.map(([key, attr]) => (
                <FieldRow
                  key={key}
                  label={fieldLabel(key, attr)}
                  required={attr.required}
                  align="top"
                  aiEnabled={!!attr.aiConfig?.enabled}
                  generating={!!generating[key]}
                  onRegenerate={() => runAIGeneration(key)}
                >
                  <DynamicField
                    value={local[key]}
                    attr={attr}
                    fieldKey={key}
                    contextValues={contextValues}
                    publicOrigin={publicOrigin}
                    onChange={(v) => patch({ [key]: v })}
                  />
                </FieldRow>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FieldRow({
  label,
  children,
  required,
  align = "center",
  aiEnabled,
  generating,
  onRegenerate,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  align?: "center" | "top";
  aiEnabled?: boolean;
  generating?: boolean;
  onRegenerate?: () => void;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[140px_1fr] gap-3",
        align === "center" ? "items-center" : "items-start pt-1",
      )}
    >
      <Label className="text-sm text-muted-foreground font-normal flex items-center gap-1.5">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
        {aiEnabled && onRegenerate && (
          <button
            onClick={onRegenerate}
            disabled={generating}
            className="ml-auto inline-flex items-center justify-center size-5 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50"
            title={generating ? "Generating…" : "Regenerate with AI"}
            type="button"
          >
            {generating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
          </button>
        )}
      </Label>
      <div className="min-w-0">
        {generating ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground italic">
            <Loader2 className="size-3 animate-spin" />
            Generating with AI…
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

// ── Auto-trigger evaluation ────────────────────────────────────────

function shouldAutoTrigger(
  key: string,
  attr: Attribute,
  local: Entry,
  attributes: Record<string, Attribute>,
  attempted: Set<string>,
): boolean {
  if (!attr.aiConfig?.enabled) return false;
  if (attr.aiConfig.autoFillOnEmpty === false) return false;
  if (attempted.has(key)) return false;
  if (isNonEmpty(local[key])) return false;

  const refs = extractRefs(attr.aiConfig.systemPrompt);
  const deps =
    refs.length > 0
      ? refs
      : Object.entries(attributes)
          .filter(([k, a]) => k !== key && !a.aiConfig?.enabled)
          .map(([k]) => k);

  if (deps.length === 0) return true;
  return deps.every((d) => isNonEmpty(local[d]));
}

function isNonEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim() !== "";
  return true;
}

function extractRefs(template: string): string[] {
  const seen = new Set<string>();
  for (const m of template.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g)) {
    seen.add(m[1]);
  }
  return Array.from(seen);
}

// Debounced per-(plural, id) save queue.
const debouncers = new Map<string, ReturnType<typeof setTimeout>>();
const pending = new Map<string, Record<string, unknown>>();

function schedule(
  pluralName: string,
  id: number,
  patch: Record<string, unknown>,
  onSaved: (e: Entry) => void,
  onError: () => void,
) {
  const key = `${pluralName}:${id}`;
  pending.set(key, { ...(pending.get(key) ?? {}), ...patch });
  const existing = debouncers.get(key);
  if (existing) clearTimeout(existing);
  debouncers.set(
    key,
    setTimeout(async () => {
      const body = pending.get(key);
      pending.delete(key);
      debouncers.delete(key);
      if (!body) return;
      try {
        const saved = await api.updateEntry(pluralName, id, body);
        onSaved(saved);
      } catch {
        onError();
      }
    }, 350),
  );
}
