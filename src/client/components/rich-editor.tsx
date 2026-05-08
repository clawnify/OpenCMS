import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useRef } from "react";
import {
  Bold,
  Italic,
  Quote,
  Code,
  List,
  ListOrdered,
  Heading2,
  ImagePlus,
  Link as LinkIcon,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface RichEditorProps {
  value: string;
  onChange: (json: string) => void;
}

export function RichEditor({ value, onChange }: RichEditorProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Image.configure({ inline: false, HTMLAttributes: { class: "rounded-lg my-2" } }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: "Start writing…" }),
    ],
    content: parseContent(value),
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none focus:outline-none min-h-[120px] [&_p.is-editor-empty:first-child]:before:text-muted-foreground [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)] [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:pointer-events-none",
      },
    },
    onUpdate: ({ editor }) => {
      onChange(JSON.stringify(editor.getJSON()));
    },
  });

  useEffect(() => {
    if (!editor) return;
    const current = JSON.stringify(editor.getJSON());
    if (current !== value) {
      editor.commands.setContent(parseContent(value), { emitUpdate: false });
    }
  }, [value, editor]);

  if (!editor) return null;

  async function uploadAndInsert(file: File) {
    const { url } = await api.uploadImage(file);
    editor!.chain().focus().setImage({ src: url }).run();
  }

  return (
    <div>
      <div className="flex items-center gap-1 pb-2 -mt-1">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadAndInsert(f);
            e.target.value = "";
          }}
        />
        <ToolbarBtn onClick={() => fileRef.current?.click()} title="Insert image">
          <Plus className="size-3.5" />
        </ToolbarBtn>
        <ParagraphStyleBtn editor={editor} />
        <Separator orientation="vertical" className="h-5 mx-1" />
        <ToolbarBtn
          onClick={() => {
            const url = window.prompt("Link URL");
            if (url) editor.chain().focus().setLink({ href: url }).run();
          }}
          title="Link"
        >
          <LinkIcon className="size-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Bold"
        >
          <Bold className="size-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Italic"
        >
          <Italic className="size-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          title="Quote"
        >
          <Quote className="size-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          active={editor.isActive("codeBlock")}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          title="Code block"
        >
          <Code className="size-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title="Bullet list"
        >
          <List className="size-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title="Ordered list"
        >
          <ListOrdered className="size-3.5" />
        </ToolbarBtn>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

function ToolbarBtn({
  children,
  onClick,
  active,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  title?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      title={title}
      className={cn("h-7 w-7 p-0", active && "bg-accent text-accent-foreground")}
    >
      {children}
    </Button>
  );
}

function ParagraphStyleBtn({ editor }: { editor: NonNullable<ReturnType<typeof useEditor>> }) {
  const isH2 = editor.isActive("heading", { level: 2 });
  return (
    <ToolbarBtn
      active={isH2}
      onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      title="Heading 2"
    >
      {isH2 ? <Heading2 className="size-3.5" /> : <span className="text-xs font-medium">P</span>}
    </ToolbarBtn>
  );
}

function parseContent(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return { type: "doc", content: [] };
  }
}
