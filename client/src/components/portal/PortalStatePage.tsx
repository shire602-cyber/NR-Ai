import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A whole-page state of the customer portal (invalid, expired, removed, throttled ...): icon tile,
 * one h1, one sentence and one or two next actions. Used by the join page and the portal shell.
 */
export function PortalStatePage({
  icon: Icon,
  tone = "neutral",
  title,
  body,
  actions,
  testId,
}: {
  icon: LucideIcon;
  tone?: "neutral" | "danger" | "success" | "warning";
  title: ReactNode;
  body: ReactNode;
  actions?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="text-center" data-testid={testId} role="status">
      <span
        className={cn(
          "mx-auto grid h-12 w-12 place-items-center rounded-xl",
          tone === "danger" && "bg-danger-subtle text-danger",
          tone === "success" && "bg-success-subtle text-success",
          tone === "warning" && "bg-warning-subtle text-warning",
          tone === "neutral" && "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"
        )}
      >
        <Icon aria-hidden="true" className="h-6 w-6" strokeWidth={1.5} />
      </span>
      <h1 className="mt-5 text-center text-h2 text-foreground text-balance" tabIndex={-1}>
        {title}
      </h1>
      <p className="mx-auto mt-2 max-w-sm text-center text-small text-muted-foreground text-pretty">
        {body}
      </p>
      {actions ? (
        <div className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
