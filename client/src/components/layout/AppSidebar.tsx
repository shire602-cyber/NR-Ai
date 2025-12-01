import { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  FileText, 
  BookMarked, 
  BarChart3, 
  Sparkles,
  Languages,
  LogOut,
  Receipt,
  Bot,
  Plug,
  MessageSquare,
  Building2,
  FileCheck,
  Users,
  List,
  Wallet,
  ShoppingCart,
  FolderArchive,
  FileStack,
  CalendarDays,
  ListTodo,
  Newspaper,
  Shield,
  UserPlus,
  Activity,
  Settings,
  FileUp,
  History,
  Database
} from 'lucide-react';
import { useLocation } from 'wouter';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { useTranslation, useI18n } from '@/lib/i18n';
import { removeToken, getToken } from '@/lib/auth';

const coreItems = [
  {
    title: 'dashboard',
    titleEn: 'Dashboard',
    titleAr: 'لوحة التحكم',
    icon: LayoutDashboard,
    url: '/dashboard',
  },
  {
    title: 'chartOfAccounts',
    titleEn: 'Chart of Accounts',
    titleAr: 'دليل الحسابات',
    icon: List,
    url: '/chart-of-accounts',
  },
  {
    title: 'journal',
    titleEn: 'Journal Entries',
    titleAr: 'القيود اليومية',
    icon: BookMarked,
    url: '/journal',
  },
  {
    title: 'invoices',
    titleEn: 'Invoices',
    titleAr: 'الفواتير',
    icon: FileText,
    url: '/invoices',
  },
  {
    title: 'receipts',
    titleEn: 'Receipts & Expenses',
    titleAr: 'الإيصالات والمصروفات',
    icon: Receipt,
    url: '/receipts',
  },
  {
    title: 'contacts',
    titleEn: 'Customer Contacts',
    titleAr: 'جهات الاتصال',
    icon: Users,
    url: '/contacts',
  },
  {
    title: 'bankReconciliation',
    titleEn: 'Bank Reconciliation',
    titleAr: 'تسوية البنك',
    icon: Building2,
    url: '/bank-reconciliation',
  },
];

const reportsItems = [
  {
    title: 'reports',
    titleEn: 'Financial Reports',
    titleAr: 'التقارير المالية',
    icon: BarChart3,
    url: '/reports',
  },
  {
    title: 'vatFiling',
    titleEn: 'VAT Filing',
    titleAr: 'تقديم ضريبة القيمة المضافة',
    icon: FileCheck,
    url: '/vat-filing',
  },
];

const aiItems = [
  {
    title: 'aiAssistant',
    titleEn: 'AI Assistant',
    titleAr: 'المساعد الذكي',
    icon: Bot,
    url: '/ai-cfo',
  },
  {
    title: 'aiCategorization',
    titleEn: 'AI Categorization',
    titleAr: 'التصنيف الذكي',
    icon: Sparkles,
    url: '/ai-features',
  },
];

const clientPortalItems = [
  {
    title: 'documentVault',
    titleEn: 'Document Vault',
    titleAr: 'خزنة المستندات',
    icon: FolderArchive,
    url: '/document-vault',
  },
  {
    title: 'taxReturnArchive',
    titleEn: 'Tax Return Archive',
    titleAr: 'أرشيف الإقرارات',
    icon: FileStack,
    url: '/tax-return-archive',
  },
  {
    title: 'complianceCalendar',
    titleEn: 'Compliance Calendar',
    titleAr: 'تقويم الامتثال',
    icon: CalendarDays,
    url: '/compliance-calendar',
  },
  {
    title: 'taskCenter',
    titleEn: 'Task Center',
    titleAr: 'مركز المهام',
    icon: ListTodo,
    url: '/task-center',
  },
  {
    title: 'newsFeed',
    titleEn: 'UAE Tax News',
    titleAr: 'أخبار الضرائب',
    icon: Newspaper,
    url: '/news-feed',
  },
];

const settingsItems = [
  {
    title: 'teamManagement',
    titleEn: 'Team',
    titleAr: 'الفريق',
    icon: Users,
    url: '/team',
  },
  {
    title: 'history',
    titleEn: 'Activity History',
    titleAr: 'سجل النشاط',
    icon: History,
    url: '/history',
  },
  {
    title: 'backupRestore',
    titleEn: 'Backup & Restore',
    titleAr: 'النسخ الاحتياطي',
    icon: Database,
    url: '/backup-restore',
  },
  {
    title: 'integrationsHub',
    titleEn: 'Shopify & E-commerce',
    titleAr: 'شوبيفاي والتجارة الإلكترونية',
    icon: ShoppingCart,
    url: '/integrations-hub',
  },
  {
    title: 'integrations',
    titleEn: 'Integrations',
    titleAr: 'التكاملات',
    icon: Plug,
    url: '/integrations',
  },
  {
    title: 'whatsappInbox',
    titleEn: 'WhatsApp',
    titleAr: 'واتساب',
    icon: MessageSquare,
    url: '/whatsapp',
  },
];

const adminItems = [
  {
    title: 'adminDashboard',
    titleEn: 'Admin Dashboard',
    titleAr: 'لوحة تحكم المدير',
    icon: Shield,
    url: '/admin/dashboard',
  },
  {
    title: 'clientManagement',
    titleEn: 'Client Management',
    titleAr: 'إدارة العملاء',
    icon: Building2,
    url: '/admin/clients',
  },
  {
    title: 'clientDocuments',
    titleEn: 'Client Documents',
    titleAr: 'مستندات العملاء',
    icon: FolderArchive,
    url: '/admin/documents',
  },
  {
    title: 'userInvitations',
    titleEn: 'Invitations',
    titleAr: 'الدعوات',
    icon: UserPlus,
    url: '/admin/invitations',
  },
  {
    title: 'clientImport',
    titleEn: 'Import Clients',
    titleAr: 'استيراد العملاء',
    icon: FileUp,
    url: '/admin/import',
  },
  {
    title: 'userManagement',
    titleEn: 'User Management',
    titleAr: 'إدارة المستخدمين',
    icon: Users,
    url: '/admin/users',
  },
  {
    title: 'activityLogs',
    titleEn: 'Activity Logs',
    titleAr: 'سجل النشاط',
    icon: Activity,
    url: '/admin/activity-logs',
  },
  {
    title: 'systemSettings',
    titleEn: 'System Settings',
    titleAr: 'إعدادات النظام',
    icon: Settings,
    url: '/admin',
  },
];

