import { useRef, useState } from "react";
import { ArrowRight, ClipboardCheck, Landmark, PanelsTopLeft, ScanLine } from "lucide-react";
import { Link } from "wouter";
import { featureBySlug } from "../content";
import { featurePath } from "../route-content";
import { Picture } from "../shared";
import type { LegacySectionProps } from "./types";
import { SectionHead } from "./SectionHead";
import { useMarketingText } from "./text";

const workflows = [
  { feature: "receipt-scanning", label: ["Scan a receipt", "امسح إيصالًا"], icon: ScanLine },
  {
    feature: "bank-reconciliation",
    label: ["Reconcile a bank CSV", "طابق كشفًا بنكيًا بصيغة CSV"],
    icon: Landmark,
  },
  { feature: "vat", label: ["Review VAT 201", "راجع إقرار VAT 201"], icon: ClipboardCheck },
  { feature: "client-portal", label: ["Client portal", "بوابة العملاء"], icon: PanelsTopLeft },
] as const;

export function ProductTour({ base, locale, tr }: LegacySectionProps) {
  const text = useMarketingText(locale);
  const [selected, setSelected] = useState(0);
  const tabList = useRef<HTMLDivElement>(null);
  return (
    <section id="tour" data-testid="section-tour" className="mz-band mz-band--light phase-workflow">
      <div className="phase-wrap">
        <SectionHead title={text("hxTourTitle")} lead={text("hxTourLead")} />
        <div className="phase-workbench">
          <div
            className="phase-tabs"
            role="tablist"
            aria-label={tr(["Product workflows", "مسارات العمل"])}
            ref={tabList}
            onKeyDown={(e) => {
              const last = workflows.length - 1;
              const next =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? last
                    : e.key === "ArrowRight"
                      ? (selected + (locale === "ar" ? last : 1)) % workflows.length
                      : e.key === "ArrowLeft"
                        ? (selected + (locale === "ar" ? 1 : last)) % workflows.length
                        : undefined;
              if (next === undefined) return;
              e.preventDefault();
              setSelected(next);
              tabList.current?.querySelectorAll("button")[next]?.focus();
            }}
          >
            {workflows.map((w, i) => (
              <button
                key={w.feature}
                id={`phase-tab-${i}`}
                type="button"
                role="tab"
                aria-controls={`phase-panel-${i}`}
                aria-selected={i === selected}
                tabIndex={i === selected ? 0 : -1}
                onClick={() => setSelected(i)}
              >
                <w.icon aria-hidden="true" />
                {tr(w.label)}
              </button>
            ))}
          </div>
          {workflows.map((w, i) => {
            const f = featureBySlug(w.feature);
            return (
              <div
                key={w.feature}
                id={`phase-panel-${i}`}
                role="tabpanel"
                aria-labelledby={`phase-tab-${i}`}
                className="phase-workflow-panel"
                hidden={i !== selected}
              >
                {i === selected && (
                  <>
                    <div>
                      <h3>{tr(w.label)}</h3>
                      <p>{tr(f.lead)}</p>
                      <Link className="phase-textlink" href={`${base}${featurePath(f.slug)}`}>
                        {tr(["Explore feature", "استكشف الميزة"])} <ArrowRight aria-hidden="true" />
                      </Link>
                    </div>
                    {f.image && <Picture image={f.image} locale={locale} alt={tr(f.title)} />}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
