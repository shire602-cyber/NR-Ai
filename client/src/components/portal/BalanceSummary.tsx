import { CalendarClock, CircleAlert, CircleCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { Skeleton } from "@/components/ui/skeleton";
import { DateText } from "@/components/documents/DateText";
import { formatMessage, useTranslation } from "@/lib/i18n";

export interface CurrencyTotal {
  currency: string;
  fils: number;
  amount: string;
  count: number;
}

export interface BalanceData {
  outstandingByCurrency: CurrencyTotal[];
  overdueByCurrency: CurrencyTotal[];
  nextDue: {
    id: string;
    number: string;
    dueDate: string;
    currency: string;
    amountDue: number;
  } | null;
}

/**
 * What the customer owes: one tile per currency (amounts of different currencies are never
 * added together; the server sums in integer fils), the overdue part, and the next due date.
 */
export function BalanceSummary({ data, loading }: { data?: BalanceData; loading?: boolean }) {
  const { t, locale } = useTranslation();
  if (loading || !data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2" aria-busy="true">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    );
  }
  const overdueBy = new Map(data.overdueByCurrency.map((o) => [o.currency, o]));
  if (data.outstandingByCurrency.length === 0) {
    return (
      <Card className="flex items-center gap-4 p-5" data-testid="portal-balance-clear">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-success-subtle text-success">
          <CircleCheck className="h-6 w-6" aria-hidden />
        </span>
        <div>
          <p className="text-body font-semibold">{t["portal.dash.allPaidTitle"]}</p>
          <p className="text-small text-muted-foreground">{t["portal.dash.allPaidBody"]}</p>
        </div>
      </Card>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2" data-testid="portal-balance">
      {data.outstandingByCurrency.map((o) => {
        const overdue = overdueBy.get(o.currency);
        return (
          <Card key={o.currency} className="p-5" data-testid={`portal-balance-${o.currency}`}>
            <p className="text-caption font-medium text-muted-foreground">
              {t["portal.dash.balanceDue"]}
            </p>
            <p className="mt-1 text-h1 font-semibold tabular-nums">
              <Money amount={Number(o.amount)} currency={o.currency} />
            </p>
            <p className="mt-1 text-small text-muted-foreground">
              {o.count === 1
                ? t["portal.invoiceCountOne"]
                : formatMessage(t["portal.invoiceCountMany"], { count: o.count })}
            </p>
            {overdue ? (
              <p
                className="mt-3 flex items-center gap-2 rounded-md bg-danger-subtle px-3 py-2 text-small font-medium text-danger-subtle-foreground"
                data-testid={`portal-overdue-${o.currency}`}
              >
                <CircleAlert className="h-4 w-4 shrink-0" aria-hidden />
                <span>
                  {formatMessage(t["portal.dash.overdueOf"], { count: overdue.count })}{" "}
                  <Money amount={Number(overdue.amount)} currency={overdue.currency} />
                </span>
              </p>
            ) : null}
          </Card>
        );
      })}
      {data.nextDue ? (
        <Card className="p-5 sm:col-span-2" data-testid="portal-next-due">
          <p className="flex items-center gap-2 text-caption font-medium text-muted-foreground">
            <CalendarClock className="h-4 w-4" aria-hidden />
            {t["portal.dash.nextDue"]}
          </p>
          <p className="mt-1 text-body font-semibold">
            <bdi>{data.nextDue.number}</bdi> ·{" "}
            <DateText value={data.nextDue.dueDate} locale={locale} />
          </p>
          <p className="text-small text-muted-foreground">
            <Money amount={data.nextDue.amountDue} currency={data.nextDue.currency} />
          </p>
        </Card>
      ) : null}
    </div>
  );
}
