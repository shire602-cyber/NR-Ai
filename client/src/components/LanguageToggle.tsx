import { Languages } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface LanguageToggleProps {
  className?: string;
  /** Pin to the bottom corner (for pages that have no header to host it). */
  floating?: boolean;
}

/**
 * Language switch for pages shown before login (sign in, register, password
 * reset, invitations, public invoice). The choice is persisted by the i18n
 * store and mirrored on <html lang dir>, so it survives reloads and is shared
 * with the signed-in app.
 */
export function LanguageToggle({ className, floating = false }: LanguageToggleProps) {
  const locale = useI18n((state) => state.locale);
  const setLocale = useI18n((state) => state.setLocale);
  const next = locale === "en" ? "ar" : "en";

  return (
    <button
      type="button"
      onClick={() => setLocale(next)}
      lang={next}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1.5 text-[13px] font-medium text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground",
        floating && "fixed bottom-4 end-4 z-50",
        className
      )}
      data-testid="button-language-toggle"
    >
      <Languages className="h-4 w-4" aria-hidden />
      {/* i18n-ignore: language endonyms are always shown in their own language */}
      {next === "ar" ? "العربية" : "English"}
    </button>
  );
}
