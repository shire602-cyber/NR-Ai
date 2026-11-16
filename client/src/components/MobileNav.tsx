import { useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  FileText,
  Camera,
  BarChart3,
  MoreHorizontal,
  BookOpen,
  BookMarked,
  Users,
  Package,
  Landmark,
  Building2,
  ArrowLeftRight,
  Sparkles,
  FolderLock,
  Settings,
  Sun,
  Moon,
  Monitor,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme, type ThemePreference } from "@/lib/theme";
import { useState, useCallback, useMemo } from "react";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { useCatalogText, type CatalogText } from "@/lib/reportCatalogText";
import {
  readyReportCatalog,
  reportAutomationTriggerRuleHref,
  reportAutomationTriggerRules,
  reportAutomationImpactProfiles,
  reportAutomationStarterHref,
  reportAutomationStarters,
  reportComparisonPresetHref,
  reportComparisonPresets,
  reportDecisionShortcutHref,
  reportDecisionShortcuts,
  reportDeliverySubscriptionHref,
  reportDeliverySubscriptions,
  reportPackTemplateHref,
  reportPackTemplates,
  reportPersonaHref,
  reportPersonaWorkspaces,
  reportQuickAccessProfiles,
  reportSavedViewHref,
  reportSavedViewProfiles,
  reportSectionHref,
  reportSuiteHref,
  reportSuiteProfiles,
  reportWorkspaceHref,
} from "@/lib/reportCatalog";

interface NavItem {
  label: string;
  /** i18n key in the shell namespace; `label` is the English fallback */
  labelKey?: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  /** If true, this item opens the "more" sheet instead of navigating */
  isMore?: boolean;
}

