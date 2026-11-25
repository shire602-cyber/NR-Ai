import { Check } from "lucide-react";
import { Num, VisualFrame, stagger, type VisualProps } from "./frame";
import {
  RECEIPT_DATE,
  RECEIPT_FIELDS,
  RECEIPT_LABELS,
  RECEIPT_LINES,
  RECEIPT_MERCHANT,
  RECEIPT_SUBTOTAL_FILS,
  RECEIPT_TOTAL_FILS,
  RECEIPT_VAT_FILS,
  pick,
} from "./sample";

/** A receipt gets a scan line, then its fields fill in. */
export default function ReceiptVisual({ locale, text, label }: VisualProps) {
  return (
    <VisualFrame text={text} label={label}>
      {() => (
        <div className="mz-show-split">
          <div className="mz-show-paper mz-show-receipt" lang={locale}>
            <span className="mz-show-scanline" aria-hidden="true" />
            <p className="mz-show-paper-title">{pick(RECEIPT_MERCHANT, locale)}</p>
            <p className="mz-show-muted" dir="ltr">
              {RECEIPT_DATE}
            </p>
            <ul className="mz-show-lines">
              {RECEIPT_LINES.map((line) => (
                <li key={line.id}>
                  <span>{pick(line.label, locale)}</span>
                  <Num fils={line.fils} />
                </li>
              ))}
            </ul>
            <p className="mz-show-line mz-show-strong">
              <span>{pick(RECEIPT_LABELS.total, locale)}</span>
              <Num fils={RECEIPT_TOTAL_FILS} />
            </p>
          </div>
          <div className="mz-show-fields" lang={locale}>
            {RECEIPT_FIELDS.map((field, i) => (
              <p className="mz-show-field mz-show-anim" style={stagger(i + 4)} key={field.id}>
                <span className="mz-show-muted">{pick(field.label, locale)}</span>
                <b>{pick(field.value, locale)}</b>
              </p>
            ))}
            <p className="mz-show-field mz-show-anim" style={stagger(7)}>
              <span className="mz-show-muted">{pick(RECEIPT_LABELS.subtotal, locale)}</span>
              <Num fils={RECEIPT_SUBTOTAL_FILS} />
            </p>
            <p className="mz-show-field mz-show-anim" style={stagger(8)}>
              <span className="mz-show-muted">{pick(RECEIPT_LABELS.vat, locale)}</span>
              <Num fils={RECEIPT_VAT_FILS} />
            </p>
            <p className="mz-show-anim" style={stagger(9)}>
              <span className="mz-show-chip mz-show-chip--ok">
                <Check aria-hidden="true" /> {pick(RECEIPT_LABELS.status, locale)}
              </span>
            </p>
          </div>
        </div>
      )}
    </VisualFrame>
  );
}
