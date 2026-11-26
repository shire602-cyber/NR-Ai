import { ArrowRight, Check } from "lucide-react";
import { Link } from "wouter";
import { MARKETING_BRAND } from "@shared/marketing-brand";
import type { SectionProps } from "./types";
import { COMPARISON_ROWS, COMPARISON_SOURCES } from "./comparison";
import { useMarketingText, type MarketingKey } from "./text";
import "./switch.css";

/**
 * Rows of the comparison table the strip leads with, in this order. The labels are the table's own
 * row labels (home/comparison.ts), so the strip and the /compare pages cannot drift apart; only
 * e-invoicing has its own wording because the row label alone ("E-invoicing") says nothing.
 */
const POINT_ROWS = ["wps", "firm", "bilingual", "einvoicing"] as const;
const POINT_LABEL: Partial<Record<(typeof POINT_ROWS)[number], MarketingKey>> = {
  einvoicing: "hxSwitchEinv",
};
const VENDORS = ["wafeq", "zoho"] as const;

/**
 * Slim "Switching from Wafeq or Zoho Books?" band for the homepage and /pricing. It names what
 * Muhasib includes and links to the two comparison pages; competitor prices, sources and the
 * checked-on date live only on those pages.
 */
export function SwitchStrip({ base, locale }: SectionProps) {
  const text = useMarketingText(locale);
  const brand = MARKETING_BRAND.name[locale];
  return (
    <section
      id="switch"
      data-testid="section-switch"
      className="mz-band mz-band--light mz-switch"
      aria-labelledby="switch-title"
    >
      <div className="phase-wrap mz-switch-row">
        <div className="mz-switch-copy">
          <h2 className="mz-switch-title" id="switch-title">
            {text("hxSwitchTitle")}
          </h2>
          <p className="mz-switch-lead">{text("hxSwitchLead")}</p>
          <ul className="mz-switch-points">
            {POINT_ROWS.map((id) => {
              const row = COMPARISON_ROWS.find((r) => r.id === id);
              return (
                <li key={id} data-point={id}>
                  <Check aria-hidden="true" />
                  <span>{text(POINT_LABEL[id] ?? row!.labelKey)}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="mz-switch-links">
          {VENDORS.map((id) => (
            <Link
              key={id}
              className="phase-button phase-outline"
              href={`${base}/compare/${COMPARISON_SOURCES[id].path}`}
            >
              {text(COMPARISON_SOURCES[id].vsKey, { brand })} <ArrowRight aria-hidden="true" />
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
