import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import type { Bilingual } from "./content";

export type Translate = (text: Bilingual) => string;

const MonthlyPlans = lazy(() => import("./MonthlyPlans"));

export function Picture({
  image,
  locale,
  alt,
  high = false,
}: {
  image: string;
  locale: string;
  alt: string;
  high?: boolean;
}) {
  // React 18 forwards this HTML attribute verbatim.
  const priority = high ? { fetchpriority: "high" } : undefined;
  return (
    <img
      className="phase-shot"
      src={`/product/${image}-${locale}.webp`}
      srcSet={
        image === "dashboard"
          ? `/product/dashboard-${locale}-small.webp 720w, /product/dashboard-${locale}.webp 1280w`
          : undefined
      }
      sizes={image === "dashboard" ? "(max-width: 760px) calc(100vw - 34px), 56vw" : undefined}
      alt={alt}
      width={1280}
      height={800}
      loading={high ? "eager" : "lazy"}
      {...priority}
    />
  );
}

export function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="phase-heading">
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}

/** The three plan cards, mounted when scrolled near (or at once with `immediate`). */
export function Plans({
  tr,
  immediate = false,
  intro = true,
}: {
  tr: Translate;
  immediate?: boolean;
  /** The "Try Enterprise free" line above the cards (the homepage says it in its own lead). */
  intro?: boolean;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const showPlans = immediate || visible || typeof IntersectionObserver === "undefined";
  useEffect(() => {
    if (showPlans) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "600px" }
    );
    if (grid.current) observer.observe(grid.current);
    return () => observer.disconnect();
  }, [showPlans]);
  return (
    <div className="phase-plan-grid" ref={grid}>
      {intro && (
        <div className="phase-plan-intro">
          <p>
            {tr([
              "Try Enterprise free for 14 days. No card required.",
              "جرّب باقة المؤسسات مجانًا لمدة ١٤ يومًا دون الحاجة إلى بطاقة.",
            ])}
          </p>
        </div>
      )}
      {showPlans && (
        <Suspense fallback={null}>
          <MonthlyPlans />
        </Suspense>
      )}
    </div>
  );
}
