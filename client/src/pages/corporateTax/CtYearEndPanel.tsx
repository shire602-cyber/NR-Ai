import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Field, FormGrid } from "@/components/ui/form-layout";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MoneyCell } from "@/components/ui/money";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { loadFailure } from "./screenState";

interface ExternalReturn {
  id: string;
  taxPeriodStart: string;
  taxPeriodEnd: string;
  totalRevenue: number;
  lossCarriedForward: number;
  interestCarriedForward: number;
  filingReference: string | null;
}

interface DeferredTaxRow {
  id: string;
  as_of: string;
  closing_asset: string;
  closing_liability: string;
  status: string;
  entry_number: string | null;
}

/**
 * A4: corporate-tax year end. M13 — tax losses brought forward from returns filed outside
 * Muhasib (before go-live); M2 — the manual deferred-tax adjustment (closing DTA / DTL at 9%).
 * The year-end current-tax accrual is posted per return (Accrue action in the returns table).
 */
export function CtYearEndPanel({ companyId }: { companyId: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const extKey = [`/api/companies/${companyId}/corporate-tax/external-returns`];
  const dtKey = [`/api/companies/${companyId}/corporate-tax/deferred-tax`];
  const externalQuery = useQuery<ExternalReturn[]>({ queryKey: extKey });
  const deferredQuery = useQuery<DeferredTaxRow[]>({ queryKey: dtKey });
  const external = externalQuery.data ?? [];
  const deferred = deferredQuery.data ?? [];
  const queries = [externalQuery, deferredQuery];
  const paused = queries.some((q) => q.fetchStatus === "paused");
  const failures = (["initial", "refresh"] as const).flatMap((kind) => {
    const failed = queries.filter((q) => loadFailure(q) === kind);
    return failed.length ? [{ kind, failed }] : [];
  });
  const [ext, setExt] = useState({ start: "", end: "", revenue: "", loss: "", reference: "" });
  const [dt, setDt] = useState({ asOf: "", asset: "", liability: "", note: "" });
  const onError = (e: Error) =>
    toast({ variant: "destructive", title: t["corporateTax.saveFailed"], description: e.message });

  const addExternal = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/corporate-tax/external-returns`, {
        taxPeriodStart: ext.start,
        taxPeriodEnd: ext.end,
        totalRevenue: ext.revenue ? Number(ext.revenue) : undefined,
        lossCarriedForward: Number(ext.loss || 0),
        filingReference: ext.reference || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: extKey });
      setExt({ start: "", end: "", revenue: "", loss: "", reference: "" });
      toast({ title: t["corporateTax.externalSaved"] });
    },
    onError,
  });
  const removeExternal = useMutation({
    mutationFn: (id: string) =>
      apiRequest("DELETE", `/api/companies/${companyId}/corporate-tax/external-returns/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: extKey }),
    onError,
  });
  const postDeferred = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/corporate-tax/deferred-tax`, {
        asOf: dt.asOf,
        closingAsset: Number(dt.asset || 0),
        closingLiability: Number(dt.liability || 0),
        note: dt.note || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dtKey });
      setDt({ asOf: "", asset: "", liability: "", note: "" });
      toast({ title: t["corporateTax.deferredPosted"] });
    },
    onError,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t["corporateTax.yearEndTitle"]}</CardTitle>
        <CardDescription>{t["corporateTax.yearEndHint"]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        {paused && (
          <p role="status" className="text-sm text-muted-foreground">
            {t["corporateTax.yearEndPaused"]}
          </p>
        )}
        {failures.map(({ kind, failed }) => (
          <div
            key={kind}
            role={kind === "initial" ? "alert" : "status"}
            data-testid={kind === "initial" ? "ct-yearend-error" : "ct-yearend-refresh-error"}
            className={`flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm ${
              kind === "initial"
                ? "border-destructive/40 bg-destructive/10"
                : "border-warning/40 bg-warning/10"
            }`}
          >
            <span>
              {kind === "initial"
                ? t["corporateTax.yearEndLoadError"]
                : t["corporateTax.yearEndRefreshError"]}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => failed.forEach((q) => void q.refetch())}
              disabled={failed.every((q) => q.fetchStatus === "fetching")}
            >
              {t["components.errorTryAgain"]}
            </Button>
          </div>
        ))}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">{t["corporateTax.externalTitle"]}</h3>
          <p className="text-xs text-muted-foreground">{t["corporateTax.externalHint"]}</p>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (ext.start && ext.end && !addExternal.isPending) addExternal.mutate();
            }}
          >
            <FormGrid>
              <Field id="ct-ext-start" label={t["corporateTax.periodStart"]} required>
                <DatePicker value={ext.start} onChange={(v) => setExt({ ...ext, start: v })} />
              </Field>
              <Field id="ct-ext-end" label={t["corporateTax.periodEnd"]} required>
                <DatePicker value={ext.end} onChange={(v) => setExt({ ...ext, end: v })} />
              </Field>
              <Field id="ct-ext-loss" label={t["corporateTax.externalLoss"]} required>
                <Input
                  inputMode="decimal"
                  dir="ltr"
                  value={ext.loss}
                  onChange={(e) => setExt({ ...ext, loss: e.target.value })}
                />
              </Field>
              <Field id="ct-ext-revenue" label={t["corporateTax.externalRevenue"]}>
                <Input
                  inputMode="decimal"
                  dir="ltr"
                  value={ext.revenue}
                  onChange={(e) => setExt({ ...ext, revenue: e.target.value })}
                />
              </Field>
              <Field id="ct-ext-ref" label={t["corporateTax.filingReference"]}>
                <Input
                  dir="auto"
                  value={ext.reference}
                  onChange={(e) => setExt({ ...ext, reference: e.target.value })}
                />
              </Field>
            </FormGrid>
            <Button type="submit" disabled={!ext.start || !ext.end || addExternal.isPending}>
              {t["corporateTax.externalAdd"]}
            </Button>
          </form>
          {external.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t["corporateTax.period"]}</TableHead>
                    <TableHead data-numeric>{t["corporateTax.externalLoss"]}</TableHead>
                    <TableHead>{t["corporateTax.filingReference"]}</TableHead>
                    <TableHead data-numeric>{t["corporateTax.actions"]}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {external.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell dir="ltr" data-nowrap>
                        {r.taxPeriodStart} – {r.taxPeriodEnd}
                      </TableCell>
                      <MoneyCell amount={r.lossCarriedForward} currency="AED" />
                      <TableCell dir="auto">{r.filingReference ?? "—"}</TableCell>
                      <TableCell data-numeric>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeExternal.mutate(r.id)}
                          disabled={removeExternal.isPending}
                        >
                          {t["corporateTax.remove"]}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">{t["corporateTax.deferredTitle"]}</h3>
          <p className="text-xs text-muted-foreground">{t["corporateTax.deferredHint"]}</p>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (dt.asOf && !postDeferred.isPending) postDeferred.mutate();
            }}
          >
            <FormGrid>
              <Field id="ct-dt-asof" label={t["corporateTax.deferredAsOf"]} required>
                <DatePicker value={dt.asOf} onChange={(v) => setDt({ ...dt, asOf: v })} />
              </Field>
              <Field id="ct-dt-asset" label={t["corporateTax.deferredAsset"]}>
                <Input
                  inputMode="decimal"
                  dir="ltr"
                  value={dt.asset}
                  onChange={(e) => setDt({ ...dt, asset: e.target.value })}
                />
              </Field>
              <Field id="ct-dt-liability" label={t["corporateTax.deferredLiability"]}>
                <Input
                  inputMode="decimal"
                  dir="ltr"
                  value={dt.liability}
                  onChange={(e) => setDt({ ...dt, liability: e.target.value })}
                />
              </Field>
              <Field id="ct-dt-note" label={t["corporateTax.notes"]}>
                <Input
                  dir="auto"
                  value={dt.note}
                  onChange={(e) => setDt({ ...dt, note: e.target.value })}
                />
              </Field>
            </FormGrid>
            <Button type="submit" disabled={!dt.asOf || postDeferred.isPending}>
              {t["corporateTax.deferredPost"]}
            </Button>
          </form>
          {deferred.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t["corporateTax.deferredAsOf"]}</TableHead>
                    <TableHead data-numeric>{t["corporateTax.deferredAsset"]}</TableHead>
                    <TableHead data-numeric>{t["corporateTax.deferredLiability"]}</TableHead>
                    <TableHead>{t["corporateTax.status"]}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deferred.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell dir="ltr">{String(r.as_of).slice(0, 10)}</TableCell>
                      <MoneyCell amount={Number(r.closing_asset)} currency="AED" />
                      <MoneyCell amount={Number(r.closing_liability)} currency="AED" />
                      <TableCell>
                        {formatMessage(t["corporateTax.deferredEntry"] ?? "{entry}", {
                          entry: r.entry_number ?? "—",
                          status:
                            r.status === "reversed"
                              ? t["corporateTax.deferredReversed"]
                              : t["corporateTax.deferredPostedShort"],
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