export function AppSidebar() {
  const [location, setLocation] = useLocation();
  const { t, locale } = useTranslation();
  const { setLocale } = useI18n();

  // Check user status directly from token - no state needed
  const checkUserStatus = (): { 
    isAdmin: boolean; 
    userType: 'admin' | 'client' | 'customer';
    needsRelogin: boolean 
  } => {
    try {
      const token = getToken();
      if (!token) {
        return { isAdmin: false, userType: 'customer', needsRelogin: false };
      }
      const parts = token.split('.');
      if (parts.length !== 3) {
        return { isAdmin: false, userType: 'customer', needsRelogin: false };
      }
      const payload = JSON.parse(atob(parts[1]));
      
      // If token doesn't have isAdmin field, it's an old token - needs re-login
      if (payload.isAdmin === undefined) {
        return { isAdmin: false, userType: 'customer', needsRelogin: true };
      }
      
      return { 
        isAdmin: payload.isAdmin === true, 
        userType: payload.userType || 'customer',
        needsRelogin: false 
      };
    } catch (error) {
      return { isAdmin: false, userType: 'customer', needsRelogin: false };
    }
  };

  // Check user status on every render
  const { isAdmin, userType, needsRelogin } = checkUserStatus();
  
  // Handle old token logout in useEffect (can't update state during render)
  useEffect(() => {
    if (needsRelogin) {
      console.log('[Admin Check] Old token detected - forcing re-login to get updated token');
      removeToken();
      setLocation('/');
    }
  }, [needsRelogin, setLocation]);

  const handleLogout = () => {
    removeToken();
    setLocation('/');
  };

  const toggleLanguage = () => {
    setLocale(locale === 'en' ? 'ar' : 'en');
  };

  const renderMenuItem = (item: typeof coreItems[0]) => {
    const Icon = item.icon;
    const isActive = location === item.url || location.startsWith(item.url + '/');
    const label = locale === 'ar' ? item.titleAr : item.titleEn;
    
    return (
      <SidebarMenuItem key={item.url}>
        <SidebarMenuButton 
          isActive={isActive}
          onClick={() => setLocation(item.url)}
          data-testid={`link-${item.title}`}
        >
          <Icon className="w-4 h-4" />
          <span>{label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
            <Wallet className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <div className="font-semibold text-sm">Muhasib.ai</div>
            <div className="text-xs text-muted-foreground">
              {locale === 'ar' ? 'المحاسبة الذكية' : 'Smart Accounting'}
            </div>
          </div>
        </div>
      </SidebarHeader>
      
      <SidebarContent>
        {/* Client Portal View - Simplified view for NR-managed clients */}
        {userType === 'client' && (
          <>
            <SidebarGroup>
              <SidebarGroupLabel>
                {locale === 'ar' ? 'لوحة التحكم' : 'Overview'}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {renderMenuItem({
                    title: 'dashboard',
                    titleEn: 'Dashboard',
                    titleAr: 'لوحة التحكم',
                    icon: LayoutDashboard,
                    url: '/dashboard',
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>
                {locale === 'ar' ? 'بوابة العميل' : 'My Portal'}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {clientPortalItems.map(renderMenuItem)}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>
                {locale === 'ar' ? 'التقارير' : 'Reports'}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {reportsItems.map(renderMenuItem)}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}

        {/* Customer/Admin View - Full bookkeeping features for self-service SaaS customers */}
        {(userType === 'customer' || userType === 'admin') && (
          <>
            <SidebarGroup>
              <SidebarGroupLabel>
                {locale === 'ar' ? 'المحاسبة' : 'Accounting'}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {coreItems.map(renderMenuItem)}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            
            <SidebarGroup>
              <SidebarGroupLabel>
                {locale === 'ar' ? 'التقارير' : 'Reports'}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {reportsItems.map(renderMenuItem)}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>
                {locale === 'ar' ? 'الذكاء الاصطناعي' : 'AI Tools'}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {aiItems.map(renderMenuItem)}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>
                {locale === 'ar' ? 'بوابة العميل' : 'Client Portal'}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {clientPortalItems.map(renderMenuItem)}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>
                {locale === 'ar' ? 'الإعدادات' : 'Settings'}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {settingsItems.map(renderMenuItem)}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}

        {/* Admin Panel - Only for admin users */}
        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-primary">
              <Shield className="w-3 h-3 mr-1 inline" />
              {locale === 'ar' ? 'لوحة الإدارة' : 'Admin Panel'}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map(renderMenuItem)}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="p-4 space-y-2">
        <Button
          variant="outline"
          className="w-full justify-start"
          onClick={toggleLanguage}
          data-testid="button-language-toggle"
        >
          <Languages className="w-4 h-4 mr-2" />
          {locale === 'en' ? 'العربية' : 'English'}
        </Button>
        
        <Button
          variant="ghost"
          className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={handleLogout}
          data-testid="button-logout"
        >
          <LogOut className="w-4 h-4 mr-2" />
          {locale === 'ar' ? 'تسجيل الخروج' : 'Logout'}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
