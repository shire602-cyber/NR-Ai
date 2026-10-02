import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { downloadPdf } from "@/lib/download-pdf";
import { formatCurrency, formatDate } from "@/lib/format";
import { messages as common } from "@/components/banking/BankingCommon.i18n";
import { bankingErrorText } from "@/components/banking/banking-common";
import type { AssetRegister } from "@/lib/banking-api-types";
import { messages } from "./AssetRegisterTab.i18n";

const todayIso = () => new Date().toISOString().slice(0, 10);

/** The asset register as of a date: cost, accumulated depreciation, NBV, and the tie to ledger accounts 1290 and 1240. */
export function AssetRegisterTab({ companyId }: { companyId: string }) {
  const tr = messages.useT();
  const trc = common.useT();
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const [asOf, setAsOf] = useState(todayIso());
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(asOf);
  const path = `/api/companies/${companyId}/fixed-assets/register?asOf=${asOf}`;

  const { data, isLoading, isError } = useQuery<AssetRegister>({ queryKey: [path], enabled: !!companyId && valid });
  const csv = useMutation({
    mutationFn: () => downloadPdf(`${path}&format=csv`, `asset-register-${asOf}.csv`),
    onError: (err: unknown) => toast({ variant: "destructive", title: tr("csvFailed"), description: bankingErrorText(trc, err, locale) }),
  });
  const money = (n: number) => formatCurrency(n, "AED", locale);
  const statusBadge = (status: string) =>
    status === "disposed" ? <StatusBadge tone="danger">{tr("statusDisposed")}</StatusBadge> : status === "fully_depreciated" ? <StatusBadge tone="neutral">{tr("statusFully")}</StatusBadge> : <StatusBadge tone="success">{tr("statusActive")}</StatusBadge>;

  return (
    <div className="space-y-4" data-testid="asset-register">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>{tr("registerTitle")}</CardTitle>
              <CardDescription>{tr("registerDescription")}</CardDescription>
            </div>
            <div className="flex items-end gap-2 flex-wrap">
              <div className="space-y-1">
                <Label htmlFor="reg-asof">{tr("asOf")}</Label>
                <Input id="reg-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} dir="ltr" className="text-start w-44" data-testid="input-register-asof" />
              </div>
              <Button variant="outline" onClick={() => csv.mutate()} disabled={csv.isPending || !valid} data-testid="button-register-csv">
                {csv.isPending ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <Download className="h-4 w-4 me-2" />}
                {tr("downloadCsv")}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : isError || !data ? (
            <p className="text-sm text-destructive">{tr("loadFailed")}</p>
          ) : data.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tr("empty")}</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">{tr("colNumber")}</TableHead>
                    <TableHead>{tr("colName")}</TableHead>
                    <TableHead>{tr("colCategory")}</TableHead>
                    <TableHead>{tr("colPurchase")}</TableHead>
                    <TableHead className="text-end">{tr("colCost")}</TableHead>
                    <TableHead className="text-end">{tr("colAccumulated")}</TableHead>
                    <TableHead className="text-end">{tr("colNbv")}</TableHead>
                    <TableHead>{tr("colStatus")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((r) => (
                    <TableRow key={r.assetId} data-testid={`register-row-${r.assetId}`} className={r.onLedger ? "" : "opacity-60"}>
                      <TableCell className="font-mono text-xs">{r.number ?? ""}</TableCell>
                      <TableCell className="font-medium" dir="auto">
                        {r.name}
                      </TableCell>
                      <TableCell className="text-sm">{r.category}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{formatDate(r.purchaseDate, locale)}</TableCell>
                      <TableCell dir="ltr" className="text-end font-mono">
                        {money(r.cost)}
                      </TableCell>
                      <TableCell dir="ltr" className="text-end font-mono">
                        {money(r.accumulated)}
                      </TableCell>
                      <TableCell dir="ltr" className="text-end font-mono font-medium">
                        {money(r.nbv)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1 items-start">
                          {statusBadge(r.status)}
                          {!r.onLedger && <span className="text-[11px] text-[hsl(var(--chart-4))]">{tr("notOnLedger")}</span>}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow data-testid="register-totals">
                    <TableCell colSpan={4} className="font-semibold">
                      {tr("totals")}
                    </TableCell>
                    <TableCell dir="ltr" className="text-end font-mono font-semibold" data-testid="register-total-cost">
                      {money(data.totals.cost)}
                    </TableCell>
                    <TableCell dir="ltr" className="text-end font-mono font-semibold" data-testid="register-total-accumulated">
                      {money(data.totals.accumulated)}
                    </TableCell>
                    <TableCell dir="ltr" className="text-end font-mono font-semibold" data-testid="register-total-nbv">
                      {money(data.totals.nbv)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}

          {data && (
            <div
              className={`rounded-md border p-3 text-sm space-y-1 ${Math.abs(data.glTie.difference) < 0.005 ? "border-[hsl(var(--chart-5)/0.4)] bg-[hsl(var(--chart-5)/0.06)]" : "border-[hsl(var(--chart-4)/0.4)] bg-[hsl(var(--chart-4)/0.08)]"}`}
              data-testid="register-tie"
              data-difference={data.glTie.difference}
            >
              <p className="font-medium flex items-center gap-2">
                {Math.abs(data.glTie.difference) < 0.005 ? <CheckCircle2 className="h-4 w-4 text-[hsl(var(--chart-5))]" /> : <AlertTriangle className="h-4 w-4 text-[hsl(var(--chart-4))]" />}
                {tr("tieTitle")}
              </p>
              <p className="flex justify-between gap-3 text-muted-foreground">
                <span>{tr("tieLedger")}</span>
                <span dir="ltr" className="font-mono">
                  {money(data.glTie.gl1290 - data.glTie.gl1240)}
                </span>
              </p>
              <p className="flex justify-between gap-3 text-muted-foreground">
                <span>{tr("tieRegister")}</span>
                <span dir="ltr" className="font-mono">
                  {money(data.totals.nbv)}
                </span>
              </p>
              <p className="text-xs">{Math.abs(data.glTie.difference) < 0.005 ? tr("tieOk") : tr("tieBad", { difference: money(data.glTie.difference) })}</p>
            </div>
          )}

          {data && data.glTie.needsCapitalization.length > 0 && (
            <div className="rounded-md border border-[hsl(var(--chart-4)/0.4)] p-3 text-sm space-y-1" data-testid="register-capitalization">
              <p className="font-medium">{tr("capTitle")}</p>
              <p className="text-xs text-muted-foreground">{tr("capBody")}</p>
              <ul className="text-xs list-disc ps-5">
                {data.glTie.needsCapitalization.map((a) => (
                  <li key={a.assetId} dir="auto">
                    {a.number ? `${a.number} ` : ""}
                    {a.name} ({tr("capCost", { cost: money(a.cost) })})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
