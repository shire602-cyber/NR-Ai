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
import { useState, useCallback } from "react";
import { useTranslation } from "@/lib/i18n";
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

const mobileSavedViewLinks = Array.from(
  reportSavedViewProfiles.map((view) => ({
    label: view.title,
    href: reportSavedViewHref(view),
    description: `${view.dateRangePreset} - ${view.comparisonPeriod}`,
  }))
).slice(0, MOBILE_REPORT_SECONDARY_LIMIT);

const mobileReportSuiteLinks = Array.from(
  reportSuiteProfiles.map((suite) => ({
    label: suite.title,
    href: reportSuiteHref(suite),
    description: `${suite.workflow} - ${suite.primaryAction}`,
  }))
).slice(0, MOBILE_REPORT_SECONDARY_LIMIT);

const mobileDecisionShortcutLinks = Array.from(
  reportDecisionShortcuts.map((shortcut) => ({
    label: shortcut.question,
    href: reportDecisionShortcutHref(shortcut),
    description: shortcut.answer,
  }))
).slice(0, MOBILE_REPORT_SECONDARY_LIMIT);

const mobileAutomationTriggerLinks = Array.from(
  reportAutomationTriggerRules.map((rule) => ({
    label: rule.title,
    href: reportAutomationTriggerRuleHref(rule),
    description: `${rule.condition} - ${rule.actionLabel}`,
  }))
).slice(0, MOBILE_REPORT_SECONDARY_LIMIT);

const mobileDeliverySubscriptionLinks = Array.from(
  reportDeliverySubscriptions.map((subscription) => ({
    label: subscription.title,
    href: reportDeliverySubscriptionHref(subscription),
    description: `${subscription.cadence} - ${subscription.channel}`,
  }))
).slice(0, MOBILE_REPORT_SECONDARY_LIMIT);

const mobileAutomationStarterLinks = Array.from(
  reportAutomationStarters.map((starter) => ({
    label: starter.title,
    href: reportAutomationStarterHref(starter),
    description: `${starter.audience} - ${starter.outcome}`,
  }))
).slice(0, MOBILE_REPORT_SECONDARY_LIMIT);

const mobilePackTemplateLinks = Array.from(
  reportPackTemplates.map((template) => ({
    label: template.title,
    href: reportPackTemplateHref(template),
    description: `${template.cadence} - ${template.delivery}`,
  }))
).slice(0, MOBILE_REPORT_SECONDARY_LIMIT);

const mobileComparisonPresetLinks = Array.from(
  reportComparisonPresets.map((preset) => ({
    label: preset.title,
    href: reportComparisonPresetHref(preset),
    description: `${preset.baseline} - ${preset.automationTrigger}`,
  }))
).slice(0, MOBILE_REPORT_SECONDARY_LIMIT);

const moreLinks: MoreLink[] = [
  ...reportPersonaWorkspaces.map((workspace) => ({
    label: workspace.navLabel,
    href: reportWorkspaceHref(workspace),
    description: workspace.focus,
  })),
  ...reportPersonaWorkspaces.map((workspace) => ({
    label: `Role setup - ${workspace.title}`,
    href: reportSectionHref(workspace, "role-setup"),
    description: `Start ${workspace.navLabel.toLowerCase()} with reports and automations`,
  })),
  ...reportPersonaWorkspaces.map((workspace) => ({
    label: `Report suites - ${workspace.title}`,
    href: reportSectionHref(workspace, "report-suites"),
    description: `Role-based report suites for ${workspace.focus.toLowerCase()}`,
  })),
  ...reportPersonaWorkspaces.map((workspace) => ({
    label: `Quick access reports - ${workspace.title}`,
    href: reportSectionHref(workspace, "quick-access"),
    description:
      reportQuickAccessProfiles.find((profile) => profile.persona === workspace.persona)?.outcome ??
      `Daily reports for ${workspace.navLabel.toLowerCase()}`,
  })),
  ...reportPersonaWorkspaces.flatMap((workspace) =>
    mobileReportsForWorkspace(workspace).flatMap((report) => {
      const href = reportPersonaHref(report, workspace.persona);
      return href
        ? [
            {
              key: `report-catalog-${workspace.persona}-${report.id}`,
              label: `${report.name} - ${workspace.title}`,
              href,
              description: `${report.category} - ${report.comparison} - ${report.automation}`,
            },
          ]
        : [];
    })
  ),
  ...reportPersonaWorkspaces.map((workspace) => ({
    label: `Saved report views - ${workspace.title}`,
    href: reportSectionHref(workspace, "saved-views"),
    description: `Saved comparison, basis, and export presets for ${workspace.navLabel.toLowerCase()}`,
  })),
  ...mobileSavedViewLinks,
  ...mobileReportSuiteLinks,
  ...reportPersonaWorkspaces.map((workspace) => ({
    label: `Report operations - ${workspace.title}`,
    href: reportSectionHref(workspace, "automation-operations"),
    description: workspace.automationOutcome,
  })),
  ...reportPersonaWorkspaces.map((workspace) => ({
    label: workspace.automationNavLabel,
    href: reportSectionHref(workspace, "automation-command-center"),
    description: workspace.packSchedule.automation,
  })),
  ...reportPersonaWorkspaces.map((workspace) => ({
    label: `Automation impact - ${workspace.title}`,
    href: reportSectionHref(workspace, "automation-impact"),
    description:
      reportAutomationImpactProfiles.find((profile) => profile.persona === workspace.persona)
        ?.outcome ?? `Automation impact for ${workspace.navLabel.toLowerCase()}`,
  })),
  ...mobileDecisionShortcutLinks,
  ...mobileAutomationTriggerLinks,
  ...mobileDeliverySubscriptionLinks,
  ...mobileAutomationStarterLinks,
  ...mobilePackTemplateLinks,
  ...mobileComparisonPresetLinks,
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
const reportMoreLinks = moreLinks.filter((link) => !link.labelKey);

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
