import { useRef } from "react";
import { Link, useLocation } from "wouter";
import { useActiveIntoView, useEdgeFade } from "@/components/ui/use-scroll-fade";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Practice (NR-only) section links. The sidebar's Practice group links only the command
 * centre (WP-A nav); its sibling views are reached from this strip on each of them.
 */
const PRACTICE_LINKS = [
  { href: "/firm/command-center", labelKey: "firmOps.navCommandCentre" },
  { href: "/firm/health", labelKey: "firmOps.navClientHealth" },
  { href: "/firm/value-ops", labelKey: "firmOps.navValueProgrammes" },
  { href: "/firm/analytics", labelKey: "firmOps.navAnalytics" },
  { href: "/firm/pipeline", labelKey: "firmOps.navPipeline" },
] as const;

export function PracticeNav() {
  const { t } = useTranslation();
  const [location] = useLocation();
  const strip = useRef<HTMLDivElement | null>(null);
  const fade = useEdgeFade(strip);
  useActiveIntoView(strip);
  const path = location.split("?")[0];
  return (
    <nav aria-label={t["firmOps.navLabel"]} data-testid="practice-nav">
      <div
        ref={strip}
        style={fade}
        className="scroll-fade-x flex gap-1 overflow-x-auto border-b border-border"
      >
        {PRACTICE_LINKS.map((link) => {
          const active = path === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative -mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-small font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {t[link.labelKey]}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
