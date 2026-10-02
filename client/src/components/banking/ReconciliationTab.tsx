import { useEffect, useMemo, useState } from "react";
import { todayYmd as todayIso, formatCalendarDate } from "@/lib/calendar-date";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Download, Loader2, Lock, RotateCcw, Scale, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { downloadPdf } from "@/lib/download-pdf";
import { formatCurrency } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { parseAmountText } from "@/lib/statement-review";
import type { BankAccount, BankReconciliationSession, ReconciliationStatement } from "@/lib/banking-api-types";
import { messages } from "./ReconciliationTab.i18n";
import { messages as common } from "./BankingCommon.i18n";
import { bankKey, bankingErrorText } from "./banking-common";
import { reconciliationVerdict, type ExplainedItem, type ItemType } from "./reconciliation-explain";

interface Props {
  companyId: string;
  bankAccounts: BankAccount[];
  initialBankAccountId?: string;
}


export function ReconciliationTab({ companyId, bankAccounts, initialBankAccountId }: Props) {
  const tr = messages.useT();
  const trc = common.useT();
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const [bankAccountId, setBankAccountId] = useState(initialBankAccountId ?? "");
  const [asOf, setAsOf] = useState(todayIso());
  const [balanceText, setBalanceText] = useState("");

  useEffect(() => {
    if (!bankAccountId && bankAccounts.length > 0) setBankAccountId(initialBankAccountId || bankAccounts[0].id);
  }, [bankAccounts, bankAccountId, initialBankAccountId]);

  const balanceParam = balanceText.trim() ? parseAmountText(balanceText) : null;
  const params = new URLSearchParams({ bankAccountId, asOf });
  if (balanceParam !== null) params.set("statementBalance", String(balanceParam));
  const reportPath = `/api/companies/${companyId}/bank-statements/reconciliation-report?${params}`;

  const { data: report, isLoading, isError } = useQuery<ReconciliationStatement>({
    queryKey: bankKey(companyId, `reconciliation-report?${params}`),
    enabled: !!companyId && !!bankAccountId && /^\d{4}-\d{2}-\d{2}$/.test(asOf),
  });
  const { data: sessions } = useQuery<BankReconciliationSession[]>({
    queryKey: ["/api/companies", companyId, `bank-reconciliations?bankAccountId=${bankAccountId}`],
    enabled: !!companyId && !!bankAccountId,
  });

  const currency = bankAccounts.find((a) => a.id === bankAccountId)?.currency ?? report?.currency ?? "AED";
  const money = (n: number) => formatCurrency(n, currency, locale);
  const verdict = useMemo(() => (report ? reconciliationVerdict(report) : null), [report]);
  // "balanced" only when the difference is 0 AND no item is half of an unmatched pair
  const balanced = verdict?.verdict === "balanced";
  const latestCompleted = useMemo(() => {
    const done = (sessions ?? []).filter((s) => s.status === "completed");
    return done.sort((a, b) => b.statementDate.localeCompare(a.statementDate))[0];
  }, [sessions]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: bankKey(companyId) });
    queryClient.invalidateQueries({ predicate: (q) => q.queryKey[1] === companyId && String(q.queryKey[2]).startsWith("bank-reconciliations") });
  };

  const complete = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/bank-reconciliations`, { bankAccountId, statementDate: asOf, statementBalance: report!.statementBalance }),
    onSuccess: () => {
      refresh();
      toast({ title: tr("completedTitle"), description: tr("completedBody", { date: formatCalendarDate(asOf, locale, "short") }) });
    },
    onError: (err: unknown) => toast({ variant: "destructive", title: tr("completeFailed"), description: bankingErrorText(trc, err, locale) }),
  });

  const reopen = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/companies/${companyId}/bank-reconciliations/${id}/reopen`),
    onSuccess: () => {
      refresh();
      toast({ title: tr("reopenTitle"), description: tr("reopenBody") });
    },
    onError: (err: unknown) => toast({ variant: "destructive", title: tr("reopenFailed"), description: bankingErrorText(trc, err, locale) }),
  });

  const csv = useMutation({
    mutationFn: () => downloadPdf(`${reportPath}&format=csv`, `bank-reconciliation-${asOf}.csv`),
    onError: (err: unknown) => toast({ variant: "destructive", title: tr("csvFailed"), description: bankingErrorText(trc, err, locale) }),
  });

  const sourceText = (s: ReconciliationStatement["statementBalanceSource"]) =>
    s === "param" ? tr("sourceParam") : s === "session" ? tr("sourceSession") : s === "import" ? tr("sourceImport") : s === "running_balance" ? tr("sourceRunning") : tr("sourceNone");

  const Row = ({ label, value, strong, sign, testId }: { label: string; value: number | null; strong?: boolean; sign?: "+" | "-"; testId?: string }) => (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 ${strong ? "border-t font-semibold" : "text-sm"}`}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span dir="ltr" className="font-mono text-end" data-testid={testId}>
        {value === null ? "-" : `${sign === "-" && value ? "-" : ""}${money(value)}`}
      </span>
    </div>
  );

  const typeText = (t: ItemType) =>
    t === "DEPOSIT_IN_TRANSIT" ? tr("typeDeposit") : t === "OUTSTANDING_PAYMENT" ? tr("typeOutstanding") : t === "STATEMENT_CREDIT" ? tr("typeStatementCredit") : tr("typeStatementDebit");
  const sourceLabel = (source: string | null) =>
    !source ? "" : source === "payment" ? tr("docPayment") : source === "bill_payment" ? tr("docBillPayment") : source === "bank_reconciliation" ? tr("docBankEntry") : source === "bank_rule" ? tr("docBankRule") : source === "manual" ? tr("docManual") : source.startsWith("fx_revaluation") ? tr("docRevaluation") : tr("docOther");
  const documentText = (i: ExplainedItem) =>
    i.document.number ? `${sourceLabel(i.document.source)} ${i.document.number}`.trim() : i.document.reference ? `${tr("docStatementLine")} ${i.document.reference}` : tr("docStatementLine");

  return (
    <div className="space-y-6" data-testid="reconciliation-tab">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5" />
            {tr("title")}
          </CardTitle>
          <CardDescription>{tr("intro")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>{tr("bankAccount")}</Label>
              <Select value={bankAccountId} onValueChange={setBankAccountId}>
                <SelectTrigger data-testid="select-recon-account">
                  <SelectValue placeholder={tr("selectAccount")} />
                </SelectTrigger>
                <SelectContent>
                  {bankAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.nameEn} ({a.currency})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="recon-asof">{tr("asOf")}</Label>
              <Input id="recon-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} dir="ltr" className="text-start" data-testid="input-recon-asof" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="recon-balance">{tr("statementBalance")}</Label>
              <Input
                id="recon-balance"
                inputMode="decimal"
                value={balanceText}
                onChange={(e) => setBalanceText(e.target.value)}
                dir="ltr"
                className="text-start"
                aria-invalid={balanceText.trim() !== "" && balanceParam === null}
                data-testid="input-recon-balance"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{tr("statementBalanceHint")}</p>

          {!bankAccountId ? (
            <p className="text-sm text-muted-foreground">{tr("pickAccount")}</p>
          ) : isLoading ? (
            <div className="space-y-2" aria-busy="true" aria-label={tr("loading")}>
              <Skeleton className="h-40 w-full" />
            </div>
          ) : isError || !report ? (
            <p className="text-sm text-destructive">{tr("loadFailed")}</p>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border p-4" data-testid="recon-statement-side">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{tr("statementSide")}</p>
                  <Row label={tr("statementBalanceLabel")} value={report.statementBalance} testId="recon-statement-balance" />
                  <p className="text-[11px] text-muted-foreground -mt-1 mb-1">{sourceText(report.statementBalanceSource)}</p>
                  <Row label={tr("depositsInTransit")} value={report.depositsInTransit} testId="recon-deposits" />
                  <Row label={tr("outstandingPayments")} value={report.outstandingPayments} sign="-" testId="recon-outstanding" />
                  <Row label={tr("adjustedStatement")} value={report.adjustedStatementBalance} strong testId="recon-adjusted-statement" />
                </div>
                <div className="rounded-lg border p-4" data-testid="recon-ledger-side">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{tr("ledgerSide")}</p>
                  <Row label={tr("ledgerBalanceLabel")} value={report.ledgerBalance} testId="recon-ledger-balance" />
                  <p className="text-[11px] mb-1">&nbsp;</p>
                  <Row label={tr("unreconciledCredits")} value={report.unreconciledCredits} testId="recon-credits" />
                  <Row label={tr("unreconciledDebits")} value={report.unreconciledDebits} sign="-" testId="recon-debits" />
                  <Row label={tr("adjustedLedger")} value={report.adjustedLedgerBalance} strong testId="recon-adjusted-ledger" />
                </div>
              </div>

              <div
                role="status"
                data-testid="recon-difference"
                data-balanced={balanced ? "true" : "false"}
                data-verdict={verdict?.verdict}
                className={`flex items-center justify-between gap-3 flex-wrap rounded-md border p-3 ${
                  balanced ? "border-[hsl(var(--chart-5)/0.4)] bg-[hsl(var(--chart-5)/0.08)]" : "border-[hsl(var(--chart-4)/0.4)] bg-[hsl(var(--chart-4)/0.08)]"
                }`}
              >
                <div className="flex items-center gap-2">
                  {balanced ? <CheckCircle2 className="h-5 w-5 text-[hsl(var(--chart-5))]" /> : <AlertTriangle className="h-5 w-5 text-[hsl(var(--chart-4))]" />}
                  <span className="font-medium">{tr("difference")}</span>
                  <span dir="ltr" className="font-mono">
                    {report.difference === null ? "-" : money(report.difference)}
                  </span>
                  <StatusBadge tone={balanced ? "success" : "warning"}>
                    {verdict?.verdict === "needs_statement_balance"
                      ? tr("unknownDifference")
                      : balanced
                        ? tr("balanced")
                        : verdict?.verdict === "balanced_with_unmatched"
                          ? tr("balancedUnmatched")
                          : tr("notBalanced")}
                  </StatusBadge>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" size="sm" onClick={() => csv.mutate()} disabled={csv.isPending} data-testid="button-recon-csv">
                    {csv.isPending ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <Download className="h-4 w-4 me-2" />}
                    {tr("downloadCsv")}
                  </Button>
                  <Button size="sm" onClick={() => complete.mutate()} disabled={!balanced || complete.isPending || report.statementBalance === null} title={tr("completeHint")} data-testid="button-recon-complete">
                    {complete.isPending ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <Lock className="h-4 w-4 me-2" />}
                    {complete.isPending ? tr("completing") : tr("complete")}
                  </Button>
                </div>
              </div>

              {verdict?.verdict === "balanced_with_unmatched" && (
                <p className="text-sm rounded-md border border-[hsl(var(--chart-4)/0.4)] bg-[hsl(var(--chart-4)/0.08)] p-3" data-testid="recon-unmatched-note">
                  {tr("unmatchedNote", { count: verdict.unmatchedPairs })}
                </p>
              )}

              <div className="space-y-2" data-testid="reconciliation-items">
                <p className="text-sm font-semibold">
                  {tr("itemsHeading")} <span className="text-muted-foreground font-normal">({verdict?.items.length ?? 0})</span>
                </p>
                {!verdict || verdict.items.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{tr("noItems")}</p>
                ) : (
                  <div className="rounded-md border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{tr("colType")}</TableHead>
                          <TableHead>{tr("colDocument")}</TableHead>
                          <TableHead className="w-28">{tr("colDate")}</TableHead>
                          <TableHead>{tr("colDescription")}</TableHead>
                          <TableHead className="text-end w-32">{tr("colAmount")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {verdict.items.map((i) => (
                          <TableRow key={i.key} data-testid={`recon-item-${i.type}`} data-paired={i.pairedWith ? "true" : "false"}>
                            <TableCell className="text-sm whitespace-nowrap">
                              {typeText(i.type)}
                              {i.pairedWith && <span className="block text-[11px] text-[hsl(var(--chart-4))]">{tr("pairedHint")}</span>}
                            </TableCell>
                            <TableCell className="text-xs" dir="auto">
                              {documentText(i)}
                            </TableCell>
                            <TableCell className="font-mono text-xs whitespace-nowrap">{formatCalendarDate(i.date, locale, "short")}</TableCell>
                            <TableCell className="text-sm" dir="auto">
                              {i.description}
                            </TableCell>
                            <TableCell dir="ltr" className="text-end font-mono text-sm">
                              {money(i.amount)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tr("sessions")}</CardTitle>
        </CardHeader>
        <CardContent>
          {!sessions || sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tr("sessionsEmpty")}</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr("sessionDate")}</TableHead>
                    <TableHead className="text-end">{tr("sessionStatement")}</TableHead>
                    <TableHead className="text-end">{tr("sessionLedger")}</TableHead>
                    <TableHead>{tr("sessionStatus")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map((s) => (
                    <TableRow key={s.id} data-testid={`session-${s.id}`}>
                      <TableCell className="font-mono text-sm">{formatCalendarDate(s.statementDate, locale, "short")}</TableCell>
                      <TableCell dir="ltr" className="text-end font-mono">
                        {money(Number(s.statementBalance))}
                      </TableCell>
                      <TableCell dir="ltr" className="text-end font-mono">
                        {money(Number(s.ledgerBalance))}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={s.status === "completed" ? "success" : "neutral"}>{s.status === "completed" ? tr("statusCompleted") : tr("statusReopened")}</StatusBadge>
                      </TableCell>
                      <TableCell className="text-end">
                        {latestCompleted?.id === s.id && (
                          <Button variant="outline" size="sm" onClick={() => reopen.mutate(s.id)} disabled={reopen.isPending} data-testid={`button-reopen-${s.id}`}>
                            <RotateCcw className="h-3.5 w-3.5 me-1" />
                            {tr("reopen")}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
