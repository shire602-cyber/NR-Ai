/** Body of the reconciliation statement dialog; loaded on demand by the Bank accounts page. */
import { useEffect, useState, useSyncExternalStore } from "react";
import { onlineManager, useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CashBalance } from "@/components/ui/cash-balance";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { loadNamespaces, t as catalogs, useTranslation, type Locale } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiRequest, queryClient } from "@/lib/queryClient";
import { FileDown } from "lucide-react";
import { sectionState } from "./query-states";
import { RefreshFailed } from "./RefreshFailed";
import { BodyLoadFailed } from "./BodyLoadFailed";
import { STATEMENT_NAMESPACES } from "./statement-namespaces";

interface StatementItem {
  id: string;
  date: string;
  description: string;
  amount: string;
}

interface Statement {
  currency?: string;
  totals: Record<string, string>;
  differenceFils: number;
  depositsInTransit: StatementItem[];
  outstandingPayments: StatementItem[];
  unrecordedReceipts: StatementItem[];
  unrecordedPayments: StatementItem[];
}

// P2: the rows that are a balance (bank or book) say "Overdrawn" when below zero.
const BALANCE_ROWS = new Set([
  "bankStatement.bankBalance",
  "bankStatement.adjustedBank",
  "bankStatement.glBalance",
  "bankStatement.adjustedBook",
]);

interface SavedReconciliation {
  id: string;
  periodEnd: string;
  statementClosingBalance: number;
  difference: number;
  status: string;
  signedOffAt: string | null;
}

// A paused query is not proof of being offline (an unfocused retry pauses too), so offline copy
// follows React Query's connectivity state only.
const subscribeConnectivity = (notify: () => void) => onlineManager.subscribe(notify);
const isKnownOffline = () => !onlineManager.isOnline();

