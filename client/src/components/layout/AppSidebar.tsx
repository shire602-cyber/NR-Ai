import { useState, useEffect, useMemo, useRef } from "react";
import {
  LayoutDashboard,
  TrendingUp,
  ShoppingCart,
  BookMarked,
  BarChart3,
  Banknote,
  Settings,
  Briefcase,
  Shield,
  ChevronDown,
  Languages,
  LogOut,
  FolderArchive,
  FileStack,
  CalendarDays,
  ListTodo,
  ClipboardList,
  Sparkles,
  Package,
  Landmark,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { shouldShowNraCenterNav } from "@shared/access";
import { firmPathAllowed, useFirmAccess } from "@/components/FirmRouteAccess";
import { useTranslation, useI18n } from "@/lib/i18n";
import { useRTL } from "@/components/RTLProvider";
import { removeToken } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";
import { CompanySwitcher } from "@/components/CompanySwitcher";
import { BrandMark } from "@/components/BrandMark";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useActiveCompany } from "@/components/ActiveCompanyProvider";
import { SETTINGS_ROUTES } from "@/components/layout/settings-nav";
import { useEdgeFadeY } from "@/components/ui/use-scroll-fade";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SubItem {
  key?: string;
  titleKey: string;
  url: string;
  title?: string;
  description?: string;
  testId?: string;
  /** Other routes that highlight this item (pages that became tabs of it). */
  matches?: string[];
  /** Shown only for companies registered in Saudi Arabia (ZATCA). */
  saudiOnly?: boolean;
}

interface NavGroup {
  key: string;
  titleKey: string;
  icon: LucideIcon;
  items: SubItem[];
  url?: string;
  /** Direct items: other routes that highlight this entry. */
  matches?: string[];
}

interface ClientPortalItem {
  titleKey: string;
  icon: LucideIcon;
  url: string;
}

// ─── Nav data ────────────────────────────────────────────────────────────────

// WP-A (Fable spec 3.5): no group exceeds 7 items; labels are short sentence case
// (`shell.nav.*`); single destinations are direct items. `testId` keeps the data-testids the
// links had before the regroup (`link-<testId>`). Pages that left the sidebar stay routed and
// are reached from their parent page (tabs), the settings sub-nav or the command palette.
const CUSTOMER_GROUPS: NavGroup[] = [
  {
    key: "sales",
    titleKey: "shell.nav.sales",
    icon: TrendingUp,
    items: [
      { titleKey: "shell.nav.invoices", url: "/invoices", testId: "invoices" },
      { titleKey: "shell.nav.quotes", url: "/quotes", testId: "quotes" },
      { titleKey: "shell.nav.creditNotes", url: "/credit-notes", testId: "creditNotes" },
      { titleKey: "shell.nav.recurring", url: "/recurring-invoices", testId: "recurringInvoices" },
      { titleKey: "shell.nav.customers", url: "/contacts", testId: "contacts" },
      {
        titleKey: "shell.nav.paymentReminders",
        url: "/payment-chasing",
        testId: "paymentChasing",
      },
    ],
  },
  {
    key: "purchases",
    titleKey: "shell.nav.purchases",
    icon: ShoppingCart,
    items: [
      { titleKey: "shell.nav.bills", url: "/bill-pay", testId: "billPay" },
      {
        titleKey: "shell.nav.receipts",
        url: "/receipts",
        testId: "receipts",
        matches: ["/receipt-autopilot"],
      },
      { titleKey: "shell.nav.suppliers", url: "/vendors", testId: "pages.vendor" },
      { titleKey: "shell.nav.purchaseOrders", url: "/purchase-orders", testId: "purchaseOrders" },
      { titleKey: "shell.nav.expenseClaims", url: "/expense-claims", testId: "expenseClaims" },
    ],
  },
  {
    key: "inventory",
    titleKey: "shell.nav.inventory",
    icon: Package,
    url: "/inventory",
    items: [],
  },
  {
    key: "banking",
    titleKey: "shell.nav.banking",
    icon: Landmark,
    items: [
      {
        titleKey: "shell.nav.bankAccounts",
        url: "/bank-accounts",
        testId: "banking.accounts.title",
      },
      {
        titleKey: "shell.nav.reconciliation",
        url: "/bank-reconciliation",
        testId: "bankReconciliation",
        matches: ["/reconciliation-rules", "/auto-reconcile"],
      },
      { titleKey: "shell.nav.bankFeeds", url: "/bank-feeds", testId: "banking.feeds.title" },
    ],
  },
  {
    key: "accounting",
    titleKey: "shell.nav.accounting",
    icon: BookMarked,
    items: [
      {
        titleKey: "shell.nav.chartOfAccounts",
        url: "/chart-of-accounts",
        testId: "chartOfAccounts",
      },
      { titleKey: "shell.nav.journal", url: "/journal", testId: "journal" },
      { titleKey: "shell.nav.fixedAssets", url: "/fixed-assets", testId: "fixedAssets" },
      { titleKey: "shell.nav.budgets", url: "/budgets", testId: "budgets" },
      { titleKey: "shell.nav.costCentres", url: "/cost-centers", testId: "costCenters" },
      { titleKey: "shell.nav.exchangeRates", url: "/exchange-rates", testId: "exchangeRates" },
      { titleKey: "shell.nav.monthEnd", url: "/month-end", testId: "monthEndClose" },
    ],
  },
  {
    key: "reports",
    titleKey: "shell.nav.reports",
    icon: BarChart3,
    url: "/reports",
    items: [],
  },
  {
    key: "compliance",
    titleKey: "shell.nav.tax",
    icon: ClipboardList,
    items: [
      {
        titleKey: "shell.nav.vat",
        url: "/vat-filing",
        testId: "vatFiling",
        matches: ["/vat-autopilot"],
      },
      { titleKey: "shell.nav.corporateTax", url: "/corporate-tax", testId: "corporateTax" },
      {
        titleKey: "shell.nav.einvoicing",
        url: "/settings/einvoicing",
        testId: "einvoicing-settings",
      },
      {
        titleKey: "shell.nav.zatca",
        url: "/settings/zatca",
        testId: "zatca-settings",
        saudiOnly: true,
      },
      { titleKey: "shell.nav.calendar", url: "/compliance-calendar", testId: "complianceCalendar" },
      {
        titleKey: "shell.nav.filedReturns",
        url: "/tax-return-archive",
        testId: "taxReturnArchive",
      },
      { titleKey: "shell.nav.evidence", url: "/evidence-center", testId: "evidenceCenter" },
    ],
  },
  {
    key: "payroll",
    titleKey: "shell.nav.payroll",
    icon: Banknote,
    url: "/payroll",
    items: [],
  },
  {
    key: "ai",
    titleKey: "shell.nav.assistant",
    icon: Sparkles,
    url: "/ai",
    matches: ["/assistant"],
    items: [],
  },
];

