import { useState, useEffect, useMemo } from 'react';
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
  Building2,
  UserPlus,
  FileUp,
  Users,
  Activity,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
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
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTranslation, useI18n } from '@/lib/i18n';
import { removeToken, getToken } from '@/lib/auth';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SubItem {
  titleKey: string;
  url: string;
}

interface NavGroup {
  key: string;
  titleKey: string;
  icon: LucideIcon;
  items: SubItem[];
}

// ─── Nav data ────────────────────────────────────────────────────────────────

const CUSTOMER_GROUPS: NavGroup[] = [
  {
    key: 'sales',
    titleKey: 'sales',
    icon: TrendingUp,
    items: [
      { titleKey: 'invoices', url: '/invoices' },
      { titleKey: 'recurringInvoices', url: '/recurring-invoices' },
      { titleKey: 'contacts', url: '/contacts' },
    ],
  },
  {
    key: 'purchases',
    titleKey: 'purchases',
    icon: ShoppingCart,
    items: [
      { titleKey: 'receipts', url: '/receipts' },
      { titleKey: 'billPay', url: '/bill-pay' },
      { titleKey: 'expenseClaims', url: '/expense-claims' },
      { titleKey: 'inventory', url: '/inventory' },
    ],
  },
  {
    key: 'accounting',
    titleKey: 'accounting',
    icon: BookMarked,
    items: [
      { titleKey: 'chartOfAccounts', url: '/chart-of-accounts' },
      { titleKey: 'journal', url: '/journal' },
      { titleKey: 'bankReconciliation', url: '/bank-reconciliation' },
      { titleKey: 'fixedAssets', url: '/fixed-assets' },
      { titleKey: 'monthEndClose', url: '/month-end' },
    ],
  },
  {
    key: 'reports',
    titleKey: 'reportsSection',
    icon: BarChart3,
    items: [
      { titleKey: 'reports', url: '/reports' },
      { titleKey: 'vatFiling', url: '/vat-filing' },
      { titleKey: 'corporateTax', url: '/corporate-tax' },
      { titleKey: 'budgeting', url: '/budgets' },
      { titleKey: 'cashFlowForecast', url: '/cashflow-forecast' },
    ],
  },
  {
    key: 'payroll',
    titleKey: 'hrPayroll',
    icon: Banknote,
    items: [
      { titleKey: 'payroll', url: '/payroll' },
    ],
  },
  {
    key: 'settings',
    titleKey: 'settings',
    icon: Settings,
    items: [
      { titleKey: 'companyProfile', url: '/company-profile' },
      { titleKey: 'teamManagement', url: '/team' },
      { titleKey: 'integrations', url: '/integrations' },
      { titleKey: 'backupRestore', url: '/backup-restore' },
      { titleKey: 'history', url: '/history' },
    ],
  },
];

const NRA_GROUP: NavGroup = {
  key: 'nra',
  titleKey: 'nraCenter',
  icon: Briefcase,
  items: [
    { titleKey: 'clientPortfolio', url: '/firm/clients' },
    { titleKey: 'staffManagement', url: '/firm/staff' },
    { titleKey: 'healthDashboard', url: '/firm/health' },
    { titleKey: 'communications', url: '/firm/comms' },
  ],
};

const ADMIN_GROUP: NavGroup = {
  key: 'admin',
  titleKey: 'adminPanel',
  icon: Shield,
  items: [
    { titleKey: 'adminDashboard', url: '/admin/dashboard' },
    { titleKey: 'clientManagement', url: '/admin/clients' },
    { titleKey: 'clientDocuments', url: '/admin/documents' },
    { titleKey: 'userInvitations', url: '/admin/invitations' },
    { titleKey: 'clientImport', url: '/admin/import' },
    { titleKey: 'userManagement', url: '/admin/users' },
    { titleKey: 'activityLogs', url: '/admin/activity-logs' },
    { titleKey: 'systemSettings', url: '/admin' },
  ],
};

