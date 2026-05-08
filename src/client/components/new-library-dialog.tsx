import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { Attribute, ContentType } from "@/lib/content-types";

function toSingular(displayName: string): string {
  const base = displayName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (base.endsWith("s") ? base.slice(0, -1) : base) || "item";
}

function toPlural(singular: string): string {
  if (!singular) return "items";
  if (/(s|x|z|ch|sh)$/.test(singular)) return singular + "es";
  if (/[^aeiou]y$/.test(singular)) return singular.slice(0, -1) + "ies";
  return singular + "s";
}

function toCollectionName(plural: string): string {
  return plural.replace(/-/g, "_");
}

function toUid(singular: string): string {
  return `api::${singular}.${singular}`;
}

const STARTER_ATTRIBUTES: Record<string, Attribute> = {
  title: { type: "string", required: true, configurable: false },
  slug: { type: "uid", targetField: "title", required: true, configurable: false },
  status: {
    type: "enumeration",
    enum: ["draft", "live"],
    default: "draft",
    required: true,
    configurable: false,
  },
};

export function NewLibraryDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (ct: ContentType) => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [singular, setSingular] = useState("");
  const [plural, setPlural] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live-derive singular/plural from display name unless user has typed.
  const [touchedSingular, setTouchedSingular] = useState(false);
  const [touchedPlural, setTouchedPlural] = useState(false);

  useEffect(() => {
    if (!touchedSingular) setSingular(toSingular(displayName));
  }, [displayName, touchedSingular]);
  useEffect(() => {
    if (!touchedPlural) setPlural(toPlural(singular));
  }, [singular, touchedPlural]);

  function reset() {
    setDisplayName("");
    setSingular("");
    setPlural("");
    setTouchedSingular(false);
    setTouchedPlural(false);
    setError(null);
    setBusy(false);
  }

  async function create() {
    setError(null);
    if (!displayName.trim() || !singular || !plural) {
      setError("Display name, singular, and plural are required.");
      return;
    }
    setBusy(true);
    try {
      const created = await api.createContentType({
        uid: toUid(singular),
        kind: "collectionType",
        collectionName: toCollectionName(plural),
        info: {
          singularName: singular,
          pluralName: plural,
          displayName: displayName.trim(),
        },
        options: {},
        attributes: STARTER_ATTRIBUTES,
      });
      reset();
      onCreated(created);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New library</DialogTitle>
          <DialogDescription>
            Creates a collection-type with a starter schema (title, slug, status). You can add
            and remove fields after.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label="Display name">
            <Input
              autoFocus
              placeholder="Articles"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="h-9"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Singular">
              <Input
                value={singular}
                onChange={(e) => {
                  setTouchedSingular(true);
                  setSingular(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
                }}
                className="h-9 font-mono text-sm"
                placeholder="article"
              />
            </Field>
            <Field label="Plural">
              <Input
                value={plural}
                onChange={(e) => {
                  setTouchedPlural(true);
                  setPlural(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
                }}
                className="h-9 font-mono text-sm"
                placeholder="articles"
              />
            </Field>
          </div>
          <div className="text-xs text-muted-foreground">
            Public REST: <code className="font-mono">GET /api/entries/{plural || "…"}</code>
          </div>
          {error && (
            <div className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1.5">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={create} disabled={busy}>
            {busy ? "Creating…" : "Create library"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground font-normal">{label}</Label>
      {children}
    </div>
  );
}
