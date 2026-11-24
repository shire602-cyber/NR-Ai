import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { SiteLocale } from "../routes";
import { useCountUp, useInView, usePrefersReducedMotion } from "./motion";
import { useMarketingText, type MarketingKey } from "./text";
import {
  FINAL_FRAME,
  FRAMES,
  INVOICE,
  LOOP_MS,
  RECEIPT,
  STATUS_KEYS,
  VAT_PAYABLE_AED,
  formatFils,
  toFils,
} from "./hero/model";

const NAV: readonly MarketingKey[] = [
  "hxHeroNavDashboard",
  "hxHeroNavInvoices",
  "hxHeroNavExpenses",
  "hxHeroNavVat",
  "hxHeroNavPayroll",
  "hxHeroNavReports",
];

const dirOf = (locale: SiteLocale) => (locale === "ar" ? "rtl" : "ltr");
const other = (locale: SiteLocale): SiteLocale => (locale === "ar" ? "en" : "ar");
const index = (i: number) => ({ "--i": i }) as CSSProperties;

function usePageHidden(): boolean {
  const [hidden, setHidden] = useState(
    () => typeof document !== "undefined" && document.visibilityState === "hidden"
  );
  useEffect(() => {
    const update = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return hidden;
}

/**
 * The live product composition. One frame at a time from FRAMES, advanced by a single timeout
 * chain that only runs while the stage is on screen, the tab is visible and motion is allowed.
 * Without IntersectionObserver (jsdom) or under reduced motion the static final frame is shown.
 */
export default function HeroStage({ locale }: { locale: SiteLocale }) {
  // Both catalogs are requested up front so the invoice can flip without a blank frame.
  const texts = { en: useMarketingText("en"), ar: useMarketingText("ar") };
  const text = texts[locale];
  const ref = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const inView = useInView(ref, { once: false, threshold: 0.1, rootMargin: "0px" });
  const hidden = usePageHidden();
  const animated = !reduced && typeof IntersectionObserver !== "undefined";
  const running = animated && inView && !hidden;

  const [position, setPosition] = useState(0);
  const [cycle, setCycle] = useState(0);
  useEffect(() => {
    if (!running) return;
    const last = position === FRAMES.length - 1;
    const delay = last
      ? LOOP_MS - FRAMES[position].at
      : FRAMES[position + 1].at - FRAMES[position].at;
    const timer = setTimeout(() => {
      if (last) {
        setPosition(0);
        setCycle((value) => value + 1);
      } else {
        setPosition(position + 1);
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [running, position]);

  const frame = animated ? FRAMES[position] : FINAL_FRAME;
  const invoiceLocale = frame.flip ? other(locale) : locale;
  const invoiceText = texts[invoiceLocale];
  const count = useCountUp(VAT_PAYABLE_AED, { durationMs: 1500, enabled: frame.step >= 5 });
  const vatShown = animated ? count : VAT_PAYABLE_AED;
  const status = frame.status;

  return (
    <div
      ref={ref}
      className="mz-stage"
      role="img"
      aria-label={text("hxHeroImageAlt")}
      dir={dirOf(locale)}
      lang={locale}
      data-testid="hero-stage"
      data-animated={animated ? "true" : "false"}
      data-step={frame.step}
      data-status={status}
    >
      <div className="mz-stage-inner" aria-hidden="true" key={cycle}>
        <span className="mz-stage-sample">{text("hxHeroCaption")}</span>
        <aside className="mz-stage-side">
          <span className="mz-stage-logo" />
          {NAV.map((key, i) => (
            <span key={key} className="mz-stage-nav" data-active={i === 1} style={index(i)}>
              {text(key)}
            </span>
          ))}
        </aside>
        <div className="mz-stage-main">
          <div
            className="mz-stage-invoice"
            data-on={frame.step >= 1}
            dir={dirOf(invoiceLocale)}
            lang={invoiceLocale}
          >
            <div className="mz-stage-invhead">
              <strong>{invoiceText("hxHeroInvTitle")}</strong>
              <span className="mz-stage-num" dir="ltr">
                {INVOICE.number}
              </span>
              <span className="mz-stage-lang" dir="ltr">
                <span data-active={invoiceLocale === "en"}>{text("hxHeroLangEn")}</span>
                <span data-active={invoiceLocale === "ar"}>{text("hxHeroLangAr")}</span>
              </span>
            </div>
            <div className="mz-stage-body" key={invoiceLocale}>
              <p className="mz-stage-type mz-stage-customer" style={index(0)}>
                {invoiceText("hxHeroInvCustomer")}
              </p>
              {INVOICE.lines.map((line, i) => (
                <p className="mz-stage-row mz-stage-type" key={line.key} style={index(i + 1)}>
                  <span>{invoiceText(line.key)}</span>
                  <bdi dir="ltr">{formatFils(line.netFils)}</bdi>
                </p>
              ))}
              <p className="mz-stage-row mz-stage-type mz-stage-muted" style={index(3)}>
                <span>{invoiceText("hxHeroInvSubtotal")}</span>
                <bdi dir="ltr">{formatFils(INVOICE.netFils)}</bdi>
              </p>
              <p className="mz-stage-row mz-stage-type mz-stage-muted" style={index(4)}>
                <span>{invoiceText("hxHeroInvVat")}</span>
                <bdi dir="ltr">{formatFils(INVOICE.vatFils)}</bdi>
              </p>
              <p className="mz-stage-row mz-stage-type mz-stage-total" style={index(5)}>
                <span>{invoiceText("hxHeroInvTotal")}</span>
                <bdi dir="ltr">AED {formatFils(INVOICE.totalFils)}</bdi>
              </p>
            </div>
            <div className="mz-stage-statusrow">
              <span
                key={status}
                className={status === 0 ? "mz-stage-draft" : "mz-stage-pill mz-live"}
              >
                {text(STATUS_KEYS[status])}
              </span>
              <span className="mz-stage-track">
                {STATUS_KEYS.map((key, i) => (
                  <i key={key} data-done={i <= status} />
                ))}
              </span>
            </div>
          </div>

          <div className="mz-stage-side-col">
            <div className="mz-stage-capture">
              <div
                className="mz-stage-receipt"
                data-on={frame.step >= 3}
                data-scan={frame.step === 3}
                data-done={frame.step >= 4}
              >
                <strong>{text("hxHeroRecTitle")}</strong>
                <b>{text("hxHeroRecVendor")}</b>
                <i />
                <i />
                <i />
                <span dir="ltr">{formatFils(RECEIPT.grossFils)}</span>
              </div>
              <div className="mz-stage-expense" data-on={frame.step >= 4}>
                <span className="mz-stage-expense-main">
                  <strong>{text("hxHeroRecVendor")}</strong>
                  <small>{text("hxHeroRecCategory")}</small>
                </span>
                <span className="mz-stage-expense-amount">
                  <bdi dir="ltr">{formatFils(RECEIPT.grossFils)}</bdi>
                  <em>
                    {text("hxHeroRecVatBack")} <bdi dir="ltr">{formatFils(RECEIPT.vatFils)}</bdi>
                  </em>
                </span>
              </div>
            </div>
            <div className="mz-stage-vat" data-on={frame.step >= 5}>
              <small>{text("hxHeroVatTitle")}</small>
              <strong dir="ltr">AED {formatFils(toFils(Math.round(vatShown)))}</strong>
              <small>{text("hxHeroVatSub")}</small>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
