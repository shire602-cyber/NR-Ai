import * as React from "react";
import { useFormContext, type FieldErrors, type FieldValues } from "react-hook-form";
import { AlertCircle, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { localizeMessage } from "@/lib/validation-messages";
import { focusField, type SummaryItem } from "@/hooks/use-form-gate";

/**
 * D5b form layout (CTO form spec, CTO-CHECKPOINT-D2 "Forms"):
 *  - FormSection: one group of fields with a text-h3 title and text-small description.
 *    In a dialog, sections are separated by hairlines (a bordered card inside the dialog
 *    panel would nest borders); on a page wrap the group in SectionCard instead.
 *  - FormGrid: two columns from 640px, 24px column gap, 16px row gap.
 *  - FormErrorSummary / ErrorSummary: on submit, list what needs fixing at the top and
 *    move focus to the first invalid field.
 *  - FormActions: footer row; `sticky` keeps Save reachable on long forms.
 */

export interface FormSectionProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Header-end slot (e.g. "Add line"). */
  actions?: React.ReactNode;
  testId?: string;
  /** Heading level; h2 when no h2 precedes the section on the page (heading-order). */
  headingLevel?: 2 | 3;
}

export function FormSection({
  title,
  description,
  actions,
  testId,
  headingLevel = 3,
  className,
  children,
  ...props
}: FormSectionProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const headingId = React.useId();
  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      data-testid={testId}
      data-form-section=""
      className={cn(
        "min-w-0 space-y-stack border-t border-border pt-5 first-of-type:border-t-0 first-of-type:pt-0",
        className
      )}
      {...props}
    >
      {(title || description || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {title && (
              <Heading id={headingId} className="text-h3 font-semibold text-foreground">
                {title}
              </Heading>
            )}
            {description && <p className="mt-1 text-small text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export interface FormGridProps extends React.HTMLAttributes<HTMLDivElement> {
  cols?: 1 | 2 | 3;
}

/** Spans a FormGrid child across every column. */
export const formSpanFull = "sm:col-span-full";

export function FormGrid({ cols = 2, className, ...props }: FormGridProps) {
  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-1 gap-x-6 gap-y-4",
        cols === 2 && "sm:grid-cols-2",
        cols === 3 && "sm:grid-cols-2 lg:grid-cols-3",
        className
      )}
      {...props}
    />
  );
}

export interface FormActionsProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Stick to the bottom of the dialog / page scroll area (long forms). */
  sticky?: boolean;
  /** `dialog` (default) bleeds to a sized dialog's edges; `page` sticks to the viewport. */
  variant?: "dialog" | "page";
}

export function FormActions({
  sticky = false,
  variant = "dialog",
  className,
  ...props
}: FormActionsProps) {
  return (
    <div
      data-form-actions=""
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end",
        sticky &&
          variant === "dialog" &&
          "sticky -bottom-5 z-10 -mx-4 -mb-5 sm:-bottom-6 mt-2 max-sm:!mt-auto border-t border-border bg-card px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:-mx-6 sm:-mb-6 sm:px-6 sm:pb-4",
        sticky &&
          variant === "page" &&
          "sticky bottom-0 z-20 -mx-4 border-t border-border bg-background px-4 py-3 md:-mx-6 md:px-6",
        className
      )}
      {...props}
    />
  );
}

export type { SummaryItem };

