import { useEffect, lazy, Suspense } from 'react';
import { Switch, Route, useLocation, Link } from 'wouter';
import { queryClient } from './lib/queryClient';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useI18n } from '@/lib/i18n';
import { getToken } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { User } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2 } from 'lucide-react';

// Eagerly loaded — always needed on first paint
import NotFound from '@/pages/not-found';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import Dashboard from '@/pages/Dashboard';
import Landing from '@/pages/Landing';
import Services from '@/pages/Services';
import Pricing from '@/pages/Pricing';
import PublicInvoiceView from '@/pages/PublicInvoiceView';
import CustomerPortal from '@/pages/CustomerPortal';

// Firm (NRA Management Center) — lazy loaded
const ClientPortfolio = lazy(() => import('@/pages/firm/ClientPortfolio'));
const ClientProfile = lazy(() => import('@/pages/firm/ClientProfile'));
const StaffManagement = lazy(() => import('@/pages/firm/StaffManagement'));
const FirmHealth = lazy(() => import('@/pages/firm/FirmHealth'));
const FirmComms = lazy(() => import('@/pages/firm/FirmComms'));

// Core accounting — loaded eagerly since most users land here
import Accounts from '@/pages/Accounts';
import ChartOfAccounts from '@/pages/ChartOfAccounts';
import AccountLedger from '@/pages/AccountLedger';
import Invoices from '@/pages/Invoices';
import Journal from '@/pages/Journal';
import JournalEntryDetail from '@/pages/JournalEntryDetail';
import Reports from '@/pages/Reports';
import Receipts from '@/pages/Receipts';
import CompanyProfile from '@/pages/CompanyProfile';

// Lazy-loaded pages (large or infrequently visited)
const Admin = lazy(() => import('@/pages/Admin'));
const AdminDashboard = lazy(() => import('@/pages/AdminDashboard'));
const ClientManagement = lazy(() => import('@/pages/ClientManagement'));
const ClientDetails = lazy(() => import('@/pages/ClientDetails'));
const ClientDocuments = lazy(() => import('@/pages/ClientDocuments'));
const ClientTasks = lazy(() => import('@/pages/ClientTasks'));
const ClientImport = lazy(() => import('@/pages/ClientImport'));
const UserInvitations = lazy(() => import('@/pages/UserInvitations'));
const ActivityLogs = lazy(() => import('@/pages/ActivityLogs'));
const AdminDocuments = lazy(() => import('@/pages/AdminDocuments'));

const AdvancedReports = lazy(() => import('@/pages/AdvancedReports'));
const AdvancedAnalytics = lazy(() => import('@/pages/AdvancedAnalytics'));
const Analytics = lazy(() => import('@/pages/Analytics'));

const Payroll = lazy(() => import('@/pages/Payroll'));
const FixedAssets = lazy(() => import('@/pages/FixedAssets'));
const Budgets = lazy(() => import('@/pages/Budgets'));
const DocumentVault = lazy(() => import('@/pages/DocumentVault'));
const BillPay = lazy(() => import('@/pages/BillPay'));
const ExpenseClaims = lazy(() => import('@/pages/ExpenseClaims'));
const Inventory = lazy(() => import('@/pages/Inventory'));
const RecurringInvoices = lazy(() => import('@/pages/RecurringInvoices'));

const AICFO = lazy(() => import('@/pages/AICFO'));
const AIChat = lazy(() => import('@/pages/AIChat'));
const AIFeatures = lazy(() => import('@/pages/AIFeatures'));
const AIInbox = lazy(() => import('@/pages/AIInbox'));
const SmartAssistant = lazy(() => import('@/pages/SmartAssistant'));

const CustomerContacts = lazy(() => import('@/pages/CustomerContacts'));
const Integrations = lazy(() => import('@/pages/Integrations'));
const IntegrationsHub = lazy(() => import('@/pages/IntegrationsHub'));
const WhatsAppDashboard = lazy(() => import('@/pages/WhatsAppDashboard'));
const Notifications = lazy(() => import('@/pages/Notifications'));
const Reminders = lazy(() => import('@/pages/Reminders'));
const Referrals = lazy(() => import('@/pages/Referrals'));
const Feedback = lazy(() => import('@/pages/Feedback'));

