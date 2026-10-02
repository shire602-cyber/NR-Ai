import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { formatNumber } from "@/lib/format";
import { accountName } from "@/lib/account-name";
import type { LedgerAccount, RuleDirection, RuleSplitLine } from "@/lib/banking-api-types";
import { messages } from "./RuleSplitEditor.i18n";
import { MAX_SPLIT_LINES, evenSplit, previewPosting, splitIssues, splitTotal, type SplitIssue } from "./rule-split";

interface Props {
  lines: RuleSplitLine[];
  onChange: (lines: RuleSplitLine[]) => void;
  /** Accounts a rule may post to (income and expense type, active). */
  accounts: LedgerAccount[];
  vatRate: number;
  direction: RuleDirection;
}

const EXAMPLE_GROSS = 1050;

/** A number field that keeps what is typed ("33." stays "33.") and reports the number. */
function PercentInput({ value, onChange, label, testId }: { value: number; onChange: (n: number) => void; label: string; testId: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (Number(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      dir="ltr"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        onChange(Number.isFinite(n) ? n : 0);
      }}
      aria-label={label}
      className="text-end font-mono"
      data-testid={testId}
    />
  );
}
const ISSUE_KEY: Record<SplitIssue, "issueCount" | "issueAccount" | "issuePercent" | "issueTotal"> = {
  LINES_COUNT: "issueCount",
  ACCOUNT_MISSING: "issueAccount",
  PERCENT_RANGE: "issuePercent",
  TOTAL_NOT_100: "issueTotal",
};

export function RuleSplitEditor({ lines, onChange, accounts, vatRate, direction }: Props) {
  const tr = messages.useT();
  const locale = useI18n((s) => s.locale);
  const total = splitTotal(lines);
  const issues = splitIssues(lines);
  // a fresh rule has no account yet: say so only once something else has been touched
  const shownIssues = issues.filter((code) => code !== "ACCOUNT_MISSING" || lines.some((l) => l.accountId));
  const lineName = (id: string) => {
    const a = accounts.find((x) => x.id === id);
    return a ? `${a.code} ${accountName(a, locale)}` : id;
  };

  const preview = useMemo(
    () => (issues.length === 0 ? previewPosting({ gross: EXAMPLE_GROSS, vatRate: direction === "inflow" ? 0 : vatRate, lines }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, vatRate, direction, issues.length]
  );

  const patch = (index: number, change: Partial<RuleSplitLine>) => onChange(lines.map((l, i) => (i === index ? { ...l, ...change } : l)));
  const money = (n: number) => formatNumber(n, locale);

  return (
    <div className="space-y-3" data-testid="rule-split-editor">
      <div>
        <p className="text-sm font-medium">{tr("title")}</p>
        <p className="text-xs text-muted-foreground">{tr("hint")}</p>
        <p className="text-xs text-muted-foreground">{tr("accountsHint")}</p>
      </div>

      <ul className="space-y-2">
        {lines.map((l, i) => (
          <li key={i} className="grid grid-cols-[1fr_5.5rem_2.25rem] gap-2 items-start" data-testid={`split-line-${i}`}>
            <div className="space-y-1 min-w-0">
              <Select value={l.accountId} onValueChange={(v) => patch(i, { accountId: v })}>
                <SelectTrigger aria-label={tr("account")} data-testid={`split-account-${i}`}>
                  <SelectValue placeholder={tr("accountPlaceholder")} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <span dir="ltr" className="font-mono">
                        {a.code}
                      </span>{" "}
                      {accountName(a, locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input value={l.description ?? ""} onChange={(e) => patch(i, { description: e.target.value || undefined })} placeholder={tr("description")} maxLength={200} dir="auto" className="h-8 text-xs" />
            </div>
            <PercentInput value={Number(l.percent) || 0} onChange={(n) => patch(i, { percent: n })} label={tr("percent")} testId={`split-percent-${i}`} />
            <Button type="button" variant="ghost" size="icon" onClick={() => onChange(lines.filter((_, j) => j !== i))} disabled={lines.length <= 1} aria-label={tr("removeLine")}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onChange([...lines, { accountId: "", percent: 0 }])} disabled={lines.length >= MAX_SPLIT_LINES} data-testid="button-add-split">
            <Plus className="h-4 w-4 me-1" />
            {tr("addLine")}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(evenSplit(lines.map((l) => l.accountId)))} disabled={lines.length < 2}>
            {tr("splitEvenly")}
          </Button>
        </div>
        <p dir="ltr" className={`text-sm font-mono ${total === 100 ? "text-[hsl(var(--chart-5))]" : "text-destructive"}`} data-testid="split-total" aria-live="polite">
          {tr("total")}: {total}%
        </p>
      </div>

      {shownIssues.length > 0 && (
        <ul className="text-xs text-destructive space-y-0.5" data-testid="split-issues">
          {shownIssues.map((code) => (
            <li key={code}>{tr(ISSUE_KEY[code], { total })}</li>
          ))}
        </ul>
      )}

      {preview && (
        <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1" data-testid="split-example">
          <p className="font-medium">
            {tr("exampleTitle")}: {tr("exampleAmount")} <span dir="ltr">{money(preview.gross)}</span>
          </p>
          {direction === "inflow" && <p className="text-muted-foreground">{tr("exampleInflow")}</p>}
          {preview.vat > 0 && (
            <p className="flex justify-between gap-3">
              <span>{tr("exampleVat")}</span>
              <span dir="ltr" className="font-mono">
                {money(preview.vat)}
              </span>
            </p>
          )}
          {preview.shares.map((s, i) => (
            <p key={i} className="flex justify-between gap-3">
              <span dir="auto" className="truncate">
                {lineName(s.accountId)}
              </span>
              <span dir="ltr" className="font-mono">
                {money(s.amount)}
              </span>
            </p>
          ))}
          <p className="flex justify-between gap-3 border-t pt-1 font-medium">
            <span>{tr("exampleGross")}</span>
            <span dir="ltr" className="font-mono">
              {money(preview.gross)}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
