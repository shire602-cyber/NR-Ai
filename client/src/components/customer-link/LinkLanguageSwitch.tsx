import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { rememberViewerLocaleChoice } from "@/lib/customer-link";
import { useI18n, useTranslation } from "@/lib/i18n";

const LINK_NAMESPACES = ["customerLink"];

/**
 * Language switch for the no-login pages. It names the target language in that language and
 * marks it as such (`lang`), as the site's LocaleToggle does, and remembers the choice.
 */
export function LinkLanguageSwitch({ testId }: { testId: string }) {
  const { t, locale } = useTranslation(LINK_NAMESPACES);
  const setLocale = useI18n((s) => s.setLocale);
  const target = locale === "ar" ? "en" : "ar";
  return (
    <Button
      variant="ghost"
      size="sm"
      className="print:hidden"
      data-testid={testId}
      title={t["customerLink.switchLanguageTitle"]}
      onClick={() => {
        rememberViewerLocaleChoice();
        setLocale(target);
      }}
    >
      <Languages className="h-4 w-4" aria-hidden />
      <span lang={target}>{target === "ar" ? "العربية" : "English"}</span>
    </Button>
  );
}
