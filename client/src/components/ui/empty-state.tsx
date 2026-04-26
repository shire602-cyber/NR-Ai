import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface EmptyStateAction {
  label: string;
  onClick?: () => void;
  href?: string;
  icon?: LucideIcon;
  variant?: React.ComponentProps<typeof Button>['variant'];
  testId?: string;
}

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  className?: string;
  /** Render a more compact version, e.g. inside a table cell */
  compact?: boolean;
  testId?: string;
}

/**
 * Standard empty state for lists, tables, and panels.
 * Pairs a soft icon with a title, optional description, and 0–2 CTAs.
 * Uses semantic tokens (muted-foreground, foreground) only — never hardcoded colors.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  compact = false,
  testId,
}: EmptyStateProps) {
  return (
    <div
      data-testid={testId ?? 'empty-state'}
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'py-8 px-4' : 'py-16 px-6',
        className,
      )}
    >
      {Icon && (
        <div
          className={cn(
            'rounded-full bg-muted/50 flex items-center justify-center mb-4',
            compact ? 'w-12 h-12' : 'w-16 h-16',
          )}
          aria-hidden="true"
        >
          <Icon
            className={cn(
              'text-muted-foreground/60',
              compact ? 'w-6 h-6' : 'w-8 h-8',
            )}
          />
        </div>
      )}
      <h3
        className={cn(
          'font-semibold text-foreground',
          compact ? 'text-base' : 'text-lg',
        )}
      >
        {title}
      </h3>
      {description && (
        <p
          className={cn(
            'text-muted-foreground mt-1 max-w-md',
            compact ? 'text-xs' : 'text-sm',
          )}
        >
          {description}
        </p>
      )}
      {(action || secondaryAction) && (
        <div className={cn('flex flex-wrap items-center justify-center gap-2', compact ? 'mt-4' : 'mt-6')}>
          {action && <EmptyStateButton {...action} />}
          {secondaryAction && <EmptyStateButton {...secondaryAction} variant={secondaryAction.variant ?? 'outline'} />}
        </div>
      )}
    </div>
  );
}

function EmptyStateButton({ label, onClick, href, icon: Icon, variant = 'default', testId }: EmptyStateAction) {
  const content = (
    <>
      {Icon && <Icon className="w-4 h-4 mr-2" />}
      {label}
    </>
  );
  if (href) {
    return (
      <Button asChild variant={variant} data-testid={testId}>
        <a href={href}>{content}</a>
      </Button>
    );
  }
  return (
    <Button onClick={onClick} variant={variant} data-testid={testId}>
      {content}
    </Button>
  );
}
