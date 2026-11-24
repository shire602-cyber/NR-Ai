import { useId, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { PAID_PLAN_IDS, type PaidPlanId } from "@shared/plans";
import { trialSignupPath } from "../route-content";
import type { SectionProps } from "./types";
import { SectionHead } from "./SectionHead";
import { useMarketingText, type MarketingKey, type MarketingText } from "./text";
import { useCountUp, useInView } from "./motion";
import {
  COMPARATORS,
  COMPETITOR_PRICES,
  type Comparator,
  type CompetitorId,
} from "./competitor-prices";
import { PENALTY_AED_PER_MONTH } from "./deadlines";
import {
  ASSUMPTIONS,
  DEFAULT_COMPARATOR,
  DEFAULT_PLAN,
  SLIDERS,
  computeSavings,
  formatAmount,
  formatAedWhole,
  formatHours,
  type SliderSpec,
} from "./savings";
import "./savings.css";

/** Placeholder glyph for "no figure"; the accessible label comes from the catalog. */
const DASH = "-";

const PLAN_KEYS: Record<PaidPlanId, MarketingKey> = {
  starter: "planStarter",
  professional: "planProfessional",
  enterprise: "planEnterprise",
};

/** Brand name of a comparator as written on the vendor's site (not translated). */
function comparatorBrand(c: Comparator): string | null {
  return c.plan ? `${c.brand} ${c.plan}` : c.brand;
}

function comparatorLabel(c: Comparator, text: MarketingText): string {
  return comparatorBrand(c) ?? text(c.id === "sheet" ? "hxSavSoftSheet" : "hxSavSoftOther");
}

interface SliderProps {
  id: string;
  label: string;
  spec: SliderSpec;
  value: number;
  valueText: string;
  onChange: (value: number) => void;
}

function Slider({ id, label, spec, value, valueText, onChange }: SliderProps) {
  return (
    <div className="mz-sav-field">
      <div className="mz-sav-field-head">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id} className="mz-sav-value">
          {valueText}
        </output>
      </div>
      <input
        id={id}
        className="mz-sav-range"
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        aria-valuetext={valueText}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

export function SavingsCalculator({ locale }: SectionProps) {
  const text = useMarketingText(locale);
  const uid = useId();
  const [invoices, setInvoices] = useState<number>(SLIDERS.invoices.default);
  const [receipts, setReceipts] = useState<number>(SLIDERS.receipts.default);
  const [hours, setHours] = useState<number>(SLIDERS.hours.default);
  const [rate, setRate] = useState<number>(SLIDERS.rate.default);
  const [comparatorId, setComparatorId] = useState<CompetitorId>(DEFAULT_COMPARATOR);
  const [plan, setPlan] = useState<PaidPlanId>(DEFAULT_PLAN);
  const [touched, setTouched] = useState(false);

  const result = useMemo(
    () => computeSavings({ invoices, receipts, hours, rate, comparator: comparatorId, plan }),
    [invoices, receipts, hours, rate, comparatorId, plan]
  );
  const comparator = COMPARATORS.find((c) => c.id === comparatorId) ?? COMPARATORS[0];

  const resultsRef = useRef<HTMLDivElement>(null);
  const inView = useInView(resultsRef);
  const yearAed = Math.round(result.valueYearFils / 100);
  const animated = useCountUp(yearAed, { enabled: inView });
  const shownYear = touched ? yearAed : Math.round(animated);

  const aed = (amount: string) => text("hxSavAed", { amount });
  const change = (setter: (value: number) => void) => (value: number) => {
    setTouched(true);
    setter(value);
  };

  const { software } = result;
  let softwareLine: string;
  if (software.diffAed === null) softwareLine = text("hxSavSwNone");
  else if (software.diffAed > 0)
    softwareLine = text("hxSavSwLess", { amount: formatAmount(software.diffAed) });
  else if (software.diffAed < 0)
    softwareLine = text("hxSavSwMore", { amount: formatAmount(-software.diffAed) });
  else softwareLine = text("hxSavSwSame");

  const theirsName = comparatorLabel(comparator, text);
  const dash = (
    <span aria-label={text("hxSavDashLabel")} role="img">
      {DASH}
    </span>
  );
  const ctxNote = comparator.note ? text(comparator.note) : null;

  return (
    <section id="savings" data-testid="section-savings" className="mz-band mz-band--sand mz-sav">
      <div className="phase-wrap">
        <SectionHead title={text("hxSavTitle")} lead={text("hxSavLead")} />

        <div className="mz-sav-grid">
          <fieldset className="mz-card mz-sav-inputs">
            <legend className="mz-sav-legend">{text("hxSavInputs")}</legend>
            <Slider
              id={`${uid}-invoices`}
              label={text("hxSavInvoices")}
              spec={SLIDERS.invoices}
              value={invoices}
              valueText={text("hxSavValInvoices", { n: invoices })}
              onChange={change(setInvoices)}
            />
            <Slider
              id={`${uid}-receipts`}
              label={text("hxSavReceipts")}
              spec={SLIDERS.receipts}
              value={receipts}
              valueText={text("hxSavValReceipts", { n: receipts })}
              onChange={change(setReceipts)}
            />
            <Slider
              id={`${uid}-hours`}
              label={text("hxSavHours")}
              spec={SLIDERS.hours}
              value={hours}
              valueText={text("hxSavValHours", { n: hours })}
              onChange={change(setHours)}
            />
            <Slider
              id={`${uid}-rate`}
              label={text("hxSavRate")}
              spec={SLIDERS.rate}
              value={rate}
              valueText={text("hxSavValRate", { n: rate })}
              onChange={change(setRate)}
            />
            <div className="mz-sav-selects">
              <div className="mz-sav-field">
                <label htmlFor={`${uid}-software`}>{text("hxSavSoftware")}</label>
                <select
                  id={`${uid}-software`}
                  className="mz-sav-select"
                  value={comparatorId}
                  onChange={(event) => {
                    setTouched(true);
                    setComparatorId(event.target.value as CompetitorId);
                  }}
                >
                  {COMPARATORS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {comparatorLabel(c, text)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mz-sav-field">
                <label htmlFor={`${uid}-plan`}>{text("hxSavPlan")}</label>
                <select
                  id={`${uid}-plan`}
                  className="mz-sav-select"
                  value={plan}
                  onChange={(event) => {
                    setTouched(true);
                    setPlan(event.target.value as PaidPlanId);
                  }}
                >
                  {PAID_PLAN_IDS.map((id) => (
                    <option key={id} value={id}>
                      {text(PLAN_KEYS[id])}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </fieldset>

          <div className="mz-card mz-sav-results" ref={resultsRef}>
            <div className="mz-sav-results-head">
              <h3 className="mz-sav-h3">{text("hxSavResults")}</h3>
              <span className="mz-badge">{text("hxSavEstimate")}</span>
            </div>

            <div className="mz-sav-big" data-testid="savings-headline">
              <p className="mz-sav-big-label">{text("hxSavHeadline")}</p>
              <p className="mz-sav-big-num" aria-hidden="true">
                {aed(formatAmount(shownYear))}
              </p>
            </div>

            <div aria-live="polite" aria-atomic="true" data-testid="savings-live">
              <p className="mz-sav-sr">
                {text("hxSavHeadline")}: {aed(formatAmount(yearAed))}
              </p>
              <dl className="mz-sav-stats">
                <div>
                  <dt>{text("hxSavHoursSaved")}</dt>
                  <dd data-testid="savings-hours">
                    {text("hxSavHoursVal", { n: formatHours(result.hoursSaved) })}
                  </dd>
                </div>
                <div>
                  <dt>{text("hxSavTimeMonth")}</dt>
                  <dd data-testid="savings-month">{aed(formatAedWhole(result.valueMonthFils))}</dd>
                </div>
                <div>
                  <dt>{text("hxSavTimeYear")}</dt>
                  <dd data-testid="savings-year">{aed(formatAedWhole(result.valueYearFils))}</dd>
                </div>
              </dl>

              <div className="mz-sav-software" data-testid="savings-software">
                <h4 className="mz-sav-h4">{text("hxSavSwTitle")}</h4>
                <dl className="mz-sav-stats">
                  <div>
                    <dt>{text("hxSavSwTheirs", { name: theirsName })}</dt>
                    <dd data-testid="savings-theirs">
                      {software.theirsYearAed === null
                        ? dash
                        : aed(formatAmount(software.theirsYearAed))}
                    </dd>
                  </div>
                  <div>
                    <dt>{text("hxSavSwOurs", { plan: text(PLAN_KEYS[plan]) })}</dt>
                    <dd data-testid="savings-ours">{aed(formatAmount(software.oursYearAed))}</dd>
                  </div>
                </dl>
                <p
                  className="mz-sav-diff"
                  data-testid="savings-diff"
                  data-tone={software.diffAed !== null && software.diffAed < 0 ? "more" : "neutral"}
                >
                  {softwareLine}
                </p>
                {ctxNote && <p className="mz-sav-note">{ctxNote}</p>}
              </div>
            </div>

            <div className="mz-sav-context" data-testid="savings-penalty">
              <p className="mz-sav-context-label">{text("hxSavContextLabel")}</p>
              <p className="mz-sav-context-line">
                {text("hxSavPenalty", { amount: formatAmount(PENALTY_AED_PER_MONTH) })}
              </p>
            </div>

            <Link className="phase-button phase-primary mz-sav-cta" href={trialSignupPath}>
              {text("hxSavCta")} <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </div>

        <details className="mz-sav-how" data-testid="savings-how">
          <summary>{text("hxSavHow")}</summary>
          <p>{text("hxSavHowIntro")}</p>
          <table className="mz-sav-table">
            <thead>
              <tr>
                <th scope="col">{text("hxSavAsHead")}</th>
                <th scope="col">{text("hxSavAsValueHead")}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">{text("hxSavAsInvoice")}</th>
                <td>{text("hxSavAsMin", { n: ASSUMPTIONS.minutesPerInvoice })}</td>
              </tr>
              <tr>
                <th scope="row">{text("hxSavAsReceipt")}</th>
                <td>{text("hxSavAsMin", { n: ASSUMPTIONS.minutesPerReceipt })}</td>
              </tr>
              <tr>
                <th scope="row">{text("hxSavAsCap")}</th>
                <td>{text("hxSavAsPct", { n: Math.round(ASSUMPTIONS.capShare * 100) })}</td>
              </tr>
            </tbody>
          </table>
          <p>{text("hxSavHowPlans")}</p>
          <p>{text("hxSavPriceAsOf")}</p>
          <ul className="mz-sav-sources">
            <li>
              <a href={COMPETITOR_PRICES.wafeq.source} target="_blank" rel="noopener noreferrer">
                {text("hxSavSourceWafeq")}
              </a>
            </li>
            <li>
              <a href={COMPETITOR_PRICES.zoho.source} target="_blank" rel="noopener noreferrer">
                {text("hxSavSourceZoho")}
              </a>
            </li>
          </ul>
          <p className="mz-sav-fine">{text("hxSavTrademark")}</p>
        </details>
      </div>
    </section>
  );
}
