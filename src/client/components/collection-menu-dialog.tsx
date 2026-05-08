import { useState, useEffect } from "react";
import { Trash2, ArrowLeft, ChevronRight, EyeOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { POSTS_FIELDS, useFieldConfig, resolveLabel, isHidden, type FieldDef } from "@/lib/fields";
import { FieldEditor, TYPE_ICON, TYPE_LABEL } from "./field-editor";
import { cn } from "@/lib/utils";

interface Collection {
  id: string;
  label: string;
  count: number;
}

export function CollectionMenuDialog({
  collection,
  onClose,
}: {
  collection: Collection | null;
  onClose: () => void;
}) {
  const [fieldKey, setFieldKey] = useState<string | null>(null);

  useEffect(() => {
    if (!collection) setFieldKey(null);
  }, [collection]);

  const field = fieldKey ? POSTS_FIELDS.find((f) => f.key === fieldKey) ?? null : null;

  return (
    <Dialog
      open={!!collection}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg p-0 gap-0">
        {field ? (
          <FieldDialogView
            field={field}
            onBack={() => setFieldKey(null)}
            onClose={onClose}
          />
        ) : (
          <CollectionDialogView
            collection={collection}
            onPickField={(k) => setFieldKey(k)}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CollectionDialogView({
  collection,
  onPickField,
  onClose,
}: {
  collection: Collection | null;
  onPickField: (key: string) => void;
  onClose: () => void;
}) {
  const { config } = useFieldConfig();

  return (
    <>
      <DialogHeader className="px-5 pt-5 pb-3">
        <DialogTitle>Library: {collection?.label}</DialogTitle>
        <DialogDescription>
          {collection?.count ?? 0} item
          {(collection?.count ?? 0) === 1 ? "" : "s"}. Click a field to edit its label or
          visibility.
        </DialogDescription>
      </DialogHeader>

      <div className="px-3 pb-3 max-h-[420px] overflow-y-auto">
        {POSTS_FIELDS.map((f) => {
          const Icon = TYPE_ICON[f.type];
          const label = resolveLabel(f, config);
          const hidden = isHidden(f, config);
          const isOverridden =
            !!config[f.key]?.label || !!config[f.key]?.hidden;
          return (
            <button
              key={f.key}
              onClick={() => onPickField(f.key)}
              className={cn(
                "w-full flex items-center gap-3 px-2 py-2 rounded-md hover:bg-muted text-left",
                hidden && "opacity-60",
              )}
            >
              <Icon className="size-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate flex items-center gap-1.5">
                  {label}
                  {isOverridden && (
                    <span className="text-[10px] text-muted-foreground">·  customised</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {TYPE_LABEL[f.type]} · <code className="font-mono">{f.key}</code>
                </div>
              </div>
              {hidden && <EyeOff className="size-3.5 text-muted-foreground" />}
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>
          );
        })}
      </div>

      <Separator />

      <DialogFooter className="px-5 py-3 sm:justify-between">
        <Button
          variant="ghost"
          disabled
          title="Built-in libraries can't be deleted in v1"
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

function FieldDialogView({
  field,
  onBack,
  onClose,
}: {
  field: FieldDef;
  onBack: () => void;
  onClose: () => void;
}) {
  const Icon = TYPE_ICON[field.type];
  return (
    <>
      <DialogHeader className="px-5 pt-5 pb-3 flex-row items-center gap-2 space-y-0">
        <button
          onClick={onBack}
          className="size-7 inline-flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground"
          title="Back"
          aria-label="Back to library"
        >
          <ArrowLeft className="size-4" />
        </button>
        <Icon className="size-4 text-muted-foreground" />
        <DialogTitle className="flex-1">{field.defaultLabel}</DialogTitle>
        <span className="text-xs text-muted-foreground">{TYPE_LABEL[field.type]}</span>
      </DialogHeader>
      <DialogDescription className="sr-only">
        Edit the {field.defaultLabel} field's display label and visibility.
      </DialogDescription>

      <div className="pb-1">
        <FieldEditor field={field} variant="dialog" />
      </div>

      <DialogFooter className="px-5 py-3">
        <Button onClick={onClose}>Done</Button>
      </DialogFooter>
    </>
  );
}
