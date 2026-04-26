import { useEffect, lazy, Suspense } from 'react';
import { Switch, Route, useLocation, Link } from 'wouter';
import { queryClient } from './lib/queryClient';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { PortalLayout } from '@/components/layout/PortalLayout';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useI18n, useTranslation } from '@/lib/i18n';
import { getToken } from '@/lib/auth';
import { User } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2 } from 'lucide-react';

// All pages lazy-loaded for route-level code splitting.
// Layout shell (AppSidebar, ProtectedLayout) is NOT lazy — needed immediately.
const NotFound = lazy(() => import('@/pages/not-found'));
const Login = lazy(() => import('@/pages/Login'));
const Register = lazy(() => import('@/pages/Register'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const LandingPage = lazy(() => import('@/pages/LandingPage'));
const Services = lazy(() => import('@/pages/Services'));
const Pricing = lazy(() => import('@/pages/Pricing'));
const PublicInvoiceView = lazy(() => import('@/pages/PublicInvoiceView'));
const CustomerPortal = lazy(() => import('@/pages/CustomerPortal'));

// Client Portal — lazy loaded
const PortalDashboard = lazy(() => import('@/pages/portal/PortalDashboard'));
const PortalInvoices = lazy(() => import('@/pages/portal/PortalInvoices'));
const PortalDocuments = lazy(() => import('@/pages/portal/PortalDocuments'));
const PortalStatements = lazy(() => import('@/pages/portal/PortalStatements'));
const PortalMessages = lazy(() => import('@/pages/portal/PortalMessages'));

// Firm (NRA Management Center) — lazy loaded
const ClientPortfolio = lazy(() => import('@/pages/firm/ClientPortfolio'));
const ClientProfile = lazy(() => import('@/pages/firm/ClientProfile'));
const StaffManagement = lazy(() => import('@/pages/firm/StaffManagement'));
const BulkOperations = lazy(() => import('@/pages/firm/BulkOperations'));
const FirmHealth = lazy(() => import('@/pages/firm/FirmHealth'));
const FirmComms = lazy(() => import('@/pages/firm/FirmComms'));
const FirmAnalytics = lazy(() => import('@/pages/firm/FirmAnalytics'));
const LeadPipeline = lazy(() => import('@/pages/firm/LeadPipeline'));

// Core accounting
const Accounts = lazy(() => import('@/pages/Accounts'));
const ChartOfAccounts = lazy(() => import('@/pages/ChartOfAccounts'));
const AccountLedger = lazy(() => import('@/pages/AccountLedger'));
const Invoices = lazy(() => import('@/pages/Invoices'));
const Journal = lazy(() => import('@/pages/Journal'));
const JournalEntryDetail = lazy(() => import('@/pages/JournalEntryDetail'));
const Reports = lazy(() => import('@/pages/Reports'));
const Receipts = lazy(() => import('@/pages/Receipts'));
const CompanyProfile = lazy(() => import('@/pages/CompanyProfile'));

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

const Onboarding = lazy(() => import('@/pages/Onboarding'));
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
import { NotificationBell } from '@/components/NotificationBell';
import { OfflineIndicator } from '@/components/OfflineIndicator';
import { RouteGuard } from '@/components/layout/RouteGuard';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { RTLProvider } from '@/components/RTLProvider';
import '@/styles/rtl.css';
import '@/styles/mobile.css';

// Components
import { OnboardingWizard } from '@/components/Onboarding';

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const { t } = useTranslation();
  const { company, isLoading: companyLoading } = useDefaultCompany();

  useEffect(() => {
    if (!companyLoading && company && !company.onboardingCompleted && location !== '/onboarding') {
      navigate('/onboarding');
    }
  }, [company, companyLoading, location, navigate]);


  const style = {
    '--sidebar-width': '16rem',
    '--sidebar-width-icon': '3rem',
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <motion.header
            className="flex items-center justify-between gap-3 px-3 md:px-6 h-14 border-b border-border/70 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60 sticky top-0 z-20"
            initial={{ y: -16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            <div className="flex items-center gap-2">
              <SidebarTrigger
                data-testid="button-sidebar-toggle"
                className="text-muted-foreground hover:text-foreground"
              />
              <div className="hidden md:flex items-center gap-2 ps-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-success-subtle text-success-subtle-foreground text-[10px] font-semibold tracking-wide uppercase">
                  <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse-dot" />
                  FTA Compliant
                </span>
                <span className="text-border">·</span>
                <span className="font-mono text-[11px] tracking-tight">UAE · AED</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <OfflineIndicator />
              <NotificationBell />
              <Link href="/company-profile">
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  data-testid="button-profile"
                  className="group flex items-center gap-2 ps-1.5 pe-3 py-1 rounded-full border border-border/70 bg-card/50 hover:bg-card hover:border-border transition-colors"
                >
                  <span className="relative flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-xs">
                    <User className="w-3.5 h-3.5" />
                  </span>
                  <span className="hidden sm:inline text-[13px] font-medium tracking-tight text-foreground/80 group-hover:text-foreground">
                    {t.profile}
                  </span>
                </motion.button>
              </Link>
            </div>
          </motion.header>
          <main className="flex-1 overflow-auto">
            <div className="mx-auto w-full max-w-[1480px] px-4 md:px-8 py-6 md:py-10">
              <RouteGuard>
              <ErrorBoundary>
              <AnimatePresence mode="wait">
                <motion.div
                  key={location}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                >
              {children}
                </motion.div>
              </AnimatePresence>
              </ErrorBoundary>
              </RouteGuard>
            </div>
          </main>
        </div>
      </div>
      <OnboardingWizard />
    </SidebarProvider>
  );
}

// Guard: client portal routes require userType 'client_portal' or 'client'
function PortalRoute({ children }: { children: React.ReactNode }) {
  const [, navigate] = useLocation();
  try {
    const token = getToken();
    if (!token) { navigate('/login'); return null; }
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.userType !== 'client_portal' && !payload.isAdmin) {
      navigate('/dashboard'); return null;
    }
  } catch {
    navigate('/login');
    return null;
  }
  return <>{children}</>;
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
  
  // Redirect authenticated users from landing to their home (portal or main dashboard)
  useEffect(() => {
    if (location === '/' && token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setLocation(payload.userType === 'client_portal' ? '/client-portal/dashboard' : '/dashboard');
      } catch {
        setLocation('/dashboard');
      }
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
          <Suspense fallback={<PageLoader />}>
            <LandingPage />
          </Suspense>
        </motion.div>
      </AnimatePresence>
    );
  }
  
  // Client Portal routes — authenticated, portal layout
  if (location.startsWith('/client-portal')) {
    return (
      <PortalRoute>
        <PortalLayout>
          <Suspense fallback={<PageLoader />}>
            <Switch>
              <Route path="/client-portal/dashboard" component={PortalDashboard} />
              <Route path="/client-portal/invoices" component={PortalInvoices} />
              <Route path="/client-portal/documents" component={PortalDocuments} />
              <Route path="/client-portal/statements" component={PortalStatements} />
              <Route path="/client-portal/messages" component={PortalMessages} />
              <Route component={NotFound} />
            </Switch>
          </Suspense>
        </PortalLayout>
      </PortalRoute>
    );
  }

  // Full-page protected route: onboarding wizard (no sidebar)
  if (location === '/onboarding') {
    return (
      <ProtectedRoute>
        <Suspense fallback={<PageLoader />}>
          <Onboarding />
        </Suspense>
      </ProtectedRoute>
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
          <Suspense fallback={<PageLoader />}>
            <Switch>
              <Route path="/login" component={Login} />
              <Route path="/register" component={Register} />
              <Route path="/services" component={Services} />
              <Route path="/view/invoice/:token" component={PublicInvoiceView} />
              <Route path="/portal/:token" component={CustomerPortal} />
              <Route path="/pricing" component={Pricing} />
            </Switch>
          </Suspense>
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
          <Route path="/firm/health">
            <FirmRoute><FirmHealth /></FirmRoute>
          </Route>
          <Route path="/firm/clients/:companyId">
            <FirmRoute><ClientProfile /></FirmRoute>
          </Route>
          <Route path="/firm/clients">
            <FirmRoute><ClientPortfolio /></FirmRoute>
          </Route>
          <Route path="/firm/staff">
            <FirmRoute><StaffManagement /></FirmRoute>
          </Route>
          <Route path="/firm/bulk">
            <FirmRoute><BulkOperations /></FirmRoute>
          </Route>
          <Route path="/firm/health">
            <FirmRoute><FirmHealth /></FirmRoute>
          </Route>
          <Route path="/firm/comms">
            <FirmRoute><FirmComms /></FirmRoute>
          </Route>
          <Route path="/firm/analytics">
            <FirmRoute><FirmAnalytics /></FirmRoute>
          </Route>
          <Route path="/firm/pipeline">
            <FirmRoute><LeadPipeline /></FirmRoute>
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
        <RTLProvider>
          <TooltipProvider>
            <Router />
            <PWAInstallPrompt />
            <MobileNav />
            <Toaster />
          </TooltipProvider>
        </RTLProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
