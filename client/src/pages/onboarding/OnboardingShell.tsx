import type { FormEvent, ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatMessage, useTranslation } from "@/lib/i18n";

/*
 * One shell for customer and firm onboarding (spec 3.3 / 3.4): logo at the start, "Step n of 3"
 * at the end, a single 2 px progress line; a 520 px content column top-aligned at 96 px; one
 * primary button at the inline end and a ghost "Back" at the start (sticky above the safe area
 * on phones). No pills, dots, decorative cards or blur.
 */
export function OnboardingShell({
  step,
  total,
  children,
  actions,
}: {
  /** 1-based; omit for states outside the steps (e.g. "owner is still setting up"). */
  step?: number;
  total: number;
  children: ReactNode;
  /** <StepActions/>: rendered outside the animated column so the phone bar can be fixed. */
  actions?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-14 w-full max-w-[70rem] items-center justify-between gap-4 px-4 md:px-8">
          <span className="flex items-center gap-2.5" translate="no">
            <BrandMark size="sm" />
            <span className="text-[0.9375rem] font-semibold text-foreground" lang="en" dir="ltr">
              {"Muhasib"}
              <span className="text-accent">{".ai"}</span>
            </span>
          </span>
          {step ? (
            <p className="text-small text-muted-foreground" data-testid="onboarding-step-count">
              {formatMessage(t["onboarding.v3StepOf"], { n: step, total })}
            </p>
          ) : null}
        </div>
        <div className="h-0.5 w-full bg-border" aria-hidden="true">
          <div
            className="h-full bg-primary transition-[width] duration-base ease-out"
            style={{ width: `${step ? (step / total) * 100 : 0}%` }}
          />
        </div>
      </header>
      <main className="flex-1 px-4 pb-32 pt-10 md:px-8 md:pb-16 md:pt-24">
        <div key={step} className="page-enter mx-auto w-full max-w-[32.5rem]">
          {children}
        </div>
        {actions}
      </main>
    </div>
  );
}

/** Title (text-h1) and one intro line (text-lead). */
export function StepHeading({ title, lead }: { title: ReactNode; lead?: ReactNode }) {
  return (
    <header className="mb-8">
      <h1 className="text-h1 text-balance text-foreground">{title}</h1>
      {lead ? <p className="mt-2 text-lead text-muted-foreground text-pretty">{lead}</p> : null}
    </header>
  );
}

/** The step's form id: the primary button (in StepActions) submits it with `form=`. */
export const STEP_FORM_ID = "onboarding-step-form";

/** A step is a form: Enter submits, the primary button is the submit. */
export function StepForm({
  onSubmit,
  children,
  className,
}: {
  onSubmit: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <form
      id={STEP_FORM_ID}
      noValidate
      className={cn("space-y-6", className)}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
    </form>
  );
}

/** Back (ghost, start) · optional secondary · primary (end). Sticky on phones. */
export function StepActions({
  onBack,
  secondary,
  primary,
}: {
  onBack?: () => void;
  secondary?: ReactNode;
  primary?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background px-4 pt-3",
        "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        "md:static md:z-auto md:mt-10 md:border-0 md:bg-transparent md:p-0"
      )}
    >
      <div className="mx-auto flex w-full max-w-[32.5rem] items-center gap-3">
        {onBack ? (
          <Button type="button" variant="ghost" onClick={onBack} data-testid="onboarding-back">
            <ArrowLeft aria-hidden="true" className="h-4 w-4 rtl:rotate-180" />
            {t["onboarding.v3Back"]}
          </Button>
        ) : null}
        <div className="ms-auto flex items-center gap-3">
          {secondary}
          {primary}
        </div>
      </div>
    </div>
  );
}

/** Label, control and the one line that says why the field is asked. */
export function Field({
  label,
  htmlFor,
  help,
  error,
  children,
  optional,
}: {
  label: ReactNode;
  htmlFor?: string;
  help?: ReactNode;
  error?: string | null;
  children: ReactNode;
  optional?: boolean;
}) {
  const { t } = useTranslation();
  const helpId = htmlFor ? `${htmlFor}-help` : undefined;
  return (
    <div className="space-y-2">
      <label htmlFor={htmlFor} className="block text-small font-medium text-foreground">
        {label}
        {optional ? (
          <span className="ms-1 font-normal text-muted-foreground">
            {t["onboarding.v3Optional"]}
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p id={helpId} role="alert" className="text-small text-danger">
          {error}
        </p>
      ) : help ? (
        <p id={helpId} className="text-small text-muted-foreground">
          {help}
        </p>
      ) : null}
    </div>
  );
}
