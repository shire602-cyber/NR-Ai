import { lazy, Suspense, useRef, type ComponentType } from "react";
import { ArrowRight, Check } from "lucide-react";
import { Link } from "wouter";
import { featurePath } from "../route-content";
import type { SectionProps } from "./types";
import { useInView } from "./motion";
import { Reveal } from "./Reveal";
import { SectionHead } from "./SectionHead";
import { useMarketingText, type MarketingKey } from "./text";
import type { VisualProps } from "./showcase/frame";
import "./showcase.css";

type Visual = ComponentType<VisualProps>;

interface Row {
  id: string;
  slug: string;
  band: "dark" | "light" | "sand";
  keys: {
    name: MarketingKey;
    title: MarketingKey;
    lead: MarketingKey;
    bullets: readonly [MarketingKey, MarketingKey, MarketingKey];
    alt: MarketingKey;
  };
  Visual: Visual;
}

/* One lazy chunk per visual, loaded when its row nears the viewport. */
const ReceiptVisual = lazy(() => import("./showcase/ReceiptVisual"));
const InvoiceVisual = lazy(() => import("./showcase/InvoiceVisual"));
const VatVisual = lazy(() => import("./showcase/VatVisual"));
const BankVisual = lazy(() => import("./showcase/BankVisual"));
const PayrollVisual = lazy(() => import("./showcase/PayrollVisual"));
const ReportsVisual = lazy(() => import("./showcase/ReportsVisual"));
const StockVisual = lazy(() => import("./showcase/StockVisual"));

/** Order, bands and feature pages of the seven rows (dark and light alternate for rhythm). */
const SHOWCASE_ROWS: readonly Row[] = [
  {
    id: "receipt",
    slug: "receipt-scanning",
    band: "dark",
    keys: {
      name: "hxShowRcptName",
      title: "hxShowRcptTitle",
      lead: "hxShowRcptLead",
      bullets: ["hxShowRcptB1", "hxShowRcptB2", "hxShowRcptB3"],
      alt: "hxShowRcptAlt",
    },
    Visual: ReceiptVisual,
  },
  {
    id: "invoice",
    slug: "invoicing",
    band: "light",
    keys: {
      name: "hxShowInvName",
      title: "hxShowInvTitle",
      lead: "hxShowInvLead",
      bullets: ["hxShowInvB1", "hxShowInvB2", "hxShowInvB3"],
      alt: "hxShowInvAlt",
    },
    Visual: InvoiceVisual,
  },
  {
    id: "vat",
    slug: "vat",
    band: "dark",
    keys: {
      name: "hxShowVatName",
      title: "hxShowVatTitle",
      lead: "hxShowVatLead",
      bullets: ["hxShowVatB1", "hxShowVatB2", "hxShowVatB3"],
      alt: "hxShowVatAlt",
    },
    Visual: VatVisual,
  },
  {
    id: "bank",
    slug: "bank-reconciliation",
    band: "light",
    keys: {
      name: "hxShowBankName",
      title: "hxShowBankTitle",
      lead: "hxShowBankLead",
      bullets: ["hxShowBankB1", "hxShowBankB2", "hxShowBankB3"],
      alt: "hxShowBankAlt",
    },
    Visual: BankVisual,
  },
  {
    id: "payroll",
    slug: "payroll",
    band: "dark",
    keys: {
      name: "hxShowPayName",
      title: "hxShowPayTitle",
      lead: "hxShowPayLead",
      bullets: ["hxShowPayB1", "hxShowPayB2", "hxShowPayB3"],
      alt: "hxShowPayAlt",
    },
    Visual: PayrollVisual,
  },
  {
    id: "reports",
    slug: "reporting",
    band: "light",
    keys: {
      name: "hxShowRepName",
      title: "hxShowRepTitle",
      lead: "hxShowRepLead",
      bullets: ["hxShowRepB1", "hxShowRepB2", "hxShowRepB3"],
      alt: "hxShowRepAlt",
    },
    Visual: ReportsVisual,
  },
  {
    id: "stock",
    slug: "inventory",
    band: "sand",
    keys: {
      name: "hxShowStockName",
      title: "hxShowStockTitle",
      lead: "hxShowStockLead",
      bullets: ["hxShowStockB1", "hxShowStockB2", "hxShowStockB3"],
      alt: "hxShowStockAlt",
    },
    Visual: StockVisual,
  },
];

/** Loads the visual's chunk only once its row is close to the viewport. */
function LazyVisual({ Visual, ...props }: VisualProps & { Visual: Visual }) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useInView(ref, { rootMargin: "400px 0px 400px 0px", threshold: 0 });
  return (
    <div ref={ref} className="mz-show-slot">
      {near && (
        <Suspense fallback={null}>
          <Visual {...props} />
        </Suspense>
      )}
    </div>
  );
}

export function Showcase({ base, locale }: SectionProps) {
  const text = useMarketingText(locale);
  return (
    <section id="features" data-testid="section-features" className="mz-show">
      <div className="mz-band mz-band--light mz-show-head">
        <div className="phase-wrap">
          <SectionHead title={text("hxShowTitle")} lead={text("hxShowLead")} />
        </div>
      </div>
      {SHOWCASE_ROWS.map((row, index) => (
        <div
          className={`mz-band mz-band--${row.band} mz-show-row`}
          data-testid={`showcase-row-${row.id}`}
          data-flip={index % 2 === 1 ? "true" : "false"}
          key={row.id}
        >
          <div className="phase-wrap mz-show-grid">
            <Reveal className="mz-show-text">
              <h3 className="mz-show-title">{text(row.keys.title)}</h3>
              <p className="mz-show-lead">{text(row.keys.lead)}</p>
              <ul className="mz-show-bullets">
                {row.keys.bullets.map((key) => (
                  <li key={key}>
                    <Check aria-hidden="true" />
                    <span>{text(key)}</span>
                  </li>
                ))}
              </ul>
              <Link
                className="phase-textlink mz-show-explore"
                href={`${base}${featurePath(row.slug)}`}
                aria-label={text("hxShowExploreAria", { name: text(row.keys.name) })}
              >
                {text("hxShowExplore")} <ArrowRight aria-hidden="true" />
              </Link>
            </Reveal>
            <LazyVisual
              Visual={row.Visual}
              locale={locale}
              text={text}
              label={text(row.keys.alt)}
            />
          </div>
        </div>
      ))}
    </section>
  );
}
