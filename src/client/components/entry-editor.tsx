import { useEffect, useState } from "react";
import { X, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { DynamicField } from "./dynamic-field";
import { api } from "@/lib/api";
import {
  fieldLabel,
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

  useEffect(() => setLocal(entry), [entry.id]);

  function patch(p: Record<string, unknown>) {
    const next = { ...local, ...p };
    setLocal(next);
    setSavingState("saving");
    schedule(
      contentType.info.pluralName,
      Number(entry.id),
      p,
      (saved) => {
        setLocal(saved);
        onChange(saved);
        setSavingState("saved");
      },
      () => setSavingState("error"),
    );
  }

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

  // Build a contextValues map (used by uid field for slug preview etc.)
  const contextValues: Record<string, unknown> = local;

  // Render fields in a sensible order: non-richtext first, then richtext / json
  // (which take a lot of vertical space) at the bottom.
  const entries = Object.entries(contentType.attributes);
  const top = entries.filter(([, a]) => a.type !== "richtext" && a.type !== "json");
  const bottom = entries.filter(([, a]) => a.type === "richtext" || a.type === "json");

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
            <FieldRow key={key} label={fieldLabel(key, attr)} required={attr.required}>
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
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  align?: "center" | "top";
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[140px_1fr] gap-3",
        align === "center" ? "items-center" : "items-start pt-1",
      )}
    >
      <Label className="text-sm text-muted-foreground font-normal">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <div className="min-w-0">{children}</div>
    </div>
  );
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
