import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Link } from "wouter";

// ─── Empty state ─────────────────────────────────────────────────────────────

export function EmptyState({
  icon: Icon,
  title,
  body,
  actionLabel,
  actionHref,
}: {
  icon: any;
  title: string;
  body: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4">
      <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-muted/60 ring-1 ring-border text-muted-foreground mb-3">
        <Icon className="w-5 h-5" strokeWidth={1.75} />
      </div>
      <div className="text-[14px] font-medium text-foreground tracking-tight">{title}</div>
      <div className="text-[12.5px] text-muted-foreground mt-0.5 max-w-xs leading-relaxed">
        {body}
      </div>
      {actionLabel && actionHref && (
        <Link href={actionHref}>
          <Button variant="outline" size="sm" className="gap-1.5 mt-4">
            <Plus className="w-3.5 h-3.5" />
            {actionLabel}
          </Button>
        </Link>
      )}
    </div>
  );
}
