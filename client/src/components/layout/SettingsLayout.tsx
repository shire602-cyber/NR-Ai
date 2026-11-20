import * as React from "react";
import { Link, useLocation } from "wouter";

import { useActiveIntoView, useEdgeFade } from "@/components/ui/use-scroll-fade";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  SETTINGS_NAV,
  isSettingsNavActive,
  type SettingsNavItem,
} from "@/components/layout/settings-nav";

export interface SettingsLayoutProps {
  children: React.ReactNode;
  /** Hide sections that do not apply (e.g. `["firm"]` when no firm is linked). */
  hide?: string[];
  /** Replace the default sections. */
  items?: SettingsNavItem[];
  className?: string;
}

/**
 * SettingsLayout (spec 3.15) — left sub-nav (200 px) + a content column max 760. Below 1024 px
 * the sub-nav becomes a horizontal, scrollable link strip with an edge fade. Each settings page
 * renders its own PageHeader and SectionCards inside `children`.
 */
export function SettingsLayout({ children, hide, items, className }: SettingsLayoutProps) {
  const { t } = useTranslation();
  const [location] = useLocation();
  const strip = React.useRef<HTMLDivElement | null>(null);
  const fade = useEdgeFade(strip);
  useActiveIntoView(strip);
  const nav = (items ?? SETTINGS_NAV).filter((i) => !hide?.includes(i.key));
  const label = (k: string) => (t as Record<string, string>)[k] ?? k;

  return (
    <div
      className={cn("lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-10", className)}
      data-testid="settings-layout"
    >
      <nav aria-label={t["components.ui.settingsNav.label"]} className="mb-6 lg:mb-0">
        <div
          ref={strip}
          className="scroll-fade-x -mx-4 flex gap-1 overflow-x-auto px-4 lg:sticky lg:top-6 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0"
          style={fade}
        >
          {nav.map((item) => {
            const active = isSettingsNavActive(location, item);
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={active ? "page" : undefined}
                data-testid={item.testId ?? `settings-nav-${item.key}`}
                className={cn(
                  "relative flex h-9 shrink-0 items-center whitespace-nowrap rounded-md px-3 text-small font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-secondary text-foreground lg:before:absolute lg:before:inset-y-2 lg:before:start-0 lg:before:w-0.5 lg:before:rounded-full lg:before:bg-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                {label(item.labelKey)}
              </Link>
            );
          })}
        </div>
      </nav>
      <div className="min-w-0 max-w-narrow">{children}</div>
    </div>
  );
}
