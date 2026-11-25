/** Body of the reconciliation statement dialog; loaded on demand by the Bank accounts page. */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { useTranslation } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { FileDown } from "lucide-react";
import { sectionState } from "./query-states";
import { RefreshFailed } from "./RefreshFailed";

interface StatementItem {
  id: string;
  date: string;
  description: string;
  amount: string;
}

interface Statement {
  totals: Record<string, string>;
  differenceFils: number;
  depositsInTransit: StatementItem[];
  outstandingPayments: StatementItem[];
  unrecordedReceipts: StatementItem[];
  unrecordedPayments: StatementItem[];
}

interface SavedReconciliation {
  id: string;
  periodEnd: string;
  statementClosingBalance: number;
  difference: number;
  status: string;
  signedOffAt: string | null;
}

export default function StatementDialogBody({
  companyId,
  accountId,
}: {
  companyId: string;
  accountId: string;
}) {
  const { t } = useTranslation();
  const tr = (k: string) => t[k] ?? k;
  const { toast } = useToast();
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState(new Date().toISOString().slice(0, 10));
  const [closing, setClosing] = useState("");
  const [statement, setStatement] = useState<Statement | null>(null);
  const historyKey = ["/api/companies", companyId, "bank-accounts", accountId, "reconciliations"];
  const historyQuery = useQuery<SavedReconciliation[]>({ queryKey: historyKey });
  const { data: history, refetch: refetchHistory } = historyQuery;
  const historyState = sectionState(historyQuery);
  const onError = (err: Error) =>
    toast({ variant: "destructive", title: tr("banking.common.error"), description: err?.message });

  const previewMutation = useMutation({
    mutationFn: async () => {
      const q = new URLSearchParams({ periodEnd, statementClosingBalance: closing });
      if (periodStart) q.set("periodStart", periodStart);
      return (await apiRequest(
        "GET",
        `/api/companies/${companyId}/bank-accounts/${accountId}/reconciliation-statement?${q}`
      )) as Statement;
    },
    onSuccess: setStatement,
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
      setStatement(row.statement);
      queryClient.invalidateQueries({ queryKey: historyKey });
    },
    onError,
  });
  const signMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/companies/${companyId}/bank-reconciliations/${id}/sign-off`, {}),
    onSuccess: () => {
      toast({ title: tr("banking.statement.signedOff") });
      queryClient.invalidateQueries({ queryKey: historyKey });
    },
    onError,
  });

  const rows: Array<[string, string, StatementItem[] | null]> = statement
    ? [
        ["banking.statement.bankBalance", statement.totals.statementClosingBalance, null],
        [
          "banking.statement.depositsInTransit",
          statement.totals.depositsInTransit,
          statement.depositsInTransit,
        ],
        [
          "banking.statement.outstandingPayments",
          statement.totals.outstandingPayments,
          statement.outstandingPayments,
        ],
        ["banking.statement.adjustedBank", statement.totals.adjustedBankBalance, null],
        ["banking.statement.glBalance", statement.totals.glBalance, null],
        [
          "banking.statement.unrecordedReceipts",
          statement.totals.unrecordedReceipts,
          statement.unrecordedReceipts,
        ],
        [
          "banking.statement.unrecordedPayments",
          statement.totals.unrecordedPayments,
          statement.unrecordedPayments,
        ],
        ["banking.statement.adjustedBook", statement.totals.adjustedBookBalance, null],
        ["banking.statement.difference", statement.totals.difference, null],
      ]
    : [];

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <Label htmlFor="st-start">{tr("banking.statement.periodStart")}</Label>
          <DatePicker id="st-start" value={periodStart} onChange={setPeriodStart} />
        </div>
        <div>
          <Label htmlFor="st-end">{tr("banking.statement.periodEnd")}</Label>
          <DatePicker id="st-end" value={periodEnd} onChange={setPeriodEnd} />
        </div>
        <div>
          <Label htmlFor="st-close">{tr("banking.statement.closingBalance")}</Label>
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
          {tr("banking.statement.preview")}
        </Button>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={!closing || !periodEnd || saveMutation.isPending}
        >
          {tr("banking.statement.saveDraft")}
        </Button>
      </div>
      {statement && (
        <Card>
          <CardHeader>
            <CardDescription>
              {statement.differenceFils === 0
                ? tr("banking.statement.reconciled")
                : tr("banking.statement.notReconciled")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {rows.map(([key, value, items]) => (
              <div key={key}>
                <div className="flex justify-between font-medium">
                  <span>{tr(key)}</span>
                  <span>{value}</span>
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
        <p className="text-sm font-semibold mb-2">{tr("banking.statement.history")}</p>
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
            {tr("banking.common.offline")}. {tr("banking.common.offlineBody")}{" "}
            <Button variant="link" size="sm" onClick={() => void refetchHistory()}>
              {t["components.errorRetry"]}
            </Button>
          </p>
        ) : historyState.kind === "error" ? (
          <p role="alert" className="text-small text-muted-foreground">
            {tr("banking.statement.historyError")}{" "}
            <Button variant="link" size="sm" onClick={() => void refetchHistory()}>
              {t["components.errorRetry"]}
            </Button>
          </p>
        ) : history?.length === 0 ? (
          <p className="text-small text-muted-foreground">{tr("banking.statement.historyNone")}</p>
        ) : (
          <Table>
            <TableBody>
              {(history ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.periodEnd}</TableCell>
                  <TableCell>{r.statementClosingBalance}</TableCell>
                  <TableCell>{r.difference}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === "signed_off" ? "default" : "outline"}>
                      {r.status === "signed_off"
                        ? tr("banking.statement.signedOff")
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
                          {tr("banking.statement.signOff")}
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
                              ? tr("banking.statement.exportPdf")
                              : tr("banking.statement.exportXlsx")}
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