// Settings is one entry that opens the settings area (left sub-nav, SettingsLayout).
const SETTINGS_GROUP: NavGroup = {
  key: "settings",
  titleKey: "shell.nav.settings",
  icon: Settings,
  url: "/settings/company",
  matches: SETTINGS_ROUTES,
  items: [],
};

const NRA_GROUP: NavGroup = {
  key: "nra",
  titleKey: "shell.nav.practice",
  icon: Briefcase,
  items: [
    {
      titleKey: "shell.nav.commandCentre",
      url: "/firm/command-center",
      testId: "firmCommandCenter",
      matches: ["/firm/health", "/firm/value-ops", "/firm/analytics", "/firm/pipeline"],
    },
    { titleKey: "shell.nav.clients", url: "/firm/clients", testId: "clientPortfolio" },
    { titleKey: "shell.nav.practiceWork", url: "/firm/practice", testId: "firm.practiceWorkspace" },
    { titleKey: "shell.nav.staff", url: "/firm/staff", testId: "staffManagement" },
    { titleKey: "shell.nav.communications", url: "/firm/comms", testId: "communications" },
    {
      titleKey: "shell.nav.documentChasing",
      url: "/firm/document-chasing",
      testId: "documentChasing",
    },
    { titleKey: "shell.nav.emailIntake", url: "/firm/email-intake", testId: "emailIntake" },
  ],
};

const ADMIN_GROUP: NavGroup = {
  key: "admin",
  titleKey: "shell.nav.admin",
  icon: Shield,
  items: [
    { titleKey: "shell.nav.adminOverview", url: "/admin/dashboard", testId: "adminDashboard" },
    { titleKey: "shell.nav.adminUsers", url: "/admin/users", testId: "userManagement" },
    {
      titleKey: "shell.nav.adminInvitations",
      url: "/admin/invitations",
      testId: "userInvitations",
    },
    { titleKey: "shell.nav.adminDocuments", url: "/admin/documents", testId: "clientDocuments" },
    { titleKey: "shell.nav.adminImport", url: "/admin/import", testId: "clientImport" },
    { titleKey: "shell.nav.adminActivity", url: "/admin/activity-logs", testId: "activityLogs" },
  ],
};

