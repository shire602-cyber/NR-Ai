import type { SectionProps } from "./types";
import { useMarketingText, type MarketingKey } from "./text";

const CHIPS: readonly MarketingKey[] = [
  "hxChipPrices",
  "hxChipBilingual",
  "hxChipVat",
  "hxChipPint",
  "hxChipWps",
  "hxChipNoCard",
];

export function TrustChips({ locale }: SectionProps) {
  const text = useMarketingText(locale);
  return (
    <section
      id="trust-chips"
      data-testid="section-trust-chips"
      className="mz-band mz-band--light mz-band--tight"
      aria-label={text("hxChipLabel")}
    >
      <div className="phase-wrap">
        <ul className="mz-chips">
          {CHIPS.map((key) => (
            <li className="mz-chip" key={key}>
              {text(key)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
