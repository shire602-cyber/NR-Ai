/**
 * Group consolidation (W5-C: R14-18, R12-12). Reads the server-side management consolidation
 * (GET /api/company-groups/:groupId/consolidated-statements) — eliminations, translation, CTA
 * and NCI are computed on the server; this page only renders them.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTranslation } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { apiUrl } from "@/lib/api";
import { getAuthHeaders } from "@/lib/auth";
import { formatNumber } from "@/lib/format";
import { AlertTriangle, Download, Save } from "lucide-react";

interface GroupSummary {
  id: string;
  name: string;
  reportingCurrency: string;
}

interface Line {
  key: string;
  accountCode: string;
  accountName: string;
  accountNameAr: string | null;
  byEntity: Record<string, number>;
  eliminations: number;
  total: number;
}
interface Block {
  total: number;
  lines: Line[];
}
interface Entity {
  companyId: string;
  name: string;
  functionalCurrency: string;
  ownershipPercent: number;
  included: boolean;
  excludedReason?: string;
  translated?: { netProfit: number; netAssets: number; cta: number };
}
interface Elimination {
  id: string | null;
  kind: "rule" | "manual";
  label: string;
  date: string;
  matched?: number;
  unmatchedDifference?: number;
  lines: Array<{
    companyName: string;
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
  }>;
}
interface RateUsed {
  rate: string;
  date: string;
  source: string;
}
interface Statements {
  label: { en: string; ar: string };
  corporateTaxNote: { en: string; ar: string };
  group: { id: string; name: string; reportingCurrency: string };
  period: { from: string; to: string };
  entities: Entity[];
  eliminations: Elimination[];
  translation: {
    rates: Array<{
      companyId: string;
      currency: string;
      closing: RateUsed;
      average: RateUsed;
      retainedEarnings: RateUsed;
      historical: Array<RateUsed>;
    }>;
    cta: { total: number };
  };
  consolidated: {
    profitAndLoss: {
      sections: Record<string, Block>;
      netProfit: number;
      attributableToOwners: number;
      attributableToNci: number;
    };
    balanceSheet: {
      assets: { current: Block; nonCurrent: Block; total: number };
      liabilities: { current: Block; nonCurrent: Block; total: number };
      equity: {
        capital: Block;
        retainedEarningsBroughtForward: number;
        currentYearEarnings: number;
        cumulativeTranslationAdjustment: number;
        total: number;
        attributableToOwners: number;
        nonControllingInterest: number;
      };
      totalAssets: number;
      totalLiabilities: number;
      totalEquity: number;
      isBalanced: boolean;
      difference: number;
    };
  };
  warnings: string[];
}

const today = () => new Date().toISOString().slice(0, 10);

export default function Consolidation() {
  const { t, locale } = useTranslation();
  const tr = (k: string) => (t as Record<string, string>)[`consolidation.${k}`] ?? k;
  const { toast } = useToast();
  const [pickedGroup, setGroupId] = useState<string>("");
  const [from, setFrom] = useState(`${today().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today());
  const [period, setPeriod] = useState({ from, to });

  const { data: groups, isLoading: loadingGroups } = useQuery<GroupSummary[]>({
    queryKey: ["/api/company-groups"],
  });
  const urlGroup = new URLSearchParams(window.location.search).get("group");
  const groupId =
    pickedGroup || groups?.find((g) => g.id === urlGroup)?.id || groups?.[0]?.id || "";

  const statementsUrl = groupId
    ? `/api/company-groups/${groupId}/consolidated-statements?from=${period.from}&to=${period.to}`
    : "";
  const { data, isLoading, error } = useQuery<Statements>({
    queryKey: [statementsUrl],
    enabled: !!groupId,
  });

  const recordRun = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/company-groups/${groupId}/consolidation-runs`, period),
    onSuccess: () => toast({ title: tr("recorded") }),
    onError: (e: unknown) =>
      toast({
        title: tr("failed"),
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      }),
  });

  const exportXlsx = async () => {
    try {
      const res = await fetch(
        apiUrl(
          `/api/company-groups/${groupId}/consolidated-statements/export?from=${period.from}&to=${period.to}&format=xlsx`
        ),
        { headers: { ...getAuthHeaders() }, credentials: "include" }
      );
      if (!res.ok) throw new Error(`${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `management-consolidation-${period.from}-${period.to}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({
        title: tr("loadFailed"),
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    }
  };

  const included = useMemo(() => (data?.entities ?? []).filter((e) => e.included), [data]);
  const money = (n: number | undefined) => formatNumber(n ?? 0, locale);
  const accountName = (l: Line) =>
    locale === "ar" && l.accountNameAr ? l.accountNameAr : l.accountName;

  const blockRows = (title: string, b: Block | undefined) => (
    <>
      <TableRow className="bg-muted/40">
        <TableCell colSpan={included.length + 3} className="font-medium">
          {title}
        </TableCell>
      </TableRow>
      {(b?.lines ?? []).map((l) => (
        <TableRow key={l.key}>
          <TableCell>
            <span className="text-muted-foreground me-2">{l.accountCode}</span>
            {accountName(l)}
          </TableCell>
          {included.map((e) => (
            <TableCell key={e.companyId} className="text-end tabular-nums">
              {money(l.byEntity[e.companyId])}
            </TableCell>
          ))}
          <TableCell className="text-end tabular-nums">{money(l.eliminations)}</TableCell>
          <TableCell className="text-end tabular-nums font-medium">{money(l.total)}</TableCell>
        </TableRow>
      ))}
    </>
  );
  const totalRow = (title: string, value: number | undefined, strong = false) => (
    <TableRow>
      <TableCell colSpan={included.length + 2} className={strong ? "font-semibold" : ""}>
        {title}
      </TableCell>
      <TableCell className={`text-end tabular-nums ${strong ? "font-semibold" : ""}`}>
        {money(value)}
      </TableCell>
    </TableRow>
  );
  const head = (
    <TableHeader>
      <TableRow>
        <TableHead>{tr("account")}</TableHead>
        {included.map((e) => (
          <TableHead key={e.companyId} className="text-end">
            {e.name}
          </TableHead>
        ))}
        <TableHead className="text-end">{tr("eliminationsColumn")}</TableHead>
        <TableHead className="text-end">{tr("consolidated")}</TableHead>
      </TableRow>
    </TableHeader>
  );

  const pl = data?.consolidated.profitAndLoss;
  const bs = data?.consolidated.balanceSheet;

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        eyebrow={tr("eyebrow")}
        title={tr("consolidationTitle")}
        description={tr("consolidationDescription")}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/company-groups">{tr("manageGroups")}</Link>
            </Button>
            <Button variant="outline" onClick={exportXlsx} disabled={!data}>
              <Download className="h-4 w-4 me-2" />
              {tr("export")}
            </Button>
            <Button onClick={() => recordRun.mutate()} disabled={!data || recordRun.isPending}>
              <Save className="h-4 w-4 me-2" />
              {tr("record")}
            </Button>
          </>
        }
      />

      <div
        className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm"
        data-testid="banner-management-consolidation"
      >
        <p className="font-medium">{tr("managementLabel")}</p>
        <p className="mt-1">{tr("ctNote")}</p>
      </div>

      <Card>
        <CardContent className="pt-6 grid gap-4 sm:grid-cols-4 items-end">
          <div className="space-y-1">
            <Label>{tr("selectGroup")}</Label>
            {loadingGroups ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Select value={groupId} onValueChange={setGroupId}>
                <SelectTrigger data-testid="select-group">
                  <SelectValue placeholder={tr("selectGroup")} />
                </SelectTrigger>
                <SelectContent>
                  {(groups ?? []).map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name} ({g.reportingCurrency})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="cons-from">{tr("from")}</Label>
            <Input
              id="cons-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cons-to">{tr("to")}</Label>
            <Input id="cons-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button onClick={() => setPeriod({ from, to })} disabled={!groupId}>
            {tr("run")}
          </Button>
        </CardContent>
      </Card>

      {groups && groups.length === 0 && (
        <p className="text-sm text-muted-foreground">{tr("noGroups")}</p>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {tr("loadFailed")}: {error instanceof Error ? error.message : ""}
        </p>
      )}
      {isLoading && groupId && <Skeleton className="h-64 w-full" />}

      {data && pl && bs && (
        <>
          {data.warnings.length > 0 && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              <p className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4" />
                {tr("warnings")}
              </p>
              <ul className="mt-1 list-disc ps-5">
                {data.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{tr("entities")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {data.entities.map((e) => (
                <Badge key={e.companyId} variant={e.included ? "secondary" : "outline"}>
                  {e.name} · {e.functionalCurrency} · {e.ownershipPercent}%
                  {!e.included ? ` · ${tr("excluded")}` : ""}
                </Badge>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{tr("profitAndLoss")}</CardTitle>
              <CardDescription>
                {data.period.from} – {data.period.to} · {data.group.reportingCurrency}
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                {head}
                <TableBody>
                  {blockRows(tr("revenue"), pl.sections.revenue)}
                  {blockRows(tr("costOfSales"), pl.sections.costOfSales)}
                  {blockRows(tr("operatingExpenses"), pl.sections.operatingExpenses)}
                  {blockRows(tr("otherIncome"), pl.sections.otherIncome)}
                  {blockRows(tr("otherExpenses"), pl.sections.otherExpenses)}
                  {totalRow(tr("netProfit"), pl.netProfit, true)}
                  {totalRow(tr("attributableOwners"), pl.attributableToOwners)}
                  {totalRow(tr("attributableNci"), pl.attributableToNci)}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {tr("balanceSheet")}
                <Badge variant={bs.isBalanced ? "secondary" : "destructive"}>
                  {bs.isBalanced ? tr("balanced") : `${tr("outOfBalance")} ${money(bs.difference)}`}
                </Badge>
              </CardTitle>
              <CardDescription>
                {data.period.to} · {data.group.reportingCurrency}
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                {head}
                <TableBody>
                  {blockRows(tr("currentAssets"), bs.assets.current)}
                  {blockRows(tr("nonCurrentAssets"), bs.assets.nonCurrent)}
                  {totalRow(tr("totalAssets"), bs.totalAssets, true)}
                  {blockRows(tr("currentLiabilities"), bs.liabilities.current)}
                  {blockRows(tr("nonCurrentLiabilities"), bs.liabilities.nonCurrent)}
                  {totalRow(tr("totalLiabilities"), bs.totalLiabilities, true)}
                  {blockRows(tr("capital"), bs.equity.capital)}
                  {totalRow(tr("retainedEarnings"), bs.equity.retainedEarningsBroughtForward)}
                  {totalRow(tr("currentYearEarnings"), bs.equity.currentYearEarnings)}
                  {totalRow(tr("cta"), bs.equity.cumulativeTranslationAdjustment)}
                  {totalRow(tr("totalEquity"), bs.totalEquity, true)}
                  {totalRow(tr("attributableOwners"), bs.equity.attributableToOwners)}
                  {totalRow(tr("nci"), bs.equity.nonControllingInterest)}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{tr("eliminations")}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr("kind")}</TableHead>
                    <TableHead>{tr("label")}</TableHead>
                    <TableHead>{tr("company")}</TableHead>
                    <TableHead>{tr("account")}</TableHead>
                    <TableHead className="text-end">{tr("debit")}</TableHead>
                    <TableHead className="text-end">{tr("credit")}</TableHead>
                    <TableHead className="text-end">{tr("unmatched")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.eliminations.flatMap((e, i) =>
                    (e.lines.length ? e.lines : [null]).map((l, j) => (
                      <TableRow key={`${e.id ?? e.label}-${i}-${j}`}>
                        <TableCell>{j === 0 ? tr(e.kind) : ""}</TableCell>
                        <TableCell>{j === 0 ? e.label : ""}</TableCell>
                        <TableCell>{l?.companyName ?? ""}</TableCell>
                        <TableCell>{l ? `${l.accountCode} ${l.accountName}` : ""}</TableCell>
                        <TableCell className="text-end tabular-nums">
                          {l ? money(l.debit) : ""}
                        </TableCell>
                        <TableCell className="text-end tabular-nums">
                          {l ? money(l.credit) : ""}
                        </TableCell>
                        <TableCell className="text-end tabular-nums">
                          {j === 0 && e.kind === "rule" ? money(e.unmatchedDifference) : ""}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {data.translation.rates.some((r) => r.currency !== data.group.reportingCurrency) && (
            <Card>
              <CardHeader>
                <CardTitle>{tr("translation")}</CardTitle>
                <CardDescription>
                  {tr("cta")}: {money(data.translation.cta.total)} {data.group.reportingCurrency}
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tr("company")}</TableHead>
                      <TableHead>{tr("functionalCurrency")}</TableHead>
                      <TableHead>{tr("closingRate")}</TableHead>
                      <TableHead>{tr("averageRate")}</TableHead>
                      <TableHead>{tr("reRate")}</TableHead>
                      <TableHead>{tr("historicalRates")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.translation.rates
                      .filter((r) => r.currency !== data.group.reportingCurrency)
                      .map((r) => (
                        <TableRow key={r.companyId}>
                          <TableCell>
                            {data.entities.find((e) => e.companyId === r.companyId)?.name}
                          </TableCell>
                          <TableCell>{r.currency}</TableCell>
                          <TableCell>
                            {r.closing.rate} ({r.closing.date})
                          </TableCell>
                          <TableCell>
                            {r.average.rate} ({r.average.date})
                          </TableCell>
                          <TableCell>{r.retainedEarnings.rate}</TableCell>
                          <TableCell>
                            {r.historical.map((x) => `${x.date}: ${x.rate}`).join(", ")}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
