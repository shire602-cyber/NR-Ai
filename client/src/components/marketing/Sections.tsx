import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowRight, Check, Plus, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";

/*
 * Shared marketing section primitives (R3, CTO 8/9; WP-B): the line-eyebrow heading, checklist,
 * hairline tiles, questions block and closing band. The landing page, /pricing and the inner
 * public pages all use these, so every public page reads as one system. Styles: marketing.css.
 */

export function SectionHeading({
  eyebrow,
  title,
  body,
  center,
  id,
}: {
  eyebrow?: string;
  title: string;
  body?: ReactNode;
  center?: boolean;
  id?: string;
}) {
  return (
    <div className={`mk-heading${center ? " mk-heading--center" : ""}`}>
      {eyebrow ? <p className="mk-eyebrow">{eyebrow}</p> : null}
      <h2 className="mk-h2" id={id}>
        {title}
      </h2>
      {body ? <p className="mk-lead">{body}</p> : null}
    </div>
  );
}

export function Checklist({ items, columns }: { items: ReactNode[]; columns?: 2 }) {
  return (
    <ul className="mk-checklist" data-columns={columns}>
      {items.map((item, i) => (
        <li key={i}>
          <Check aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export interface TileItem {
  key: string;
  icon?: LucideIcon;
  title: ReactNode;
  body: ReactNode;
  testId?: string;
}

/** Hairline tiles: icon, title, one paragraph. 2 or 3 columns from tablet up. */
export function Tiles({ items, columns = 3 }: { items: TileItem[]; columns?: 2 | 3 }) {
  return (
    <ul className="mk-tiles" data-columns={columns}>
      {items.map(({ key, icon: Icon, title, body, testId }) => (
        <li key={key} className="mk-tile" data-testid={testId}>
          {Icon ? (
            <span className="mk-feature__icon">
              <Icon aria-hidden="true" />
            </span>
          ) : null}
          <h3 className="mk-h3">{title}</h3>
          <p className="mk-body">{body}</p>
        </li>
      ))}
    </ul>
  );
}

export interface FaqItem {
  q: ReactNode;
  a: ReactNode;
  /** Optional follow-up link under the answer. */
  link?: { href: string; label: ReactNode };
}

/**
 * Questions block shared by the landing page and /pricing: eyebrow + H2 in the start column,
 * the accordion in the end column (one column on phones).
 */
export function FaqSection({
  id,
  eyebrow,
  title,
  items,
}: {
  id: string;
  eyebrow: string;
  title: string;
  items: FaqItem[];
}) {
  return (
    <section className="mk-section" aria-labelledby={id}>
      <div className="mk-container mk-split">
        <SectionHeading id={id} eyebrow={eyebrow} title={title} />
        <div className="mk-faq">
          {items.map((item, i) => (
            <details key={i}>
              <summary>
                <span>{item.q}</span>
                <Plus aria-hidden="true" />
              </summary>
              <div className="mk-faq__answer">
                <p>{item.a}</p>
                {item.link ? (
                  <Link href={item.link.href} className="mk-link">
                    {item.link.label}
                    <ArrowRight className="mk-flip" aria-hidden="true" width={16} height={16} />
                  </Link>
                ) : null}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/** The closing band every marketing page ends with (landing, pricing, services). */
export function ClosingCta() {
  const { t } = useTranslation();
  return (
    <section className="mk-section mk-section--flush-top" aria-labelledby="mk-cta-title">
      <div className="mk-container">
        <div className="mk-cta">
          <h2 id="mk-cta-title" className="mk-h2">
            {t["marketing.ctaTitle"]}
          </h2>
          <p className="mk-lead">{t["marketing.ctaBody"]}</p>
          <div className="mk-hero__ctas">
            <Button asChild size="xl">
              <Link href="/register" data-testid="button-cta-start">
                {t["marketing.startFreeTrial"]}
                <ArrowRight className="mk-flip" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="xl">
              <Link href="/demo">{t["marketing.heroSecondary"]}</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
