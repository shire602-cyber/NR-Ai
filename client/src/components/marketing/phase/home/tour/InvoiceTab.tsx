import { useEffect, useState } from "react";
import { useMarketingText } from "../text";
import { invoiceTotals, moneyPlain, parseQty, parseUnitFils, money } from "./model";
import type { DocLine, TourInvoice } from "./invoiceState";
import { INVOICE_CUSTOMER, INVOICE_LINES, INVOICE_NUMBER } from "./sample";
import { useAutoStart, useSequence } from "./sequence";
import { Money, Sample, type TabProps } from "./shared";

type Layout = "en" | "ar" | "both";
const LAYOUTS: readonly {
  id: Layout;
  key: "hxTourLayoutEn" | "hxTourLayoutAr" | "hxTourLayoutBoth";
}[] = [
  { id: "en", key: "hxTourLayoutEn" },
  { id: "ar", key: "hxTourLayoutAr" },
  { id: "both", key: "hxTourLayoutBoth" },
];
const STEP_KEYS = ["hxTourStep1", "hxTourStep2", "hxTourStep3", "hxTourStep4"] as const;

/** The invoice itself, one column per language, so the bilingual layout is the same document. */
function InvoiceDoc({
  layout,
  lines,
  totals,
}: {
  layout: Layout;
  lines: DocLine[];
  totals: ReturnType<typeof invoiceTotals>;
}) {
  const en = useMarketingText("en");
  const ar = useMarketingText("ar");
  const languages = layout === "both" ? (["en", "ar"] as const) : ([layout] as const);
  return (
    <div
      className={`mz-tour-doc mz-tour-doc--${layout}`}
      data-testid="tour-invoice-doc"
      data-layout={layout}
    >
      {languages.map((lang) => {
        const t = lang === "ar" ? ar : en;
        return (
          <div
            key={lang}
            className="mz-tour-doc-col"
            lang={lang}
            dir={lang === "ar" ? "rtl" : "ltr"}
          >
            <div className="mz-tour-doc-head">
              <strong>{t("hxTourDocTitle")}</strong>
              <span>
                {t("hxTourDocNumber")} <Sample>{INVOICE_NUMBER}</Sample>
              </span>
            </div>
            <p className="mz-tour-doc-bill">
              {t("hxTourDocBillTo")}: <Sample>{INVOICE_CUSTOMER[lang]}</Sample>
            </p>
            <table>
              <thead>
                <tr>
                  <th scope="col">{t("hxTourDocDesc")}</th>
                  <th scope="col">{t("hxTourDocQty")}</th>
                  <th scope="col">{t("hxTourDocAmount")}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.line.id}>
                    <td>
                      <Sample>{l.line.item[lang]}</Sample>
                    </td>
                    <td>
                      <span className="mz-tour-num" dir="ltr">
                        {l.qty}
                      </span>
                    </td>
                    <td>
                      <Money fils={l.amountFils} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={2}>
                    {t("hxTourDocSubtotal")}
                  </th>
                  <td>
                    <Money fils={totals.subtotalFils} />
                  </td>
                </tr>
                <tr>
                  <th scope="row" colSpan={2}>
                    {t("hxTourDocVat")}
                  </th>
                  <td>
                    <Money fils={totals.vatFils} />
                  </td>
                </tr>
                <tr className="mz-tour-doc-total">
                  <th scope="row" colSpan={2}>
                    {t("hxTourDocTotal")} ({t("hxTourCurrency")})
                  </th>
                  <td>
                    <Money fils={totals.totalFils} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        );
      })}
    </div>
  );
}

