import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { RECEIPT } from "./sample";
import { useAutoStart, useSequence } from "./sequence";
import { Money, Sample, type TabProps } from "./shared";

/** Stages: 1 scan sweep (two ticks), then merchant, date, amount, VAT, account. */
const TOTAL = 6;

export default function ReceiptTab({ locale, text, reduced, autoPlay }: TabProps) {
  const scan = useSequence(TOTAL, 700, reduced);
  useAutoStart(autoPlay, scan.start, 700);
  const scanning = scan.running && scan.step <= 1;

  const fields: { key: string; label: string; at: number; value: ReactNode }[] = [
    {
      key: "merchant",
      label: text("hxTourFMerchant"),
      at: 2,
      value: <Sample>{RECEIPT.merchant[locale]}</Sample>,
    },
    {
      key: "date",
      label: text("hxTourFDate"),
      at: 3,
      value: (
        <span className="mz-tour-num" dir="ltr" translate="no">
          {RECEIPT.date}
        </span>
      ),
    },
    {
      key: "amount",
      label: `${text("hxTourFAmount")} (${text("hxTourCurrency")})`,
      at: 4,
      value: <Money fils={RECEIPT.totalFils} />,
    },
    {
      key: "vat",
      label: `${text("hxTourFVat")} (${text("hxTourCurrency")})`,
      at: 5,
      value: <Money fils={RECEIPT.vatFils} />,
    },
  ];

  return (
    <div className="mz-tour-receipt">
      <div className="mz-tour-receipt-col">
        <div
          className={scanning ? "mz-tour-paper is-scanning" : "mz-tour-paper"}
          role="img"
          aria-label={text("hxTourReceiptLabel")}
          data-testid="tour-receipt"
        >
          <span className="mz-tour-paper-title" translate="no">
            {RECEIPT.merchant[locale]}
          </span>
          <span className="mz-tour-bar" />
          <span className="mz-tour-bar mz-tour-bar--short" />
          <span className="mz-tour-bar" />
          <span className="mz-tour-bar mz-tour-bar--short" />
          <span className="mz-tour-paper-row" translate="no">
            <span className="mz-tour-bar mz-tour-bar--tiny" />
            <span className="mz-tour-num" dir="ltr">
              {RECEIPT.date}
            </span>
          </span>
          <span className="mz-tour-paper-row">
            <span>{text("hxTourFVat")}</span>
            <Money fils={RECEIPT.vatFils} />
          </span>
          <span className="mz-tour-paper-row mz-tour-paper-total">
            <span>{text("hxTourFAmount")}</span>
            <Money fils={RECEIPT.totalFils} />
          </span>
          <span className="mz-tour-scanline" aria-hidden="true" />
        </div>
        <div className="mz-tour-actions">
          <button
            type="button"
            className="phase-button phase-primary"
            data-testid="tour-scan"
            disabled={scan.running}
            onClick={scan.start}
          >
            {scan.running ? text("hxTourScanning") : text("hxTourScan")}
          </button>
          {scan.step > 0 && !scan.running && (
            <button type="button" className="mz-tour-link" onClick={scan.reset}>
              {text("hxTourReset")}
            </button>
          )}
        </div>
      </div>

      <div className="mz-tour-receipt-col">
        <dl className="mz-tour-fields" data-testid="tour-fields">
          {fields.map((f) => (
            <div key={f.key} className="mz-tour-field" data-filled={scan.step >= f.at}>
              <dt>{f.label}</dt>
              <dd>
                {scan.step >= f.at ? f.value : <span className="mz-tour-bar" aria-hidden="true" />}
              </dd>
            </div>
          ))}
          <div className="mz-tour-field" data-filled={scan.step >= 6}>
            <dt>{text("hxTourFAccount")}</dt>
            <dd>
              {scan.step >= 6 ? (
                <span className="mz-badge">{text("hxTourAccountOffice")}</span>
              ) : (
                <span className="mz-tour-bar" aria-hidden="true" />
              )}
            </dd>
          </div>
          <div className="mz-tour-field" data-filled={scan.step >= 6}>
            <dt>
              {text("hxTourRecoverable")} ({text("hxTourCurrency")})
            </dt>
            <dd>
              {scan.step >= 6 ? (
                <Money fils={RECEIPT.vatFils} />
              ) : (
                <span className="mz-tour-bar" aria-hidden="true" />
              )}
            </dd>
          </div>
        </dl>
        <p className="mz-tour-done" aria-live="polite" role="status">
          {scan.done && (
            <>
              <Check aria-hidden="true" /> {text("hxTourReceiptDone")}
            </>
          )}
        </p>
      </div>
    </div>
  );
}
