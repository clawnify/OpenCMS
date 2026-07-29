import { Fragment, useEffect, useRef, useState } from "react";
import { X, Trash2, Sparkles, Loader2, NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { DynamicField } from "./dynamic-field";
import { api } from "@/lib/api";
import {
  fieldLabel,
  NOTES_KEY,
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
  // Notes stay out of the way until asked for: the panel shows on its own once
  // the entry has any, otherwise it's one click away. They arrive from their own
  // endpoint — entry payloads deliberately don't carry them (see routes-entries).
  const [notesOpened, setNotesOpened] = useState(false);
  const [notes, setNotes] = useState("");
  // Track which AI fields we've already auto-triggered in this session so a
  // single failure doesn't loop, and a successful fill doesn't re-trigger on
  // remount-induced local changes.
  const autoAttemptedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setLocal(entry);
    autoAttemptedRef.current = new Set();
    setNotesOpened(false);
    setNotes("");
    let stale = false;
    api
      .getNotes(contentType.info.pluralName, entry.id)
      .then((r) => {
        if (!stale) setNotes(r.notes ?? "");
      })
      .catch((e) => console.error("Could not load notes", e));
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // `notes` is a platform column with its own panel below. Drop any attribute
  // of the same name (possible in a library created before it was reserved) so
  // one column never gets two inputs in the same form.
  const entries = Object.entries(contentType.attributes).filter(([k]) => k !== NOTES_KEY);
  const top = entries.filter(([, a]) => a.type !== "richtext" && a.type !== "json" && a.type !== "html" && a.type !== "image");
  const bottom = entries.filter(([, a]) => a.type === "richtext" || a.type === "json" || a.type === "html" || a.type === "image");

  // The brief reads as an extension of the description — the summary says what
  // the entry is, the notes say how to write it — so it sits directly under
  // that field. Libraries without a `description` get it after the short fields,
  // still above the long-form content it briefs.
  const notesAnchor =
    top.find(([k]) => k === "description")?.[0] ?? top[top.length - 1]?.[0];

  const notesPanel =
    notesOpened || notes.trim() ? (
      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 space-y-2">
        <div className="flex items-center gap-1.5 text-sm">
          <NotebookPen className="size-3.5 text-muted-foreground" />
          Notes
        </div>
        <Textarea
          autoFocus={notesOpened}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            patch({ [NOTES_KEY]: e.target.value });
          }}
          placeholder="The angle, what you'd say about this from your own experience, sources, what to avoid…"
          className="min-h-24 bg-background text-sm"
          data-field={NOTES_KEY}
        />
        <p className="text-xs text-muted-foreground">
          Your brief for whoever writes this — you or an agent. Feeds AI generation as the
          source of angle and first-hand experience. Not shown to public readers.
        </p>
      </div>
    ) : (
      <button
        onClick={() => setNotesOpened(true)}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <NotebookPen className="size-3.5" />
        Add notes
      </button>
    );

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
            <Fragment key={key}>
              <FieldRow
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
              {key === notesAnchor && notesPanel}
            </Fragment>
          ))}

          {/* A library with no short fields at all still needs the panel. */}
          {notesAnchor === undefined && notesPanel}

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
