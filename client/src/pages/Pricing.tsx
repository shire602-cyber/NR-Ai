import { useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  BookOpenCheck,
  Check,
  ChevronDown,
  FileDown,
  FileText,
  Landmark,
  Languages,
  Scale,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { ClosingCta, FaqSection, SectionHeading } from "@/components/marketing/Sections";
import { PlanCard } from "@/components/marketing/PlanCard";
import {
  BILLING_CYCLES,
  COMPARE_GROUPS,
  EVERY_PLAN,
  PLANS,
  cycleSavingPercent,
  planNameKey,
  planPrice,
  type BillingCycle,
  type Cell,
  type PlanId,
} from "@/components/marketing/plans";
import { formatMoneyText } from "@/lib/format-money";
import { UPGRADE_CONTACT_EMAIL } from "@shared/trial";

/*
 * /pricing (WP-B, spec 3.1): the same header, section heading, card and closing band as the
 * landing page. Seven sections: header band with the billing control, plan row, what every
 * plan includes, compare plans (sticky header; a plan picker on phones), the accountant band,
 * questions, closing CTA. Plan data and prices: components/marketing/plans.ts. Trial terms:
 * shared/trial.ts through the marketing catalog.
 */

const CYCLE_LABEL: Record<BillingCycle, string> = {
  monthly: "marketing.prCycleMonthly",
  quarterly: "marketing.pricingQuarterly",
  yearly: "marketing.prCycleYearly",
};

const EVERY_ICON: Record<(typeof EVERY_PLAN)[number]["id"], LucideIcon> = {
  invoices: FileText,
  vat: Landmark,
  ledger: BookOpenCheck,
  bilingual: Languages,
  bank: Scale,
  exports: FileDown,
};

const PLAN_IDS = PLANS.map((p) => p.id);

/** Segmented control (the shared Tabs pill look); a radiogroup so arrow keys and tests work. */
function Segmented<V extends string>({
  value,
  options,
  onChange,
  label,
  testId,
  optionTestId,
  className,
}: {
  value: V;
  options: readonly { value: V; label: string }[];
  onChange: (v: V) => void;
  label: string;
  testId?: string;
  optionTestId?: (v: V) => string;
  className?: string;
}) {
  const move = (dir: 1 | -1) => {
    const i = options.findIndex((o) => o.value === value);
    const next = options[(i + dir + options.length) % options.length];
    onChange(next.value);
  };
  return (
    <div
      className={`mk-segmented ${className ?? ""}`}
      role="radiogroup"
      aria-label={label}
      data-testid={testId}
      onKeyDown={(e) => {
        const rtl = document.documentElement.dir === "rtl";
        if (e.key === "ArrowRight") move(rtl ? -1 : 1);
        else if (e.key === "ArrowLeft") move(rtl ? 1 : -1);
        else return;
        e.preventDefault();
      }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          tabIndex={value === o.value ? 0 : -1}
          data-active={value === o.value}
          data-testid={optionTestId?.(o.value)}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function CellValue({ cell }: { cell: Cell }) {
  const { t } = useTranslation();
  if (cell === true) {
    return (
      <span className="mk-ptable__yes">
        <Check aria-hidden="true" />
        <span className="sr-only">{t["marketing.prIncluded"]}</span>
      </span>
    );
  }
  if (cell === false) {
    return (
      <span className="mk-ptable__no">
        <span aria-hidden="true">{"–"}</span>
        <span className="sr-only">{t["marketing.pricingNotIncluded"]}</span>
      </span>
    );
  }
  return <span className="mk-ptable__val">{t[cell]}</span>;
}

function PriceShort({ id, cycle }: { id: PlanId; cycle: BillingCycle }) {
  const { t, locale } = useTranslation();
  const plan = PLANS.find((p) => p.id === id)!;
  const price = planPrice(plan, cycle);
  return (
    <small>
      {formatMessage(t["marketing.prPerMonthShort"], {
        amount: formatMoneyText(price, "AED", locale, { fractionDigits: 0 }),
      })}
    </small>
  );
}

function CompareTable({ cycle }: { cycle: BillingCycle }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(COMPARE_GROUPS.map((g) => [g.key, !!g.open]))
  );
  return (
    <table className="mk-ptable" aria-labelledby="mk-compare-title">
      <colgroup>
        <col className="mk-ptable__labelcol" />
        {PLAN_IDS.map((id) => (
          <col key={id} data-featured={id === "professional" ? "true" : undefined} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th scope="col">
            <span className="sr-only">{t["marketing.prFeature"]}</span>
          </th>
          {PLANS.map((plan) => (
            <th
              key={plan.id}
              scope="col"
              data-featured={plan.featured ? "true" : undefined}
              data-testid={`compare-head-${plan.id}`}
            >
              <span>{t[planNameKey(plan.id)]}</span>
              <PriceShort id={plan.id} cycle={cycle} />
              {plan.cta === "contact" ? (
                <Button asChild variant="outline" size="sm">
                  <a href={`mailto:${UPGRADE_CONTACT_EMAIL}?subject=Muhasib.ai%20Enterprise`}>
                    {t["marketing.pricingTalkToUs"]}
                  </a>
                </Button>
              ) : (
                <Button asChild variant="outline" size="sm">
                  <Link href="/register">{t["marketing.prTryCta"]}</Link>
                </Button>
              )}
            </th>
          ))}
        </tr>
      </thead>
      {COMPARE_GROUPS.map((group) => {
        const isOpen = open[group.key];
        const bodyId = `mk-compare-${group.key.replace(/\W/g, "-")}`;
        return (
          <tbody key={group.key} id={bodyId}>
            <tr className="mk-ptable__group">
              <th colSpan={5} scope="colgroup">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen((o) => ({ ...o, [group.key]: !o[group.key] }))}
                >
                  <ChevronDown aria-hidden="true" data-open={isOpen} />
                  {t[group.key]}
                </button>
              </th>
            </tr>
            {group.rows.map((row) => (
              <tr key={row.key} hidden={!isOpen}>
                <td>
                  {t[row.key]}
                  {row.noteKey ? <small className="mk-ptable__note">{t[row.noteKey]}</small> : null}
                </td>
                {PLAN_IDS.map((id) => (
                  <td key={id} data-featured={id === "professional" ? "true" : undefined}>
                    <CellValue cell={row.cells[id]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        );
      })}
    </table>
  );
}

/** Phones: a plan picker and one column per group, no horizontal scroll. */
function CompareList() {
  const { t } = useTranslation();
  const [plan, setPlan] = useState<PlanId>("professional");
  return (
    <div className="mk-compare-list">
      <Segmented
        className="mk-compare-list__picker"
        value={plan}
        onChange={setPlan}
        label={t["marketing.prPickPlan"]}
        options={PLANS.map((p) => ({ value: p.id, label: t[planNameKey(p.id)] }))}
      />
      {COMPARE_GROUPS.map((group) => (
        <section key={group.key} className="mk-compare-list__group">
          <h3>{t[group.key]}</h3>
          <dl>
            {group.rows.map((row) => (
              <div key={row.key}>
                <dt>
                  {t[row.key]}
                  {row.noteKey ? <small>{t[row.noteKey]}</small> : null}
                </dt>
                <dd>
                  <CellValue cell={row.cells[plan]} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

const FAQ = [
  ["marketing.prFaqTrialQ", "marketing.pricingTrialFaqAnswer"],
  ["marketing.prFaqAfterQ", "marketing.prFaqAfterA"],
  ["marketing.prFaqChangeQ", "marketing.prFaqChangeA"],
  ["marketing.prFaqBillingQ", "marketing.prFaqBillingA"],
  ["marketing.prFaqHelpQ", "marketing.prFaqHelpA"],
  ["marketing.faq7Q", "marketing.faq7A"],
] as const;

export default function Pricing() {
  const { t } = useTranslation();
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  // Professional first on phones (CSS order), equal-height row from tablet up.
  const quarterly = cycleSavingPercent("quarterly");
  const yearly = cycleSavingPercent("yearly");

  return (
    <MarketingLayout
      titleKey="marketing.seoPricingTitle"
      descriptionKey="marketing.seoPricingDescription"
    >
      {/* 1 · Header band */}
      <header className="mk-section mk-prhead" aria-labelledby="mk-pricing-h1">
        <div className="mk-container mk-prhead__grid">
          <div>
            <p className="mk-eyebrow">{t["marketing.pricingEyebrow"]}</p>
            <h1 id="mk-pricing-h1" className="mk-h2 mk-prhead__title">
              {t["marketing.prTitle"]}
            </h1>
            <p className="mk-lead">{t["marketing.pricingBody"]}</p>
          </div>
          <div className="mk-prhead__billing">
            <Segmented
              value={cycle}
              onChange={setCycle}
              label={t["marketing.pricingBillingPeriod"]}
              testId="billing-cycle"
              optionTestId={(c) => `billing-cycle-${c}`}
              options={BILLING_CYCLES.map((c) => ({ value: c, label: t[CYCLE_LABEL[c]] }))}
            />
            <p className="mk-caption">
              {formatMessage(t["marketing.prSavingNote"], { quarterly, yearly })}
            </p>
          </div>
        </div>
      </header>

      {/* 2 · Plan row */}
      <section className="mk-prplans" aria-label={t["marketing.prPlansLabel"]}>
        <div className="mk-container">
          <div className="mk-prplans__row">
            {PLANS.map((plan) => (
              <PlanCard key={plan.id} plan={plan} cycle={cycle} />
            ))}
          </div>
          <p className="mk-prplans__terms">
            <span data-testid="trial-claim">{t["marketing.trialClaim"]}</span>
            <span aria-hidden="true">{" · "}</span>
            <span>{t["marketing.prVatIncluded"]}</span>
            <span aria-hidden="true">{" · "}</span>
            <span>{t["marketing.pricingPricingInAed"]}</span>
          </p>
        </div>
      </section>

      {/* 3 · What every plan includes */}
      <section className="mk-section mk-section--tight" aria-labelledby="mk-every-title">
        <div className="mk-container mk-split">
          <SectionHeading
            id="mk-every-title"
            eyebrow={t["marketing.prEveryEyebrow"]}
            title={t["marketing.prEveryTitle"]}
          />
          <ul className="mk-cells">
            {EVERY_PLAN.map((item) => {
              const Icon = EVERY_ICON[item.id];
              return (
                <li key={item.id}>
                  <Icon aria-hidden="true" />
                  <h3>{t[item.title]}</h3>
                  <p>{t[item.body]}</p>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* 4 · Compare plans */}
      <section className="mk-section mk-section--sunken" aria-labelledby="mk-compare-title">
        <div className="mk-container">
          <SectionHeading id="mk-compare-title" title={t["marketing.prCompareTitle"]} />
          <div className="mk-compare">
            <CompareTable cycle={cycle} />
          </div>
          <CompareList />
        </div>
      </section>

      {/* 5 · Accountant band */}
      <section className="mk-section mk-section--tight mk-band" aria-labelledby="mk-acct-title">
        <div className="mk-container mk-acct">
          <div>
            <h2 id="mk-acct-title" className="mk-h2">
              {t["marketing.prAcctTitle"]}
            </h2>
            <p className="mk-lead">{t["marketing.prAcctBody"]}</p>
          </div>
          <Button asChild variant="outline" size="lg" className="mk-on-band">
            <Link href="/services" data-testid="link-accounting-services">
              {t["marketing.prAcctCta"]}
              <ArrowRight className="mk-flip" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </section>

      {/* 6 · Questions */}
      <FaqSection
        id="mk-pfaq-title"
        eyebrow={t["marketing.faqEyebrow"]}
        title={t["marketing.prFaqTitle"]}
        items={FAQ.map(([q, a]) => ({ q: t[q], a: t[a] }))}
      />

      {/* 7 · Closing CTA (the landing's) */}
      <ClosingCta />
    </MarketingLayout>
  );
}
