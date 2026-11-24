import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { ArrowRight, ClipboardCheck, FileText, Landmark, ScanLine, Users } from "lucide-react";
import { Link } from "wouter";
import { featurePath } from "../route-content";
import type { SectionProps } from "./types";
import { SectionHead } from "./SectionHead";
import { useMarketingText } from "./text";
import { useInView, usePrefersReducedMotion } from "./motion";
import { nextTabIndex } from "./tour/model";
import "./tour.css";

/** Loaded when the section is within ~400px of the viewport; keeps the first load light. */
const TourApp = lazy(() => import("./tour/TourApp"));

const TABS = [
  { slug: "invoicing", label: "hxTourTab1", blurb: "hxTourBlurb1", icon: FileText },
  { slug: "receipt-scanning", label: "hxTourTab2", blurb: "hxTourBlurb2", icon: ScanLine },
  { slug: "bank-reconciliation", label: "hxTourTab3", blurb: "hxTourBlurb3", icon: Landmark },
  { slug: "vat", label: "hxTourTab4", blurb: "hxTourBlurb4", icon: ClipboardCheck },
  { slug: "client-portal", label: "hxTourTab5", blurb: "hxTourBlurb5", icon: Users },
] as const;

export const TOUR_ADVANCE_MS = 8000;

export function ProductTour({ base, locale }: SectionProps) {
  const text = useMarketingText(locale);
  const reduced = usePrefersReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const near = useInView(sectionRef, { rootMargin: "400px 0px", threshold: 0 });
  const visible = useInView(sectionRef, { once: false, rootMargin: "0px", threshold: 0.3 });
  const [selected, setSelected] = useState(0);
  const [interacted, setInteracted] = useState(false);

  // Any pointer or key press inside the tour ends auto-advance for good.
  const touch = useCallback(() => setInteracted(true), []);

  const advancing = near && visible && !interacted && !reduced;
  useEffect(() => {
    if (!advancing) return;
    const id = setTimeout(() => setSelected((s) => (s + 1) % TABS.length), TOUR_ADVANCE_MS);
    return () => clearTimeout(id);
  }, [advancing, selected]);

  const onTabKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = nextTabIndex(e.key, selected, TABS.length, locale === "ar");
    if (next === null) return;
    e.preventDefault();
    setSelected(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <section
      id="tour"
      data-testid="section-tour"
      className="mz-band mz-band--light mz-tour"
      ref={sectionRef}
    >
      <div className="phase-wrap">
        <SectionHead title={text("hxTourTitle")} lead={text("hxTourLead")} />
        <div
          className="mz-tour-shell"
          onPointerDownCapture={touch}
          onKeyDownCapture={touch}
          data-interacted={interacted}
        >
          <div
            className="mz-tour-tabs"
            role="tablist"
            aria-label={text("hxTourTabsLabel")}
            onKeyDown={onTabKeys}
          >
            {TABS.map((tab, i) => (
              <button
                key={tab.slug}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                id={`mz-tour-tab-${i}`}
                type="button"
                role="tab"
                aria-controls={`mz-tour-panel-${i}`}
                aria-selected={i === selected}
                tabIndex={i === selected ? 0 : -1}
                onClick={() => setSelected(i)}
              >
                <tab.icon aria-hidden="true" />
                <span>{text(tab.label)}</span>
              </button>
            ))}
          </div>
          {TABS.map((tab, i) => (
            <div
              key={tab.slug}
              id={`mz-tour-panel-${i}`}
              role="tabpanel"
              aria-labelledby={`mz-tour-tab-${i}`}
              className="mz-tour-panel"
              hidden={i !== selected}
            >
              {i === selected && (
                <>
                  <div className="mz-tour-copy">
                    <h3>{text(tab.label)}</h3>
                    <p>{text(tab.blurb)}</p>
                    <Link className="phase-textlink" href={`${base}${featurePath(tab.slug)}`}>
                      {text("hxTourExplore")} <ArrowRight aria-hidden="true" />
                    </Link>
                  </div>
                  <div className="mz-tour-window mz-card">
                    <p className="mz-badge mz-tour-sample">{text("hxTourSample")}</p>
                    <div className="mz-tour-stage">
                      {near ? (
                        <Suspense
                          fallback={
                            <div
                              className="mz-tour-skeleton"
                              role="status"
                              aria-label={text("hxTourLoading")}
                            />
                          }
                        >
                          <TourApp
                            tab={selected}
                            locale={locale}
                            reduced={reduced}
                            autoPlay={!interacted && !reduced}
                          />
                        </Suspense>
                      ) : (
                        <div className="mz-tour-skeleton" aria-hidden="true" />
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
