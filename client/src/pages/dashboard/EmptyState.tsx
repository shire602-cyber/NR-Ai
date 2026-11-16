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
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-xs">
        <Icon className="h-5 w-5" strokeWidth={1.5} aria-hidden />
      </div>
      <div className="text-sm font-semibold text-foreground">{title}</div>
      <div className="mt-0.5 max-w-xs text-small leading-relaxed text-muted-foreground">{body}</div>
      {actionLabel && actionHref && (
        <Button asChild variant="outline" size="sm" className="mt-4">
          <Link href={actionHref}>
            <Plus aria-hidden />
            {actionLabel}
          </Link>
        </Button>
      )}
    </div>
  );
}
