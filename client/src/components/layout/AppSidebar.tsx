import { useState, useEffect, useMemo } from "react";
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
  Newspaper,
  ClipboardList,
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
import { useTranslation, useI18n } from "@/lib/i18n";
import { useRTL } from "@/components/RTLProvider";
import { removeToken } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";
import { CompanySwitcher } from "@/components/CompanySwitcher";
import { BrandMark } from "@/components/BrandMark";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useActiveCompany } from "@/components/ActiveCompanyProvider";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SubItem {
  key?: string;
  titleKey: string;
  url: string;
  title?: string;
  description?: string;
  testId?: string;
}

interface NavGroup {
  key: string;
  titleKey: string;
  icon: LucideIcon;
  items: SubItem[];
  url?: string;
}

interface ClientPortalItem {
  titleKey: string;
  icon: LucideIcon;
  url: string;
}

// ─── Nav data ────────────────────────────────────────────────────────────────

const CUSTOMER_GROUPS: NavGroup[] = [
  {
    key: "sales",
    titleKey: "sales",
    icon: TrendingUp,
    items: [
      { titleKey: "invoices", url: "/invoices" },
      { titleKey: "quotes", url: "/quotes" },
      { titleKey: "creditNotes", url: "/credit-notes" },
      { titleKey: "invoiceTemplates", url: "/invoice-templates" },
      { titleKey: "recurringInvoices", url: "/recurring-invoices" },
      { titleKey: "paymentChasing", url: "/payment-chasing" },
      { titleKey: "contacts", url: "/contacts" },
    ],
  },
  {
    key: "purchases",
    titleKey: "purchases",
    icon: ShoppingCart,
    items: [
      { titleKey: "receipts", url: "/receipts" },
      { titleKey: "receiptAutopilot", url: "/receipt-autopilot" },
      { titleKey: "billPay", url: "/bill-pay" },
      { titleKey: "purchaseOrders", url: "/purchase-orders" },
      { titleKey: "expenseClaims", url: "/expense-claims" },
      { titleKey: "inventory", url: "/inventory" },
    ],
  },
  {
    key: "accounting",
    titleKey: "accounting",
    icon: BookMarked,
    items: [
      { titleKey: "chartOfAccounts", url: "/chart-of-accounts" },
      { titleKey: "journal", url: "/journal" },
      { titleKey: "bankReconciliation", url: "/bank-reconciliation" },
      { titleKey: "reconciliationRules", url: "/reconciliation-rules" },
      { titleKey: "costCenters", url: "/cost-centers" },
      { titleKey: "exchangeRates", url: "/exchange-rates" },
      { titleKey: "fixedAssets", url: "/fixed-assets" },
      { titleKey: "monthEndClose", url: "/month-end" },
    ],
  },
  {
    key: "reports",
    titleKey: "reportsSection",
    icon: BarChart3,
    url: "/reports",
    items: [],
  },
  {
    key: "payroll",
    titleKey: "hrPayroll",
    icon: Banknote,
    items: [{ titleKey: "payroll", url: "/payroll" }],
  },
  {
    key: "compliance",
    titleKey: "compliance",
    icon: ClipboardList,
    items: [
      { titleKey: "vatFiling", url: "/vat-filing" },
      { titleKey: "vatAutopilot", url: "/vat-autopilot" },
      { titleKey: "corporateTax", url: "/corporate-tax" },
      { titleKey: "taxReturnArchive", url: "/tax-return-archive" },
      { titleKey: "complianceCalendar", url: "/compliance-calendar" },
      { titleKey: "documentVersions", url: "/document-versions" },
    ],
  },
  {
    key: "settings",
    titleKey: "settings",
    icon: Settings,
    items: [
      { titleKey: "companySettings", url: "/settings/company" },
      { titleKey: "companyProfile", url: "/company-profile" },
      { titleKey: "teamManagement", url: "/team" },
      { titleKey: "integrations", url: "/integrations" },
      { titleKey: "developerSettings", url: "/developer-settings" },
      { titleKey: "notificationPreferences", url: "/notification-preferences" },
      { titleKey: "subscription", url: "/subscription" },
      { titleKey: "backupRestore", url: "/backup-restore" },
      { titleKey: "history", url: "/history" },
    ],
  },
];

