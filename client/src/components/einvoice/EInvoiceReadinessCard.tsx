/**
 * X6d: in-app e-invoicing readiness checklist (dashboard and onboarding). One row per area the
 * PINT AE rules check (scope, supplier identity, buyer details, item codes, provider) with a fix
 * link, plus the mandate go-live countdown. Dates are guidance from the Ministry of Finance
 * timeline and are labelled "confirm for your entity"; the card says plainly that transmission is
 * off until an accredited provider is connected.
 */
import { Link } from "wouter";
import { CheckCircle2, Circle, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { fieldLabelKey, type EInvoiceReadiness } from "./einvoice-meta";
import { useEInvoiceReadiness } from "./use-einvoice";

export function EInvoiceReadinessCard({
  companyId,
  className,
  compact = false,
}: {
  companyId: string | null | undefined;
  className?: string;
  /**
   * Onboarding: header, progress and the go-live line only. The per-area checklist and its fix
   * links (which would leave onboarding) stay on the dashboard card.
   */
  compact?: boolean;
}) {
  const { t, locale } = useTranslation();
  const query = useEInvoiceReadiness(companyId);
  const { isLoading, isError } = query;
  // A response without the readiness shape (older API, empty mock) renders the skeleton,
  // never a crash.
  const data = query.data && query.data.mandate ? query.data : undefined;
  if (!companyId) return null;
  if (isError) return null;

  const countdown = (view: EInvoiceReadiness): string => {
    const m = view.mandate;
    if (m.scope === "none") return t["launchProof.readinessScopeNone"];
    if (!m.goLiveDate) return t["launchProof.readinessNoDate"];
    const date = formatDate(m.goLiveDate, locale);
    if (m.daysToGoLive !== null && m.daysToGoLive > 0) {
      return formatMessage(t["launchProof.readinessCountdown"], {
        days: String(m.daysToGoLive),
        date,
      });
    }
    return formatMessage(t["launchProof.readinessInForce"], { date });
  };

  const sampleText = (item: EInvoiceReadiness["items"][number]): string =>
    item.samples
      .map((s) => {
        const key = fieldLabelKey(s);
        return key ? t[key] : s;
      })
      .join(", ");

  return (
    <Card className={cn(className)} data-testid="einvoice-readiness-card">
      <CardHeader className={compact ? "pb-2" : undefined}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-h4">{t["launchProof.readinessTitle"]}</CardTitle>
            <CardDescription>{t["launchProof.readinessSubtitle"]}</CardDescription>
          </div>
          {data && (
            <Badge
              variant={data.done === data.total ? "success" : "outline"}
              data-testid="einvoice-readiness-progress"
            >
              {formatMessage(t["launchProof.readinessProgress"], {
                done: String(data.done),
                total: String(data.total),
              })}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className={compact ? "space-y-3" : "space-y-4"}>
        {isLoading || !data ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <div
              className="rounded-md border border-border bg-muted/30 p-3 text-small"
              data-testid="einvoice-readiness-countdown"
            >
              <p className="font-medium text-foreground">{countdown(data)}</p>
              <p className="mt-1 text-caption text-muted-foreground">
                {t["launchProof.readinessDateNote"]}
              </p>
            </div>
            {!compact && (
              <ul className="divide-y divide-border" data-testid="einvoice-readiness-list">
                {data.items.map((item) => {
                  const done = item.status === "done";
                  const Icon = done ? CheckCircle2 : Circle;
                  return (
                    <li
                      key={item.key}
                      className="flex items-start gap-3 py-2.5"
                      data-testid={`einvoice-readiness-${item.key}`}
                      data-status={item.status}
                    >
                      <Icon
                        aria-hidden
                        className={cn(
                          "mt-0.5 h-4 w-4 shrink-0",
                          done ? "text-success" : "text-muted-foreground"
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-small font-medium text-foreground">
                          {t[`launchProof.readinessItem_${item.key}`]}
                        </p>
                        <p className="text-caption text-muted-foreground">
                          {done
                            ? t[`launchProof.readinessDone_${item.key}`]
                            : t[`launchProof.readinessHint_${item.key}`]}
                        </p>
                        {!done && item.samples.length > 0 && (
                          <p className="text-caption text-foreground">
                            {formatMessage(t["launchProof.readinessAttention"], {
                              count: String(item.count),
                              total: String(item.total),
                              names: sampleText(item),
                            })}
                          </p>
                        )}
                      </div>
                      {!done && (
                        <Link
                          href={item.fixHref}
                          className="inline-flex shrink-0 items-center gap-1 text-small font-medium text-primary hover:underline"
                          data-testid={`einvoice-readiness-fix-${item.key}`}
                        >
                          {t["launchProof.readinessFix"]}
                          <ArrowRight aria-hidden className="h-3.5 w-3.5 rtl:rotate-180" />
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-caption text-muted-foreground" data-testid="einvoice-readiness-tx">
              {data.transmission.enabled
                ? formatMessage(t["launchProof.readinessTxOn"], {
                    provider: data.transmission.provider ?? "",
                  })
                : t["launchProof.readinessTxOff"]}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
