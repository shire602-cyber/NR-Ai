import { 
  LayoutDashboard, 
  BookOpen, 
  FileText, 
  BookMarked, 
  BarChart3, 
  Sparkles,
  Languages,
  LogOut,
  Receipt,
  Bot,
  Settings
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTranslation, useI18n } from '@/lib/i18n';
import { removeToken } from '@/lib/auth';

const navigationItems = [
  {
    title: 'dashboard',
    icon: LayoutDashboard,
    url: '/dashboard',
  },
  {
    title: 'accounts',
    icon: BookOpen,
    url: '/accounts',
  },
  {
    title: 'invoices',
    icon: FileText,
    url: '/invoices',
  },
  {
    title: 'receipts',
    icon: Receipt,
    url: '/receipts',
  },
  {
    title: 'journal',
    icon: BookMarked,
    url: '/journal',
  },
  {
    title: 'reports',
    icon: BarChart3,
    url: '/reports',
  },
  {
    title: 'aiTools',
    icon: Sparkles,
    url: '/ai-categorize',
  },
  {
    title: 'aiCfo',
    icon: Bot,
    url: '/ai-cfo',
  },
];

export function AppSidebar() {
  const [location, setLocation] = useLocation();
  const { t, locale } = useTranslation();
  const { setLocale } = useI18n();

  const handleLogout = () => {
    removeToken();
    setLocation('/login');
  };

  const toggleLanguage = () => {
    setLocale(locale === 'en' ? 'ar' : 'en');
  };

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <div className="font-semibold text-sm">AI Bookkeeping</div>
            <div className="text-xs text-muted-foreground">UAE Edition</div>
          </div>
        </div>
      </SidebarHeader>
      
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigationItems.map((item) => {
                const Icon = item.icon;
                const isActive = location === item.url;
                
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link href={item.url} data-testid={`link-${item.title}`}>
                        <Icon className="w-4 h-4" />
                        <span>{t[item.title as keyof typeof t]}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
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
          {t.logout}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
