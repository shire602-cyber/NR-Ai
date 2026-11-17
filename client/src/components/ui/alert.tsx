import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Alert — the one semantic surface (spec 2.3). Four tones (+ neutral): background
 * `*-subtle`, 1 px border in the tone at 25%, icon in the tone, text `--foreground`.
 *
 *   <Alert tone="warning" title="VAT period is locked">One sentence of context.</Alert>
 *
 * With `tone` the tone icon is drawn for you (pass `icon={Other}` to swap it or
 * `icon={false}` to hide it) — do not also pass an <svg> child. Without `tone` the legacy
 * shadcn API (`variant`, child svg, `AlertTitle` / `AlertDescription`) still works.
 */
const alertVariants = cva(
  "relative w-full rounded-lg border p-4 [&>svg~*]:ps-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:start-4 [&>svg]:top-4 [&>svg]:text-foreground",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        destructive:
          "border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export type AlertTone = "info" | "success" | "warning" | "danger" | "neutral";

const TONE_CLASS: Record<AlertTone, string> = {
  info: "bg-info-subtle border-[hsl(var(--info)/0.25)] [&_[data-alert-icon]]:text-info",
  success: "bg-success-subtle border-[hsl(var(--success)/0.25)] [&_[data-alert-icon]]:text-success",
  warning: "bg-warning-subtle border-[hsl(var(--warning)/0.25)] [&_[data-alert-icon]]:text-warning",
  danger: "bg-danger-subtle border-[hsl(var(--danger)/0.25)] [&_[data-alert-icon]]:text-danger",
  neutral: "bg-surface-sunken border-border [&_[data-alert-icon]]:text-muted-foreground",
};

const TONE_ICON: Record<AlertTone, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: OctagonAlert,
  neutral: Info,
};

export interface AlertProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title">, VariantProps<typeof alertVariants> {
  /** Semantic tone (spec 2.3). Preferred over `variant`. */
  tone?: AlertTone;
  /** Bold first line (tone alerts only). */
  title?: React.ReactNode;
  /** Replace or hide (`false`) the tone icon. */
  icon?: LucideIcon | false;
  /** Optional action rendered at the inline end (a Button size="sm" or a link). */
  action?: React.ReactNode;
}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, tone, title, icon, action, children, role, ...props }, ref) => {
    if (!tone) {
      return (
        <div
          ref={ref}
          role={role ?? "alert"}
          className={cn(alertVariants({ variant }), className)}
          {...props}
        >
          {title ? <AlertTitle>{title}</AlertTitle> : null}
          {children}
        </div>
      );
    }
    const Icon = icon === false ? null : (icon ?? TONE_ICON[tone]);
    return (
      <div
        ref={ref}
        // Info/neutral notes are not interruptions; only warning/danger announce.
        role={role ?? (tone === "warning" || tone === "danger" ? "alert" : "status")}
        data-tone={tone}
        className={cn(
          "flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-small text-foreground",
          TONE_CLASS[tone],
          className
        )}
        {...props}
      >
        {Icon ? (
          <Icon data-alert-icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
        ) : null}
        <div className="min-w-0 flex-1">
          {title ? <div className="font-semibold leading-5">{title}</div> : null}
          {children ? (
            <div className={cn("leading-5 [&_p]:leading-5", title && "mt-0.5")}>{children}</div>
          ) : null}
        </div>
        {action ? <div className="shrink-0 self-center">{action}</div> : null}
      </div>
    );
  }
);
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5
      ref={ref}
      className={cn("mb-1 font-medium leading-none tracking-tight", className)}
      {...props}
    />
  )
);
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("text-sm [&_p]:leading-relaxed", className)} {...props} />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription };
