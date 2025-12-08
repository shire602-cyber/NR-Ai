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
import { motion, AnimatePresence } from 'framer-motion';
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
  { title: 'dashboard', icon: LayoutDashboard, url: '/dashboard' },
  { title: 'chartOfAccounts', icon: List, url: '/chart-of-accounts' },
  { title: 'journal', icon: BookMarked, url: '/journal' },
  { title: 'invoices', icon: FileText, url: '/invoices' },
  { title: 'receipts', icon: Receipt, url: '/receipts' },
  { title: 'contacts', icon: Users, url: '/contacts' },
  { title: 'bankReconciliation', icon: Building2, url: '/bank-reconciliation' },
];

const reportsItems = [
  { title: 'reports', icon: BarChart3, url: '/reports' },
  { title: 'vatFiling', icon: FileCheck, url: '/vat-filing' },
];

const aiItems = [
  { title: 'aiCfo', icon: Bot, url: '/ai-cfo' },
  { title: 'aiFeatures', icon: Sparkles, url: '/ai-features' },
  { title: 'aiChat', icon: MessageSquare, url: '/ai-chat' },
];

const clientPortalItems = [
  { title: 'documentVault', icon: FolderArchive, url: '/document-vault' },
  { title: 'taxReturnArchive', icon: FileStack, url: '/tax-return-archive' },
  { title: 'complianceCalendar', icon: CalendarDays, url: '/compliance-calendar' },
  { title: 'taskCenter', icon: ListTodo, url: '/task-center' },
  { title: 'newsFeed', icon: Newspaper, url: '/news-feed' },
];

const settingsItems = [
  { title: 'teamManagement', icon: Users, url: '/team' },
  { title: 'history', icon: History, url: '/history' },
  { title: 'backupRestore', icon: Database, url: '/backup-restore' },
  { title: 'integrationsHub', icon: ShoppingCart, url: '/integrations-hub' },
  { title: 'integrations', icon: Plug, url: '/integrations' },
  { title: 'whatsappInbox', icon: MessageSquare, url: '/whatsapp' },
];

const adminItems = [
  { title: 'adminDashboard', icon: Shield, url: '/admin/dashboard' },
  { title: 'clientManagement', icon: Building2, url: '/admin/clients' },
  { title: 'clientDocuments', icon: FolderArchive, url: '/admin/documents' },
  { title: 'userInvitations', icon: UserPlus, url: '/admin/invitations' },
  { title: 'clientImport', icon: FileUp, url: '/admin/import' },
  { title: 'userManagement', icon: Users, url: '/admin/users' },
  { title: 'activityLogs', icon: Activity, url: '/admin/activity-logs' },
  { title: 'systemSettings', icon: Settings, url: '/admin' },
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
    const label = (t as any)[item.title] || item.title;
    
    return (
      <SidebarMenuItem key={item.url}>
        <motion.div
          whileHover={{ x: 4 }}
          transition={{ duration: 0.2 }}
        >
        <SidebarMenuButton 
          isActive={isActive}
          onClick={() => setLocation(item.url)}
          data-testid={`link-${item.title}`}
            className="relative group transition-all duration-200"
          >
            <motion.div
              className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-r-full"
              initial={{ scaleY: 0 }}
              animate={{ scaleY: isActive ? 1 : 0 }}
              transition={{ duration: 0.2 }}
            />
            <motion.div
              whileHover={{ scale: 1.1 }}
              transition={{ duration: 0.2 }}
        >
          <Icon className="w-4 h-4" />
            </motion.div>
            <motion.span
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2 }}
            >
              {label}
            </motion.span>
        </SidebarMenuButton>
        </motion.div>
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar>
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4 }}
      >
      <SidebarHeader className="p-4">
          <motion.div 
            className="flex items-center gap-2"
            whileHover={{ scale: 1.02 }}
            transition={{ duration: 0.2 }}
          >
            <motion.div 
              className="w-8 h-8 rounded-md bg-primary flex items-center justify-center"
              whileHover={{ rotate: [0, -10, 10, -10, 0] }}
              transition={{ duration: 0.5 }}
            >
            <Wallet className="w-5 h-5 text-primary-foreground" />
            </motion.div>
          <div>
              <motion.div 
                className="font-semibold text-sm"
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.1 }}
              >
                Muhasib.ai
              </motion.div>
              <motion.div 
                className="text-xs text-muted-foreground"
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.2 }}
              >
              {t.smartAccounting || 'Smart Accounting'}
              </motion.div>
            </div>
          </motion.div>
      </SidebarHeader>
      </motion.div>
      
      <SidebarContent>
        {/* Client Portal View - Simplified view for NR-managed clients */}
        {userType === 'client' && (
          <>
            <SidebarGroup>
              <SidebarGroupLabel>
                {t.overview || 'Overview'}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {renderMenuItem({ title: 'dashboard', icon: LayoutDashboard, url: '/dashboard' })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>
                {t.myPortal || 'My Portal'}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {clientPortalItems.map(renderMenuItem)}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>
                {t.reportsSection || 'Reports'}
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
                {t.accounting || 'Accounting'}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {coreItems.map(renderMenuItem)}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            
            <SidebarGroup>
              <SidebarGroupLabel>
                {t.reportsSection || 'Reports'}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {reportsItems.map(renderMenuItem)}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>
                {t.aiTools || 'AI Tools'}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {aiItems.map(renderMenuItem)}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>
                {t.clientPortal || 'Client Portal'}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {clientPortalItems.map(renderMenuItem)}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>
                {t.settings || 'Settings'}
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
              {t.adminPanel || 'Admin Panel'}
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
        <motion.div
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
        <Button
          variant="outline"
            className="w-full justify-start transition-all duration-200"
          onClick={toggleLanguage}
          data-testid="button-language-toggle"
          >
            <motion.div
              animate={{ rotate: [0, 360] }}
              transition={{ duration: 0.5, delay: 0.2 }}
        >
          <Languages className="w-4 h-4 mr-2" />
            </motion.div>
          {locale === 'en' ? 'Arabic' : 'English'}
        </Button>
        </motion.div>
        
        <motion.div
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
        <Button
          variant="ghost"
            className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10 transition-all duration-200"
          onClick={handleLogout}
          data-testid="button-logout"
          >
            <motion.div
              whileHover={{ x: -2 }}
              transition={{ duration: 0.2 }}
        >
          <LogOut className="w-4 h-4 mr-2" />
            </motion.div>
          {t.logout || 'Logout'}
        </Button>
        </motion.div>
      </SidebarFooter>
    </Sidebar>
  );
}
