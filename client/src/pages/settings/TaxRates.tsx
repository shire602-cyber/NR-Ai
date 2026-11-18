/**
 * WQ3 (9.13): Settings > Tax rates (read-only). Each VAT treatment, its rate and the VAT 201
 * boxes it feeds, from GET /api/companies/:id/tax-rates, which reads the VAT engine's own box
 * functions (server/tax/vat-box-map.ts). Nothing here is a second copy of the box rules.
 */
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { SettingsLayout } from "@/components/layout/SettingsLayout";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { Badge } from "@/components/ui/badge";
import { CardListSkeleton } from "@/components/ui/loading-skeletons";
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
  jurisdiction: "AE" | "SA";
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
            {formatMessage(t["settingsPages.taxRates.box"], { box })}
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
  return (
    <div className="space-y-6">
      {data.jurisdiction === "SA" && (
        <p className="flex items-start gap-2 rounded-lg bg-info-subtle p-3 text-small" role="note">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {t["settingsPages.taxRates.ksaNote"]}
        </p>
      )}
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t["settingsPages.taxRates.treatment"]}</TableHead>
                <TableHead data-numeric="">{t["settingsPages.taxRates.rate"]}</TableHead>
                <TableHead className="w-1/2">{t["settingsPages.taxRates.boxes"]}</TableHead>
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
                      {tr[TREATMENT_KEY[r.treatment] ?? ""] ?? r.treatment}
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
                    <TableCell>
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

export default function TaxRates() {
  const { t } = useTranslation();
  const { companyId } = useDefaultCompany();
  const { data, isLoading, isError } = useQuery<VatBoxMapResponse>({
    queryKey: ["/api/companies", companyId, "tax-rates"],
    enabled: !!companyId,
  });
  return (
    <SettingsLayout>
      <div className="max-w-narrow space-y-6" data-testid="page-tax-rates">
        <PageHeader
          title={t["settingsPages.taxRates.title"]}
          description={t["settingsPages.taxRates.description"]}
        />
        <p className="text-small text-muted-foreground">{t["settingsPages.taxRates.readOnly"]}</p>
        {isLoading ? (
          <CardListSkeleton count={2} />
        ) : isError || !data ? (
          <p className="text-small text-danger" role="alert">
            {t["settingsPages.taxRates.loadFailed"]}
          </p>
        ) : (
          <TaxRatesView data={data} />
        )}
      </div>
    </SettingsLayout>
  );
}
