import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { T } from "@/components/layout/T";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
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
import { useToast } from "@/hooks/use-toast";
import { formatMessage, translateNow, useTranslation } from "@/lib/i18n";
import { apiRequest } from "@/lib/queryClient";
import type { ClientCompany } from "./EmailIntake";

interface EvidenceGap {
  bankTransactionId: string;
  date: string;
  amount: number;
  direction: "inflow" | "outflow";
  kind: "missing_purchase_evidence" | "missing_sales_evidence";
  description: string;
}
interface CompletenessResult {
  summary: {
    totalLines: number;
    matchedLines: number;
    unmatchedLines: number;
    coverageRatio: number;
    unmatchedOutflowValue: number;
    unmatchedInflowValue: number;
    gapCount: number;
  };
  gaps: EvidenceGap[];
}

const fmtAed = (n: number) =>
  `AED ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function EmailIntakeCompletenessTab({ clients }: { clients: ClientCompany[] }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [companyId, setCompanyId] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [result, setResult] = useState<CompletenessResult | null>(null);

  const canRun = companyId && periodStart && periodEnd;

  const runMutation = useMutation({
    mutationFn: () =>
      apiRequest(
        "GET",
        `/api/firm/email-intake/completeness/${companyId}?periodStart=${periodStart}&periodEnd=${periodEnd}`
      ),
    onSuccess: (data: CompletenessResult) => setResult(data),
    onError: (e: any) =>
      toast({
        title: translateNow("toasts.couldNotLoad"),
        description: e.message,
        variant: "destructive",
      }),
  });

  const chaseMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/firm/email-intake/completeness/${companyId}/chase`, {
        periodStart,
        periodEnd,
      }),
    onSuccess: (r: { created: number; skipped: number }) =>
      toast({
        title: translateNow("toasts.chaseRequestsRaised"),
        description: formatMessage(translateNow("toasts.createdAlreadyChased"), {
          created: r.created,
          skipped: r.skipped,
        }),
      }),
    onError: (e: any) =>
      toast({
        title: translateNow("toasts.couldNotRaiseChases"),
        description: e.message,
        variant: "destructive",
      }),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <T k="pages.checkAPeriodForMissingDocuments" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label>
                <T k="pages.client" />
              </Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger
                  aria-label={t["pages.client"]}
                  data-testid="select-completeness-client"
                >
                  <SelectValue placeholder={t["bulkOperations.selectClient"]} />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>
                <T k="pages.periodStart2" />
              </Label>
              <DatePicker value={periodStart} onChange={(v) => setPeriodStart(v)} />
            </div>
            <div className="space-y-1.5">
              <Label>
                <T k="pages.periodEnd2" />
              </Label>
              <DatePicker value={periodEnd} onChange={(v) => setPeriodEnd(v)} />
            </div>
            <div className="flex items-end">
              <Button
                onClick={() => runMutation.mutate()}
                disabled={!canRun || runMutation.isPending}
              >
                <T k="pages.runCheck" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              {result.summary.gapCount === 0 ? (
                <CheckCircle2 className="h-5 w-5 text-success" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-warning" />
              )}
              {formatMessage(t["firmOps.intakeCoverage"], {
                percent: Math.round(result.summary.coverageRatio * 100),
                count: result.summary.gapCount,
              })}
            </CardTitle>
            {result.summary.gapCount > 0 && (
              <Button
                onClick={() => chaseMutation.mutate()}
                disabled={chaseMutation.isPending}
                data-testid="button-chase"
              >
                <T k="pages.createChaseRequests" />
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <Stat label={t["emailIntake.bankLines"]} value={String(result.summary.totalLines)} />
              <Stat
                label={t["consolidation.matched"]}
                value={String(result.summary.matchedLines)}
              />
              <Stat
                label={t["emailIntake.missingPurchases"]}
                value={fmtAed(result.summary.unmatchedOutflowValue)}
              />
              <Stat
                label={t["emailIntake.missingSales"]}
                value={fmtAed(result.summary.unmatchedInflowValue)}
              />
            </div>

            {result.gaps.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t["emailIntake.everyBankLineInThis"]}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t["firmOps.colDate"]}</TableHead>
                    <TableHead>
                      <T k="pages.description" />
                    </TableHead>
                    <TableHead>{t["firmOps.colType"]}</TableHead>
                    <TableHead data-numeric>
                      <T k="pages.amount" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.gaps.map((g) => (
                    <TableRow key={g.bankTransactionId}>
                      <TableCell>{g.date.slice(0, 10)}</TableCell>
                      <TableCell className="max-w-[320px] truncate">
                        {g.description || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={g.direction === "outflow" ? "secondary" : "outline"}>
                          {g.kind === "missing_purchase_evidence"
                            ? t["firmOps.intakePurchase"]
                            : t["firmOps.intakeSales"]}
                        </Badge>
                      </TableCell>
                      <TableCell data-numeric className=" font-medium">
                        {fmtAed(g.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}
