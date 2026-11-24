import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * HTML twin of the "Ledger" PDF family (server/services/pdf-ledger.ts, Fable spec 2.8) for the
 * pages customers open: the public invoice view and the public customer portal. White document
 * card (max 760), 2 px accent rule, company block at the start, title at the end, meta row,
 * parties, line table, totals block with the filled amount-due row, and a quiet footer.
 *
 * Colours are tokens only (`--primary` is the accent); Latin values go in <bdi> so phone
 * numbers, TRNs and document numbers keep their order in Arabic.
 */

export function LedgerSheet({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <article
      className={cn(
        "mx-auto w-full max-w-[760px] overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-card-soft",
        className
      )}
      {...props}
    >
      <div aria-hidden className="h-0.5 bg-primary" />
      <div className="space-y-8 px-5 py-6 sm:px-10 sm:py-9">{children}</div>
    </article>
  );
}

export function LedgerHeader({
  start,
  title,
  aside,
  titleTestId,
}: {
  /** Company block (name, TRN, address, contact). */
  start: React.ReactNode;
  title: React.ReactNode;
  /** Under the title: number, status pill. */
  aside?: React.ReactNode;
  titleTestId?: string;
}) {
  return (
    <header className="flex flex-col-reverse gap-5 border-b border-border pb-6 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">{start}</div>
      <div className="shrink-0 space-y-2 sm:text-end">
        <h1 className="text-h2 font-semibold text-foreground" data-testid={titleTestId}>
          {title}
        </h1>
        {aside}
      </div>
    </header>
  );
}

export function LedgerCompany({
  name,
  lines,
}: {
  name: React.ReactNode;
  lines: Array<React.ReactNode | null | undefined | false>;
}) {
  return (
    <>
      <p className="text-h3 font-semibold text-foreground [overflow-wrap:anywhere]" dir="auto">
        {name}
      </p>
      {lines.filter(Boolean).map((line, i) => (
        <p key={i} className="text-small text-muted-foreground [overflow-wrap:anywhere]">
          {line}
        </p>
      ))}
    </>
  );
}

/** Label/value pairs in one row (wraps to two columns on mobile). */
export function LedgerMeta({
  items,
}: {
  items: Array<{ label: React.ReactNode; value: React.ReactNode; testId?: string } | null | false>;
}) {
  const list = items.filter(Boolean) as Array<{
    label: React.ReactNode;
    value: React.ReactNode;
    testId?: string;
  }>;
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-[repeat(auto-fit,minmax(120px,1fr))]">
      {list.map((item, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-caption text-muted-foreground">{item.label}</dt>
          <dd
            className="mt-1 text-small font-semibold tabular-nums text-foreground [overflow-wrap:anywhere]"
            data-testid={item.testId}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function LedgerParty({
  label,
  name,
  lines = [],
}: {
  label: React.ReactNode;
  name: React.ReactNode;
  lines?: Array<React.ReactNode | null | undefined | false>;
}) {
  return (
    <section className="min-w-0 space-y-1">
      <h2 className="text-caption font-semibold text-primary">{label}</h2>
      <p className="text-body font-semibold text-foreground [overflow-wrap:anywhere]" dir="auto">
        {name}
      </p>
      {lines.filter(Boolean).map((line, i) => (
        <p key={i} className="text-small text-muted-foreground [overflow-wrap:anywhere]">
          {line}
        </p>
      ))}
    </section>
  );
}

export interface LedgerColumn {
  key: string;
  label: React.ReactNode;
  numeric?: boolean;
  /** Shown on the stacked mobile row as "label value" under the description. */
  mobile?: boolean;
}

/**
 * Line table. From 480 px it is a hairline table; below that each line is a stacked row
 * (description, then the `mobile` columns, then the amount at the end).
 */
export function LedgerLines({
  columns,
  rows,
  primaryKey,
  amountKey,
}: {
  columns: LedgerColumn[];
  rows: Array<Record<string, React.ReactNode>>;
  primaryKey: string;
  amountKey: string;
}) {
  return (
    <div>
      <table className="hidden w-full text-small min-[480px]:table">
        <thead>
          <tr className="bg-surface-sunken">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  "px-3 py-2.5 text-caption font-semibold text-muted-foreground",
                  c.numeric ? "text-end" : "text-start"
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    "px-3 py-3 align-top",
                    c.numeric ? "text-end tabular-nums whitespace-nowrap" : "text-start",
                    c.key === primaryKey && "font-medium text-foreground"
                  )}
                >
                  {row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="divide-y divide-border border-y border-border min-[480px]:hidden">
        {rows.map((row, i) => (
          <li key={i} className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0 space-y-1">
              <p className="text-small font-medium text-foreground [overflow-wrap:anywhere]">
                {row[primaryKey]}
              </p>
              <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-caption text-muted-foreground">
                {columns
                  .filter((c) => c.mobile)
                  .map((c) => (
                    <span key={c.key}>
                      {c.label} <span className="tabular-nums text-foreground">{row[c.key]}</span>
                    </span>
                  ))}
              </p>
            </div>
            <p className="shrink-0 text-small font-semibold tabular-nums text-foreground">
              {row[amountKey]}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Totals block at the inline end; `due` is the filled accent row. */
export function LedgerTotals({
  rows,
  due,
}: {
  rows: Array<{ label: React.ReactNode; value: React.ReactNode; strong?: boolean } | null | false>;
  due?: { label: React.ReactNode; value: React.ReactNode; testId?: string } | null;
}) {
  const list = rows.filter(Boolean) as Array<{
    label: React.ReactNode;
    value: React.ReactNode;
    strong?: boolean;
  }>;
  return (
    <div className="flex justify-end">
      <dl className="w-full max-w-[320px] text-small">
        {list.map((r, i) => (
          <div
            key={i}
            className={cn(
              "flex items-baseline justify-between gap-4 py-1.5",
              r.strong && "mt-1 border-t border-border pt-2.5 font-semibold text-foreground"
            )}
          >
            <dt className={r.strong ? undefined : "text-muted-foreground"}>{r.label}</dt>
            <dd className="tabular-nums">{r.value}</dd>
          </div>
        ))}
        {due && (
          <div className="mt-3 flex items-baseline justify-between gap-4 rounded-md bg-primary px-4 py-3 text-primary-foreground">
            <dt className="font-semibold">{due.label}</dt>
            <dd
              className="text-h3 font-semibold tabular-nums [&_.money-currency]:text-inherit"
              data-testid={due.testId}
            >
              {due.value}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

/** Quiet document footer line. */
export function LedgerFooter({ children }: { children: React.ReactNode }) {
  return (
    <footer className="mx-auto w-full max-w-[760px] px-1 py-6 text-center text-caption text-muted-foreground">
      {children}
    </footer>
  );
}
