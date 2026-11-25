import { ArrowRight, Braces, Check, FileText, Network, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { MARKETING_BRAND } from "@shared/marketing-brand";
import { FreeTool } from "../Forms";
import { DeadlineFinder } from "../home/DeadlineFinder";
import { Reveal } from "../home/Reveal";
import { SectionHead } from "../home/SectionHead";
import {
  DEADLINES,
  DEADLINE_SOURCES,
  PENALTY_TEXT_VARS,
  type DeadlineSegment,
} from "../home/deadlines";
import { useMarketingText, type MarketingKey } from "../home/text";
import type { LegacySectionProps } from "../home/types";
import { trialSignupPath } from "../route-content";
import { formatDeadlineDate } from "./preview";
import "../home/home.css";
import "./pages.css";

const STEPS = [
  { icon: Braces, title: "hxHubStep1Title", desc: "hxHubStep1Desc" },
  { icon: Network, title: "hxHubStep2Title", desc: "hxHubStep2Desc" },
  { icon: ShieldCheck, title: "hxHubStep3Title", desc: "hxHubStep3Desc" },
  { icon: FileText, title: "hxHubStep4Title", desc: "hxHubStep4Desc" },
] as const satisfies readonly { icon: unknown; title: MarketingKey; desc: MarketingKey }[];

const SEGMENTS: readonly { id: DeadlineSegment; label: MarketingKey }[] = [
  { id: "large", label: "hxHubTypeLarge" },
  { id: "small", label: "hxHubTypeSmall" },
  { id: "government", label: "hxHubTypeGov" },
];

const INCLUDED: readonly MarketingKey[] = ["hxHubInc1", "hxHubInc2", "hxHubInc3"];

const FAQ: readonly { q: MarketingKey; a: MarketingKey }[] = [
  { q: "hxHubFaq1Q", a: "hxHubFaq1A" },
  { q: "hxHubFaq2Q", a: "hxHubFaq2A" },
  { q: "hxHubFaq3Q", a: "hxHubFaq3A" },
  { q: "hxHubFaq4Q", a: "hxHubFaq4A" },
  { q: "hxHubFaq5Q", a: "hxHubFaq5A" },
  { q: "hxHubFaq6Q", a: "hxHubFaq6A" },
];

/** Body of the UAE e-invoicing hub, below the page heading rendered by PhaseSite. */
export function EinvoicingHub({ base, locale, tr }: LegacySectionProps) {
  const text = useMarketingText(locale);
  const brand = MARKETING_BRAND.name[locale];
  const vars = { brand, ...PENALTY_TEXT_VARS };

  return (
    <div data-testid="einvoicing-hub">
      <DeadlineFinder base={base} locale={locale} headingLevel={2} compact={false} />

      <section
        id="how-it-works"
        className="mz-band mz-band--light mz-page-how"
        aria-labelledby="hub-how-title"
      >
        <div className="phase-wrap">
          <SectionHead
            id="hub-how-title"
            title={text("hxHubHowTitle")}
            lead={text("hxHubHowLead")}
          />
          <ol className="mz-page-steps" aria-label={text("hxHubStepsLabel")}>
            {STEPS.map(({ icon: Icon, title, desc }, index) => (
              <li className="mz-card mz-page-step" key={title}>
                <span className="mz-page-step-icon" aria-hidden="true">
                  <Icon />
                </span>
                <span className="mz-page-step-no" aria-hidden="true">
                  {index + 1}
                </span>
                <h3>{text(title)}</h3>
                <p>{text(desc, vars)}</p>
              </li>
            ))}
          </ol>
          <p className="mz-page-note">{text("einvPageStructured", { brand })}</p>
          <a
            className="phase-textlink"
            href="https://mof.gov.ae/en/about-us/initiatives/einvoicing/einvoicing-accredited-service-providers-asps/"
            target="_blank"
            rel="noopener noreferrer"
          >
            {text("einvPageSource")}
          </a>
        </div>
      </section>

      <section
        id="who-is-in-scope"
        className="mz-band mz-band--sand mz-page-scope"
        aria-labelledby="hub-scope-title"
      >
        <div className="phase-wrap">
          <SectionHead
            id="hub-scope-title"
            title={text("hxHubScopeTitle")}
            lead={text("hxHubScopeLead")}
          />
          <div className="mz-page-pair">
            <Reveal className="mz-card mz-page-scope-card">
              <h3>{text("hxHubInTitle")}</h3>
              <p>{text("hxHubInDesc")}</p>
            </Reveal>
            <Reveal className="mz-card mz-page-scope-card" delayMs={80}>
              <h3>{text("hxHubOutTitle")}</h3>
              <p>{text("hxHubOutDesc")}</p>
              <a
                className="phase-textlink"
                href={DEADLINE_SOURCES.scope[locale]}
                target="_blank"
                rel="noopener noreferrer"
              >
                {text("hxDlSourceScope")}
              </a>
            </Reveal>
          </div>
          <h3 className="mz-page-subhead">{text("hxHubDatesTitle")}</h3>
          <div
            className="mz-page-table-scroll"
            tabIndex={0}
            role="region"
            aria-label={text("hxHubDatesCaption")}
          >
            <table className="mz-page-table" data-testid="hub-dates">
              <caption className="mz-page-sr">{text("hxHubDatesCaption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{text("hxHubColType")}</th>
                  <th scope="col">{text("hxHubColAppoint")}</th>
                  <th scope="col">{text("hxHubColLive")}</th>
                </tr>
              </thead>
              <tbody>
                {SEGMENTS.map(({ id, label }) => (
                  <tr key={id}>
                    <th scope="row">{text(label)}</th>
                    <td>
                      <time dateTime={DEADLINES[id].appoint}>
                        {formatDeadlineDate(DEADLINES[id].appoint, locale)}
                      </time>
                    </td>
                    <td>
                      <time dateTime={DEADLINES[id].live}>
                        {formatDeadlineDate(DEADLINES[id].live, locale)}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mz-page-note">
            <strong>{text("hxDlPenalty", PENALTY_TEXT_VARS)}.</strong> {text("hxDlSourcesIntro")}{" "}
            <a href={DEADLINE_SOURCES.fta} target="_blank" rel="noopener noreferrer">
              {text("hxDlSourceFta")}
            </a>
            {" · "}
            <a href={DEADLINE_SOURCES.mof} target="_blank" rel="noopener noreferrer">
              {text("hxDlSourceMof")}
            </a>
            {" · "}
            <a href={DEADLINE_SOURCES.penalty} target="_blank" rel="noopener noreferrer">
              {text("hxDlSourcePenalty")}
            </a>
          </p>
        </div>
      </section>

      <section
        id="included"
        className="mz-band mz-band--light mz-page-included"
        aria-labelledby="hub-inc-title"
      >
        <div className="phase-wrap mz-page-split">
          <div>
            <SectionHead
              id="hub-inc-title"
              title={text("hxHubIncTitle")}
              lead={text("hxHubIncLead", vars)}
            />
            <div className="phase-cta-row">
              <Link className="phase-button phase-primary" href={trialSignupPath}>
                {text("hxCtaPrimary")}
              </Link>
              <Link className="phase-button phase-outline" href={`${base}/pricing`}>
                {text("hxHubIncPlans")}
              </Link>
            </div>
          </div>
          <ul className="mz-page-checks">
            {INCLUDED.map((key) => (
              <li key={key}>
                <Check aria-hidden="true" />
                <span>{text(key)}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section
        id="readiness"
        className="mz-band mz-band--sand mz-page-ready"
        aria-labelledby="hub-ready-title"
      >
        <div className="phase-wrap">
          <SectionHead
            id="hub-ready-title"
            title={text("hxHubReadyTitle")}
            lead={text("hxHubReadyLead")}
          />
          <div className="mz-card mz-page-embed" data-testid="hub-readiness">
            <FreeTool slug="e-invoicing-readiness" tr={tr} locale={locale} />
          </div>
          <p>
            <Link className="phase-textlink" href={`${base}/tools/e-invoicing-readiness`}>
              {text("hxHubReadyOpen")} <ArrowRight aria-hidden="true" />
            </Link>
          </p>
        </div>
      </section>

      <section
        id="faq"
        className="mz-band mz-band--light mz-page-faq"
        aria-labelledby="hub-faq-title"
      >
        <div className="phase-wrap">
          <SectionHead id="hub-faq-title" title={text("hxHubFaqTitle")} />
          <div className="mz-page-faq-list">
            {FAQ.map(({ q, a }) => (
              <details key={q}>
                <summary>{text(q, vars)}</summary>
                <p>{text(a, vars)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

export default EinvoicingHub;
