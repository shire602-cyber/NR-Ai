import { useState, useEffect, useRef } from "react";
import {
  LayoutDashboard,
  BarChart3,
  ChevronDown,
  Languages,
  LogOut,
  FolderArchive,
  FileStack,
  CalendarDays,
  ListTodo,
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
import { useTranslation, useI18n } from "@/lib/i18n";
import { useRTL } from "@/components/RTLProvider";
import { removeToken } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";
import { CompanySwitcher } from "@/components/CompanySwitcher";
import { BrandMark } from "@/components/BrandMark";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  ALL_NAV_GROUPS,
  getGroupForRoute,
  groupIsActive,
  itemIsActive,
  type NavGroup,
} from "@/components/layout/nav-config";
import { useNavGroups } from "@/components/layout/useNavGroups";
import { useEdgeFadeY } from "@/components/ui/use-scroll-fade";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ClientPortalItem {
  titleKey: string;
  icon: LucideIcon;
  url: string;
}

// ─── Nav data ────────────────────────────────────────────────────────────────

// Client portal flat items (no collapsible — spec: "don't change this")
const CLIENT_PORTAL_DOCUMENT_ITEMS: ClientPortalItem[] = [
  { titleKey: "documentVault", icon: FolderArchive, url: "/document-vault" },
];

const CLIENT_PORTAL_COMPLIANCE_ITEMS: ClientPortalItem[] = [
  { titleKey: "vatFiling", icon: ClipboardList, url: "/vat-filing" },
  { titleKey: "corporateTax", icon: FileStack, url: "/corporate-tax" },
  { titleKey: "complianceCalendar", icon: CalendarDays, url: "/compliance-calendar" },
  { titleKey: "taxReturnArchive", icon: FileStack, url: "/tax-return-archive" },
  // The task centre became the calendar's List view (WP-D); /task-center only redirects.
  { titleKey: "taskCenter", icon: ListTodo, url: "/compliance-calendar?view=list" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SIDEBAR_LS_KEY = "sidebar-expanded-group";

// ─── Component ───────────────────────────────────────────────────────────────

export function AppSidebar() {
  const [location, setLocation] = useLocation();
  const { t, locale } = useTranslation();
  const { setLocale } = useI18n();
  const { isRTL, rtlValue } = useRTL();
  const queryClient = useQueryClient();
  const { data: currentUser } = useCurrentUser();

  const userType = currentUser?.userType || "customer";

  const { allGroups } = useNavGroups();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollFade = useEdgeFadeY(scrollRef, 16);

  // Initialize expanded group: active route's group takes precedence, then localStorage
  const [expandedGroup, setExpandedGroup] = useState<string | null>(() => {
    const fromRoute = getGroupForRoute(location, ALL_NAV_GROUPS);
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
                              <span className="block truncate text-caption font-normal text-sidebar-muted">
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
            <div className="px-3 pt-5 pb-1.5 text-caption font-medium text-sidebar-muted">
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

            <div className="px-3 pt-5 pb-1.5 text-caption font-medium text-sidebar-muted">
              {t["shell.sidebarDocuments"]}
            </div>
            <SidebarMenu className="px-1.5">
              {CLIENT_PORTAL_DOCUMENT_ITEMS.map(renderClientPortalItem)}
            </SidebarMenu>

            <div className="px-3 pt-5 pb-1.5 text-caption font-medium text-sidebar-muted">
              {t.compliance ?? "Compliance"}
            </div>
            <SidebarMenu className="px-1.5">
              {CLIENT_PORTAL_COMPLIANCE_ITEMS.map(renderClientPortalItem)}
            </SidebarMenu>

            <div className="px-3 pt-5 pb-1.5 text-caption font-medium text-sidebar-muted">
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
            <div className="px-3 pt-5 pb-1.5 text-caption font-medium text-sidebar-muted">
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

            <div className="px-3 pt-5 pb-1.5 text-caption font-medium text-sidebar-muted">
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
