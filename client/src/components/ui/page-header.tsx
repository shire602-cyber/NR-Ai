import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  /** Short uppercase context label rendered above the title, e.g. "Sales" */
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned action buttons */
  actions?: ReactNode;
  className?: string;
  testId?: string;
}

/**
 * Editorial page header — emerald eyebrow, Instrument Serif display title,
 * muted description, and a right-aligned actions slot. Use at the top of
 * every workspace page so the app reads as one product.
 */
export function PageHeader({ eyebrow, title, description, actions, className, testId }: PageHeaderProps) {
  return (
    <header className={cn('flex items-end justify-between flex-wrap gap-4', className)}>
      <div className="flex-1 min-w-0">
        {eyebrow && (
          <div className="mb-2 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-accent">
            <span aria-hidden className="inline-block w-5 h-px bg-accent/60" />
            {eyebrow}
          </div>
        )}
        <h1
          className="font-display text-[28px] md:text-[34px] leading-[1.05] tracking-tight text-foreground"
          data-testid={testId ?? 'text-page-title'}
        >
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 text-[13.5px] text-muted-foreground leading-relaxed max-w-2xl">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </header>
  );
}
