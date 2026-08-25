import { useEffect, useState } from "react";
import { Trash2, ArrowLeft, ChevronRight, EyeOff, Plus, NotebookPen } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fieldLabel,
  isFieldLocked,
  PLATFORM_COLUMNS,
  type Attribute,
  type AttributeType,
  type ContentType,
} from "@/lib/content-types";
import { api } from "@/lib/api";
import {
  ALL_TYPES,
  FieldEditor,
  TYPE_ICON,
  TYPE_LABEL,
} from "./field-editor";
import { cn } from "@/lib/utils";

type View =
  | { kind: "menu" }
  | { kind: "field"; key: string }
  | { kind: "newField" }
  | { kind: "notes" }
  | { kind: "deleteFieldConfirm"; key: string }
  | { kind: "deleteLibraryConfirm" };

export function LibraryDialog({
  contentType,
  entryCount,
  onClose,
  onChange,
}: {
  contentType: ContentType | null;
  entryCount?: number;
  onClose: () => void;
  onChange: () => void;
}) {
  const [view, setView] = useState<View>({ kind: "menu" });

  useEffect(() => {
    if (!contentType) setView({ kind: "menu" });
  }, [contentType]);

  async function patchAttributes(
    next: Record<string, Attribute>,
    opts: { applyDestructive?: boolean } = {},
  ) {
    if (!contentType) return;
    await api.patchContentType(contentType.uid, {
      attributes: next,
      applyDestructive: opts.applyDestructive,
    });
    onChange();
  }

  return (
    <Dialog
      open={!!contentType}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        {!contentType ? null : view.kind === "menu" ? (
          <MenuView
            contentType={contentType}
            entryCount={entryCount}
            onPickField={(key) => setView({ kind: "field", key })}
            onAddField={() => setView({ kind: "newField" })}
            onEditNotes={() => setView({ kind: "notes" })}
            onDeleteLibrary={() => setView({ kind: "deleteLibraryConfirm" })}
            onClose={onClose}
          />
        ) : view.kind === "field" ? (
          <FieldView
            contentType={contentType}
            fieldKey={view.key}
            onBack={() => setView({ kind: "menu" })}
            onCommit={async (nextAttr) => {
              const isTypeChange =
                nextAttr.type !== contentType.attributes[view.key]?.type;
              const merged = { ...contentType.attributes, [view.key]: nextAttr };
              if (isTypeChange) {
                if (
                  !window.confirm(
                    `Change "${view.key}" from ${contentType.attributes[view.key].type} to ${nextAttr.type}? Existing values in this column may be coerced or wiped.`,
                  )
                ) {
                  return;
                }
                await patchAttributes(merged, { applyDestructive: true });
              } else {
                await patchAttributes(merged);
              }
              setView({ kind: "menu" });
            }}
            onRemove={() => setView({ kind: "deleteFieldConfirm", key: view.key })}
          />
        ) : view.kind === "notes" ? (
          <NotesView
            contentType={contentType}
            onBack={() => setView({ kind: "menu" })}
            onSave={async (notes) => {
              await api.patchContentType(contentType.uid, { info: { ...contentType.info, notes } });
              onChange();
              setView({ kind: "menu" });
            }}
          />
        ) : view.kind === "newField" ? (
          <NewFieldView
            contentType={contentType}
            onBack={() => setView({ kind: "menu" })}
            onCreate={async (key, attr) => {
              await patchAttributes({ ...contentType.attributes, [key]: attr });
              setView({ kind: "menu" });
            }}
          />
        ) : view.kind === "deleteFieldConfirm" ? (
          <DeleteFieldConfirmView
            contentType={contentType}
            fieldKey={view.key}
            entryCount={entryCount}
            onBack={() => setView({ kind: "menu" })}
            onConfirm={async () => {
              const next = { ...contentType.attributes };
              delete next[view.key];
              await patchAttributes(next, { applyDestructive: true });
              setView({ kind: "menu" });
            }}
          />
        ) : view.kind === "deleteLibraryConfirm" ? (
          <DeleteLibraryConfirmView
            contentType={contentType}
            entryCount={entryCount}
            onBack={() => setView({ kind: "menu" })}
            onConfirm={async () => {
              await api.deleteContentType(contentType.uid);
              onChange();
              onClose();
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ── Views ───────────────────────────────────────────────────────────

function MenuView({
  contentType,
  entryCount,
  onPickField,
  onAddField,
  onEditNotes,
  onDeleteLibrary,
  onClose,
}: {
  contentType: ContentType;
  entryCount?: number;
  onPickField: (k: string) => void;
  onAddField: () => void;
  onEditNotes: () => void;
  onDeleteLibrary: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <DialogHeader className="px-5 pt-5 pb-3">
        <DialogTitle>Library: {contentType.info.displayName}</DialogTitle>
        <DialogDescription>
          {entryCount !== undefined ? (
            <>{entryCount} item{entryCount === 1 ? "" : "s"} · </>
          ) : null}
          <code className="font-mono">/api/entries/{contentType.info.pluralName}</code>
        </DialogDescription>
      </DialogHeader>

      <div className="px-3 pb-3 max-h-[420px] overflow-y-auto">
        {/* The brief goes above the fields, not with them: it describes the
            library itself, and a library with two dozen columns buries anything
            appended after the list. An author who never scrolls the schema still
            has to pass the house style. */}
        <button
          onClick={onEditNotes}
          className="w-full flex items-center gap-3 px-2 py-2 rounded-md hover:bg-muted text-left"
        >
          <NotebookPen className="size-4 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm">Library notes</div>
            <div className="text-xs text-muted-foreground truncate">
              {contentType.info.notes?.trim()
                ? contentType.info.notes.trim()
                : "House style for every entry here"}
            </div>
          </div>
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>

        <Separator className="my-2" />

        {Object.entries(contentType.attributes).map(([key, attr]) => {
          const Icon = TYPE_ICON[attr.type];
          const label = fieldLabel(key, attr);
          const locked = isFieldLocked(attr);
          return (
            <button
              key={key}
              onClick={() => onPickField(key)}
              className={cn(
                "w-full flex items-center gap-3 px-2 py-2 rounded-md hover:bg-muted text-left",
                attr.hidden && "opacity-60",
              )}
            >
              <Icon className="size-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate flex items-center gap-1.5">
                  {label}
                  {locked && (
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      built-in
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {TYPE_LABEL[attr.type]} · <code className="font-mono">{key}</code>
                </div>
              </div>
              {attr.hidden && <EyeOff className="size-3.5 text-muted-foreground" />}
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>
          );
        })}

        <button
          onClick={onAddField}
          className="w-full flex items-center gap-3 px-2 py-2 rounded-md hover:bg-muted text-left text-muted-foreground hover:text-foreground mt-1"
        >
          <Plus className="size-4 shrink-0" />
          <div className="text-sm">Add field</div>
        </button>
      </div>

      <Separator />

      <DialogFooter className="px-5 py-3 mx-0 mb-0 sm:justify-between">
        <Button
          variant="ghost"
          onClick={onDeleteLibrary}
          className="text-destructive hover:text-destructive gap-1.5"
        >
          <Trash2 className="size-4" />
          Delete library
        </Button>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </>
  );
}

function NotesView({
  contentType,
  onBack,
  onSave,
}: {
  contentType: ContentType;
  onBack: () => void;
  onSave: (notes: string) => Promise<void>;
}) {
  const [notes, setNotes] = useState(contentType.info.notes ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <DialogHeader className="px-5 pt-5 pb-3 flex-row items-center gap-2 space-y-0">
        <BackButton onClick={onBack} />
        <NotebookPen className="size-4 text-muted-foreground" />
        <DialogTitle className="flex-1">Library notes</DialogTitle>
      </DialogHeader>
      <DialogDescription className="sr-only">
        Standing brief for every entry in {contentType.info.displayName}.
      </DialogDescription>

      <div className="px-5 pb-4 space-y-2">
        <Textarea
          autoFocus
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="How every entry here is written: house style, markup the site supports, what to avoid…"
          className="min-h-40 text-sm"
        />
        <p className="text-xs text-muted-foreground">
          The standing brief for every {contentType.info.singularName || "entry"} in this
          library — read by anyone writing one, agents included, and fed to AI generation.
          A single entry's own notes override it. Not shown to public readers.
        </p>
      </div>

      <Separator />

      <DialogFooter className="px-5 py-3 mx-0 mb-0">
        <Button variant="outline" onClick={onBack} disabled={busy}>
          Cancel
        </Button>
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave(notes.trim());
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}

function FieldView({
  contentType,
  fieldKey,
  onBack,
  onCommit,
  onRemove,
}: {
  contentType: ContentType;
  fieldKey: string;
  onBack: () => void;
  onCommit: (next: Attribute) => Promise<void>;
  onRemove: () => void;
}) {
  const attr = contentType.attributes[fieldKey];
  if (!attr) return null;
  const Icon = TYPE_ICON[attr.type];
  const locked = isFieldLocked(attr);
  return (
    <>
      <DialogHeader className="px-5 pt-5 pb-3 flex-row items-center gap-2 space-y-0">
        <BackButton onClick={onBack} />
        <Icon className="size-4 text-muted-foreground" />
        <DialogTitle className="flex-1">{fieldLabel(fieldKey, attr)}</DialogTitle>
        <span className="text-xs text-muted-foreground">{TYPE_LABEL[attr.type]}</span>
      </DialogHeader>
      <DialogDescription className="sr-only">
        Edit the {fieldKey} field's label, type, and visibility.
      </DialogDescription>

      <FieldEditor
        fieldKey={fieldKey}
        attribute={attr}
        siblingFieldKeys={Object.keys(contentType.attributes).filter((k) => k !== fieldKey)}
        onCommit={onCommit}
        onRemove={locked ? undefined : onRemove}
      />
    </>
  );
}

function NewFieldView({
  contentType,
  onBack,
  onCreate,
}: {
  contentType: ContentType;
  onBack: () => void;
  onCreate: (key: string, attr: Attribute) => Promise<void>;
}) {
  const [key, setKey] = useState("");
  const [type, setType] = useState<AttributeType>("string");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const k = key.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!k) return setError("Field key is required.");
    if (k in contentType.attributes) return setError(`Field "${k}" already exists.`);
    if (PLATFORM_COLUMNS.includes(k)) {
      return setError(`"${k}" is a built-in column — pick another key.`);
    }
    setBusy(true);
    setError(null);
    try {
      const attr: Attribute =
        type === "enumeration"
          ? ({ type: "enumeration", enum: ["option_a", "option_b"] } as Attribute)
          : ({ type } as Attribute);
      await onCreate(k, attr);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader className="px-5 pt-5 pb-3 flex-row items-center gap-2 space-y-0">
        <BackButton onClick={onBack} />
        <DialogTitle className="flex-1">Add field</DialogTitle>
      </DialogHeader>

      <div className="px-5 pb-3 space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground font-normal">Field key</Label>
          <Input
            autoFocus
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="my_field"
            className="h-8 font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Used as the column name in the SQL table. Lowercase letters, digits, underscore.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground font-normal">Type</Label>
          <Select value={type} onValueChange={(t: AttributeType) => setType(t)}>
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
            </SelectContent>
          </Select>
        </div>

        {error && (
          <div className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1.5">
            {error}
          </div>
        )}
      </div>

      <DialogFooter className="px-5 py-3 mx-0 mb-0">
        <Button variant="outline" onClick={onBack} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={create} disabled={busy}>
          {busy ? "Adding…" : "Add field"}
        </Button>
      </DialogFooter>
    </>
  );
}

function DeleteFieldConfirmView({
  contentType,
  fieldKey,
  entryCount,
  onBack,
  onConfirm,
}: {
  contentType: ContentType;
  fieldKey: string;
  entryCount?: number;
  onBack: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <DialogHeader className="px-5 pt-5 pb-3 flex-row items-center gap-2 space-y-0">
        <BackButton onClick={onBack} />
        <DialogTitle className="flex-1">Delete field</DialogTitle>
      </DialogHeader>

      <div className="px-5 pb-3 space-y-3">
        <p className="text-sm">
          Permanently delete the <code className="font-mono">{fieldKey}</code> column from{" "}
          <b>{contentType.info.displayName}</b>?
        </p>
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
          The SQL column will be dropped. Any values stored in this column for{" "}
          {entryCount ?? "existing"} entries will be lost. This can't be undone.
        </div>
      </div>

      <DialogFooter className="px-5 py-3 mx-0 mb-0">
        <Button variant="outline" onClick={onBack} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
            }
          }}
          disabled={busy}
        >
          {busy ? "Deleting…" : "Delete field"}
        </Button>
      </DialogFooter>
    </>
  );
}

function DeleteLibraryConfirmView({
  contentType,
  entryCount,
  onBack,
  onConfirm,
}: {
  contentType: ContentType;
  entryCount?: number;
  onBack: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <DialogHeader className="px-5 pt-5 pb-3 flex-row items-center gap-2 space-y-0">
        <BackButton onClick={onBack} />
        <DialogTitle className="flex-1">Delete library</DialogTitle>
      </DialogHeader>

      <div className="px-5 pb-3 space-y-3">
        <p className="text-sm">
          Permanently delete <b>{contentType.info.displayName}</b>?
        </p>
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
          The SQL table <code className="font-mono">{contentType.collectionName}</code> and all{" "}
          {entryCount ?? "its"} entries will be dropped. This can't be undone.
        </div>
      </div>

      <DialogFooter className="px-5 py-3 mx-0 mb-0">
        <Button variant="outline" onClick={onBack} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
            }
          }}
          disabled={busy}
        >
          {busy ? "Deleting…" : "Delete library"}
        </Button>
      </DialogFooter>
    </>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="size-7 inline-flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground"
      title="Back"
      aria-label="Back"
    >
      <ArrowLeft className="size-4" />
    </button>
  );
}
