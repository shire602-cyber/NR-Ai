/**
 * WQ3 (9.13): Settings > Tax rates (read-only). Each VAT treatment, its rate and the VAT 201
 * boxes it feeds, from GET /api/companies/:id/tax-rates, which reads the VAT engine's own box
 * functions (server/tax/vat-box-map.ts). Nothing here is a second copy of the box rules.
 */
import { useQuery } from "@tanstack/react-query";
import { SettingsLayout } from "@/components/layout/SettingsLayout";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardListSkeleton } from "@/components/ui/loading-skeletons";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadErrorState } from "@/components/ui/load-error-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";

export interface VatBoxRef {
  box: string;
  part: "amount" | "vat";
  key: string;
}

export interface VatTreatmentRow {
  side: "sales" | "purchases";
  treatment: string;
  rate: number;
  boxes: VatBoxRef[];
}

export interface VatBoxMapResponse {
  standardRate: number;
  emirate: string | null;
  rows: VatTreatmentRow[];
}

const TREATMENT_KEY: Record<string, string> = {
  standard: "settingsPages.taxRates.standard",
  zero_rated: "settingsPages.taxRates.zeroRated",
  exempt: "settingsPages.taxRates.exempt",
  out_of_scope: "settingsPages.taxRates.outOfScope",
  reverse_charge: "settingsPages.taxRates.reverseCharge",
  import: "settingsPages.taxRates.import",
  not_reportable: "settingsPages.taxRates.notReportable",
};

function percent(rate: number): string {
  return `${Math.round(rate * 10000) / 100}%`;
}

/** The boxes of one treatment, grouped: "Box 1b amount, VAT". */
function BoxList({ boxes }: { boxes: VatBoxRef[] }) {
  const { t } = useTranslation();
  if (!boxes.length) {
    return <span className="text-muted-foreground">{t["settingsPages.taxRates.notReported"]}</span>;
  }
  const byBox = new Map<string, Array<VatBoxRef["part"]>>();
  for (const b of boxes) byBox.set(b.box, [...(byBox.get(b.box) ?? []), b.part]);
  return (
    <span className="flex flex-wrap gap-1.5">
      {[...byBox.entries()].map(([box, parts]) => (
        <Badge key={box} variant="neutral" className="gap-1 font-normal" data-testid={`box-${box}`}>
          <span className="font-medium tabular-nums">
            {/* Isolate the box id so "1b" stays one left-to-right token inside Arabic text. */}
            {formatMessage(t["settingsPages.taxRates.box"], { box: `\u2066${box}\u2069` })}
          </span>
          <span className="text-muted-foreground">
            {parts
              .map((p) =>
                p === "vat"
                  ? t["settingsPages.taxRates.partVat"]
                  : t["settingsPages.taxRates.partAmount"]
              )
              .join(" · ")}
          </span>
        </Badge>
      ))}
    </span>
  );
}

