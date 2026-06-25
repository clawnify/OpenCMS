import { useState } from "react";
import { Check, Copy } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Documents the public read-only JSON API for a library. The list/read routes
 * under /api/entries/** are exposed publicly (see clawnify.json public_routes),
 * so anyone can consume the content as a headless CMS without auth.
 */
export function ApiDialog({
  open,
  onOpenChange,
  pluralName,
  displayName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pluralName: string;
  displayName: string;
}) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const listUrl = `${origin}/api/entries/${pluralName}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg overflow-hidden p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle>Public API · {displayName}</DialogTitle>
          <DialogDescription>
            Read-only JSON, no auth required. Use it as a headless CMS — fetch your
            content from any site, app, or agent.
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 pb-4 space-y-4">
          <Zone label="Endpoints">
            <EndpointRow method="GET" path={`/api/entries/${pluralName}`} desc="List all entries" />
            <EndpointRow method="GET" path={`/api/entries/${pluralName}/:id`} desc="Get one entry" />
            <EndpointRow method="GET" path="/api/openapi.json" desc="OpenAPI schema" />
          </Zone>

          <Zone label="Example">
            <CodeBlock text={`curl ${listUrl}`} />
          </Zone>

          <Zone label="In JavaScript">
            <CodeBlock
              text={`const res = await fetch("${listUrl}");\nconst ${pluralName} = await res.json();`}
            />
          </Zone>

          <p className="text-xs text-muted-foreground">
            Only <code className="font-mono">GET</code> under{" "}
            <code className="font-mono">/api/entries</code> is public. Creating, updating,
            and deleting entries require an authenticated session.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Zone({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

function EndpointRow({ method, path, desc }: { method: string; path: string; desc: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="inline-flex w-11 shrink-0 justify-center rounded-sm bg-success-tint px-1.5 py-0.5 text-[11px] font-semibold text-success">
        {method}
      </span>
      <code className="font-mono text-xs text-foreground">{path}</code>
      <span className="ml-auto text-xs text-muted-foreground">{desc}</span>
    </div>
  );
}

function CodeBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative rounded-md border border-border bg-muted/40">
      <pre className="overflow-x-auto px-3 py-2.5 text-xs font-mono whitespace-pre-wrap break-all">
        {text}
      </pre>
      <button
        onClick={() => {
          navigator.clipboard?.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        title="Copy"
        className={cn(
          "absolute right-1.5 top-1.5 inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground",
          "opacity-0 group-hover:opacity-100 focus:opacity-100",
        )}
      >
        {copied ? <Check className="size-3.5 text-success" strokeWidth={2.5} /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}
