import {
  BadgeCheck,
  Banknote,
  CreditCard,
  FileCheck2,
  Languages,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import type { SectionProps } from "./types";
import { useMarketingText, type MarketingKey } from "./text";

const CHIPS: readonly { key: MarketingKey; Icon: LucideIcon }[] = [
  { key: "hxChipPrices", Icon: Banknote },
  { key: "hxChipBilingual", Icon: Languages },
  { key: "hxChipVat", Icon: Receipt },
  { key: "hxChipPint", Icon: FileCheck2 },
  { key: "hxChipWps", Icon: BadgeCheck },
  { key: "hxChipNoCard", Icon: CreditCard },
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
          {CHIPS.map(({ key, Icon }) => (
            <li className="mz-chip" key={key}>
              <Icon aria-hidden="true" size={16} />
              {text(key)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
