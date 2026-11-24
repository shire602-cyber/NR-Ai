import { ChevronDown } from "lucide-react";
import { Link } from "wouter";
import { MARKETING_BRAND } from "@shared/marketing-brand";
import { bankCopy, vatCopy, type Bilingual } from "../content";
import type { LegacySectionProps } from "./types";
import { SectionHead } from "./SectionHead";
import { useMarketingText } from "./text";

const legacyFaqs: readonly [Bilingual, Bilingual][] = [
  [["How do I reconcile my bank statement?", "كيف أطابق كشف حسابي البنكي؟"], bankCopy],
  [["How do I file my VAT return?", "كيف أقدّم إقرار ضريبة القيمة المضافة؟"], vatCopy],
  [
    ["Do I need a card to try it?", "هل أحتاج إلى بطاقة مصرفية للتجربة؟"],
    [
      "No. Start a 14-day free trial without entering card details.",
      "يمكنك بدء تجربة مجانية لمدة ١٤ يومًا دون إدخال بيانات البطاقة.",
    ],
  ],
  [
    ["Can I bring my existing records?", "هل يمكنني نقل سجلاتي الحالية؟"],
    [
      "Use CSV imports for supported records and keep a copy of your previous system’s exports for reference.",
      "استورد السجلات المدعومة بصيغة CSV واحتفظ بنسخة من ملفات التصدير من نظامك السابق للرجوع إليها.",
    ],
  ],
];

export function Faq({ base, locale, tr }: LegacySectionProps) {
  const text = useMarketingText(locale);
  const items = [
    ...legacyFaqs.map(([q, a]) => ({ q: tr(q), a: tr(a) })),
    {
      q: text("hxFaqEinvQ"),
      a: text("hxFaqEinvA", { brand: MARKETING_BRAND.name[locale] }),
    },
  ];
  return (
    <section id="faq" data-testid="section-faq" className="mz-band mz-band--light">
      <div className="phase-wrap phase-split phase-faq">
        <div>
          <SectionHead title={text("hxFaqTitle")} />
          <Link className="phase-textlink" href={`${base}/tools/invoice-template`}>
            {text("hxFaqSample")}
          </Link>
        </div>
        <div>
          {items.map(({ q, a }) => (
            <details key={q}>
              <summary>
                {q} <ChevronDown aria-hidden="true" />
              </summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
