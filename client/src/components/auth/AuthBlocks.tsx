import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

/*
 * Building blocks for the auth column (WP-B, spec 3.2): no card, the form sits on the page
 * background at 400 px; one title style; errors inline above the form (never a corner toast);
 * dedicated full states for a failed social sign-in and an invalid verification link.
 */

export function AuthHeader({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <header className="mb-8">
      <h1 className="text-h1 text-foreground text-balance">{title}</h1>
      {description ? (
        <p className="mt-2 text-small text-muted-foreground text-pretty">{description}</p>
      ) : null}
    </header>
  );
}

/** Inline message above the form: the shared tone Alert, spaced for the auth column. */
export function AuthAlert({
  tone,
  title,
  children,
  testId,
}: {
  tone: "danger" | "success" | "info";
  title?: ReactNode;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <Alert tone={tone} title={title} className="mb-6" data-testid={testId}>
      {children}
    </Alert>
  );
}

/** A whole-column state (callback failure, invalid link): icon tile, title, sentence, actions. */
export function AuthState({
  icon: Icon,
  tone = "neutral",
  title,
  body,
  actions,
  testId,
}: {
  icon: LucideIcon;
  tone?: "neutral" | "danger" | "success";
  title: ReactNode;
  body: ReactNode;
  actions?: ReactNode;
  testId?: string;
}) {
  return (
    <div data-testid={testId}>
      <span
        className={cn(
          "grid h-10 w-10 place-items-center rounded-lg",
          tone === "danger"
            ? "bg-danger-subtle text-danger"
            : tone === "success"
              ? "bg-success-subtle text-success"
              : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
        )}
      >
        <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
      </span>
      <h1 className="mt-5 text-h1 text-balance">{title}</h1>
      <p className="mt-2 text-small text-muted-foreground text-pretty">{body}</p>
      {actions ? <div className="mt-6 flex flex-wrap gap-3">{actions}</div> : null}
    </div>
  );
}

/** "Don't have an account? Create account" under the form. */
export function AuthSwitch({ children }: { children: ReactNode }) {
  return <p className="mt-8 text-small text-muted-foreground">{children}</p>;
}

/** Shared sizes: 44 px inputs and buttons in the auth column (spec 3.2). */
export const AUTH_INPUT = "h-11";
export const AUTH_BUTTON = "h-11 w-full";
