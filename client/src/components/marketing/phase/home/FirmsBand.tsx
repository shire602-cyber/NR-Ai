import { useState } from "react";
import { ArrowRight, ClipboardCheck, Users, UserRoundCheck, type LucideIcon } from "lucide-react";
import { Link } from "wouter";
import type { SectionProps } from "./types";
import { ProofPlaceholder } from "./ProofPlaceholder";
import { Reveal } from "./Reveal";
import { SectionHead } from "./SectionHead";
import { useMarketingText, type MarketingKey } from "./text";
import { Num } from "./showcase/frame";
import { TOUR_CLIENTS } from "./tour/sample";
import "./firms.css";

const FEATURES: readonly { icon: LucideIcon; title: MarketingKey; desc: MarketingKey }[] = [
  { icon: Users, title: "hxFirmFeatSwitchTitle", desc: "hxFirmFeatSwitchDesc" },
  { icon: UserRoundCheck, title: "hxFirmFeatPortalTitle", desc: "hxFirmFeatPortalDesc" },
  { icon: ClipboardCheck, title: "hxFirmFeatReviewTitle", desc: "hxFirmFeatReviewDesc" },
];

export function FirmsBand({ base, locale }: SectionProps) {
  const text = useMarketingText(locale);
  const [selected, setSelected] = useState(TOUR_CLIENTS[0]?.id ?? "");
  const client = TOUR_CLIENTS.find((c) => c.id === selected) ?? TOUR_CLIENTS[0];
  return (
    <section id="firms" data-testid="section-firms" className="mz-band mz-band--dark mz-firm">
      <div className="phase-wrap">
        <SectionHead
          eyebrow={text("hxFirmEyebrow")}
          title={text("hxFirmTitle")}
          lead={text("hxFirmLead")}
        />
        <div className="mz-firm-grid">
          <Reveal className="mz-firm-features">
            <ul>
              {FEATURES.map(({ icon: Icon, title, desc }) => (
                <li className="mz-firm-feature" key={title}>
                  <Icon aria-hidden="true" />
                  <div>
                    <h3>{text(title)}</h3>
                    <p>{text(desc)}</p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mz-firm-cta">
              <Link className="phase-button phase-primary" href={`${base}/contact`}>
                {text("hxFirmCta")}
              </Link>
              <Link className="phase-textlink" href={`${base}/solutions/accounting-firms`}>
                {text("hxFirmMore")} <ArrowRight aria-hidden="true" />
              </Link>
            </div>
            <p className="mz-firm-smb">
              {text("hxFirmSmb")}{" "}
              <Link className="phase-textlink" href={`${base}/solutions/small-business`}>
                {text("hxFirmSmbLink")} <ArrowRight aria-hidden="true" />
              </Link>
            </p>
          </Reveal>
          <Reveal className="mz-firm-visual" delayMs={120}>
            <div className="mz-firm-window" translate="no" lang={locale}>
              <div
                className="mz-firm-switcher"
                role="group"
                aria-label={text("hxFirmSwitcherLabel")}
              >
                {TOUR_CLIENTS.map((c) => (
                  <button
                    type="button"
                    className="mz-firm-client"
                    aria-pressed={c.id === client?.id}
                    onClick={() => setSelected(c.id)}
                    key={c.id}
                  >
                    {c.name[locale]}
                  </button>
                ))}
              </div>
              {client && (
                <dl className="mz-firm-stats">
                  <div>
                    <dt>{text("hxFirmOpenInvoices")}</dt>
                    <dd dir="ltr">{client.openInvoices}</dd>
                  </div>
                  <div>
                    <dt>{text("hxFirmOpenAmount")}</dt>
                    <dd>
                      <span className="mz-firm-ccy">{text("hxFirmCurrency")}</span>{" "}
                      <Num fils={client.openAmountFils} />
                    </dd>
                  </div>
                  <div>
                    <dt>{text("hxFirmToReview")}</dt>
                    <dd dir="ltr">{client.review}</dd>
                  </div>
                </dl>
              )}
            </div>
            <p className="mz-firm-sample">{text("hxFirmSample")}</p>
          </Reveal>
        </div>
        <ProofPlaceholder locale={locale} variant="firm" />
      </div>
    </section>
  );
}
