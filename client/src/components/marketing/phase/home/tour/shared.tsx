import type { SiteLocale } from "../../routes";
import type { MarketingText } from "../text";
import { money } from "./model";

/** What every tour tab receives. */
export interface TabProps {
  locale: SiteLocale;
  text: MarketingText;
  /** prefers-reduced-motion: sequences jump to their final state. */
  reduced: boolean;
  /** True until the visitor touches the tour: tabs may start their own demo. */
  autoPlay: boolean;
}

/** Money with Western digits, always left-to-right, never translated. */
export function Money({ fils, className }: { fils: number; className?: string }) {
  return (
    <span
      className={className ? `mz-tour-num ${className}` : "mz-tour-num"}
      dir="ltr"
      translate="no"
    >
      {money(fils)}
    </span>
  );
}

/** Sample text that must not be machine-translated or flagged as stray English in Arabic mode. */
export function Sample({ children, lang }: { children: string; lang?: "en" | "ar" }) {
  return (
    <bdi translate="no" lang={lang}>
      {children}
    </bdi>
  );
}
