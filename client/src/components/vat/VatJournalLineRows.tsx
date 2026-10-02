import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { messages as pageMessages } from "./VatJournalLineRows.i18n";

/**
 * One journal behind a VAT 201 box, as the server stores it on the return (vatAdjustments):
 *  - an ADJUSTMENT (manual VAT journal): `amount` is its signed effect on the tax, shown in the adjustment column;
 *  - a taxable SALE by journal (`kind: "journal_sale"`): `amount` is the net revenue and `vat` the output VAT, shown in
 *    the amount and VAT columns of box 1.
 * `box` is the box column the line affects (box1bDubaiAdj, box1bDubaiAmount, box9ExpensesAdj).
 */
export interface VatReturnJournalLine {
  entryId: string;
  entryNumber: string;
  description?: string | null;
  date?: string;
  side?: string;
  box: string;
  amount: number;
  vat?: number;
  kind?: "journal_sale" | "journal_purchase";
  /** A purchase journal in a blocked category (Art. 53): listed, counted nowhere. */
  blocked?: boolean;
}

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The lines that affect any of the given box columns. */
export const journalLinesForBoxes = (
  lines: VatReturnJournalLine[] | null | undefined,
  boxes: string[]
) => (lines ?? []).filter((l) => boxes.includes(l.box));

/** Rows (inside a table body) listing the journals behind the given box columns. Renders nothing when there are none. */
export default function VatJournalLineRows({
  lines,
  boxes,
}: {
  lines: VatReturnJournalLine[] | null | undefined;
  boxes: string[];
}) {
  const tr = pageMessages.useT();
  const own = journalLinesForBoxes(lines, boxes);
  if (own.length === 0) return null;
  return (
    <Fragment>
      {own.map((l) => {
        const sale = l.kind === "journal_sale" || l.kind === "journal_purchase";
        const badge =
          l.kind === "journal_sale"
            ? tr("saleBadge")
            : l.kind === "journal_purchase"
              ? l.blocked
                ? tr("blockedPurchaseBadge")
                : tr("purchaseBadge")
              : tr("adjustmentBadge");
        const hint =
          l.kind === "journal_sale"
            ? tr("saleHint")
            : l.kind === "journal_purchase"
              ? l.blocked
                ? tr("blockedPurchaseHint")
                : tr("purchaseHint")
              : tr("adjustmentHint");
        return (
          <TableRow
            key={`${l.entryId}:${l.box}`}
            className="bg-muted/30 text-xs"
            data-testid={`vat-journal-line-${l.entryNumber}`}
          >
            <TableCell className="ps-8">
              <span className="font-medium">{tr("journal", { number: l.entryNumber })}</span>
              {l.date ? <span className="text-muted-foreground"> · {l.date}</span> : null}
              <Badge variant="outline" className="ms-2 text-[10px]" title={hint}>
                {badge}
              </Badge>
              <br />
              <span className="text-muted-foreground">
                {l.description?.trim() || tr("noDescription")}
              </span>
            </TableCell>
            <TableCell className="text-end tabular-nums">{sale ? fmt(l.amount) : ""}</TableCell>
            <TableCell className="text-end tabular-nums">
              {sale ? fmt(l.blocked ? 0 : (l.vat ?? 0)) : ""}
            </TableCell>
            <TableCell className="text-end tabular-nums">{sale ? "" : fmt(l.amount)}</TableCell>
          </TableRow>
        );
      })}
    </Fragment>
  );
}