// Client portal flat items (no collapsible — spec: "don't change this")
const CLIENT_PORTAL_DOCUMENT_ITEMS: ClientPortalItem[] = [
  { titleKey: "documentVault", icon: FolderArchive, url: "/document-vault" },
];

const CLIENT_PORTAL_COMPLIANCE_ITEMS: ClientPortalItem[] = [
  { titleKey: "vatFiling", icon: ClipboardList, url: "/vat-filing" },
  { titleKey: "corporateTax", icon: FileStack, url: "/corporate-tax" },
  { titleKey: "complianceCalendar", icon: CalendarDays, url: "/compliance-calendar" },
  { titleKey: "taxReturnArchive", icon: FileStack, url: "/tax-return-archive" },
  { titleKey: "taskCenter", icon: ListTodo, url: "/task-center" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SIDEBAR_LS_KEY = "sidebar-expanded-group";

function routeMatchesItem(location: string, itemUrl: string): boolean {
  if (location === itemUrl || location.startsWith(itemUrl + "/")) return true;
  if (itemUrl.includes("?")) return location.startsWith(itemUrl + "&");
  return location.startsWith(itemUrl + "?");
}

function itemIsActive(location: string, item: { url?: string; matches?: string[] }): boolean {
  return [...(item.url ? [item.url] : []), ...(item.matches ?? [])].some((url) =>
    routeMatchesItem(location, url)
  );
}

function groupIsActive(location: string, group: NavGroup): boolean {
  return group.url
    ? itemIsActive(location, group)
    : group.items.some((item) => itemIsActive(location, item));
}

function getGroupForRoute(location: string, groups: NavGroup[]): string | null {
  return groups.find((group) => groupIsActive(location, group))?.key ?? null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AppSidebar() {
  const [location, setLocation] = useLocation();
  const { t, locale } = useTranslation();
  const { setLocale } = useI18n();
  const { isRTL, rtlValue } = useRTL();
  const queryClient = useQueryClient();
  const { data: currentUser } = useCurrentUser();

  const isAdmin = currentUser?.isAdmin === true;
  const userType = currentUser?.userType || "customer";

  // `isFirmContext` is true when the user has switched INTO a firm-managed
  // client company. Firm-level tools (the NRA Center) belong at the firm level,
  // so we hide that group while a specific client file is the active workspace.
  // The user re-enters the firm via the "Firm workspace" entry in CompanySwitcher.
  const { isFirmContext, company } = useActiveCompany();
  // ZATCA applies to companies registered in Saudi Arabia only (UAE companies never see it).
  const isSaudi =
    (company as { addressCountry?: string | null } | undefined)?.addressCountry === "SA";
  // S4: staff of any approved firm (GET /api/firms/me) get the firm group too,
  // without the NR-only links (firm messaging, document chasing, email intake,
  // value-ops). NR staff and admins keep the full NRA Center.
  const firmAccess = useFirmAccess(currentUser);
  const showNraCenter =
    shouldShowNraCenterNav(currentUser, { inClientContext: isFirmContext }) ||
    (firmAccess.canAccessFirm && !isFirmContext);
  const firmGroup = useMemo<NavGroup>(
    () =>
      firmAccess.isNr
        ? NRA_GROUP
        : {
            ...NRA_GROUP,
            titleKey: "firm.navFirmWorkspace",
            items: NRA_GROUP.items.filter((item) => firmPathAllowed(firmAccess, item.url)),
          },
    [firmAccess]
  );

  // All collapsible groups for this user (Dashboard is separate — direct link)
  const allGroups = useMemo<NavGroup[]>(
    () => [
      ...CUSTOMER_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) => !item.saudiOnly || isSaudi),
      })),
      ...(showNraCenter ? [firmGroup] : []),
      ...(isAdmin ? [ADMIN_GROUP] : []),
      SETTINGS_GROUP,
    ],
    [showNraCenter, firmGroup, isAdmin, isSaudi]
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollFade = useEdgeFadeY(scrollRef, 16);

  // Initialize expanded group: active route's group takes precedence, then localStorage
  const [expandedGroup, setExpandedGroup] = useState<string | null>(() => {
    const fromRoute = getGroupForRoute(location, [
      ...CUSTOMER_GROUPS,
      NRA_GROUP,
      ADMIN_GROUP,
      SETTINGS_GROUP,
    ]);
    if (fromRoute) return fromRoute;
    try {
      return localStorage.getItem(SIDEBAR_LS_KEY);
    } catch {
      return null;
    }
  });

  // Auto-expand the group that owns the current route when navigating
  useEffect(() => {
    const group = getGroupForRoute(location, allGroups);
    if (group) {
      // Syncs the open group with the router location (an external system).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpandedGroup((current) => (current === group ? current : group));
      try {
        localStorage.setItem(SIDEBAR_LS_KEY, group);
      } catch {
        /* ignore */
      }
    }
  }, [location, allGroups]);

  const toggleGroup = (key: string) => {
    setExpandedGroup((prev) => {
      const next = prev === key ? null : key;
      try {
        if (next) localStorage.setItem(SIDEBAR_LS_KEY, next);
        else localStorage.removeItem(SIDEBAR_LS_KEY);
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
    } catch {
      // Network failure shouldn't block local sign-out; cookies still expire.
    }
    removeToken();
    queryClient.clear();
    setLocation("/");
  };

  const toggleLanguage = () => {
    setLocale(locale === "en" ? "ar" : "en");
  };

  // ── Renderers ──────────────────────────────────────────────────────────────

  const renderNavGroup = (group: NavGroup) => {
    const Icon = group.icon;
    const isExpanded = expandedGroup === group.key;
    const hasActive = groupIsActive(location, group);
    const groupTitle = (t as Record<string, string>)[group.titleKey] ?? group.titleKey;

    const groupUrl = group.url;

    if (groupUrl) {
      return (
        <SidebarMenuItem key={group.key}>
          <SidebarMenuButton
            isActive={hasActive}
            onClick={() => setLocation(groupUrl)}
            data-testid={`group-${group.key}`}
          >
            <Icon className="w-4 h-4" />
            <span className="min-w-0 truncate" title={groupTitle}>
              {groupTitle}
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      );
    }

    return (
      <SidebarMenuItem key={group.key}>
        <SidebarMenuButton
          onClick={() => toggleGroup(group.key)}
          className={cn(
            hasActive && "font-medium text-sidebar-accent-foreground [&>svg]:text-sidebar-primary"
          )}
          data-testid={`group-${group.key}`}
        >
          <Icon className="w-4 h-4" />
          {/* Group labels never wrap (spec 3.5): one line, truncated with a tooltip. */}
          <span className="min-w-0 truncate" title={groupTitle}>
            {groupTitle}
          </span>
          <motion.div
            className="ms-auto"
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.16 }}
          >
            <ChevronDown className="w-3.5 h-3.5 text-sidebar-muted" />
          </motion.div>
        </SidebarMenuButton>

        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              key="sub"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              style={{ overflow: "hidden" }}
            >
              <SidebarMenuSub
                className={cn(
                  group.key === "reports" &&
                    "max-h-[min(34rem,calc(100vh-18rem))] overflow-y-auto pe-1"
                )}
              >
                {group.items.map((item) => {
                  const isActive = itemIsActive(location, item);
                  const label =
                    item.title ?? (t as Record<string, string>)[item.titleKey] ?? item.titleKey;
                  const description = group.key === "reports" ? undefined : item.description;
                  return (
                    <SidebarMenuSubItem key={item.key ?? item.testId ?? item.url}>
                      <SidebarMenuSubButton
                        asChild
                        isActive={isActive}
                        className={cn(
                          "w-full justify-start text-start",
                          description ? "h-auto min-h-10 py-1.5" : undefined
                        )}
                        data-testid={`link-${item.testId ?? item.titleKey}`}
                      >
                        <Link href={item.url} title={label}>
                          <span className="min-w-0 flex-1 overflow-hidden">
                            <span className="block truncate">{label}</span>
                            {description ? (
                              <span className="block truncate text-[11px] font-normal leading-tight text-sidebar-muted">
                                {description}
                              </span>
                            ) : null}
                          </span>
                        </Link>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  );
                })}
              </SidebarMenuSub>
            </motion.div>
          )}
        </AnimatePresence>
      </SidebarMenuItem>
    );
  };

  const renderClientPortalItem = (item: ClientPortalItem) => {
    const Icon = item.icon;
    const isActive = location === item.url;
    const label = (t as Record<string, string>)[item.titleKey] ?? item.titleKey;
    return (
      <SidebarMenuItem key={item.url}>
        <SidebarMenuButton
          isActive={isActive}
          onClick={() => setLocation(item.url)}
          data-testid={`link-${item.titleKey}`}
        >
          <Icon className="w-4 h-4" />
          <span>{label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Sidebar side={isRTL ? "right" : "left"}>
      <motion.div
        initial={{ opacity: 0, x: rtlValue(-6, 6) }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
        {/* Spec 3.5: logo + wordmark only (no tagline); the company switcher sits directly
            under it for every user type. */}
        <SidebarHeader className="px-3 pt-4 pb-3 space-y-3">
          <div className="flex items-center gap-2.5 px-1">
            <BrandMark size="md" />
            {/* i18n-ignore: brand name */}
            <div className="font-semibold text-[15px] tracking-tight text-sidebar-accent-foreground leading-tight">
              Muhasib<span className="text-sidebar-primary">.ai</span>
            </div>
          </div>
          <CompanySwitcher />
        </SidebarHeader>
      </motion.div>

      <SidebarContent ref={scrollRef} className="px-1.5" style={scrollFade}>
        {/* ── Client portal — simplified flat view ── */}
        {userType === "client" && (
          <>
            <div className="px-3 pt-5 pb-1.5 text-[11px] font-medium text-sidebar-muted">
              {t["shell.sidebarWorkspace"]}
            </div>
            <SidebarMenu className="px-1.5">
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location === "/dashboard"}
                  onClick={() => setLocation("/dashboard")}
                  data-testid="link-dashboard"
                >
                  <LayoutDashboard className="w-4 h-4" />
                  <span>{t.dashboard}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>

            <div className="px-3 pt-5 pb-1.5 text-[11px] font-medium text-sidebar-muted">
              {t["shell.sidebarDocuments"]}
            </div>
            <SidebarMenu className="px-1.5">
              {CLIENT_PORTAL_DOCUMENT_ITEMS.map(renderClientPortalItem)}
            </SidebarMenu>

            <div className="px-3 pt-5 pb-1.5 text-[11px] font-medium text-sidebar-muted">
              {t.compliance ?? "Compliance"}
            </div>
            <SidebarMenu className="px-1.5">
              {CLIENT_PORTAL_COMPLIANCE_ITEMS.map(renderClientPortalItem)}
            </SidebarMenu>

            <div className="px-3 pt-5 pb-1.5 text-[11px] font-medium text-sidebar-muted">
              {t["shell.sidebarInsights"]}
            </div>
            <SidebarMenu className="px-1.5">
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location === "/reports"}
                  onClick={() => setLocation("/reports")}
                  data-testid="link-reports"
                >
                  <BarChart3 className="w-4 h-4" />
                  <span>{t.reports}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </>
        )}

        {/* ── Customer / admin — 7 collapsible accordion groups ──
            Default for every non-portal account type: an unknown or mistyped
            userType must never strand the owner with an empty sidebar. */}
        {userType !== "client" && (
          <>
            <div className="px-3 pt-5 pb-1.5 text-[11px] font-medium text-sidebar-muted">
              {t["shell.sidebarOverview"]}
            </div>
            <SidebarMenu className="px-1.5">
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location === "/dashboard"}
                  onClick={() => setLocation("/dashboard")}
                  data-testid="link-dashboard"
                >
                  <LayoutDashboard className="w-4 h-4" />
                  <span>{t.dashboard}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>

            <div className="px-3 pt-5 pb-1.5 text-[11px] font-medium text-sidebar-muted">
              {t["shell.sidebarOperations"]}
            </div>
            <SidebarMenu className="px-1.5 pb-4">{allGroups.map(renderNavGroup)}</SidebarMenu>
          </>
        )}
      </SidebarContent>

      <SidebarFooter className="px-2.5 py-2.5 border-t border-sidebar-border space-y-0.5">
        <button
          type="button"
          onClick={toggleLanguage}
          data-testid="button-language-toggle"
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent/70 transition-colors duration-fast"
        >
          <Languages className="w-4 h-4 text-sidebar-muted" />
          <span className="text-[13px]" lang={locale === "en" ? "ar" : "en"}>
            {locale === "en" ? "العربية" : "English"}
          </span>
          <span className="ms-auto kbd">{locale === "en" ? "AR" : "EN"}</span>
        </button>

        <button
          type="button"
          onClick={handleLogout}
          data-testid="button-logout"
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground hover:text-danger hover:bg-danger/10 transition-colors duration-fast"
        >
          <LogOut className="w-4 h-4 text-sidebar-muted rtl:-scale-x-100" />
          <span className="text-[13px]">{t.logout}</span>
        </button>
      </SidebarFooter>
    </Sidebar>
  );
}
