import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EMIRATE_LABELS } from "@/lib/enum-labels";
import { formatCurrency } from "@/lib/format";
import { useTranslation } from "@/lib/i18n";
import { emirateRows } from "@/lib/vat-emirates";
import { messages as pageMessages } from "./VatEmirateBreakdown.i18n";

interface Props {
  /** Anything that carries the box 1 fields: a return, the Autopilot's vat201, a workpaper's totals. */
  boxes: Record<string, unknown> | null | undefined;
  /** Shown when there is nothing in any emirate (default: the section is left out). */
  showWhenEmpty?: boolean;
  testId?: string;
}

/** Box 1 of the VAT 201: one row per emirate that has supplies, with a total. */
export function VatEmirateBreakdown({
  boxes,
  showWhenEmpty = false,
  testId = "vat-emirate-breakdown",
}: Props) {
  const tr = pageMessages.useT();
  const { locale } = useTranslation();
  const rows = emirateRows(boxes);
  if (rows.length === 0 && !showWhenEmpty) return null;
  const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const hasAdjustment = rows.some((r) => r.adjustment !== 0);
  return (
    <section className="space-y-2" aria-labelledby={`${testId}-title`} data-testid={testId}>
      <div>
        <h3 id={`${testId}-title`} className="text-sm font-semibold">
          {tr("title")}
        </h3>
        <p className="text-xs text-muted-foreground">{tr("hint")}</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tr("none")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">{tr("colBox")}</TableHead>
                <TableHead>{tr("colEmirate")}</TableHead>
                <TableHead className="text-end">{tr("colAmount")}</TableHead>
                <TableHead className="text-end">{tr("colVat")}</TableHead>
                {hasAdjustment ? (
                  <TableHead className="text-end">{tr("colAdjustment")}</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.box} data-testid={`${testId}-${r.box}`}>
                  <TableCell dir="ltr" className="font-mono text-xs">
                    {r.box}
                  </TableCell>
                  <TableCell>
                    {locale === "ar" ? EMIRATE_LABELS[r.slug].ar : EMIRATE_LABELS[r.slug].en}
                  </TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {formatCurrency(r.amount, "AED", locale)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {formatCurrency(r.vat, "AED", locale)}
                  </TableCell>
                  {hasAdjustment ? (
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {formatCurrency(r.adjustment, "AED", locale)}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow className="font-semibold">
                <TableCell colSpan={2}>{tr("total")}</TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {formatCurrency(
                    sum((r) => r.amount),
                    "AED",
                    locale
                  )}
                </TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {formatCurrency(
                    sum((r) => r.vat),
                    "AED",
                    locale
                  )}
                </TableCell>
                {hasAdjustment ? (
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {formatCurrency(
                      sum((r) => r.adjustment),
                      "AED",
                      locale
                    )}
                  </TableCell>
                ) : null}
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </section>
  );
}
