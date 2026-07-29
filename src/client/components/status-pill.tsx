import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
type PostStatus = "draft" | "live";

const STYLES: Record<PostStatus, string> = {
  live: "bg-emerald-100 text-emerald-700",
  draft: "bg-zinc-100 text-zinc-600",
};

const LABELS: Record<PostStatus, string> = {
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
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full pl-2 pr-1.5 py-0.5 text-xs font-medium",
        !withChevron && "pr-2",
        STYLES[status],
        className,
      )}
    >
      {LABELS[status]}
      {withChevron && <ChevronDown className="size-3 opacity-60" />}
    </span>
  );
}
