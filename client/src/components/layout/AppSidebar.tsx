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
  Settings,
  Wallet,
  ShoppingCart
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
import { removeToken } from '@/lib/auth';

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

const settingsItems = [
  {
    title: 'teamManagement',
    titleEn: 'Team',
    titleAr: 'الفريق',
    icon: Users,
    url: '/team',
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

export function AppSidebar() {
  const [location, setLocation] = useLocation();
  const { t, locale } = useTranslation();
  const { setLocale } = useI18n();

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
            {locale === 'ar' ? 'الإعدادات' : 'Settings'}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsItems.map(renderMenuItem)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
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
