import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { downloadPdf } from "@/lib/download-pdf";
import { formatCurrency } from "@/lib/format";
import { messages as common } from "@/components/banking/BankingCommon.i18n";
import { bankingErrorText } from "@/components/banking/banking-common";
import type { DepreciationScheduleRow } from "@/lib/banking-api-types";
import { messages } from "./DepreciationScheduleTab.i18n";

const PAGE = 120;
const monthLabel = (year: number, month: number, locale: string) =>
  new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));

/** Posted depreciation and, optionally, the months still to come until each asset reaches its salvage value. */
export function DepreciationScheduleTab({ companyId }: { companyId: string }) {
  const tr = messages.useT();
  const trc = common.useT();
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [project, setProject] = useState(true);
  const [limit, setLimit] = useState(PAGE);

  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (project) params.set("projectToEnd", "true");
  const qs = params.toString();
  const path = `/api/companies/${companyId}/fixed-assets/depreciation-schedule${qs ? `?${qs}` : ""}`;

  const { data, isLoading, isError } = useQuery<DepreciationScheduleRow[]>({ queryKey: [path], enabled: !!companyId });
  const csv = useMutation({
    mutationFn: () => downloadPdf(`${path}${qs ? "&" : "?"}format=csv`, "depreciation-schedule.csv"),
    onError: (err: unknown) => toast({ variant: "destructive", title: tr("csvFailed"), description: bankingErrorText(trc, err, locale) }),
  });
  const money = (n: number) => formatCurrency(n, "AED", locale);
  const rows = data ?? [];

  return (
    <div className="space-y-4" data-testid="depreciation-schedule">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>{tr("scheduleTitle")}</CardTitle>
              <CardDescription>{tr("scheduleDescription")}</CardDescription>
            </div>
            <div className="flex items-end gap-3 flex-wrap">
              <div className="space-y-1">
                <Label htmlFor="sched-from">{tr("from")}</Label>
                <Input id="sched-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} dir="ltr" className="text-start w-40" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sched-to">{tr("to")}</Label>
                <Input id="sched-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} dir="ltr" className="text-start w-40" />
              </div>
              <div className="flex items-center gap-2 pb-2">
                <Switch id="sched-project" checked={project} onCheckedChange={setProject} data-testid="switch-project" />
                <Label htmlFor="sched-project" className="text-sm">
                  {tr("projectToEnd")}
                </Label>
              </div>
              <Button variant="outline" onClick={() => csv.mutate()} disabled={csv.isPending} data-testid="button-schedule-csv">
                {csv.isPending ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <Download className="h-4 w-4 me-2" />}
                {tr("downloadCsv")}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : isError ? (
            <p className="text-sm text-destructive">{tr("scheduleLoadFailed")}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tr("scheduleEmpty")}</p>
          ) : (
            <>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tr("colName")}</TableHead>
                      <TableHead>{tr("colPeriod")}</TableHead>
                      <TableHead className="text-end">{tr("colAmount")}</TableHead>
                      <TableHead className="text-end">{tr("colAccum")}</TableHead>
                      <TableHead className="text-end">{tr("colBook")}</TableHead>
                      <TableHead>{tr("colStatus")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, limit).map((r, i) => (
                      <TableRow key={`${r.assetId}-${r.year}-${r.month}-${i}`} data-testid={r.projected ? "schedule-row-projected" : "schedule-row-posted"} className={r.projected ? "text-muted-foreground" : ""}>
                        <TableCell className="font-medium" dir="auto">
                          {r.number ? `${r.number} ` : ""}
                          {r.name}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{monthLabel(r.year, r.month, locale)}</TableCell>
                        <TableCell dir="ltr" className="text-end font-mono">
                          {money(r.amount)}
                        </TableCell>
                        <TableCell dir="ltr" className="text-end font-mono">
                          {money(r.accumulated)}
                        </TableCell>
                        <TableCell dir="ltr" className="text-end font-mono">
                          {money(r.nbv)}
                        </TableCell>
                        <TableCell>{r.projected ? <StatusBadge tone="neutral">{tr("projected")}</StatusBadge> : <StatusBadge tone="success">{tr("posted")}</StatusBadge>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {rows.length > limit && (
                <div className="flex justify-center pt-3">
                  <Button variant="outline" size="sm" onClick={() => setLimit((n) => n + PAGE)}>
                    {tr("scheduleMore", { count: rows.length - limit })}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