export function TaxRatesView({ data }: { data: VatBoxMapResponse }) {
  const { t } = useTranslation();
  const tr = t as Record<string, string>;
  const emirateLabel = data.emirate
    ? (tr[`pageLabels.companySettings.emirate.${data.emirate}`] ?? data.emirate)
    : null;
  if (!data.rows.length) {
    return (
      <EmptyState
        size="md"
        title={t["settingsPages.taxRates.empty"]}
        description={t["settingsPages.taxRates.emptyHint"]}
        testId="tax-rates-empty"
      />
    );
  }
  return (
    <div className="space-y-6">
      {(["sales", "purchases"] as const).map((side) => (
        <SectionCard
          key={side}
          title={
            side === "sales"
              ? t["settingsPages.taxRates.sales"]
              : t["settingsPages.taxRates.purchases"]
          }
          description={
            side === "sales"
              ? emirateLabel
                ? formatMessage(t["settingsPages.taxRates.emirateNote"], { emirate: emirateLabel })
                : t["settingsPages.taxRates.emirateMissing"]
              : undefined
          }
          flush
          testId={`tax-rates-${side}`}
        >
          {/* F2: below md the boxes sit under the treatment (no third column to run off the
              card); `mobile-fit` opts out of the phone-wide 600 px table minimum. */}
          <Table className="mobile-fit">
            <TableHeader>
              <TableRow>
                <TableHead>{t["settingsPages.taxRates.treatment"]}</TableHead>
                <TableHead data-numeric="">{t["settingsPages.taxRates.rate"]}</TableHead>
                <TableHead className="w-1/2 max-md:hidden">
                  {t["settingsPages.taxRates.boxes"]}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows
                .filter((r) => r.side === side)
                .map((r) => (
                  <TableRow
                    key={`${side}-${r.treatment}`}
                    data-testid={`tax-rate-${side}-${r.treatment}`}
                  >
                    <TableCell className="font-medium">
                      {tr[TREATMENT_KEY[r.treatment] ?? ""] ??
                        t["settingsPages.taxRates.otherTreatment"]}
                      <span
                        className="mt-1.5 block font-normal md:hidden"
                        data-testid="boxes-stacked"
                      >
                        <span className="sr-only">{t["settingsPages.taxRates.boxes"]}: </span>
                        <BoxList boxes={r.boxes} />
                      </span>
                    </TableCell>
                    <TableCell data-numeric="" className="tabular-nums" dir="ltr">
                      {percent(r.rate)}
                      {side === "purchases" &&
                        (r.treatment === "reverse_charge" || r.treatment === "import") && (
                          <span className="ms-1 text-caption text-muted-foreground">
                            ({t["settingsPages.taxRates.selfAccounted"]})
                          </span>
                        )}
                    </TableCell>
                    <TableCell className="max-md:hidden">
                      <BoxList boxes={r.boxes} />
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </SectionCard>
      ))}
    </div>
  );
}

/** Neutral state while a first load is paused (offline, or the tab is not in focus). */
function WaitingState() {
  const { t } = useTranslation();
  return (
    <div role="status" data-testid="tax-rates-waiting">
      <EmptyState
        size="md"
        title={t["settingsPages.taxRates.waiting"]}
        description={t["settingsPages.taxRates.waitingHint"]}
      />
    </div>
  );
}

export default function TaxRates() {
  const { t } = useTranslation();
  const {
    companyId,
    isLoading: companyLoading,
    isPaused: companyPaused,
    error: companyError,
    hasNoCompanies,
    refetch: refetchCompany,
  } = useDefaultCompany();
  const { data, isLoadingError, isRefetchError, fetchStatus, error, refetch } =
    useQuery<VatBoxMapResponse>({
      queryKey: ["/api/companies", companyId, "tax-rates"],
      enabled: !!companyId,
    });
  const ratesPaused = !!companyId && !data && fetchStatus === "paused";
  const retry = () => void refetch();
  let body;
  if (companyLoading) {
    body = <CardListSkeleton count={2} />;
  } else if (companyPaused) {
    body = <WaitingState />;
  } else if (!companyId && hasNoCompanies) {
    body = (
      <EmptyState
        size="md"
        title={t["settingsPages.taxRates.noCompany"]}
        testId="tax-rates-no-company"
      />
    );
  } else if (data) {
    // Cached rows stay on screen when a refresh fails; the failure is shown inline.
    body = (
      <div className="space-y-4">
        {isRefetchError && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-small"
            data-testid="tax-rates-refresh-error"
          >
            <span>{t["settingsPages.taxRates.refreshFailed"]}</span>
            <Button type="button" variant="outline" size="sm" onClick={retry}>
              {t["firm.retry"]}
            </Button>
          </div>
        )}
        <TaxRatesView data={data} />
      </div>
    );
  } else if (ratesPaused) {
    body = <WaitingState />;
  } else if (isLoadingError || (!companyId && !!companyError)) {
    // A rates failure retries the rates query; a company-list failure retries the company query
    // (the rates query is disabled until a company id exists).
    body = (
      <LoadErrorState
        error={companyId ? error : companyError}
        onRetry={companyId ? retry : refetchCompany}
        title={t["settingsPages.taxRates.loadFailed"]}
        testId="tax-rates-load-error"
      />
    );
  } else {
    // First rates load in flight (or the company id is about to resolve).
    body = <CardListSkeleton count={2} />;
  }
  return (
    <SettingsLayout>
      <div className="max-w-narrow space-y-6" data-testid="page-tax-rates">
        <PageHeader
          title={t["settingsPages.taxRates.title"]}
          description={t["settingsPages.taxRates.description"]}
        />
        <p className="text-small text-muted-foreground">{t["settingsPages.taxRates.readOnly"]}</p>
        {body}
      </div>
    </SettingsLayout>
  );
}
