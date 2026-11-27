import type { ReactNode } from "react";

export function ActivityFeedRow({
  testId,
  icon,
  sentence,
  children,
  trailing,
}: {
  testId: string;
  icon: ReactNode;
  sentence: string;
  children: ReactNode;
  trailing: ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 px-4 py-3 sm:px-5" data-testid={testId}>
      <span
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface-sunken text-muted-foreground"
        aria-hidden
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-body text-foreground">{sentence}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground">
          {children}
        </p>
      </div>
      {trailing}
    </li>
  );
}

export function ActivityFeedMetaItem({
  children,
  translate,
  truncate,
}: {
  children: string;
  translate?: "no";
  truncate?: boolean;
}) {
  return (
    <span
      className={
        truncate
          ? "inline-flex min-w-0 items-baseline gap-x-2"
          : "inline-flex items-baseline gap-x-2"
      }
    >
      <span aria-hidden>·</span>
      <span className={truncate ? "truncate" : undefined} translate={translate}>
        {children}
      </span>
    </span>
  );
}
