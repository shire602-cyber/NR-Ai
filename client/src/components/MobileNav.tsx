import { useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  FileText,
  Camera,
  BarChart3,
  MoreHorizontal,
  ChevronRight,
  Sun,
  Moon,
  Monitor,
  Languages,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSessionActions } from "@/hooks/useSessionActions";
import { useTheme, type ThemePreference } from "@/lib/theme";
import { useState, useCallback } from "react";
import { useTranslation } from "@/lib/i18n";
import { useNavGroups } from "@/components/layout/useNavGroups";
import { itemIsActive, type NavGroup } from "@/components/layout/nav-config";
import { isCustomerOnlyRoute } from "@/lib/route-config";

interface NavItem {
  label: string;
  /** i18n key in the shell namespace; `label` is the English fallback */
  labelKey?: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  /** If true, this item opens the "more" sheet instead of navigating */
  isMore?: boolean;
}

const THEME_OPTIONS: { value: ThemePreference; icon: LucideIcon; labelKey: string }[] = [
  { value: "light", icon: Sun, labelKey: "shell.themeLight" },
  { value: "dark", icon: Moon, labelKey: "shell.themeDark" },
  { value: "system", icon: Monitor, labelKey: "shell.themeSystem" },
];

const navItems: NavItem[] = [
  { label: "Dashboard", labelKey: "shell.navDashboard", icon: LayoutDashboard, href: "/dashboard" },
  { label: "Invoices", labelKey: "shell.navInvoices", icon: FileText, href: "/invoices" },
  { label: "Receipts", labelKey: "shell.navReceipts", icon: Camera, href: "/receipts" },
  { label: "Reports", labelKey: "shell.navReports", icon: BarChart3, href: "/reports" },
  { label: "More", labelKey: "shell.navMore", icon: MoreHorizontal, href: "#", isMore: true },
];

interface MoreRow {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  testId?: string;
  matches?: string[];
}

interface MoreSection {
  key: string;
  heading: string;
  rows: MoreRow[];
}

/** Destinations already on the bottom bar are not repeated in the More sheet. */
const TAB_HREFS = new Set(["/dashboard", "/invoices", "/receipts", "/reports"]);

/**
 * Spec 3.5: the More sheet lists the sidebar's groups (same headings, same order) as a single
 * column of 44 px rows — icon, full label, chevron — so no label is ever truncated. Single
 * destinations (Inventory, Payroll, Assistant, Settings) lead under "Workspace".
 */
function buildMoreSections(groups: NavGroup[], label: (key: string) => string): MoreSection[] {
  const direct: MoreRow[] = groups
    .filter((g) => g.url && !TAB_HREFS.has(g.url))
    .map((g) => ({
      key: g.key,
      label: label(g.titleKey),
      href: g.url!,
      icon: g.icon,
      testId: `mobile-more-${g.key}`,
      matches: g.matches,
    }));
  const grouped = groups
    .filter((g) => !g.url)
    .map((g) => ({
      key: g.key,
      heading: label(g.titleKey),
      rows: g.items
        .filter((item) => !TAB_HREFS.has(item.url))
        .map((item) => ({
          key: item.key ?? item.url,
          label: label(item.titleKey),
          href: item.url,
          icon: item.icon ?? g.icon,
          testId: `mobile-more-${item.testId ?? item.titleKey}`,
          matches: item.matches,
        })),
    }))
    .filter((section) => section.rows.length > 0);
  return [{ key: "workspace", heading: label("shell.nav.workspace"), rows: direct }, ...grouped];
}

/**
 * Mobile Bottom Navigation Bar
 *
 * Renders a fixed bottom tab bar on mobile screens (< 768px).
 * Uses wouter for navigation, consistent with the rest of the app.
 * The "More" tab opens a bottom sheet with additional navigation links.
 */
