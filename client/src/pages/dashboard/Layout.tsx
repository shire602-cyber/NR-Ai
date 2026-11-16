import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight } from "lucide-react";
import { Link } from "wouter";

// ─── Quick action ────────────────────────────────────────────────────────────

export function QuickAction({
  icon: Icon,
  title,
  description,
  href,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  /** Kept for call-site compatibility; entrance motion is handled by the page. */
  delay?: number;
}) {
  return (
    <Link
      href={href}
      className="group flex h-full flex-col rounded-xl border border-card-border bg-card p-4 shadow-card-soft transition-[border-color,box-shadow] duration-base ease-standard hover:border-border-strong hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-foreground/80 transition-colors duration-fast group-hover:bg-brand-50 group-hover:text-accent dark:group-hover:bg-brand-950">
          <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        </span>
        <ArrowUpRight
          aria-hidden
          className="ms-auto h-4 w-4 text-muted-foreground transition-colors duration-fast group-hover:text-accent rtl:-scale-x-100"
        />
      </div>
      <div className="mt-3 text-sm font-semibold text-foreground">{title}</div>
      <div className="mt-0.5 text-small text-muted-foreground">{description}</div>
    </Link>
  );
}

// ─── Section header ──────────────────────────────────────────────────────────

export function SectionHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h2 className="mt-1 text-h2 text-foreground">{title}</h2>
      </div>
      {action}
    </div>
  );
}
