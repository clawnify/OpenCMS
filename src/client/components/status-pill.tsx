import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Generic colored pill — the primitive behind both the built-in `status`
 * field and the `badge` custom field. Pass either Tailwind classes
 * (`colorClassName`, for fixed palettes) or concrete `bg`/`text` CSS values
 * (for data-driven colors).
 */
export function Pill({
  label,
  colorClassName,
  bg,
  text,
  className,
  withChevron,
}: {
  label: string;
  colorClassName?: string;
  bg?: string;
  text?: string;
  className?: string;
  withChevron?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full pl-2 pr-1.5 py-0.5 text-xs font-medium",
        !withChevron && "pr-2",
        colorClassName,
        className,
      )}
      style={bg || text ? { backgroundColor: bg, color: text } : undefined}
    >
      {label}
      {withChevron && <ChevronDown className="size-3 opacity-60" />}
    </span>
  );
}

// ── Built-in Posts `status` field ─────────────────────────────────────

type PostStatus = "draft" | "live";

const STATUS_STYLES: Record<PostStatus, string> = {
  live: "bg-emerald-100 text-emerald-700",
  draft: "bg-zinc-100 text-zinc-600",
};

const STATUS_LABELS: Record<PostStatus, string> = {
  live: "Live",
  draft: "Draft",
};

export function StatusPill({
  status,
  className,
  withChevron,
}: {
  status: PostStatus;
  className?: string;
  withChevron?: boolean;
}) {
  return (
    <Pill
      label={STATUS_LABELS[status] ?? status}
      colorClassName={STATUS_STYLES[status] ?? STATUS_STYLES.draft}
      className={className}
      withChevron={withChevron}
    />
  );
}