/** Plain error summary for forms that keep their own state (no react-hook-form). */
export function ErrorSummary({
  items,
  className,
  testId = "form-error-summary",
}: {
  items: SummaryItem[];
  className?: string;
  testId?: string;
}) {
  const { t } = useTranslation();
  if (!items.length) return null;
  return (
    <div
      role="alert"
      data-testid={testId}
      className={cn(
        "rounded-lg border border-danger/30 bg-danger-subtle px-4 py-3 text-small text-danger-subtle-foreground",
        className
      )}
    >
      <p className="flex items-center gap-2 font-medium">
        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
        {items.length === 1
          ? t["forms.errorSummaryOne"]
          : formatMessage(t["forms.errorSummaryMany"], { count: items.length })}
      </p>
      <ul className="mt-1.5 list-disc space-y-0.5 ps-9">
        {items.map((item, i) => (
          <li key={item.id ?? i}>
            {item.id ? (
              <button
                type="button"
                className="text-start underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
                onClick={() => focusField(item.id!)}
              >
                {item.label ? (
                  <>
                    <span className="font-medium">{item.label}</span>
                    {item.message ? <>: {item.message}</> : null}
                  </>
                ) : (
                  item.message
                )}
              </button>
            ) : (
              item.message
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function flattenErrors(errors: FieldErrors<FieldValues>, prefix = ""): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(errors ?? {})) {
    if (!value) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const v = value as { message?: unknown; type?: unknown };
    if (typeof v.message === "string" && v.message) out.push([path, localizeMessage(v.message)]);
    else if (typeof value === "object") {
      if (v.message === undefined && v.type === undefined) {
        out.push(...flattenErrors(value as FieldErrors<FieldValues>, path));
      } else if (typeof v.type === "string") {
        out.push([path, ""]);
      }
    }
  }
  return out;
}

/** Prefer a registered input name, then the marker used by custom controls. */
function fieldElement(scope: Element | null, name: string): HTMLElement | null {
  if (!scope) return null;
  const fields = Array.from(scope.querySelectorAll<HTMLElement>("[name], [data-field]"));
  return (
    fields.find((element) => element.getAttribute("name") === name) ??
    fields.find((element) => element.getAttribute("data-field") === name) ??
    null
  );
}

function labelFor(el: HTMLElement | null): string | undefined {
  if (!el) return undefined;
  const id = el.getAttribute("id");
  const label = id
    ? Array.from(document.querySelectorAll<HTMLLabelElement>("label[for]")).find(
        (candidate) => candidate.htmlFor === id
      )
    : null;
  const text = (label?.textContent ?? el.getAttribute("aria-label") ?? "").replace(
    /\*\s*\(.*\)$/,
    ""
  );
  return text.replace(/\s*\*$/, "").trim() || undefined;
}

/**
 * Error summary for react-hook-form forms. Renders nothing until the first submit;
 * after a failed submit it lists every invalid field (click to focus) and moves focus
 * to the first invalid control when react-hook-form could not (custom controls).
 */
export function FormErrorSummary({ className }: { className?: string }) {
  const ctx = useFormContext();
  const ref = React.useRef<HTMLDivElement>(null);
  const { errors, submitCount } = ctx.formState;
  const entries = flattenErrors(errors);
  const signature = entries.map((e) => e.join("\u0000")).join("\u0001");
  const [items, setItems] = React.useState<SummaryItem[]>([]);

  React.useEffect(() => {
    const form = ref.current?.closest("form") ?? null;
    const next = signature
      ? signature.split("\u0001").map((row) => {
          const [name, message] = row.split("\u0000");
          const el = fieldElement(form, name);
          return { id: el?.id || undefined, label: labelFor(el), message };
        })
      : [];
    setItems(next);
  }, [signature, submitCount]);

  React.useEffect(() => {
    if (!submitCount || !signature) return;
    const form = ref.current?.closest("form");
    if (!form) return;
    const active = document.activeElement;
    if (active && form.contains(active) && active.getAttribute("aria-invalid") === "true") return;
    form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per submit attempt
  }, [submitCount]);

  return (
    <div ref={ref} className={cn(!submitCount || !items.length ? "hidden" : "", className)}>
      {submitCount > 0 && <ErrorSummary items={items} />}
    </div>
  );
}

/** Line-item editor list: hairline-separated rows on a sunken inset (no nested borders). */
export function LineItemList({ className, ...props }: React.HTMLAttributes<HTMLOListElement>) {
  return (
    <ol
      className={cn("divide-y divide-border rounded-xl bg-surface-sunken/60 px-4", className)}
      {...props}
    />
  );
}

export interface LineItemProps {
  index: number;
  /** Primary input (description / account) shown on the first row. */
  main: React.ReactNode;
  /** Figures row (qty, price, VAT, amount …) under the main input. */
  children?: React.ReactNode;
  /** Grid template for the figures row from 640px (default: 4 equal columns). */
  gridClassName?: string;
  onRemove?: () => void;
  canRemove?: boolean;
  removeTestId?: string;
  className?: string;
}

export function LineItem({
  index,
  main,
  children,
  gridClassName,
  onRemove,
  canRemove = true,
  removeTestId,
  className,
}: LineItemProps) {
  const { t } = useTranslation();
  return (
    <li className={cn("space-y-4 py-4", className)}>
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className="mt-2 w-5 shrink-0 text-caption tabular-nums text-muted-foreground"
        >
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">{main}</div>
        {onRemove && (
          <button
            type="button"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
            disabled={!canRemove}
            aria-label={formatMessage(t["forms.removeLine"], { n: index + 1 })}
            onClick={onRemove}
            data-testid={canRemove ? removeTestId : undefined}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
      {children && (
        <div
          className={cn(
            "mobile-keep-cols grid grid-cols-2 gap-3 ps-7",
            gridClassName ?? "sm:grid-cols-4",
            onRemove && "sm:pe-11"
          )}
        >
          {children}
        </div>
      )}
    </li>
  );
}

/** Read-only amount cell in a LineItem figures row (label above, figure end-aligned). */
export function LineAmount({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      <span className="text-caption font-medium text-muted-foreground">{label}</span>
      <span className="flex h-9 items-center text-sm font-medium">{children}</span>
    </div>
  );
}

/** Totals block for forms without a document preview (Money figures, total emphasised). */
export function FormTotals({
  rows,
  total,
  className,
}: {
  rows: Array<{ label: React.ReactNode; value: React.ReactNode }>;
  total: { label: React.ReactNode; value: React.ReactNode };
  className?: string;
}) {
  return (
    <dl className={cn("ms-auto w-full max-w-xs space-y-1.5 text-sm", className)}>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">{r.label}</dt>
          <dd>{r.value}</dd>
        </div>
      ))}
      <div className="flex items-center justify-between gap-4 border-t border-border-strong pt-2 text-h4 font-semibold">
        <dt>{total.label}</dt>
        <dd data-testid="form-total">{total.value}</dd>
      </div>
    </dl>
  );
}

export interface FieldProps {
  /** id given to the control (cloned onto the single child element). */
  id: string;
  label: React.ReactNode;
  required?: boolean;
  help?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  labelClassName?: string;
  children: React.ReactElement<Record<string, unknown>>;
}

/**
 * Field — label + control + help + inline error for forms that keep their own state
 * (the react-hook-form equivalent is FormItem/FormLabel/FormDescription/FormMessage).
 * Wires id, aria-invalid and aria-describedby onto the control.
 */
export function Field({
  id,
  label,
  required,
  help,
  error,
  className,
  labelClassName,
  children,
}: FieldProps) {
  const { t } = useTranslation();
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <label
        htmlFor={id}
        className={cn(
          "block text-small font-medium leading-5 text-foreground",
          error ? "text-danger" : "",
          labelClassName
        )}
      >
        {label}
        {required && (
          <>
            <span aria-hidden="true" className="ms-0.5 text-danger">
              *
            </span>
            <span className="sr-only">{` (${t["forms.required"]})`}</span>
          </>
        )}
      </label>
      {React.cloneElement(children, {
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
        "aria-required": required || undefined,
      })}
      {help && (
        <p id={helpId} className="text-caption text-muted-foreground">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-caption font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Caption-sized label used for fields inside a LineItem figures row. */
export const lineLabelClass = "text-caption text-muted-foreground";
