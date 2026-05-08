import { useEffect, useRef, useState } from "react";
import { X, ImagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { RichEditor } from "./rich-editor";
import { StatusPill } from "./status-pill";
import { api } from "@/lib/api";
import type { Post, PostPatch } from "@/lib/types";
import { cn } from "@/lib/utils";

interface PostEditorProps {
  post: Post;
  onChange: (post: Post) => void;
  onClose: () => void;
  onDelete: () => void;
  publicOrigin?: string;
}

export function PostEditor({ post, onChange, onClose, onDelete, publicOrigin }: PostEditorProps) {
  const [local, setLocal] = useState<Post>(post);
  const [savingState, setSavingState] = useState<"saved" | "saving" | "error">("saved");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setLocal(post), [post.id]);

  function patch(p: PostPatch) {
    const next = { ...local, ...p } as Post;
    setLocal(next);
    setSavingState("saving");
    schedule(post.id, p, (saved) => {
      setLocal(saved);
      onChange(saved);
      setSavingState("saved");
    }, () => setSavingState("error"));
  }

  async function uploadCover(file: File) {
    const { url } = await api.uploadImage(file);
    patch({ image_url: url });
  }

  async function publish() {
    const next = local.status === "live" ? "draft" : "live";
    const saved = await api.updatePost(post.id, { status: next });
    setLocal(saved);
    onChange(saved);
  }

  const previewUrl = publicOrigin
    ? `${publicOrigin}/posts/${local.slug}`
    : `/posts/${local.slug}`;

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
          {savingState === "saving" ? "Saving…" : savingState === "error" ? "Error" : "Saved"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </Button>
        <Button onClick={publish} size="sm" className="h-7">
          {local.status === "live" ? "Unpublish" : "Publish"}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="space-y-4 max-w-2xl">
          <FieldRow label="Featured">
            <Switch
              checked={!!local.featured}
              onCheckedChange={(v) => patch({ featured: v ? 1 : 0 })}
            />
          </FieldRow>

          <FieldRow label="Image">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadCover(f);
                e.target.value = "";
              }}
            />
            {local.image_url ? (
              <div className="relative inline-block group">
                <img
                  src={local.image_url}
                  alt=""
                  className="h-16 rounded-md object-cover cursor-pointer"
                  onClick={() => fileRef.current?.click()}
                />
                <button
                  onClick={() => patch({ image_url: null })}
                  className="absolute -top-1 -right-1 size-4 rounded-full bg-foreground text-background text-xs flex items-center justify-center opacity-0 group-hover:opacity-100"
                >
                  ×
                </button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                className="gap-1.5"
              >
                <ImagePlus className="size-3.5" />
                Upload image
              </Button>
            )}
          </FieldRow>

          <FieldRow label="Status">
            <Select
              value={local.status}
              onValueChange={(v: "draft" | "live") => patch({ status: v })}
            >
              <SelectTrigger className="h-7 w-auto border-0 bg-transparent p-0 shadow-none focus:ring-0 gap-0 [&>svg]:hidden">
                <StatusPill status={local.status} withChevron />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value="draft">
                  <StatusPill status="draft" />
                </SelectItem>
                <SelectItem value="live">
                  <StatusPill status="live" />
                </SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>

          <FieldRow label="Title">
            <Input
              value={local.title}
              onChange={(e) => patch({ title: e.target.value })}
              className="h-8"
            />
          </FieldRow>

          <FieldRow label="Slug">
            <div className="flex flex-col gap-1 flex-1">
              <Input
                value={local.slug}
                onChange={(e) => patch({ slug: e.target.value })}
                className="h-8 font-mono text-xs"
              />
              <a
                href={previewUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground truncate"
              >
                🌐 {previewUrl}
              </a>
            </div>
          </FieldRow>

          <FieldRow label="Description">
            <Textarea
              value={local.description}
              onChange={(e) => patch({ description: e.target.value })}
              className="min-h-[60px] text-sm"
            />
          </FieldRow>

          <FieldRow label="Category">
            <Input
              value={local.category}
              onChange={(e) => patch({ category: e.target.value })}
              className="h-8"
              placeholder="e.g. Industry"
            />
          </FieldRow>

          <FieldRow label="Date">
            <Input
              type="date"
              value={local.post_date}
              onChange={(e) => patch({ post_date: e.target.value })}
              className="h-8 w-44"
            />
          </FieldRow>

          <FieldRow label="Author">
            <Input
              value={local.author}
              onChange={(e) => patch({ author: e.target.value })}
              className="h-8"
              placeholder="e.g. Aditya"
            />
          </FieldRow>

          <Separator className="my-2" />

          <FieldRow label="Content" align="top">
            <RichEditor
              value={local.content}
              onChange={(content) => patch({ content })}
            />
          </FieldRow>
        </div>
      </div>
    </div>
  );
}

function FieldRow({
  label,
  children,
  align = "center",
}: {
  label: string;
  children: React.ReactNode;
  align?: "center" | "top";
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[140px_1fr] gap-3",
        align === "center" ? "items-center" : "items-start pt-1",
      )}
    >
      <Label className="text-sm text-muted-foreground font-normal">{label}</Label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const debouncers = new Map<number, ReturnType<typeof setTimeout>>();
const pending = new Map<number, PostPatch>();

function schedule(
  id: number,
  patch: PostPatch,
  onSaved: (p: Post) => void,
  onError: () => void,
) {
  pending.set(id, { ...(pending.get(id) ?? {}), ...patch });
  const existing = debouncers.get(id);
  if (existing) clearTimeout(existing);
  debouncers.set(
    id,
    setTimeout(async () => {
      const body = pending.get(id);
      pending.delete(id);
      debouncers.delete(id);
      if (!body) return;
      try {
        const saved = await api.updatePost(id, body);
        onSaved(saved);
      } catch {
        onError();
      }
    }, 350),
  );
}
