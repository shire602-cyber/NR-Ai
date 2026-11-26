import type { ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";

export interface ErrorStateProps {
  title?: string;
  description?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  /** A retry is in flight: the button spins and cannot be pressed again. */
  retrying?: boolean;
  /** The button cannot be pressed, without spinning (a retry is queued). */
  disabled?: boolean;
  compact?: boolean;
  className?: string;
  testId?: string;
}

/**
 * ErrorState — what a list, table or panel shows when its data failed to load.
 * Calm (no red wall), says what happened, offers Retry. Pair with EmptyState
 * and the skeletons in loading-skeletons.tsx for the four data states.
 */
export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel,
  retrying = false,
  disabled = false,
  compact = false,
  className,
  testId,
}: ErrorStateProps) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      data-testid={testId ?? "error-state"}
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "px-4 py-8" : "px-6 py-14",
        className
      )}
    >
      <div
        aria-hidden
        className={cn(
          "mb-4 flex items-center justify-center rounded-full bg-danger-subtle text-danger-subtle-foreground",
          compact ? "h-10 w-10" : "h-12 w-12"
        )}
      >
        <AlertTriangle className={compact ? "h-5 w-5" : "h-6 w-6"} strokeWidth={1.75} />
      </div>
      <h3 className={cn("font-semibold text-foreground", compact ? "text-sm" : "text-h3")}>
        {title ?? t["components.errorSectionCouldNotLoad"]}
      </h3>
      <p className={cn("mt-1 max-w-md leading-relaxed text-muted-foreground", "text-small")}>
        {description ?? t["components.errorStateDescription"]}
      </p>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          className="mt-5"
          onClick={onRetry}
          disabled={retrying || disabled}
          aria-busy={retrying || undefined}
        >
          <RotateCw className={retrying ? "animate-spin" : undefined} aria-hidden />
          {retryLabel ?? t["components.errorRetry"]}
        </Button>
      )}
    </div>
  );
}