const BankReconciliation = lazy(() => import('@/pages/BankReconciliation'));
const VATFiling = lazy(() => import('@/pages/VATFiling'));
const CorporateTax = lazy(() => import('@/pages/CorporateTax'));
const TeamManagement = lazy(() => import('@/pages/TeamManagement'));
const TaxReturnArchive = lazy(() => import('@/pages/TaxReturnArchive'));
const ComplianceCalendar = lazy(() => import('@/pages/ComplianceCalendar'));
const TaskCenter = lazy(() => import('@/pages/TaskCenter'));
const UAENewsFeed = lazy(() => import('@/pages/UAENewsFeed'));
const History = lazy(() => import('@/pages/History'));
const BackupRestore = lazy(() => import('@/pages/BackupRestore'));
const CashFlowForecast = lazy(() => import('@/pages/CashFlowForecast'));
const AnomalyDetection = lazy(() => import('@/pages/AnomalyDetection'));
const AutoReconcile = lazy(() => import('@/pages/AutoReconcile'));
const MonthEndClose = lazy(() => import('@/pages/MonthEndClose'));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );
}

import { PWAInstallPrompt } from '@/components/PWAInstallPrompt';
import { MobileNav } from '@/components/MobileNav';
import { RouteGuard } from '@/components/layout/RouteGuard';
import '@/styles/rtl.css';
import '@/styles/mobile.css';

// Components
import { OnboardingWizard } from '@/components/Onboarding';

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const style = {
    '--sidebar-width': '16rem',
    '--sidebar-width-icon': '3rem',
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <motion.header 
            className="flex items-center justify-between p-4 border-b bg-background sticky top-0 z-10"
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            </motion.div>
            <Link href="/company-profile">
              <motion.div
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Button variant="ghost" size="sm" data-testid="button-profile" className="transition-all duration-200">
                <User className="w-4 h-4 mr-2" />
                Profile
              </Button>
              </motion.div>
            </Link>
          </motion.header>
          <main className="flex-1 overflow-auto p-8">
            <RouteGuard>
            <ErrorBoundary>
            <AnimatePresence mode="wait">
              <motion.div
                key={location}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              >
            {children}
              </motion.div>
            </AnimatePresence>
            </ErrorBoundary>
            </RouteGuard>
          </main>
        </div>
      </div>
      <OnboardingWizard />
    </SidebarProvider>
  );
}

// Guard: firm routes require firmRole (firm_owner or firm_admin) in JWT
function FirmRoute({ children }: { children: React.ReactNode }) {
  const [, navigate] = useLocation();
  try {
    const token = getToken();
    if (!token) { navigate('/login'); return null; }
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.firmRole !== 'firm_owner' && payload.firmRole !== 'firm_admin') {
      navigate('/dashboard'); return null;
    }
  } catch {
    navigate('/login');
    return null;
  }
  return <>{children}</>;
}