export function MobileNav() {
  const [location, setLocation] = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const { t } = useTranslation();
  const { allGroups, userType } = useNavGroups();
  const label = (key: string) => (t as Record<string, string>)[key] ?? key;
  // Client-portal users only see the shared (non customer-only) destinations.
  const groups =
    userType === "client"
      ? allGroups
          .filter((g) => !g.url || !isCustomerOnlyRoute(g.url))
          .map((g) => ({ ...g, items: g.items.filter((i) => !isCustomerOnlyRoute(i.url)) }))
      : allGroups;
  const sections = buildMoreSections(groups, label);
  const { preference, setPreference } = useTheme();
  const { signOut, toggleLanguage, locale } = useSessionActions();
  const text = (item: { label: string; labelKey?: string }) =>
    item.labelKey ? t[item.labelKey] || item.label : item.label;

  const handleNavClick = useCallback(
    (item: NavItem) => {
      if (item.isMore) {
        setMoreOpen((prev) => !prev);
      } else {
        setMoreOpen(false);
        setLocation(item.href);
      }
    },
    [setLocation]
  );

  const handleMoreLink = useCallback(
    (href: string) => {
      setMoreOpen(false);
      setLocation(href);
    },
    [setLocation]
  );

  const renderMoreRow = (row: MoreRow) => {
    const Icon = row.icon;
    const active = itemIsActive(location, { url: row.href, matches: row.matches });
    return (
      <li key={row.key}>
        <button
          type="button"
          onClick={() => handleMoreLink(row.href)}
          className={cn("mobile-nav-more-row", active && "mobile-nav-more-row--active")}
          aria-current={active ? "page" : undefined}
          data-testid={row.testId}
        >
          <Icon className="mobile-nav-more-icon" aria-hidden />
          <span className="mobile-nav-more-label">{row.label}</span>
          <ChevronRight className="mobile-nav-more-chevron rtl:rotate-180" aria-hidden />
        </button>
      </li>
    );
  };

  const isActive = (href: string) => {
    if (href === "#") return moreOpen;
    // While the More sheet is open it is the only active tab.
    if (moreOpen) return false;
    return location === href || location.startsWith(href + "/") || location.startsWith(href + "?");
  };

  return (
    <>
      {/* More menu overlay */}
      {moreOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="mobile-nav-overlay"
          onClick={() => setMoreOpen(false)}
        />
      )}

      {/* More menu sheet */}
      {moreOpen && (
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 30, stiffness: 400 }}
          className="mobile-nav-more-sheet"
        >
          <div className="mobile-nav-more-handle" />
          <nav aria-label={t["shell.moreSectionWorkspace"]} data-testid="mobile-more-nav">
            {sections.map((section) => (
              <section key={section.key} className="mobile-nav-more-group">
                <h2 className="mobile-nav-more-heading">{section.heading}</h2>
                <ul className="mobile-nav-more-rows">{section.rows.map(renderMoreRow)}</ul>
              </section>
            ))}
          </nav>
          {/* Theme lives here on mobile; the top bar keeps only search, bell and profile (CTO 8). */}
          <div className="mobile-nav-more-section" data-testid="mobile-theme-options">
            <div className="mobile-nav-more-heading">{t["shell.themeLabel"]}</div>
            <div className="mobile-nav-theme" role="group" aria-label={t["shell.themeLabel"]}>
              {THEME_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={preference === option.value}
                  onClick={() => setPreference(option.value)}
                  className={cn(
                    "mobile-nav-theme-option",
                    preference === option.value && "mobile-nav-theme-option--active"
                  )}
                  data-testid={`mobile-theme-option-${option.value}`}
                >
                  <option.icon className="h-4 w-4" aria-hidden />
                  {t[option.labelKey]}
                </button>
              ))}
            </div>
          </div>
          <div className="mobile-nav-more-section" data-testid="mobile-account-actions">
            <ul className="mobile-nav-more-rows" aria-label={t["shell.accountMenu"]}>
              <li>
                <button
                  type="button"
                  onClick={toggleLanguage}
                  className="mobile-nav-more-row"
                  data-testid="mobile-language-toggle"
                >
                  <Languages className="mobile-nav-more-icon" aria-hidden />
                  <span className="mobile-nav-more-label" lang={locale === "en" ? "ar" : "en"}>
                    {locale === "en" ? "العربية" : "English"}
                  </span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    void signOut();
                  }}
                  className="mobile-nav-more-row"
                  data-testid="mobile-logout"
                >
                  <LogOut className="mobile-nav-more-icon rtl:-scale-x-100" aria-hidden />
                  <span className="mobile-nav-more-label">{t.logout}</span>
                </button>
              </li>
            </ul>
          </div>
        </motion.div>
      )}

      {/* Bottom tab bar */}
      <nav className="mobile-nav" role="navigation" aria-label={t["shell.mainNavigation"]}>
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);

          return (
            <button
              key={item.label}
              onClick={() => handleNavClick(item)}
              className={`mobile-nav-tab ${active ? "mobile-nav-tab--active" : ""}`}
              aria-current={active ? "page" : undefined}
              aria-label={text(item)}
            >
              {/* Spec 3.21: active = brand icon + label; no filled pill behind the icon. */}
              <div className="mobile-nav-tab-icon">
                <Icon className="h-5 w-5" />
              </div>
              <span className="mobile-nav-tab-label">{text(item)}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
