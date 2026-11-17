import { T } from "@/components/layout/T";
import { Money, MoneyCell } from "@/components/ui/money";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/format-date";
import { useTranslation } from "@/lib/i18n";

export interface StatementSectionView {
  currency: string;
  openingBalance: number;
  closingBalance: number;
  lines: Array<{
    date: string;
    type: string;
    reference: string;
    debit: number;
    credit: number;
    balance: number;
  }>;
  aging: {
    current: number;
    days30: number;
    days60: number;
    days90: number;
    over90: number;
    total?: number;
  };
}

/**
 * Statement of account (WP-F, spec 3.18) for the public customer portal and the client portal:
 * opening balance, running-balance lines, closing balance, then the ageing buckets as one row.
 */
export function StatementOfAccount({ section: s }: { section: StatementSectionView }) {
  const { t, locale } = useTranslation();
  const m = (n: number) => <Money amount={n} currency={s.currency} />;
  const aging: Array<[string, number]> = [
    ["portal.agingCurrent", s.aging.current],
    ["portal.aging30", s.aging.days30],
    ["portal.aging60", s.aging.days60],
    ["portal.aging90", s.aging.days90],
    ["portal.agingOver90", s.aging.over90],
  ];
  if (s.aging.total !== undefined) aging.push(["portal.agingTotal", s.aging.total]);
  return (
    <div className="space-y-4">
      <Table className="row-cards">
        <TableHeader>
          <TableRow>
            <TableHead>
              <T k="portal.doc.date" />
            </TableHead>
            <TableHead>
              <T k="portal.reference" />
            </TableHead>
            <TableHead data-numeric>
              <T k="portal.debit" />
            </TableHead>
            <TableHead data-numeric>
              <T k="portal.credit" />
            </TableHead>
            <TableHead data-numeric>
              <T k="portal.balance" />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell data-cell="title" colSpan={4} className="text-muted-foreground">
              <T k="portal.doc.openingBalance" />
            </TableCell>
            <MoneyCell amount={s.openingBalance} currency={s.currency} data-cell="amount" />
          </TableRow>
          {s.lines.map((l, i) => (
            <TableRow key={`${l.reference}-${i}`}>
              <TableCell data-cell="meta" data-nowrap="">
                {formatDate(l.date, locale)}
              </TableCell>
              <TableCell data-cell="title">
                <bdi>{l.reference}</bdi>
                {t[`portal.lineType.${l.type}`] && (
                  <span className="text-muted-foreground"> · {t[`portal.lineType.${l.type}`]}</span>
                )}
              </TableCell>
              <TableCell data-numeric className="tabular-nums">
                {l.debit ? m(l.debit) : ""}
              </TableCell>
              <TableCell data-numeric className="tabular-nums">
                {l.credit ? m(l.credit) : ""}
              </TableCell>
              <MoneyCell amount={l.balance} currency={s.currency} data-cell="amount" />
            </TableRow>
          ))}
          <TableRow>
            <TableCell data-cell="title" colSpan={4} className="font-semibold">
              <T k="portal.doc.closingBalance" />
            </TableCell>
            <MoneyCell
              amount={s.closingBalance}
              currency={s.currency}
              className="font-semibold"
              data-cell="amount"
            />
          </TableRow>
        </TableBody>
      </Table>
      <div>
        <p className="mb-2 text-caption font-semibold text-muted-foreground">
          <T k="portal.doc.ageing" />
        </p>
        <dl
          className={`grid grid-cols-2 border-y border-border text-small ${aging.length > 5 ? "sm:grid-cols-6" : "sm:grid-cols-5"}`}
        >
          {aging.map(([k, v]) => (
            <div key={k} className="px-3 py-2.5 text-end">
              <dt className="text-caption text-muted-foreground">
                <T k={k} />
              </dt>
              <dd className="mt-1 font-medium tabular-nums">{m(v)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