function Router() {
  const [location, setLocation] = useLocation();
  const token = getToken();
  
  // Redirect authenticated users from landing to dashboard
  useEffect(() => {
    if (location === '/' && token) {
      setLocation('/dashboard');
    }
  }, [location, token, setLocation]);
  
  // Guard: authenticated users at root - wait for redirect
  if (location === '/' && token) {
    return null;
  }
  
  // Landing page (public only)
  if (location === '/' && !token) {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key="landing"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Landing />
        </motion.div>
      </AnimatePresence>
    );
  }
  
  // Public routes (no sidebar)
  if (location === '/login' || location === '/register' || location === '/services' || location === '/pricing' || location.startsWith('/view/invoice/') || location.startsWith('/portal/')) {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={location}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.3 }}
        >
      <Switch>
        <Route path="/login" component={Login} />
        <Route path="/register" component={Register} />
        <Route path="/services" component={Services} />
        <Route path="/view/invoice/:token" component={PublicInvoiceView} />
        <Route path="/portal/:token" component={CustomerPortal} />
        <Route path="/pricing" component={Pricing} />
      </Switch>
        </motion.div>
      </AnimatePresence>
    );
  }

  // Protected routes (with sidebar)
  return (
    <ProtectedRoute>
      <ProtectedLayout>
        <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/company-profile" component={CompanyProfile} />
          <Route path="/accounts" component={Accounts} />
          <Route path="/chart-of-accounts" component={ChartOfAccounts} />
          <Route path="/accounts/:id/ledger" component={AccountLedger} />
          <Route path="/invoices" component={Invoices} />
          <Route path="/recurring-invoices" component={RecurringInvoices} />
          <Route path="/journal" component={Journal} />
          <Route path="/journal/:id" component={JournalEntryDetail} />
          <Route path="/reports" component={Reports} />
          <Route path="/receipts" component={Receipts} />
          <Route path="/contacts" component={CustomerContacts} />
          <Route path="/inventory" component={Inventory} />
          <Route path="/payroll" component={Payroll} />
          <Route path="/bill-pay" component={BillPay} />
          <Route path="/fixed-assets" component={FixedAssets} />
          <Route path="/budgets" component={Budgets} />
          <Route path="/expense-claims" component={ExpenseClaims} />
          <Route path="/cashflow-forecast" component={CashFlowForecast} />
          <Route path="/anomaly-detection" component={AnomalyDetection} />
          <Route path="/auto-reconcile" component={AutoReconcile} />
          <Route path="/ai-inbox" component={AIInbox} />
          <Route path="/month-end" component={MonthEndClose} />
          <Route path="/ai-cfo" component={AICFO} />
          <Route path="/ai-features" component={AIFeatures} />
          <Route path="/smart-assistant" component={SmartAssistant} />
          <Route path="/ai-chat" component={AIChat} />
          <Route path="/advanced-analytics" component={AdvancedAnalytics} />
          <Route path="/integrations" component={Integrations} />
          <Route path="/integrations-hub" component={IntegrationsHub} />
          <Route path="/whatsapp" component={WhatsAppDashboard} />
          <Route path="/notifications" component={Notifications} />
          <Route path="/reminders" component={Reminders} />
          <Route path="/referrals" component={Referrals} />
          <Route path="/feedback" component={Feedback} />
          <Route path="/analytics" component={Analytics} />
          <Route path="/admin" component={Admin} />
          <Route path="/bank-reconciliation" component={BankReconciliation} />
          <Route path="/vat-filing" component={VATFiling} />
          <Route path="/corporate-tax" component={CorporateTax} />
          <Route path="/team" component={TeamManagement} />
          <Route path="/history" component={History} />
          <Route path="/backup-restore" component={BackupRestore} />
          <Route path="/advanced-reports" component={AdvancedReports} />
          <Route path="/document-vault" component={DocumentVault} />
          <Route path="/tax-return-archive" component={TaxReturnArchive} />
          <Route path="/compliance-calendar" component={ComplianceCalendar} />
          <Route path="/task-center" component={TaskCenter} />
          <Route path="/news-feed" component={UAENewsFeed} />
          
          {/* Admin Routes */}
          <Route path="/admin/dashboard" component={AdminDashboard} />
          <Route path="/admin/clients" component={ClientManagement} />
          <Route path="/admin/clients/:id" component={ClientDetails} />
          <Route path="/admin/clients/:id/documents" component={ClientDocuments} />
          <Route path="/admin/clients/:id/tasks" component={ClientTasks} />
          <Route path="/admin/documents" component={AdminDocuments} />
          <Route path="/admin/invitations" component={UserInvitations} />
          <Route path="/admin/import" component={ClientImport} />
          <Route path="/admin/activity-logs" component={ActivityLogs} />
          <Route path="/admin/users" component={Admin} />
          <Route path="/admin" component={Admin} />

          {/* NRA Firm Management Center */}
          <Route path="/firm/clients/:companyId">
            <FirmRoute><ClientProfile /></FirmRoute>
          </Route>
          <Route path="/firm/clients">
            <FirmRoute><ClientPortfolio /></FirmRoute>
          </Route>
          <Route path="/firm/staff">
            <FirmRoute><StaffManagement /></FirmRoute>
          </Route>
          <Route path="/firm/health">
            <FirmRoute><FirmHealth /></FirmRoute>
          </Route>
          <Route path="/firm/comms">
            <FirmRoute><FirmComms /></FirmRoute>
          </Route>

          <Route component={NotFound} />
        </Switch>
        </Suspense>
      </ProtectedLayout>
    </ProtectedRoute>
  );
}

export default function App() {
  const { locale, setLocale } = useI18n();

  useEffect(() => {
    // Initialize locale settings
    setLocale(locale);
  }, []);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Router />
          <PWAInstallPrompt />
          <MobileNav />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
