import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { Reveal } from "../home/Reveal";
import { useMarketingText, type MarketingText } from "../home/text";
import type { LegacySectionProps } from "../home/types";
import { tools } from "../content";
import {
  corporateTaxPreview,
  formatDeadlineDate,
  invoicePreview,
  readinessPreviewDate,
  vatPreview,
} from "./preview";
import "../home/home.css";
import "./pages.css";

const MONEY = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function Money({ fils, text }: { fils: number; text: MarketingText }) {
  return <bdi dir="ltr">{text("hxToolsAed", { amount: MONEY.format(fils / 100) })}</bdi>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The free tools as cards, each with a small preview computed by the tool's own logic. */
export function ToolsIndex({ base, locale, tr }: LegacySectionProps) {
  const text = useMarketingText(locale);
  const vat = vatPreview();
  const corporate = corporateTaxPreview();
  const invoice = invoicePreview();
  const [vatTool, corporateTool, readinessTool] = tools;

  const cards: {
    slug: string;
    title: string;
    lead: string;
    preview: ReactNode;
  }[] = [
    {
      slug: vatTool.slug,
      title: tr(vatTool.title),
      lead: text("hxToolsVatLead"),
      preview: (
        <>
          <Row label={text("hxToolsNet")}>
            <Money fils={vat.net} text={text} />
          </Row>
          <Row label={text("hxToolsVat")}>
            <Money fils={vat.vat} text={text} />
          </Row>
          <Row label={text("hxToolsTotal")}>
            <Money fils={vat.gross} text={text} />
          </Row>
        </>
      ),
    },
    {
      slug: corporateTool.slug,
      title: tr(corporateTool.title),
      lead: text("hxToolsCtLead"),
      preview: (
        <>
          <Row label={text("hxToolsCtIncome")}>
            <Money fils={corporate.incomeFils} text={text} />
          </Row>
          <Row label={text("hxToolsCtTax")}>
            <Money fils={corporate.taxFils} text={text} />
          </Row>
        </>
      ),
    },
    {
      slug: readinessTool.slug,
      title: tr(readinessTool.title),
      lead: text("hxToolsEinvLead"),
      preview: (
        <>
          <Row label={text("hxToolsEinvChecks")}>
            <bdi dir="ltr">4</bdi>
          </Row>
          <Row label={text("hxHubColAppoint")}>
            <time dateTime={readinessPreviewDate()}>
              {formatDeadlineDate(readinessPreviewDate(), locale)}
            </time>
          </Row>
        </>
      ),
    },
    {
      slug: "invoice-template",
      title: text("hxToolsInvTitle"),
      lead: text("hxToolsInvLead"),
      preview: (
        <>
          <Row label={text("hxToolsNet")}>
            <Money fils={invoice.net} text={text} />
          </Row>
          <Row label={text("hxToolsVat")}>
            <Money fils={invoice.vat} text={text} />
          </Row>
          <Row label={text("hxToolsTotal")}>
            <Money fils={invoice.gross} text={text} />
          </Row>
        </>
      ),
    },
  ];

  return (
    <section
      className="mz-band mz-band--light mz-page-tools"
      aria-label={text("hxToolsListLabel")}
      data-testid="tools-index"
    >
      <div className="phase-wrap">
        <ul className="mz-page-tool-grid">
          {cards.map((card, index) => (
            <li key={card.slug}>
              <Reveal className="mz-card mz-page-tool" delayMs={index * 70}>
                <h2>{card.title}</h2>
                <p>{card.lead}</p>
                <dl className="mz-page-preview" data-testid={`preview-${card.slug}`}>
                  {card.preview}
                </dl>
                <p className="mz-page-preview-tag">{text("hxToolsExample")}</p>
                <Link
                  className="phase-button phase-primary"
                  href={`${base}/tools/${card.slug}`}
                  aria-label={text("hxToolsOpenAria", { tool: card.title })}
                >
                  {text("hxToolsOpen")} <ArrowRight aria-hidden="true" />
                </Link>
              </Reveal>
            </li>
          ))}
        </ul>
        <p className="mz-page-note">{text("hxToolsDisclaimer")}</p>
      </div>
    </section>
  );
}

export default ToolsIndex;