// Client portal flat items (no collapsible — spec: "don't change this")
const CLIENT_PORTAL_ITEMS = [
  { titleKey: 'documentVault', icon: FolderArchive, url: '/document-vault' },
  { titleKey: 'taxReturnArchive', icon: FileStack, url: '/tax-return-archive' },
  { titleKey: 'complianceCalendar', icon: CalendarDays, url: '/compliance-calendar' },
  { titleKey: 'taskCenter', icon: ListTodo, url: '/task-center' },
  { titleKey: 'newsFeed', icon: Newspaper, url: '/news-feed' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SIDEBAR_LS_KEY = 'sidebar-expanded-group';

function getGroupForRoute(location: string, groups: NavGroup[]): string | null {
  for (const group of groups) {
    for (const item of group.items) {
      if (location === item.url || location.startsWith(item.url + '/')) {
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

  const checkUserStatus = (): {
    isAdmin: boolean;
    userType: 'admin' | 'client' | 'customer';
    firmRole: 'firm_owner' | 'firm_admin' | null;
    needsRelogin: boolean;
  } => {
    try {
      const token = getToken();
      if (!token) {
        return { isAdmin: false, userType: 'customer', firmRole: null, needsRelogin: false };
      }
      const parts = token.split('.');
      if (parts.length !== 3) {
        return { isAdmin: false, userType: 'customer', firmRole: null, needsRelogin: false };
      }
      const payload = JSON.parse(atob(parts[1]));
      if (payload.isAdmin === undefined) {
        return { isAdmin: false, userType: 'customer', firmRole: null, needsRelogin: true };
      }
      return {
        isAdmin: payload.isAdmin === true,
        userType: payload.userType || 'customer',
        firmRole: payload.firmRole ?? null,
        needsRelogin: false,
      };
    } catch {
      return { isAdmin: false, userType: 'customer', firmRole: null, needsRelogin: false };
    }
  };

  const { isAdmin, userType, firmRole, needsRelogin } = checkUserStatus();

  useEffect(() => {
    if (needsRelogin) {
      removeToken();
      setLocation('/');
    }
  }, [needsRelogin, setLocation]);

  const hasFirmRole = firmRole === 'firm_owner' || firmRole === 'firm_admin';

  // All collapsible groups for this user (Dashboard is separate — direct link)
  const allGroups = useMemo<NavGroup[]>(
    () => [
      ...CUSTOMER_GROUPS,
      ...(hasFirmRole ? [NRA_GROUP] : []),
      ...(isAdmin ? [ADMIN_GROUP] : []),
    ],
    [hasFirmRole, isAdmin],
  );

  // Initialize expanded group: active route's group takes precedence, then localStorage
  const [expandedGroup, setExpandedGroup] = useState<string | null>(() => {
    const fromRoute = getGroupForRoute(location, [
      ...CUSTOMER_GROUPS,
      NRA_GROUP,
      ADMIN_GROUP,
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
    if (group && group !== expandedGroup) {
      setExpandedGroup(group);
      try { localStorage.setItem(SIDEBAR_LS_KEY, group); } catch { /* ignore */ }
    }
  }, [location, allGroups]);

  const toggleGroup = (key: string) => {
    setExpandedGroup(prev => {
      const next = prev === key ? null : key;
      try {
        if (next) localStorage.setItem(SIDEBAR_LS_KEY, next);
        else localStorage.removeItem(SIDEBAR_LS_KEY);
      } catch { /* ignore */ }
      return next;
    });
  };

  const handleLogout = () => {
    removeToken();
    setLocation('/');
  };

  const toggleLanguage = () => {
    setLocale(locale === 'en' ? 'ar' : 'en');
  };

  // ── Renderers ──────────────────────────────────────────────────────────────

  const renderNavGroup = (group: NavGroup) => {
    const Icon = group.icon;
    const isExpanded = expandedGroup === group.key;
    const hasActive = group.items.some(
      item => location === item.url || location.startsWith(item.url + '/'),
    );
    const groupTitle = (t as Record<string, string>)[group.titleKey] ?? group.titleKey;

    return (
      <SidebarMenuItem key={group.key}>
        <SidebarMenuButton
          onClick={() => toggleGroup(group.key)}
          className={cn(hasActive && 'text-primary font-medium')}
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
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              style={{ overflow: 'hidden' }}
            >
              <SidebarMenuSub>
                {group.items.map(item => {
                  const isActive =
                    location === item.url || location.startsWith(item.url + '/');
                  const label =
                    (t as Record<string, string>)[item.titleKey] ?? item.titleKey;
                  return (
                    <SidebarMenuSubItem key={item.url}>
                      <SidebarMenuSubButton
                        asChild
                        isActive={isActive}
                        data-testid={`link-${item.titleKey}`}
                      >
                        <button type="button" onClick={() => setLocation(item.url)}>
                          {label}
                        </button>
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

  const renderClientPortalItem = (item: typeof CLIENT_PORTAL_ITEMS[0]) => {
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
    <Sidebar>
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4 }}
      >
        <SidebarHeader className="p-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center shrink-0">
              <Wallet className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <div className="font-semibold text-sm">Muhasib.ai</div>
              <div className="text-xs text-muted-foreground">
                {t.smartAccounting ?? 'Smart Accounting'}
              </div>
            </div>
          </div>
        </SidebarHeader>
      </motion.div>

      <SidebarContent>
        {/* ── Client portal — simplified flat view (unchanged per spec) ── */}
        {userType === 'client' && (
          <>
            <SidebarMenu className="px-2 pt-2">
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location === '/dashboard'}
                  onClick={() => setLocation('/dashboard')}
                  data-testid="link-dashboard"
                >
                  <LayoutDashboard className="w-4 h-4" />
                  <span>{t.dashboard}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>

            <SidebarMenu className="px-2">
              {CLIENT_PORTAL_ITEMS.map(renderClientPortalItem)}
            </SidebarMenu>

            <SidebarMenu className="px-2">
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location === '/reports'}
                  onClick={() => setLocation('/reports')}
                  data-testid="link-reports"
                >
                  <BarChart3 className="w-4 h-4" />
                  <span>{t.reports}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </>
        )}

        {/* ── Customer / admin — 7 collapsible accordion groups ── */}
        {(userType === 'customer' || userType === 'admin') && (
          <>
            {/* Dashboard — direct link, no sub-items */}
            <SidebarMenu className="px-2 pt-2">
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location === '/dashboard'}
                  onClick={() => setLocation('/dashboard')}
                  data-testid="link-dashboard"
                >
                  <LayoutDashboard className="w-4 h-4" />
                  <span>{t.dashboard}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>

            {/* Collapsible groups */}
            <SidebarMenu className="px-2 pb-4">
              {allGroups.map(renderNavGroup)}
            </SidebarMenu>
          </>
        )}
      </SidebarContent>

      <SidebarFooter className="p-4 space-y-2">
        <Button
          variant="outline"
          className="w-full justify-start"
          onClick={toggleLanguage}
          data-testid="button-language-toggle"
        >
          <Languages className="w-4 h-4 me-2" />
          {locale === 'en' ? 'Arabic' : 'English'}
        </Button>

        <Button
          variant="ghost"
          className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={handleLogout}
          data-testid="button-logout"
        >
          <LogOut className="w-4 h-4 me-2" />
          {t.logout ?? 'Logout'}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
