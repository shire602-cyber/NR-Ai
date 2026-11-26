import { useRef, type CSSProperties, type ReactNode } from "react";
import type { SiteLocale } from "../../routes";
import { useInView, usePrefersReducedMotion } from "../motion";
import type { MarketingText } from "../text";
import { money } from "../tour/model";

/**
 * idle: scrolled out of view, animated parts hidden. play: scrolled in, animations run once.
 * static: reduced motion, the final state straight away.
 */
export type MotionState = "idle" | "play" | "static";

export interface VisualProps {
  locale: SiteLocale;
  text: MarketingText;
  /** Accessible description of the visual (figure label). */
  label: string;
}

/** Window chrome shared by the seven row visuals: sample label, in-view trigger, motion state. */
export function VisualFrame({
  text,
  label,
  children,
}: Pick<VisualProps, "text" | "label"> & {
  children: (state: MotionState) => ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { threshold: 0.25 });
  const reduced = usePrefersReducedMotion();
  const state: MotionState = reduced ? "static" : inView ? "play" : "idle";
  return (
    <figure ref={ref} className="mz-show-visual" data-state={state} aria-label={label}>
      <div className="mz-show-window" translate="no">
        {children(state)}
      </div>
      <figcaption className="mz-show-sample">{text("hxShowSample")}</figcaption>
    </figure>
  );
}

/** Money with Western digits, always left-to-right. */
export function Num({ fils, className }: { fils: number; className?: string }) {
  return (
    <span className={className ? `mz-show-num ${className}` : "mz-show-num"} dir="ltr">
      {money(fils)}
    </span>
  );
}

/** Staggers an animated child: `--i` multiplies the base delay in CSS. */
// eslint-disable-next-line react-refresh/only-export-components -- tiny pure helper shared by the visuals
export const stagger = (i: number) => ({ "--i": i }) as CSSProperties;