interface MoreLink {
  key?: string;
  label: string;
  labelKey?: string;
  href: string;
  description?: string;
  /** Leading 20px icon for workspace tiles (CTO 12). */
  icon?: LucideIcon;
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

const MOBILE_REPORTS_PER_PERSONA = 6;
const MOBILE_REPORT_SECONDARY_LIMIT = 3;

function mobileQuickAccessReportIds(persona: (typeof reportPersonaWorkspaces)[number]["persona"]) {
  return new Set(
    reportQuickAccessProfiles.find((profile) => profile.persona === persona)?.reportIds ?? []
  );
}

function mobileReportsForWorkspace(workspace: (typeof reportPersonaWorkspaces)[number]) {
  const quickAccessReportIds = mobileQuickAccessReportIds(workspace.persona);
  return readyReportCatalog
    .filter((report) => report.personas.includes(workspace.persona))
    .filter((report) => quickAccessReportIds.size === 0 || quickAccessReportIds.has(report.id))
    .slice(0, MOBILE_REPORTS_PER_PERSONA);
}

function buildReportMoreLinks(
  ct: CatalogText,
  px: (key: string, values?: Record<string, string | number>) => string
): MoreLink[] {
  const mobileSavedViewLinks = Array.from(
    reportSavedViewProfiles.map((view) => ({
      label: ct("savedView", view.id, "title", view.title),
      href: reportSavedViewHref(view),
      description: `${ct("savedView", view.id, "dateRangePreset", view.dateRangePreset)} - ${ct("savedView", view.id, "comparisonPeriod", view.comparisonPeriod)}`,
    }))
  ).slice(0, MOBILE_REPORT_SECONDARY_LIMIT);

  const mobileReportSuiteLinks = Array.from(
    reportSuiteProfiles.map((suite) => ({
      label: ct("suite", suite.id, "title", suite.title),
      href: reportSuiteHref(suite),
      description: `${ct("suite", suite.id, "workflow", suite.workflow)} - ${ct("suite", suite.id, "primaryAction", suite.primaryAction)}`,
    }))
  ).slice(0, MOBILE_REPORT_SECONDARY_LIMIT);

  const mobileDecisionShortcutLinks = Array.from(
    reportDecisionShortcuts.map((shortcut) => ({
      label: ct("shortcut", shortcut.id, "question", shortcut.question),
      href: reportDecisionShortcutHref(shortcut),
      description: ct("shortcut", shortcut.id, "answer", shortcut.answer),
    }))
  ).slice(0, MOBILE_REPORT_SECONDARY_LIMIT);

  const mobileAutomationTriggerLinks = Array.from(
    reportAutomationTriggerRules.map((rule) => ({
      label: ct("rule", rule.id, "title", rule.title),
      href: reportAutomationTriggerRuleHref(rule),
      description: `${ct("rule", rule.id, "condition", rule.condition)} - ${ct("rule", rule.id, "actionLabel", rule.actionLabel)}`,
    }))
  ).slice(0, MOBILE_REPORT_SECONDARY_LIMIT);

  const mobileDeliverySubscriptionLinks = Array.from(
    reportDeliverySubscriptions.map((subscription) => ({
      label: ct("delivery", subscription.id, "title", subscription.title),
      href: reportDeliverySubscriptionHref(subscription),
      description: `${ct("delivery", subscription.id, "cadence", subscription.cadence)} - ${ct("delivery", subscription.id, "channel", subscription.channel)}`,
    }))
  ).slice(0, MOBILE_REPORT_SECONDARY_LIMIT);

  const mobileAutomationStarterLinks = Array.from(
    reportAutomationStarters.map((starter) => ({
      label: ct("starter", starter.id, "title", starter.title),
      href: reportAutomationStarterHref(starter),
      description: `${ct("starter", starter.id, "audience", starter.audience)} - ${ct("starter", starter.id, "outcome", starter.outcome)}`,
    }))
  ).slice(0, MOBILE_REPORT_SECONDARY_LIMIT);

  const mobilePackTemplateLinks = Array.from(
    reportPackTemplates.map((template) => ({
      label: ct("pack", template.id, "title", template.title),
      href: reportPackTemplateHref(template),
      description: `${ct("pack", template.id, "cadence", template.cadence)} - ${ct("pack", template.id, "delivery", template.delivery)}`,
    }))
  ).slice(0, MOBILE_REPORT_SECONDARY_LIMIT);

  const mobileComparisonPresetLinks = Array.from(
    reportComparisonPresets.map((preset) => ({
      label: ct("preset", preset.id, "title", preset.title),
      href: reportComparisonPresetHref(preset),
      description: `${ct("preset", preset.id, "baseline", preset.baseline)} - ${ct("preset", preset.id, "automationTrigger", preset.automationTrigger)}`,
    }))
  ).slice(0, MOBILE_REPORT_SECONDARY_LIMIT);

  const wsTitle = (workspace: (typeof reportPersonaWorkspaces)[number]) =>
    ct("workspace", workspace.persona, "title", workspace.title);
  const wsNav = (workspace: (typeof reportPersonaWorkspaces)[number]) =>
    ct("workspace", workspace.persona, "navLabel", workspace.navLabel);

  return [
    ...reportPersonaWorkspaces.map((workspace) => ({
      label: wsNav(workspace),
      href: reportWorkspaceHref(workspace),
      description: ct("workspace", workspace.persona, "focus", workspace.focus),
    })),
    ...reportPersonaWorkspaces.map((workspace) => ({
      label: px("shell.mobileRoleSetup", { workspace: wsTitle(workspace) }),
      href: reportSectionHref(workspace, "role-setup"),
      description: px("shell.mobileRoleSetupDesc", { name: wsNav(workspace).toLowerCase() }),
    })),
    ...reportPersonaWorkspaces.map((workspace) => ({
      label: px("shell.mobileReportSuites", { workspace: wsTitle(workspace) }),
      href: reportSectionHref(workspace, "report-suites"),
      description: px("shell.mobileReportSuitesDesc", {
        focus: ct("workspace", workspace.persona, "focus", workspace.focus).toLowerCase(),
      }),
    })),
    ...reportPersonaWorkspaces.map((workspace) => ({
      label: px("shell.mobileQuickAccess", { workspace: wsTitle(workspace) }),
      href: reportSectionHref(workspace, "quick-access"),
      description: ct.cx(
        reportQuickAccessProfiles.find((profile) => profile.persona === workspace.persona)
          ?.outcome ?? px("shell.mobileQuickAccessDesc", { name: wsNav(workspace).toLowerCase() })
      ),
    })),
    ...reportPersonaWorkspaces.flatMap((workspace) =>
      mobileReportsForWorkspace(workspace).flatMap((report) => {
        const href = reportPersonaHref(report, workspace.persona);
        return href
          ? [
              {
                key: `report-catalog-${workspace.persona}-${report.id}`,
                label: `${ct("report", report.id, "name", report.name)} - ${wsTitle(workspace)}`,
                href,
                description: `${ct("category", report.category, "label", report.category)} - ${ct("report", report.id, "comparison", report.comparison)} - ${ct("report", report.id, "automation", report.automation)}`,
              },
            ]
          : [];
      })
    ),
    ...reportPersonaWorkspaces.map((workspace) => ({
      label: px("shell.mobileSavedViews", { workspace: wsTitle(workspace) }),
      href: reportSectionHref(workspace, "saved-views"),
      description: px("shell.mobileSavedViewsDesc", { name: wsNav(workspace).toLowerCase() }),
    })),
    ...mobileSavedViewLinks,
    ...mobileReportSuiteLinks,
    ...reportPersonaWorkspaces.map((workspace) => ({
      label: px("shell.mobileReportOperations", { workspace: wsTitle(workspace) }),
      href: reportSectionHref(workspace, "automation-operations"),
      description: ct(
        "workspace",
        workspace.persona,
        "automationOutcome",
        workspace.automationOutcome
      ),
    })),
    ...reportPersonaWorkspaces.map((workspace) => ({
      label: ct("workspace", workspace.persona, "automationNavLabel", workspace.automationNavLabel),
      href: reportSectionHref(workspace, "automation-command-center"),
      description: ct(
        "workspace",
        workspace.persona,
        "packSchedule.automation",
        workspace.packSchedule.automation
      ),
    })),
    ...reportPersonaWorkspaces.map((workspace) => ({
      label: px("shell.mobileAutomationImpact", { workspace: wsTitle(workspace) }),
      href: reportSectionHref(workspace, "automation-impact"),
      description: ct.cx(
        reportAutomationImpactProfiles.find((profile) => profile.persona === workspace.persona)
          ?.outcome ??
          px("shell.mobileAutomationImpactDesc", { name: wsNav(workspace).toLowerCase() })
      ),
    })),
    ...mobileDecisionShortcutLinks,
    ...mobileAutomationTriggerLinks,
    ...mobileDeliverySubscriptionLinks,
    ...mobileAutomationStarterLinks,
    ...mobilePackTemplateLinks,
    ...mobileComparisonPresetLinks,
  ];
}

const moreLinks: MoreLink[] = [
  {
    label: "Accounts",
    labelKey: "shell.moreAccounts",
    href: "/chart-of-accounts",
    icon: BookOpen,
  },
  { label: "Journal", labelKey: "shell.moreJournal", href: "/journal", icon: BookMarked },
  { label: "Contacts", labelKey: "shell.moreContacts", href: "/contacts", icon: Users },
  { label: "Inventory", labelKey: "shell.moreInventory", href: "/inventory", icon: Package },
  { label: "VAT Filing", labelKey: "shell.moreVatFiling", href: "/vat-filing", icon: Landmark },
  {
    label: "Corporate Tax",
    labelKey: "shell.moreCorporateTax",
    href: "/corporate-tax",
    icon: Building2,
  },
  {
    label: "Bank Reconciliation",
    labelKey: "shell.moreBankReconciliation",
    href: "/bank-reconciliation",
    icon: ArrowLeftRight,
  },
  { label: "AI hub", labelKey: "shell.moreAi", href: "/ai", icon: Sparkles },
  {
    label: "Document Vault",
    labelKey: "shell.moreDocumentVault",
    href: "/document-vault",
    icon: FolderLock,
  },
  { label: "Settings", labelKey: "shell.moreSettings", href: "/company-profile", icon: Settings },
];

// Translated app destinations lead the sheet; the catalog-driven report
// shortcuts follow in a collapsible section so the sheet stays scannable.
const workspaceMoreLinks = moreLinks.filter((link) => link.labelKey);

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
  const ct = useCatalogText();
  const reportMoreLinks = useMemo(
    () =>
      buildReportMoreLinks(ct, (key, values = {}) =>
        formatMessage((t as Record<string, string>)[key] ?? key, values)
      ),
    [ct, t]
  );
  const { preference, setPreference } = useTheme();
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

