import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/ui/money";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { apiRequest } from "@/lib/queryClient";

export interface VatPreviewBoxes {
  box12TotalDueTax?: number;
  box13RecoverableTax?: number;
  box14PayableTax?: number;
}

/**
 * X5 (J1 D7): live figures of a VAT period that has not ended yet, from the VAT engine
 * (GET /vat/compute, read-only). Clearly labelled as a preview: the return itself can only be
 * generated once the period has ended.
 */
export function VatPeriodPreview({
  companyId,
  periodStart,
  periodEnd,
  compact,
}: {
  companyId: string | undefined;
  periodStart: string;
  periodEnd: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useQuery<{ boxes?: VatPreviewBoxes }>({
    queryKey: ["/api/companies", companyId, "vat", "compute", periodStart, periodEnd],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/companies/${companyId}/vat/compute?from=${periodStart}&to=${periodEnd}`
      ),
    enabled: !!companyId && !!periodStart && !!periodEnd,
    retry: false,
  });
  const boxes = data?.boxes ?? {};
  const net = Number(boxes.box14PayableTax ?? 0);

  return (
    <div
      className="space-y-2 rounded-md border border-border bg-muted/30 p-3"
      data-testid="vat-period-preview"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" data-testid="badge-vat-preview">
          {t["compliance.vatPreview.badge"]}
        </Badge>
        <span className="text-caption text-muted-foreground">
          {formatMessage(t["compliance.vatPreview.endsOn"], { date: periodEnd })}
        </span>
      </div>
      {isLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : isError ? (
        <p className="text-small text-muted-foreground">{t["compliance.vatPreview.unavailable"]}</p>
      ) : (
        <dl
          className={
            compact
              ? "grid grid-cols-3 gap-2 text-small tabular-nums"
              : "grid grid-cols-1 gap-2 text-small tabular-nums sm:grid-cols-3"
          }
        >
          <div>
            <dt className="text-muted-foreground">{t["compliance.vatFilingOutputVat"]}</dt>
            <dd className="font-medium text-foreground" data-testid="text-vat-preview-output">
              <Money amount={Number(boxes.box12TotalDueTax ?? 0)} />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t["compliance.vatFilingInputVat"]}</dt>
            <dd className="font-medium text-foreground" data-testid="text-vat-preview-input">
              <Money amount={Number(boxes.box13RecoverableTax ?? 0)} />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t["compliance.vatPreview.netSoFar"]}</dt>
            <dd className="font-semibold text-foreground" data-testid="text-vat-preview-net">
              <Money amount={net} />
            </dd>
          </div>
        </dl>
      )}
      <p className="text-caption text-muted-foreground">{t["compliance.vatPreview.note"]}</p>
    </div>
  );
}