export default function InvoiceTab({
  locale,
  text,
  reduced,
  autoPlay,
  paused,
  onActivity,
  invoice,
}: TabProps & { invoice: TourInvoice }) {
  const { qty, price, setQty, setPrice, lines, totals } = invoice;
  const [layout, setLayout] = useState<Layout>(locale === "ar" ? "ar" : "en");
  const issue = useSequence(3, 850, reduced, paused);
  useAutoStart(autoPlay, issue.start, 900);

  // The invoice is visibly moving while it runs and while Delivered pulses (unless reduced), so
  // Pause stays offered through the last stage's transition and the pulse.
  const moving = issue.running || (!reduced && issue.done);
  useEffect(() => {
    onActivity?.(moving);
    return () => onActivity?.(false);
  }, [onActivity, moving]);

  const edit = (set: typeof setQty, i: number, value: string) => {
    set((all) => all.map((v, at) => (at === i ? value : v)));
    issue.reset();
  };
  const status = text(STEP_KEYS[Math.min(issue.step, 3)]);

  return (
    <div className="mz-tour-invoice">
      <div className="mz-tour-controls">
        <table className="mz-tour-lines">
          <thead>
            <tr>
              <th scope="col">{text("hxTourDocDesc")}</th>
              <th scope="col">{text("hxTourDocQty")}</th>
              <th scope="col">
                {text("hxTourDocPrice")} ({text("hxTourCurrency")})
              </th>
            </tr>
          </thead>
          <tbody>
            {INVOICE_LINES.map((line, i) => (
              <tr key={line.id}>
                <td>
                  <Sample>{line.item[locale]}</Sample>
                </td>
                <td>
                  <input
                    className="mz-tour-input"
                    type="text"
                    inputMode="numeric"
                    dir="ltr"
                    autoComplete="off"
                    data-testid={`tour-qty-${i}`}
                    aria-label={text("hxTourInvQtyFor", { item: line.item[locale] })}
                    value={qty[i]}
                    onChange={(e) => edit(setQty, i, e.target.value)}
                    onBlur={() =>
                      setQty((all) => all.map((v, at) => (at === i ? String(parseQty(v)) : v)))
                    }
                  />
                </td>
                <td>
                  <input
                    className="mz-tour-input"
                    type="text"
                    inputMode="decimal"
                    dir="ltr"
                    autoComplete="off"
                    data-testid={`tour-price-${i}`}
                    aria-label={text("hxTourInvPriceFor", { item: line.item[locale] })}
                    value={price[i]}
                    onChange={(e) => edit(setPrice, i, e.target.value)}
                    onBlur={() =>
                      setPrice((all) =>
                        all.map((v, at) => (at === i ? moneyPlain(parseUnitFils(v)) : v))
                      )
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="mz-tour-sums" data-testid="tour-totals">
          <div>
            <dt>{text("hxTourDocSubtotal")}</dt>
            <dd>
              <Money fils={totals.subtotalFils} />
            </dd>
          </div>
          <div>
            <dt>{text("hxTourDocVat")}</dt>
            <dd data-testid="tour-vat">{money(totals.vatFils)}</dd>
          </div>
          <div className="mz-tour-sums-total">
            <dt>{text("hxTourDocTotal")}</dt>
            <dd data-testid="tour-total">{money(totals.totalFils)}</dd>
          </div>
        </dl>

        <div role="group" aria-label={text("hxTourInvLayout")} className="mz-tour-seg">
          {LAYOUTS.map((l) => (
            <button
              key={l.id}
              type="button"
              aria-pressed={layout === l.id}
              onClick={() => setLayout(l.id)}
            >
              {text(l.key)}
            </button>
          ))}
        </div>
      </div>

      <div className="mz-tour-preview">
        <InvoiceDoc layout={layout} lines={lines} totals={totals} />
        <ol className="mz-tour-pipeline" aria-label={text("hxTourPipelineLabel")}>
          {STEP_KEYS.map((key, i) => {
            const current = issue.step === i;
            const delivered = i === 3 && issue.step === 3;
            return (
              <li
                key={key}
                data-state={current ? "current" : i < issue.step ? "done" : "todo"}
                aria-current={current ? "step" : undefined}
              >
                <span className={delivered ? "mz-live" : "mz-tour-dot"}>{text(key)}</span>
              </li>
            );
          })}
        </ol>
        <div className="mz-tour-actions">
          <button
            type="button"
            className="phase-button phase-primary"
            data-testid="tour-issue"
            disabled={issue.running}
            onClick={issue.start}
          >
            {text("hxTourIssue")}
          </button>
          {issue.step > 0 && !issue.running && (
            <button type="button" className="mz-tour-link" onClick={issue.reset}>
              {text("hxTourReset")}
            </button>
          )}
        </div>
        <p
          className="mz-tour-sr"
          aria-live="polite"
          role="status"
          data-testid="tour-invoice-status"
        >
          {issue.done ? text("hxTourStatusIs", { status }) : ""}
        </p>
      </div>
    </div>
  );
}
