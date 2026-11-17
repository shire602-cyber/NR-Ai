import * as React from "react";
import { Info, type LucideIcon } from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface SetupNoticeAction {
  label: string;
  href?: string;
  onClick?: () => void;
  testId?: string;
}

export interface SetupNoticeProps {
  /** Optional short lead, e.g. "Not available yet". */
  title?: React.ReactNode;
  /** One customer-language sentence. Never an env var, vendor, "this server" or a model id. */
  children: React.ReactNode;
  action?: SetupNoticeAction;
  /** Defaults to Info. */
  icon?: LucideIcon;
  className?: string;
  testId?: string;
}

/**
 * SetupNotice (spec 2.6) — replaces every operator message ("set RESEND_API_KEY", "this
 * server", "SMTP is not configured"). Neutral tone, Info icon, one customer sentence and an
 * optional action. Where a feature is not available yet, say so and what to do instead.
 *
 *   <SetupNotice title={t["x.notAvailableYet"]} action={{ label: t["x.exportInstead"], href: "/reports" }}>
 *     {t["x.feedsNotAvailable"]}
 *   </SetupNotice>
 */
export function SetupNotice({
  title,
  children,
  action,
  icon: Icon = Info,
  className,
  testId,
}: SetupNoticeProps) {
  return (
    <div
      role="status"
      data-testid={testId ?? "setup-notice"}
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-surface-sunken px-4 py-3 text-small text-foreground sm:flex-row sm:items-center",
        className
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Icon
          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
          strokeWidth={2}
          aria-hidden
        />
        <div className="min-w-0 leading-5">
          {title ? <span className="font-semibold">{title} </span> : null}
          <span className={title ? "text-muted-foreground" : undefined}>{children}</span>
        </div>
      </div>
      {action ? (
        <div className="shrink-0 ps-7 sm:ps-0">
          {action.href ? (
            <Button asChild size="sm" variant="outline" data-testid={action.testId}>
              <Link href={action.href}>{action.label}</Link>
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={action.onClick}
              data-testid={action.testId}
            >
              {action.label}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
