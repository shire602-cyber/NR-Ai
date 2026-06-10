import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type StatusTone =
  | 'neutral'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'accent';

const TONE_CLASSES: Record<StatusTone, string> = {
  /* Each tone uses semantic chart tokens already defined in :root and .dark.
   * Background is the token at low alpha; foreground is the token at full strength.
   * This keeps badges readable in both light and dark modes from a single source. */
  neutral:
    'border-transparent bg-muted text-muted-foreground hover:bg-muted/80',
  info: 'border-transparent bg-[hsl(var(--chart-1)/0.15)] text-[hsl(var(--chart-1))] hover:bg-[hsl(var(--chart-1)/0.20)]',
  success:
    'border-transparent bg-[hsl(var(--chart-5)/0.15)] text-[hsl(var(--chart-5))] hover:bg-[hsl(var(--chart-5)/0.20)]',
  warning:
    'border-transparent bg-[hsl(var(--chart-4)/0.18)] text-[hsl(var(--chart-4))] hover:bg-[hsl(var(--chart-4)/0.24)]',
  danger:
    'border-transparent bg-destructive/15 text-destructive hover:bg-destructive/20',
  accent:
    'border-transparent bg-[hsl(var(--chart-3)/0.15)] text-[hsl(var(--chart-3))] hover:bg-[hsl(var(--chart-3)/0.20)]',
};

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  tone: StatusTone;
  children: React.ReactNode;
}

/**
 * Themeable status badge. Replaces ad-hoc `bg-green-100 text-green-800` style usage
 * across the app so dark mode and brand changes flow through the design tokens.
 */
export function StatusBadge({ tone, className, children, ...rest }: StatusBadgeProps) {
  return (
    <Badge className={cn(TONE_CLASSES[tone], className)} {...rest}>
      {children}
    </Badge>
  );
}
