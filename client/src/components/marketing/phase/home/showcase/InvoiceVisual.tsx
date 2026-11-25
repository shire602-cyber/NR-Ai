import { Num, VisualFrame, stagger, type VisualProps } from "./frame";
import { invoiceTotals } from "../tour/model";
import { INVOICE_LABELS, INVOICE_SAMPLE, pick } from "./sample";
import type { SiteLocale } from "../../routes";

const TOTALS = invoiceTotals(INVOICE_SAMPLE.lines);

/** One sheet of the invoice in a fixed language (the other sheet mirrors it). */
function Sheet({ lang, index }: { lang: SiteLocale; index: number }) {
  const dir = lang === "ar" ? "rtl" : "ltr";
  return (
    <div
      className="mz-show-paper mz-show-sheet mz-show-anim"
      style={stagger(index * 2)}
      lang={lang}
      dir={dir}
    >
      <p className="mz-show-line">
        <b className="mz-show-paper-title">{pick(INVOICE_LABELS.title, lang)}</b>
        <span className="mz-show-muted" dir="ltr">
          {INVOICE_SAMPLE.number}
        </span>
      </p>
      <p className="mz-show-muted">
        {pick(INVOICE_LABELS.billTo, lang)}: {pick(INVOICE_SAMPLE.customer, lang)}
      </p>
      <table className="mz-show-table">
        <thead>
          <tr>
            <th scope="col">{pick(INVOICE_LABELS.item, lang)}</th>
            <th scope="col">{pick(INVOICE_LABELS.qty, lang)}</th>
            <th scope="col">{pick(INVOICE_LABELS.amount, lang)}</th>
          </tr>
        </thead>
        <tbody>
          {INVOICE_SAMPLE.lines.map((line, i) => (
            <tr key={line.id}>
              <td>{pick(line.item, lang)}</td>
              <td dir="ltr">{line.qty}</td>
              <td>
                <Num fils={TOTALS.amounts[i] ?? 0} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mz-show-line">
        <span>{pick(INVOICE_LABELS.subtotal, lang)}</span>
        <Num fils={TOTALS.subtotalFils} />
      </p>
      <p className="mz-show-line">
        <span>{pick(INVOICE_LABELS.vat, lang)}</span>
        <Num fils={TOTALS.vatFils} />
      </p>
      <p className="mz-show-line mz-show-strong">
        <span>{pick(INVOICE_LABELS.total, lang)}</span>
        <Num fils={TOTALS.totalFils} />
      </p>
    </div>
  );
}

/** The same invoice in English and Arabic, side by side. */
export default function InvoiceVisual({ text, label }: VisualProps) {
  return (
    <VisualFrame text={text} label={label}>
      {() => (
        <div className="mz-show-pair">
          <Sheet lang="en" index={0} />
          <Sheet lang="ar" index={1} />
        </div>
      )}
    </VisualFrame>
  );
}
