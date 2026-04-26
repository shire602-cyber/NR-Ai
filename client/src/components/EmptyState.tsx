import { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: LucideIcon;
  illustration?: ReactNode;
  title: string;
  description?: string;
  primaryAction?: {
    label: string;
    onClick: () => void;
    icon?: LucideIcon;
    testId?: string;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
  variant?: 'default' | 'compact';
}

/**
 * Friendly empty state with optional illustration, copy, and CTAs. Use this
 * instead of bare "No data" text — it guides the user toward the next step.
 */
export function EmptyState({
  icon: Icon,
  illustration,
  title,
  description,
  primaryAction,
  secondaryAction,
  className,
  variant = 'default',
}: EmptyStateProps) {
  const PrimaryIcon = primaryAction?.icon;

  return (
    <div
      role="status"
      className={cn(
        'flex flex-col items-center justify-center text-center',
        variant === 'default' ? 'py-16 px-6' : 'py-10 px-4',
        className,
      )}
    >
      {illustration ? (
        <div className="mb-5">{illustration}</div>
      ) : Icon ? (
        <div
          className={cn(
            'mb-5 rounded-full bg-muted/60 flex items-center justify-center',
            variant === 'default' ? 'w-16 h-16' : 'w-12 h-12',
          )}
          aria-hidden="true"
        >
          <Icon
            className={cn('text-muted-foreground', variant === 'default' ? 'w-8 h-8' : 'w-6 h-6')}
          />
        </div>
      ) : null}
      <h3
        className={cn(
          'font-semibold text-foreground',
          variant === 'default' ? 'text-lg mb-2' : 'text-base mb-1',
        )}
      >
        {title}
      </h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-md mb-6">{description}</p>
      )}
      {(primaryAction || secondaryAction) && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {primaryAction && (
            <Button
              onClick={primaryAction.onClick}
              data-testid={primaryAction.testId}
              size={variant === 'default' ? 'default' : 'sm'}
            >
              {PrimaryIcon && <PrimaryIcon className="w-4 h-4 mr-2" />}
              {primaryAction.label}
            </Button>
          )}
          {secondaryAction && (
            <Button
              variant="ghost"
              onClick={secondaryAction.onClick}
              size={variant === 'default' ? 'default' : 'sm'}
            >
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
