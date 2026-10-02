import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useI18n } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";
import type { StagedPdfImport } from "@/lib/banking-api-types";
import {
  balanceCheck,
  buildCommitRows,
  fromStagedRows,
  parseAmountText,
  rowIssues,
  summariseReview,
  type CommitRow,
  type ReviewRow,
  type RowIssueCode,
} from "@/lib/statement-review";
import { messages } from "./StatementReviewGrid.i18n";
import { messages as common } from "./BankingCommon.i18n";
import { warningText } from "./statement-warnings";

interface Props {
  staged: StagedPdfImport;
  fileName: string;
  currency: string;
  busy: boolean;
  discarding: boolean;
  onCommit: (rows: CommitRow[]) => void;
  onDiscard: () => void;
}

const ISSUE_KEY: Record<RowIssueCode, Parameters<ReturnType<typeof messages.useT>>[0]> = {
  DATE_INVALID: "issueDate",
  AMOUNT_INVALID: "issueAmountInvalid",
  AMOUNT_ZERO: "issueAmountZero",
  DESCRIPTION_EMPTY: "issueDescription",
  BALANCE_INVALID: "issueBalance",
};

const SERVER_ISSUE_KEY: Record<string, Parameters<ReturnType<typeof messages.useT>>[0]> = {
  no_description: "serverNoDescription",
  balance_gap: "serverBalanceGap",
  sign_unknown: "serverSignUnknown",
};

