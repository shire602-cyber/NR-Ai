import { useRef, type CSSProperties, type ReactNode } from "react";
import { useInView } from "./motion";

/** Fades and lifts its children in the first time they scroll into view (see `.mz-reveal`). */
export function Reveal({
  children,
  className = "",
  delayMs = 0,
}: {
  children: ReactNode;
  className?: string;
  delayMs?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const style = delayMs ? ({ "--mz-delay": `${delayMs}ms` } as CSSProperties) : undefined;
  return (
    <div
      ref={ref}
      className={`mz-reveal ${className}`.trim()}
      data-inview={inView ? "true" : "false"}
      style={style}
    >
      {children}
    </div>
  );
}
