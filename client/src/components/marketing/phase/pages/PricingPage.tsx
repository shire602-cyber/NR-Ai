import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { formatAmountDigits, formatMoneyText } from "@/lib/format-money";
import {
  COMPARE_GROUPS,
  PLANS,
  planNameKey,
  planPrice,
  type Cell,
  type CompareGroup,
  type CompareRow,
} from "../../plans";
import { ComparisonTable } from "../home/ComparisonTable";
import { Faq } from "../home/Faq";
import { PlanCards } from "../home/PricingSection";
import { SectionHead } from "../home/SectionHead";
import { useMarketingText, type MarketingKey } from "../home/text";
import type { LegacySectionProps } from "../home/types";
import "../home/pricing.css";

/** `marketing.prRowCompanies` -> `prRowCompanies` (the catalog keys in plans.ts carry the prefix). */
const keyOf = (catalogKey: string) => catalogKey.replace(/^marketing\./, "") as MarketingKey;

/**
 * Rows of the matrix: the shared plan comparison (components/marketing/plans.ts, itself built from
 * shared/plans.ts, so gates and limits are the server's), with e-invoicing first because it is
 * the one row that is included on every plan.
 */
const MATRIX_GROUPS: readonly CompareGroup[] = [
  {
    key: "marketing.prEveryEyebrow",
    rows: [
      {
        key: "marketing.prEveryEinvoiceTitle",
        cells: Object.fromEntries(PLANS.map((plan) => [plan.id, true])) as CompareRow["cells"],
      },
    ],
  },
  ...COMPARE_GROUPS,
];

function MatrixCell({
  cell,
  unit,
  locale,
}: Pick<CompareRow, "unit"> & {
  cell: Cell;
  locale: LegacySectionProps["locale"];
}) {
  const text = useMarketingText(locale);
  if (cell === true) {
    return (
      <span className="mz-price-yes">
        <span aria-hidden="true">{"✓"}</span>
        <span className="sr-only">{text("prIncluded")}</span>
      </span>
    );
  }
  if (cell === false) {
    return (
      <span className="mz-price-no">
        <span aria-hidden="true">{"–"}</span>
        <span className="sr-only">{text("pricingNotIncluded")}</span>
      </span>
    );
  }
  if (typeof cell === "number") {
    return (
      <span>
        {unit === "gb"
          ? text("prValGb", { n: formatAmountDigits(cell, 0) })
          : formatAmountDigits(cell, 0)}
      </span>
    );
  }
  return <span>{text(keyOf(cell))}</span>;
}

/** Plans by feature, from the real entitlements. */
export function FeatureMatrix({ locale }: Pick<LegacySectionProps, "locale">) {
  const text = useMarketingText(locale);
  return (
    <section
      id="plan-matrix"
      data-testid="section-plan-matrix"
      className="mz-band mz-band--sand mz-price-matrix-band"
    >
      <div className="phase-wrap">
        <SectionHead title={text("hxPriceMatrixTitle")} lead={text("hxPriceMatrixLead")} />
        <div
          className="mz-price-matrix-scroll"
          tabIndex={0}
          role="region"
          aria-label={text("hxPriceMatrixCaption")}
        >
          <table className="mz-price-matrix" data-testid="plan-matrix">
            <caption>{text("hxPriceMatrixCaption")}</caption>
            <thead>
              <tr>
                <th scope="col">{text("hxPriceMatrixFeature")}</th>
                {PLANS.map((plan) => (
                  <th
                    key={plan.id}
                    scope="col"
                    data-plan={plan.id}
                    data-featured={plan.featured ? "true" : undefined}
                  >
                    {text(keyOf(planNameKey(plan.id)))}
                    <small>
                      {text("prPerMonthShort", {
                        amount: formatMoneyText(planPrice(plan, "monthly"), "AED", locale, {
                          fractionDigits: 0,
                        }),
                      })}
                    </small>
                  </th>
                ))}
              </tr>
            </thead>
            {MATRIX_GROUPS.map((group) => (
              <tbody key={group.key}>
                <tr className="mz-price-group">
                  <th scope="colgroup" colSpan={PLANS.length + 1}>
                    {text(keyOf(group.key))}
                  </th>
                </tr>
                {group.rows.map((row) => (
                  <tr key={row.key} data-row={row.key}>
                    <th scope="row">
                      {text(keyOf(row.key))}
                      {row.noteKey ? <small>{text(keyOf(row.noteKey))}</small> : null}
                    </th>
                    {PLANS.map((plan) => (
                      <td key={plan.id} data-featured={plan.featured ? "true" : undefined}>
                        <MatrixCell cell={row.cells[plan.id]} unit={row.unit} locale={locale} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </div>
    </section>
  );
}

/** Body of /en/pricing and /ar/pricing; the page wrapper renders the h1. */
export function PricingPage({ base, locale, tr }: LegacySectionProps) {
  const text = useMarketingText(locale);
  return (
    <div className="mz-price-page" data-testid="pricing-page">
      <section
        id="pricing"
        data-testid="section-pricing"
        className="mz-band mz-band--light mz-price"
      >
        <div className="phase-wrap">
          <SectionHead title={text("hxPriceTitle")} lead={text("hxPriceLead")} />
          <PlanCards base={base} locale={locale} tr={tr} immediate />
          <p className="mz-price-note mz-price-readonly" data-testid="price-readonly">
            {text("hxPriceReadOnly")}
          </p>
          <p className="mz-price-links">
            <Link className="phase-textlink" href="/pricing" data-testid="link-price-legacy">
              {text("hxPriceFullComparison")} <ArrowRight aria-hidden="true" />
            </Link>
          </p>
        </div>
      </section>
      <FeatureMatrix locale={locale} />
      <ComparisonTable base={base} locale={locale} headingLevel={2} />
      <Faq base={base} locale={locale} tr={tr} />
    </div>
  );
}
