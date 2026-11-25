import type { SiteLocale } from "../routes";
import type { Translate } from "../shared";

/** Every homepage section receives these. */
export interface SectionProps {
  base: string;
  locale: SiteLocale;
}

/** Sections that still render legacy `[en, ar]` tuples also get `tr`. */
export interface LegacySectionProps extends SectionProps {
  tr: Translate;
}