export default function StatementDialogBody({
  companyId,
  accountId,
}: {
  companyId: string;
  accountId: string;
}) {
  // No declared namespaces: this still re-renders when a catalog lands; the effect below loads ours.
  const { t, locale } = useTranslation();
  const tr = (k: string) => t[k] ?? k;
  const { toast } = useToast();
  const knownOffline = useSyncExternalStore(subscribeConnectivity, isKnownOffline);
  // The opening locale's catalog arrives with this chunk; a language switch while open loads the
  // other one. A failure counts only for the locale that is still current.
  const [failedLocale, setFailedLocale] = useState<Locale | null>(null);
  useEffect(() => {
    let stale = false;
    loadNamespaces(locale, STATEMENT_NAMESPACES).catch(() => {
      if (!stale) setFailedLocale(locale);
    });
    return () => {
      stale = true;
    };
  }, [locale]);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState(new Date().toISOString().slice(0, 10));
  const [closing, setClosing] = useState("");
  const [statement, setStatement] = useState<Statement | null>(null);
  const historyKey = ["/api/companies", companyId, "bank-accounts", accountId, "reconciliations"];
  const historyQuery = useQuery<SavedReconciliation[]>({ queryKey: historyKey });
  const { data: history, refetch: refetchHistory } = historyQuery;
  const historyState = sectionState(historyQuery);
  // A foreign-currency account whose ledger lacks account-currency amounts is refused (409); the
  // localized reason is shown in place of a statement.
  const [refusal, setRefusal] = useState<string | null>(null);
  const onError = (err: Error) => {
    if (err instanceof ApiError && err.body?.code === "FX_RECONCILIATION_UNSUPPORTED") {
      setStatement(null);
      setRefusal(err.message);
      return;
    }
    toast({ variant: "destructive", title: tr("banking.common.error"), description: err?.message });
  };

  const previewMutation = useMutation({
    mutationFn: async () => {
      const q = new URLSearchParams({ periodEnd, statementClosingBalance: closing });
      if (periodStart) q.set("periodStart", periodStart);
      return (await apiRequest(
        "GET",
        `/api/companies/${companyId}/bank-accounts/${accountId}/reconciliation-statement?${q}`
      )) as Statement;
    },
    onSuccess: (st: Statement) => {
      setRefusal(null);
      setStatement(st);
    },
    onError,
  });
  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/bank-accounts/${accountId}/reconciliations`, {
        periodEnd,
        statementClosingBalance: closing,
        ...(periodStart ? { periodStart } : {}),
      }),
    onSuccess: (row: { statement: Statement }) => {
      setRefusal(null);
      setStatement(row.statement);
      queryClient.invalidateQueries({ queryKey: historyKey });
    },
    onError,
  });
  const signMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/companies/${companyId}/bank-reconciliations/${id}/sign-off`, {}),
    onSuccess: () => {
      toast({ title: tr("bankStatement.signedOff") });
      queryClient.invalidateQueries({ queryKey: historyKey });
    },
    onError,
  });

  const rows: Array<[string, string, StatementItem[] | null]> = statement
    ? [
        ["bankStatement.bankBalance", statement.totals.statementClosingBalance, null],
        [
          "bankStatement.depositsInTransit",
          statement.totals.depositsInTransit,
          statement.depositsInTransit,
        ],
        [
          "bankStatement.outstandingPayments",
          statement.totals.outstandingPayments,
          statement.outstandingPayments,
        ],
        ["bankStatement.adjustedBank", statement.totals.adjustedBankBalance, null],
        ["bankStatement.glBalance", statement.totals.glBalance, null],
        [
          "bankStatement.unrecordedReceipts",
          statement.totals.unrecordedReceipts,
          statement.unrecordedReceipts,
        ],
        [
          "bankStatement.unrecordedPayments",
          statement.totals.unrecordedPayments,
          statement.unrecordedPayments,
        ],
        ["bankStatement.adjustedBook", statement.totals.adjustedBookBalance, null],
        ["bankStatement.difference", statement.totals.difference, null],
      ]
    : [];

  // Never show raw keys while the current locale's copy is missing; the form state is kept.
  // Read the raw catalog: the hook's view can fall back to the other locale or the key itself.
  if (!catalogs[locale]["bankStatement.history"]) {
    return failedLocale === locale ? (
      <BodyLoadFailed />
    ) : (
      <p role="status" className="text-small text-muted-foreground">
        {t["banking.common.loading"]}
      </p>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <Label htmlFor="st-start">{tr("bankStatement.periodStart")}</Label>
          <DatePicker id="st-start" value={periodStart} onChange={setPeriodStart} />
        </div>
        <div>
          <Label htmlFor="st-end">{tr("banking.statement.periodEnd")}</Label>
          <DatePicker id="st-end" value={periodEnd} onChange={setPeriodEnd} />
        </div>
        <div>
          <Label htmlFor="st-close">{tr("bankStatement.closingBalance")}</Label>
          <Input
            id="st-close"
            inputMode="decimal"
            value={closing}
            onChange={(e) => setClosing(e.target.value)}
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={() => previewMutation.mutate()}
          disabled={!closing || !periodEnd || previewMutation.isPending}
        >
          {tr("bankStatement.preview")}
        </Button>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={!closing || !periodEnd || saveMutation.isPending}
        >
          {tr("bankStatement.saveDraft")}
        </Button>
      </div>
      {refusal && (
        <div
          role="alert"
          data-testid="bank-statement-fx-refusal"
          className="rounded-md border p-3 text-sm"
        >
          <p className="font-semibold">{tr("bankStatement.fxUnsupportedTitle")}</p>
          <p className="text-muted-foreground">{refusal}</p>
        </div>
      )}
      {statement && (
        <Card>
          <CardHeader>
            <CardDescription>
              {statement.differenceFils === 0
                ? tr("bankStatement.reconciled")
                : tr("bankStatement.notReconciled")}
              {statement.currency
                ? ` · ${tr("bankStatement.amountsIn")} ${statement.currency}`
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {rows.map(([key, value, items]) => (
              <div key={key}>
                <div className="flex justify-between font-medium">
                  <span>{tr(key)}</span>
                  {BALANCE_ROWS.has(key) ? (
                    <CashBalance
                      amount={value}
                      currency={statement.currency}
                      showCurrency={false}
                      data-statement-row={key}
                    />
                  ) : (
                    <span>{value}</span>
                  )}
                </div>
                {items?.map((it) => (
                  <div
                    key={it.id}
                    className="flex justify-between text-xs text-muted-foreground ps-4"
                  >
                    <span className="truncate">
                      {it.date} {it.description}
                    </span>
                    <span>{it.amount}</span>
                  </div>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <div>
        <p className="text-sm font-semibold mb-2">{tr("bankStatement.history")}</p>
        {historyState.refreshFailed && (
          <RefreshFailed
            message={tr("banking.common.refreshFailed")}
            onRetry={() => void refetchHistory()}
            testId="bank-history-refresh-error"
          />
        )}
        {historyState.kind === "loading" ? (
          <p role="status" className="text-small text-muted-foreground">
            {tr("banking.common.loading")}
          </p>
        ) : historyState.kind === "offline" ? (
          <p
            role="alert"
            data-testid="bank-history-offline"
            className="text-small text-muted-foreground"
          >
            {knownOffline
              ? `${tr("banking.common.offline")}. ${tr("banking.common.offlineBody")}`
              : tr("banking.query.paused")}{" "}
            <Button variant="link" size="sm" onClick={() => void refetchHistory()}>
              {t["components.errorRetry"]}
            </Button>
          </p>
        ) : historyState.kind === "error" ? (
          <p role="alert" className="text-small text-muted-foreground">
            {tr("bankStatement.historyError")}{" "}
            <Button variant="link" size="sm" onClick={() => void refetchHistory()}>
              {t["components.errorRetry"]}
            </Button>
          </p>
        ) : history?.length === 0 ? (
          <p className="text-small text-muted-foreground">{tr("bankStatement.historyNone")}</p>
        ) : (
          <Table>
            <TableBody>
              {(history ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.periodEnd}</TableCell>
                  <TableCell>
                    <CashBalance amount={r.statementClosingBalance} showCurrency={false} />
                  </TableCell>
                  <TableCell>{r.difference}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === "signed_off" ? "default" : "outline"}>
                      {r.status === "signed_off"
                        ? tr("bankStatement.signedOff")
                        : tr("banking.statement.draft")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-end">
                    <div className="inline-flex flex-wrap justify-end gap-1">
                      {r.status !== "signed_off" && (
                        <Button
                          size="sm"
                          onClick={() => signMutation.mutate(r.id)}
                          disabled={signMutation.isPending}
                        >
                          {tr("bankStatement.signOff")}
                        </Button>
                      )}
                      {(["pdf", "xlsx"] as const).map((f) => (
                        <Button key={f} size="sm" variant="outline" asChild>
                          <a
                            href={`/api/companies/${companyId}/bank-reconciliations/${r.id}/export?format=${f}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <FileDown className="w-3 h-3" />
                            {f === "pdf"
                              ? tr("bankStatement.exportPdf")
                              : tr("bankStatement.exportXlsx")}
                          </a>
                        </Button>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
