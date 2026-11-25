import { SHOW_PROOF_PLACEHOLDERS } from "./flags";
import { useMarketingText } from "./text";
import type { SiteLocale } from "../routes";

const KEYS = {
  quote: "hxProofPlaceholder",
  firm: "hxProofPlaceholderFirm",
  stories: "hxProofPlaceholderStories",
} as const;

/** Marked slot where real customer proof goes later. Renders nothing unless the flag is on. */
export function ProofPlaceholder({
  locale,
  variant = "quote",
}: {
  locale: SiteLocale;
  variant?: keyof typeof KEYS;
}) {
  const text = useMarketingText(locale);
  if (!SHOW_PROOF_PLACEHOLDERS) return null;
  return (
    <p className="mz-proof-placeholder" data-testid={`proof-placeholder-${variant}`}>
      {text(KEYS[variant])}
    </p>
  );
}
