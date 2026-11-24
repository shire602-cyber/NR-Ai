import { ChevronDown } from "lucide-react";
import { Link } from "wouter";
import { MARKETING_BRAND } from "@shared/marketing-brand";
import { bankCopy, type Bilingual } from "../content";
import type { Translate } from "../shared";
import type { LegacySectionProps, SectionProps } from "./types";
import { DEADLINES, PENALTY_AED_PER_MONTH, formatDeadlineDate } from "./deadlines";
import { SectionHead } from "./SectionHead";
import { useMarketingText, type MarketingKey } from "./text";
import "./faq.css";

interface FaqItem {
  id: string;
  q: MarketingKey;
  a: MarketingKey;
}

/**
 * The bank answer is the one wording shared with the product (BANK_RECONCILIATION_COPY), and it must
 * render on the very first paint, before the marketing catalog chunk has loaded, so it is the one
 * item read from the sync bilingual tuples (tests/unit/public-bank-copy.test.ts).
 */
const BANK_FAQ: { id: string; q: Bilingual; a: Bilingual } = {
  id: "bank",
  q: ["How do I reconcile my bank statement?", "كيف أطابق كشف حسابي البنكي؟"],
  a: bankCopy,
};

/**
 * The questions, in order (the bank item is spliced in third). The Arabic and security items read
 * the long-standing `faq*` catalog entries; the trial-end item reuses the pricing answer so the
 * wording is one.
 */
const FAQ_ITEMS: readonly FaqItem[] = [
  { id: "deadline", q: "hxFaqDeadlineQ", a: "hxFaqDeadlineA" },
  { id: "einvoicing", q: "hxFaqEinvQ", a: "hxFaqEinvA" },
  { id: "vat", q: "hxFaqVatQ", a: "hxFaqVatA" },
  { id: "arabic", q: "faq2Q", a: "faq2A" },
  { id: "accountant", q: "hxFaqAcctQ", a: "hxFaqAcctA" },
  { id: "records", q: "hxFaqRecordsQ", a: "hxFaqRecordsA" },
  { id: "card", q: "hxFaqCardQ", a: "hxFaqCardA" },
  { id: "cancel", q: "hxFaqCancelQ", a: "hxFaqCancelA" },
  { id: "trial-end", q: "prFaqAfterQ", a: "prFaqAfterReadOnlyA" },
  { id: "security", q: "faq7Q", a: "faq7A" },
];

/** The question list alone (no section chrome), shared by the homepage and /pricing. */
export function FaqList({ locale, tr }: Pick<SectionProps, "locale"> & { tr: Translate }) {
  const text = useMarketingText(locale);
  const vars = {
    brand: MARKETING_BRAND.name[locale],
    smallAppoint: formatDeadlineDate(DEADLINES.small.appoint, locale),
    smallLive: formatDeadlineDate(DEADLINES.small.live, locale),
    largeAppoint: formatDeadlineDate(DEADLINES.large.appoint, locale),
    largeLive: formatDeadlineDate(DEADLINES.large.live, locale),
    penalty: PENALTY_AED_PER_MONTH.toLocaleString("en-US"),
  };
  const entries = FAQ_ITEMS.map(({ id, q, a }) => ({ id, q: text(q, vars), a: text(a, vars) }));
  entries.splice(2, 0, { id: BANK_FAQ.id, q: tr(BANK_FAQ.q), a: tr(BANK_FAQ.a) });
  return (
    <div className="mz-faq-list" data-testid="faq-list">
      {entries.map(({ id, q, a }) => (
        <details key={id} className="mz-faq-item" data-faq={id}>
          <summary>
            {q} <ChevronDown aria-hidden="true" />
          </summary>
          <p>{a}</p>
        </details>
      ))}
    </div>
  );
}

export function Faq({ base, locale, tr }: LegacySectionProps) {
  const text = useMarketingText(locale);
  return (
    <section id="faq" data-testid="section-faq" className="mz-band mz-band--light mz-faq">
      <div className="phase-wrap mz-faq-grid">
        <div>
          <SectionHead title={text("hxFaqTitle")} />
          <Link className="phase-textlink" href={`${base}/tools/invoice-template`}>
            {text("hxFaqSample")}
          </Link>
        </div>
        <FaqList locale={locale} tr={tr} />
      </div>
    </section>
  );
}