  const renderMoreLink = (link: MoreLink) => {
    const Icon = link.icon;
    return (
      <button
        key={link.key ?? link.href}
        onClick={() => handleMoreLink(link.href)}
        className={cn(
          "mobile-nav-more-item",
          Icon && "mobile-nav-more-item--tile",
          location === link.href && "mobile-nav-more-item--active"
        )}
        aria-label={link.description ? `${text(link)}: ${link.description}` : text(link)}
      >
        {Icon ? <Icon className="mobile-nav-more-icon" aria-hidden /> : null}
        <span className="mobile-nav-more-text">
          <span className="mobile-nav-more-label">{text(link)}</span>
          {link.description ? (
            <span className="mobile-nav-more-description">{link.description}</span>
          ) : null}
        </span>
      </button>
    );
  };

  const isActive = (href: string) => {
    if (href === "#") return moreOpen;
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
          <div className="mobile-nav-more-heading">{t["shell.moreSectionWorkspace"]}</div>
          <nav className="mobile-nav-more-grid" aria-label={t["shell.moreSectionWorkspace"]}>
            {workspaceMoreLinks.map((link) => renderMoreLink(link))}
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
          <details className="mobile-nav-more-section">
            <summary className="mobile-nav-more-summary">
              <span>{t["shell.moreSectionReports"]}</span>
              <span className="mobile-nav-more-count">{reportMoreLinks.length}</span>
            </summary>
            <nav className="mobile-nav-more-list" aria-label={t["shell.moreSectionReports"]}>
              {reportMoreLinks.map((link) => renderMoreLink(link))}
            </nav>
          </details>
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
              <div className="mobile-nav-tab-icon">
                <Icon className="h-5 w-5" />
                {active && (
                  <motion.div
                    layoutId="mobile-nav-indicator"
                    className="mobile-nav-indicator"
                    transition={{ type: "spring", damping: 30, stiffness: 400 }}
                  />
                )}
              </div>
              <span className="mobile-nav-tab-label">{text(item)}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
