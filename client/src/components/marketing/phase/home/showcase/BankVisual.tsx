import { Check, FileSpreadsheet } from "lucide-react";
import { Num, VisualFrame, stagger, type VisualProps } from "./frame";
import { BANK_LABELS, BANK_SAMPLE, pick } from "./sample";

/** Rows from an uploaded CSV match to invoices and bills one by one. */
export default function BankVisual({ locale, text, label }: VisualProps) {
  return (
    <VisualFrame text={text} label={label}>
      {() => (
        <div className="mz-show-paper mz-show-bank" lang={locale}>
          <p className="mz-show-file">
            <FileSpreadsheet aria-hidden="true" />
            <span dir="ltr">{pick(BANK_LABELS.file, locale)}</span>
            <span className="mz-show-muted">{pick(BANK_LABELS.csv, locale)}</span>
          </p>
          <ul className="mz-show-bank-rows">
            {BANK_SAMPLE.map((row, i) => (
              <li className="mz-show-bank-row" key={row.id}>
                <span className="mz-show-muted" dir="ltr">
                  {row.date}
                </span>
                <span>{pick(row.text, locale)}</span>
                <Num fils={row.amountFils} className={row.amountFils < 0 ? "mz-show-neg" : ""} />
                {row.match ? (
                  <span
                    className="mz-show-chip mz-show-chip--ok mz-show-anim"
                    style={stagger(i * 2 + 1)}
                  >
                    <Check aria-hidden="true" />
                    <span dir="ltr">{pick(row.match, locale)}</span>
                  </span>
                ) : (
                  <span
                    className="mz-show-chip mz-show-chip--warn mz-show-anim"
                    style={stagger(i * 2 + 1)}
                  >
                    {pick(BANK_LABELS.review, locale)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </VisualFrame>
  );
}