const NRA_GROUP: NavGroup = {
  key: "nra",
  titleKey: "nraCenter",
  icon: Briefcase,
  items: [
    { titleKey: "firmCommandCenter", url: "/firm/command-center" },
    { titleKey: "valueOps", url: "/firm/value-ops" },
    { titleKey: "clientPortfolio", url: "/firm/clients" },
    { titleKey: "staffManagement", url: "/firm/staff" },
    { titleKey: "healthDashboard", url: "/firm/health" },
    { titleKey: "communications", url: "/firm/comms" },
    { titleKey: "documentChasing", url: "/firm/document-chasing" },
  ],
};

const ADMIN_GROUP: NavGroup = {
  key: "admin",
  titleKey: "adminPanel",
  icon: Shield,
  items: [
    { titleKey: "adminDashboard", url: "/admin/dashboard" },
    { titleKey: "clientManagement", url: "/admin/clients" },
    { titleKey: "clientDocuments", url: "/admin/documents" },
    { titleKey: "userInvitations", url: "/admin/invitations" },
    { titleKey: "clientImport", url: "/admin/import" },
    { titleKey: "userManagement", url: "/admin/users" },
    { titleKey: "activityLogs", url: "/admin/activity-logs" },
    { titleKey: "systemSettings", url: "/admin" },
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

const CLIENT_PORTAL_INSIGHT_ITEMS: ClientPortalItem[] = [
  { titleKey: "newsFeed", icon: Newspaper, url: "/news-feed" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SIDEBAR_LS_KEY = "sidebar-expanded-group";

function routeMatchesItem(location: string, itemUrl: string): boolean {
  if (location === itemUrl || location.startsWith(itemUrl + "/")) return true;
  if (itemUrl.includes("?")) return location.startsWith(itemUrl + "&");
  return location.startsWith(itemUrl + "?");
}

function getGroupForRoute(location: string, groups: NavGroup[]): string | null {
  for (const group of groups) {
    if (group.url && routeMatchesItem(location, group.url)) {
      return group.key;
    }

    for (const item of group.items) {
      if (routeMatchesItem(location, item.url)) {
        return group.key;
      }
    }
  }
  return null;
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
  const { isFirmContext } = useActiveCompany();
  const showNraCenter = shouldShowNraCenterNav(currentUser, { inClientContext: isFirmContext });

  // All collapsible groups for this user (Dashboard is separate — direct link)
  const allGroups = useMemo<NavGroup[]>(
    () => [
      ...CUSTOMER_GROUPS,
      ...(showNraCenter ? [NRA_GROUP] : []),
      ...(isAdmin ? [ADMIN_GROUP] : []),
    ],
    [showNraCenter, isAdmin]
  );

  // Initialize expanded group: active route's group takes precedence, then localStorage
  const [expandedGroup, setExpandedGroup] = useState<string | null>(() => {
    const fromRoute = getGroupForRoute(location, [...CUSTOMER_GROUPS, NRA_GROUP, ADMIN_GROUP]);
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
    if (group && group !== expandedGroup) {
      setExpandedGroup(group);
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
    const hasActive = group.url
      ? routeMatchesItem(location, group.url)
      : group.items.some((item) => routeMatchesItem(location, item.url));
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
            <span>{groupTitle}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      );
    }

    return (
      <SidebarMenuItem key={group.key}>
        <SidebarMenuButton
          onClick={() => toggleGroup(group.key)}
          className={cn(hasActive && "text-primary font-medium")}
          data-testid={`group-${group.key}`}
        >
          <Icon className="w-4 h-4" />
          <span>{groupTitle}</span>
          <motion.div
            className="ms-auto"
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronDown className="w-4 h-4 opacity-50" />
          </motion.div>
        </SidebarMenuButton>

        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              key="sub"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              style={{ overflow: "hidden" }}
            >
              <SidebarMenuSub
                className={cn(
                  group.key === "reports" &&
                    "max-h-[min(34rem,calc(100vh-18rem))] overflow-y-auto pr-1"
                )}
              >
                {group.items.map((item) => {
                  const isActive = routeMatchesItem(location, item.url);
                  const label =
                    item.title ?? (t as Record<string, string>)[item.titleKey] ?? item.titleKey;
                  const description = group.key === "reports" ? undefined : item.description;
                  return (
                    <SidebarMenuSubItem key={item.key ?? item.testId ?? item.url}>
                      <SidebarMenuSubButton
                        asChild
                        isActive={isActive}
                        className={cn(
                          "w-full justify-start text-left",
                          description ? "h-auto min-h-10 py-1.5" : undefined
                        )}
                        data-testid={`link-${item.testId ?? item.titleKey}`}
                      >
                        <Link href={item.url} title={label}>
                          <span className="min-w-0 flex-1 overflow-hidden">
                            <span className="block truncate">{label}</span>
                            {description ? (
                              <span className="block truncate text-[10.5px] font-normal leading-tight text-sidebar-foreground/45">
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
        initial={{ opacity: 0, x: rtlValue(-12, 12) }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4 }}
      >
        <SidebarHeader className="px-3 pt-4 pb-3 border-b border-sidebar-border/60 space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="relative shrink-0">
              <BrandMark size="md" />
              <span
                aria-hidden
                className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-sidebar-primary ring-2 ring-sidebar animate-pulse-dot"
              />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-[13px] tracking-tight text-sidebar-foreground leading-tight">
                Muhasib<span className="text-sidebar-primary">.ai</span>
              </div>
              <div className="text-[10.5px] text-sidebar-foreground/55 uppercase tracking-[0.12em] leading-tight font-medium">
                {t.smartAccounting ?? "Smart Accounting"}
              </div>
            </div>
          </div>
          <CompanySwitcher />
        </SidebarHeader>
      </motion.div>

      <SidebarContent className="px-1.5">
        {/* ── Client portal — simplified flat view ── */}
        {userType === "client" && (
          <>
            <div className="px-3 pt-4 pb-1.5 text-[10px] uppercase tracking-[0.14em] text-sidebar-foreground/45 font-semibold">
              Workspace
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

            <div className="px-3 pt-4 pb-1.5 text-[10px] uppercase tracking-[0.14em] text-sidebar-foreground/45 font-semibold">
              Documents
            </div>
            <SidebarMenu className="px-1.5">
              {CLIENT_PORTAL_DOCUMENT_ITEMS.map(renderClientPortalItem)}
            </SidebarMenu>

            <div className="px-3 pt-4 pb-1.5 text-[10px] uppercase tracking-[0.14em] text-sidebar-foreground/45 font-semibold">
              {t.compliance ?? "Compliance"}
            </div>
            <SidebarMenu className="px-1.5">
              {CLIENT_PORTAL_COMPLIANCE_ITEMS.map(renderClientPortalItem)}
            </SidebarMenu>

            <div className="px-3 pt-4 pb-1.5 text-[10px] uppercase tracking-[0.14em] text-sidebar-foreground/45 font-semibold">
              Insights
            </div>
            <SidebarMenu className="px-1.5">
              {CLIENT_PORTAL_INSIGHT_ITEMS.map(renderClientPortalItem)}
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
            <div className="px-3 pt-4 pb-1.5 text-[10px] uppercase tracking-[0.14em] text-sidebar-foreground/45 font-semibold">
              Overview
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

            <div className="px-3 pt-4 pb-1.5 text-[10px] uppercase tracking-[0.14em] text-sidebar-foreground/45 font-semibold">
              Operations
            </div>
            <SidebarMenu className="px-1.5 pb-4">{allGroups.map(renderNavGroup)}</SidebarMenu>
          </>
        )}
      </SidebarContent>

      <SidebarFooter className="px-3 py-3 border-t border-sidebar-border/60 space-y-1.5">
        <button
          type="button"
          onClick={toggleLanguage}
          data-testid="button-language-toggle"
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground/80 hover:text-sidebar-accent-foreground hover:bg-sidebar-accent transition-colors"
        >
          <Languages className="w-4 h-4 opacity-70" />
          <span className="text-[13px]">{locale === "en" ? "العربية" : "English"}</span>
          <span className="ms-auto text-[10px] uppercase tracking-wider text-sidebar-foreground/45 font-medium">
            {locale === "en" ? "AR" : "EN"}
          </span>
        </button>

        <button
          type="button"
          onClick={handleLogout}
          data-testid="button-logout"
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
        >
          <LogOut className="w-4 h-4 opacity-70" />
          <span className="text-[13px]">{t.logout ?? "Sign out"}</span>
        </button>
      </SidebarFooter>
    </Sidebar>
  );
}
