import { useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Segmented control in the shared Tabs-pill look (36 px). A radiogroup of buttons, so a plain
 * click selects (tests and assistive tech) and arrow keys move the selection, mirrored in RTL.
 * Used by /pricing (billing period, mobile plan picker) and onboarding (VAT questions).
 */
export function Segmented<V extends string>({
  value,
  options,
  onChange,
  label,
  testId,
  optionTestId,
  className,
  disabled,
}: {
  value: V | null;
  options: readonly { value: V; label: string }[];
  onChange: (v: V) => void;
  /** Accessible name; pass `labelledBy` instead when a visible label exists. */
  label?: string;
  testId?: string;
  optionTestId?: (v: V) => string;
  className?: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (dir: 1 | -1) => {
    const i = Math.max(
      0,
      options.findIndex((o) => o.value === value)
    );
    const next = options[(i + dir + options.length) % options.length];
    onChange(next.value);
    requestAnimationFrame(() =>
      ref.current?.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus()
    );
  };
  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={label}
      data-testid={testId}
      className={cn(
        "grid h-9 auto-cols-fr grid-flow-col gap-0.5 rounded-lg bg-muted p-[3px]",
        className
      )}
      onKeyDown={(e) => {
        const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
        if (e.key === "ArrowRight") move(rtl ? -1 : 1);
        else if (e.key === "ArrowLeft") move(rtl ? 1 : -1);
        else return;
        e.preventDefault();
      }}
    >
      {options.map((o, i) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active || (value === null && i === 0) ? 0 : -1}
            disabled={disabled}
            data-value={o.value}
            data-active={active}
            data-testid={optionTestId?.(o.value)}
            onClick={() => onChange(o.value)}
            className={cn(
              "truncate rounded-md px-2 text-small font-medium transition-colors duration-fast",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-card text-foreground shadow-xs ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