export function StatementReviewGrid({ staged, fileName, currency, busy, discarding, onCommit, onDiscard }: Props) {
  const tr = messages.useT();
  const trc = common.useT();
  const locale = useI18n((s) => s.locale);
  const [rows, setRows] = useState<ReviewRow[]>(() => fromStagedRows(staged.rows));

  const summary = useMemo(() => summariseReview(rows), [rows]);
  const check = useMemo(
    () => balanceCheck({ opening: staged.statement.openingBalance, closing: staged.statement.closingBalance, rows }),
    [rows, staged.statement.openingBalance, staged.statement.closingBalance]
  );
  const rowsTotal = useMemo(
    () => rows.reduce((s, r) => (r.excluded ? s : s + Math.round((parseAmountText(r.amount) ?? 0) * 100)), 0) / 100,
    [rows]
  );

  const patch = (key: string, change: Partial<ReviewRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...change } : r)));
  const setAll = (excluded: boolean) => setRows((prev) => prev.map((r) => ({ ...r, excluded })));
  const money = (n: number | null) => (n === null ? tr("notAvailable") : formatCurrency(n, currency, locale));

  return (
    <div className="space-y-4" data-testid="statement-review-grid">
      <div>
        <h3 className="text-base font-semibold">{tr("title")}</h3>
        <p className="text-sm text-muted-foreground">{tr("intro")}</p>
        <p className="text-xs text-muted-foreground mt-1" dir="auto">
          {tr("sourceFile", { name: fileName })}
        </p>
      </div>

      {staged.parser === "ai" && (
        <Alert variant="default" data-testid="review-ai-banner">
          <Info className="h-4 w-4" />
          <AlertDescription>{tr("aiBanner")}</AlertDescription>
        </Alert>
      )}

      {staged.warnings.length > 0 && (
        <div className="text-xs text-muted-foreground space-y-1" data-testid="review-warnings">
          <p className="font-medium">{tr("warnings")}</p>
          <ul className="list-disc ps-5 space-y-0.5">
            {staged.warnings.map((w) => (
              <li key={w} dir="auto">
                {warningText(w, locale)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">{tr("opening")}</p>
          <p dir="ltr" className="font-mono font-medium text-start">
            {money(staged.statement.openingBalance)}
          </p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">{tr("rowsSum")}</p>
          <p dir="ltr" className="font-mono font-medium text-start">
            {formatCurrency(rowsTotal, currency, locale)}
          </p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">{tr("closing")}</p>
          <p dir="ltr" className="font-mono font-medium text-start">
            {money(staged.statement.closingBalance)}
          </p>
        </div>
      </div>

      <div
        role="status"
        data-testid="review-balance-check"
        data-status={check.status}
        className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
          check.status === "ok"
            ? "border-[hsl(var(--chart-5)/0.4)] bg-[hsl(var(--chart-5)/0.08)]"
            : "border-[hsl(var(--chart-4)/0.4)] bg-[hsl(var(--chart-4)/0.08)]"
        }`}
      >
        {check.status === "ok" ? (
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-[hsl(var(--chart-5))]" />
        ) : (
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-[hsl(var(--chart-4))]" />
        )}
        <span>
          {check.status === "ok"
            ? tr("checkOk")
            : check.status === "mismatch"
              ? tr("checkMismatch", {
                  expected: formatCurrency(check.expectedClosing ?? 0, currency, locale),
                  closing: money(staged.statement.closingBalance),
                  difference: formatCurrency(check.difference ?? 0, currency, locale),
                })
              : tr("checkUnknown")}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">
          {tr("includedCount", { included: summary.included, excluded: summary.excluded })}
          {summary.withIssues > 0 && <span className="text-destructive ms-2">{tr("withIssues", { count: summary.withIssues })}</span>}
        </span>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setAll(true)}>
            {tr("excludeAll")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setAll(false)}>
            {tr("includeAll")}
          </Button>
        </div>
      </div>

      <div className="rounded-md border divide-y max-h-[46vh] overflow-y-auto" data-testid="review-rows">
        <div className="hidden md:grid grid-cols-[2.5rem_8.5rem_1fr_8rem_8rem_8rem] gap-2 px-3 py-2 text-xs font-medium text-muted-foreground bg-muted/40 sticky top-0 z-10">
          <span>{tr("colInclude")}</span>
          <span>{tr("colDate")}</span>
          <span>{tr("colDescription")}</span>
          <span>{tr("colReference")}</span>
          <span className="text-end">{tr("colAmount")}</span>
          <span className="text-end">{tr("colBalance")}</span>
        </div>
        {rows.map((r, index) => {
          const issues = rowIssues(r);
          return (
            <div
              key={r.key}
              data-testid={`review-row-${index}`}
              data-excluded={r.excluded ? "true" : "false"}
              className={`grid grid-cols-2 md:grid-cols-[2.5rem_8.5rem_1fr_8rem_8rem_8rem] gap-2 px-3 py-2 items-start ${r.excluded ? "opacity-50" : ""}`}
            >
              <div className="flex items-center gap-2 md:pt-2">
                <Checkbox
                  checked={!r.excluded}
                  onCheckedChange={(c) => patch(r.key, { excluded: c !== true })}
                  aria-label={tr("colInclude")}
                />
                <span className="text-xs text-muted-foreground md:hidden">{tr("colInclude")}</span>
              </div>
              <Input
                dir="ltr"
                value={r.date}
                onChange={(e) => patch(r.key, { date: e.target.value })}
                aria-label={tr("colDate")}
                aria-invalid={issues.includes("DATE_INVALID")}
                className="h-9 font-mono text-sm"
              />
              <Input
                dir="auto"
                value={r.description}
                onChange={(e) => patch(r.key, { description: e.target.value })}
                aria-label={tr("colDescription")}
                aria-invalid={issues.includes("DESCRIPTION_EMPTY")}
                className="h-9 text-sm col-span-2 md:col-span-1"
              />
              <Input
                dir="ltr"
                value={r.reference ?? ""}
                onChange={(e) => patch(r.key, { reference: e.target.value })}
                aria-label={tr("colReference")}
                className="h-9 font-mono text-sm"
              />
              <Input
                dir="ltr"
                inputMode="decimal"
                value={r.amount}
                onChange={(e) => patch(r.key, { amount: e.target.value })}
                aria-label={tr("colAmount")}
                aria-invalid={issues.includes("AMOUNT_INVALID") || issues.includes("AMOUNT_ZERO")}
                className="h-9 font-mono text-sm text-end"
              />
              <Input
                dir="ltr"
                inputMode="decimal"
                value={r.balance}
                onChange={(e) => patch(r.key, { balance: e.target.value })}
                aria-label={tr("colBalance")}
                aria-invalid={issues.includes("BALANCE_INVALID")}
                className="h-9 font-mono text-sm text-end"
              />
              {(issues.length > 0 || (r.serverIssues.length > 0 && !r.excluded)) && (
                <ul className="col-span-2 md:col-start-2 md:col-span-5 text-xs space-y-0.5">
                  {issues.map((code) => (
                    <li key={code} className="text-destructive flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      {tr(ISSUE_KEY[code])}
                    </li>
                  ))}
                  {!r.excluded &&
                    r.serverIssues.map((code) => (
                      <li key={code} className="text-[hsl(var(--chart-4))] flex items-center gap-1">
                        <Info className="h-3 w-3 shrink-0" />
                        {SERVER_ISSUE_KEY[code] ? tr(SERVER_ISSUE_KEY[code]) : code}
                      </li>
                    ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDiscard} disabled={busy || discarding} data-testid="review-discard">
          {discarding ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : null}
          {discarding ? tr("discarding") : tr("discard")}
        </Button>
        <Button
          type="button"
          onClick={() => onCommit(buildCommitRows(rows))}
          disabled={!summary.canCommit || busy || discarding}
          title={summary.included === 0 ? tr("nothingToImport") : undefined}
          data-testid="review-commit"
        >
          {busy ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : null}
          {busy ? tr("importing") : tr("importRows", { count: summary.included })}
        </Button>
      </div>
    </div>
  );
}
