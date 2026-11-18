import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import type { Permission } from "@/lib/auth";

export interface EmptyStateAction {
  label: string;
  onClick?: () => void;
  href?: string;
  icon?: LucideIcon;
  variant?: React.ComponentProps<typeof Button>["variant"];
  testId?: string;
  /**
   * E3 (J4-r3): the company permission the action needs (a write). Without it the button is
   * disabled with the role explanation, like every other gated write control.
   */
  permission?: Permission;
}

export type EmptyStateSize = "sm" | "md" | "lg";

export interface EmptyStateProps {
  /**
   * Spec 2.6 — the only three empty-state sizes:
   * - `sm` inside a card or tab of a fuller page: one muted sentence (`title`) + one text link.
   * - `md` (default) a list page with no rows: icon tile, title, one sentence, primary + ghost.
   * - `lg` first run of a whole area: ledger-ruling backdrop, `text-h2` title, two sentences,
   *   primary + secondary, and a ghost preview of the real table underneath.
   */
  size?: EmptyStateSize;
  icon?: LucideIcon;
  /** md/lg: the heading. sm: the whole sentence. */
  title: string;
  /** md: one sentence ≤ 60 characters. lg: two sentences. sm: appended to the sentence. */
  description?: React.ReactNode;
  action?: EmptyStateAction;
  /** md: rendered as a ghost link ("Import from Excel"); lg: outline button. Ignored for sm. */
  secondaryAction?: EmptyStateAction;
  /** lg only: custom ghost preview. Defaults to three skeleton rows of `previewColumns`. */
  preview?: React.ReactNode;
  /** lg only: columns in the default ghost preview (default 4). `0` hides the preview. */
  previewColumns?: number;
  className?: string;
  /** @deprecated use `size="sm"` or `size="md"`; kept so existing screens compile. */
  compact?: boolean;
  testId?: string;
}

/**
 * EmptyState — one component, three sizes (spec 2.6). Copy never claims something untrue at
 * zero; an empty page shows no KPI tiles and no empty charts. Do not render a table header
 * above an `md` empty state.
 */
export function EmptyState({
  size,
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  preview,
  previewColumns = 4,
  className,
  compact = false,
  testId,
}: EmptyStateProps) {
  const resolved: EmptyStateSize = size ?? "md";

  if (resolved === "sm") {
    return (
      <div
        data-testid={testId ?? "empty-state"}
        data-size="sm"
        className={cn("py-2 text-start text-small text-muted-foreground", className)}
      >
        <p>
          {title}
          {description ? <> {description}</> : null}
        </p>
        {action ? (
          <EmptyStateButton
            {...action}
            variant="link"
            className="mt-1 h-auto min-h-0 p-0 text-small [@media(pointer:coarse)]:min-h-0"
          />
        ) : null}
      </div>
    );
  }

  if (resolved === "lg") {
    return (
      <div
        data-testid={testId ?? "empty-state"}
        data-size="lg"
        className={cn(
          "relative isolate overflow-hidden rounded-xl border border-border bg-card px-6 pb-8 pt-12 text-center sm:px-10 sm:pt-16",
          className
        )}
      >
        <div className="bg-ledger-ruling pointer-events-none absolute inset-0 -z-10" aria-hidden />
        {Icon && <EmptyIconTile icon={Icon} />}
        <h2 className="mx-auto max-w-xl text-h2 text-foreground">{title}</h2>
        {description && (
          <p className="mx-auto mt-2 max-w-xl text-body text-muted-foreground text-pretty">
            {description}
          </p>
        )}
        {(action || secondaryAction) && (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {action && <EmptyStateButton {...action} />}
            {secondaryAction && (
              <EmptyStateButton
                {...secondaryAction}
                variant={secondaryAction.variant ?? "outline"}
              />
            )}
          </div>
        )}
        {preview !== undefined
          ? preview && (
              <div className="mt-10 opacity-40" aria-hidden>
                {preview}
              </div>
            )
          : previewColumns > 0 && <GhostRows columns={previewColumns} />}
      </div>
    );
  }

  return (
    <div
      data-testid={testId ?? "empty-state"}
      data-size="md"
      className={cn(
        "flex flex-col items-center justify-center px-6 text-center",
        compact ? "py-8" : "py-12",
        className
      )}
    >
      {Icon && <EmptyIconTile icon={Icon} />}
      <h3 className="text-h3 text-foreground">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-small text-muted-foreground text-pretty">{description}</p>
      )}
      {(action || secondaryAction) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {action && <EmptyStateButton {...action} />}
          {secondaryAction && (
            <EmptyStateButton {...secondaryAction} variant={secondaryAction.variant ?? "ghost"} />
          )}
        </div>
      )}
    </div>
  );
}

function EmptyIconTile({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div
      className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
      aria-hidden="true"
    >
      <Icon className="h-5 w-5" strokeWidth={1.5} />
    </div>
  );
}

/** Three skeleton rows of the real table at 40% opacity: what the page becomes. */
function GhostRows({ columns }: { columns: number }) {
  return (
    <div
      className="mx-auto mt-10 max-w-3xl overflow-hidden rounded-lg border border-border bg-card text-start opacity-40"
      aria-hidden
      data-testid="empty-state-preview"
    >
      <div className="flex h-9 items-center gap-4 border-b border-border bg-surface-sunken px-4">
        {Array.from({ length: columns }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-2 rounded-full bg-neutral-300 dark:bg-neutral-700",
              i === 0 ? "w-24" : "w-14",
              i === columns - 1 && "ms-auto"
            )}
          />
        ))}
      </div>
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="flex h-11 items-center gap-4 border-b border-border px-4 last:border-b-0"
        >
          {Array.from({ length: columns }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-2 rounded-full bg-neutral-200 dark:bg-neutral-800",
                i === 0 ? (row === 1 ? "w-32" : "w-40") : "w-16",
                i === columns - 1 && "ms-auto"
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** E3 (J4-r3): the empty-state call to action, disabled with the reason for a role without it. */
function GatedEmptyStateButton(props: EmptyStateAction & { className?: string }) {
  const { gate } = useCompanyPermission();
  const denied = gate(props.permission!);
  if (!("disabled" in denied)) return <EmptyStateButton {...props} permission={undefined} />;
  return (
    <Button
      variant={props.variant ?? "default"}
      data-testid={props.testId}
      className={props.className}
      {...denied}
    >
      {props.icon && <props.icon className="w-4 h-4" />}
      {props.label}
    </Button>
  );
}

function EmptyStateButton({
  label,
  onClick,
  href,
  icon: Icon,
  variant = "default",
  testId,
  className,
  permission,
}: EmptyStateAction & { className?: string }) {
  if (permission) {
    return (
      <GatedEmptyStateButton
        {...{ label, onClick, href, icon: Icon, variant, testId, className, permission }}
      />
    );
  }
  const content = (
    <>
      {Icon && <Icon className="w-4 h-4" />}
      {label}
    </>
  );
  if (href) {
    return (
      <Button asChild variant={variant} data-testid={testId} className={className}>
        {/^(https?:|mailto:|tel:)/.test(href) ? (
          <a href={href}>{content}</a>
        ) : (
          <Link href={href}>{content}</Link>
        )}
      </Button>
    );
  }
  return (
    <Button onClick={onClick} variant={variant} data-testid={testId} className={className}>
      {content}
    </Button>
  );
}
