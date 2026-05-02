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
import { ErrorBoundary, SectionBoundary } from '@/components/ErrorBoundary';
import { useI18n, useTranslation } from '@/lib/i18n';
import { getToken } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { User, Building2, ArrowLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { PageSkeleton } from '@/components/PageSkeleton';

// All pages lazy-loaded for route-level code splitting.
// Layout shell (AppSidebar, ProtectedLayout) is NOT lazy — needed immediately.
const NotFound = lazy(() => import('@/pages/not-found'));
const Login = lazy(() => import('@/pages/Login'));
const Register = lazy(() => import('@/pages/Register'));
const ForgotPassword = lazy(() => import('@/pages/ForgotPassword'));
const ResetPassword = lazy(() => import('@/pages/ResetPassword'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const LandingPage = lazy(() => import('@/pages/LandingPage'));
const Services = lazy(() => import('@/pages/Services'));
const Pricing = lazy(() => import('@/pages/Pricing'));
const PublicInvoiceView = lazy(() => import('@/pages/PublicInvoiceView'));
const CustomerPortal = lazy(() => import('@/pages/CustomerPortal'));
const PrivacyPolicy = lazy(() => import('@/pages/PrivacyPolicy'));
const TermsOfService = lazy(() => import('@/pages/TermsOfService'));
const CookiePolicy = lazy(() => import('@/pages/CookiePolicy'));

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
const ValueOps = lazy(() => import('@/pages/firm/ValueOps'));
const FirmCommandCenter = lazy(() => import('@/pages/FirmCommandCenter'));

// Core accounting
const Accounts = lazy(() => import('@/pages/Accounts'));
const ChartOfAccounts = lazy(() => import('@/pages/ChartOfAccounts'));
const AccountLedger = lazy(() => import('@/pages/AccountLedger'));
const Invoices = lazy(() => import('@/pages/Invoices'));
const Journal = lazy(() => import('@/pages/Journal'));
const JournalEntryDetail = lazy(() => import('@/pages/JournalEntryDetail'));
const Reports = lazy(() => import('@/pages/Reports'));
const Receipts = lazy(() => import('@/pages/Receipts'));
const ReceiptAutopilot = lazy(() => import('@/pages/ReceiptAutopilot'));
const CompanyProfile = lazy(() => import('@/pages/CompanyProfile'));
const CompanySettings = lazy(() => import('@/pages/CompanySettings'));

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
const PaymentChasing = lazy(() => import('@/pages/PaymentChasing'));

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
const DocumentChasing = lazy(() => import('@/pages/DocumentChasing'));
const Referrals = lazy(() => import('@/pages/Referrals'));
const Feedback = lazy(() => import('@/pages/Feedback'));

const Onboarding = lazy(() => import('@/pages/Onboarding'));
const BankReconciliation = lazy(() => import('@/pages/BankReconciliation'));
const VATFiling = lazy(() => import('@/pages/VATFiling'));
const VATAutopilot = lazy(() => import('@/pages/VATAutopilot'));
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

function PageLoader({ variant }: { variant?: 'list' | 'detail' | 'dashboard' | 'form' | 'minimal' } = {}) {
  return <PageSkeleton variant={variant ?? 'list'} />;
}

function MinimalPageLoader() {
  return (
    <div className="flex items-center justify-center h-64" aria-busy="true">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function routeName(location: string): string {
  const seg = location.split('/').filter(Boolean)[0] ?? 'app';
  return seg
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

import { PWAInstallPrompt } from '@/components/PWAInstallPrompt';
import { MobileNav } from '@/components/MobileNav';
import { NotificationBell } from '@/components/NotificationBell';
import { OfflineIndicator } from '@/components/OfflineIndicator';
import { RouteGuard } from '@/components/layout/RouteGuard';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { ActiveCompanyProvider, useActiveCompany } from '@/components/ActiveCompanyProvider';
import { RTLProvider } from '@/components/RTLProvider';
import '@/styles/rtl.css';
import '@/styles/mobile.css';

// Components
import { OnboardingWizard } from '@/components/Onboarding';
import { CommandPaletteProvider } from '@/components/CommandPalette';
import { GlobalShortcutsProvider } from '@/components/ShortcutsHelp';
import { SkipLink } from '@/components/SkipLink';

function FirmContextBanner() {
  const { company, isFirmContext, clearActiveClientCompany } = useActiveCompany();
  const [, navigate] = useLocation();

  if (!isFirmContext || !company) return null;

  const goBackToFirm = () => {
    clearActiveClientCompany();
    navigate('/firm/clients');
  };

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 bg-primary/10 border-b border-primary/20 px-3 py-2 md:px-4"
      data-testid="firm-context-banner"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Building2 className="w-4 h-4 text-primary shrink-0" />
        <span className="text-xs uppercase tracking-wide text-primary/80 shrink-0">Managing</span>
        <span className="font-semibold text-sm truncate" data-testid="firm-context-company-name">
          {company.name}
        </span>
        {company.trnVatNumber && (
          <span className="text-xs text-muted-foreground hidden sm:inline">
            · TRN {company.trnVatNumber}
          </span>
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={goBackToFirm}
        data-testid="button-back-to-firm"
      >
        <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
        Back to Firm
      </Button>
    </div>
  );
}

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const { t } = useTranslation();
  const { company, hasNoCompanies, isLoading: companyLoading } = useDefaultCompany();
  const { isFirmContext } = useActiveCompany();

  useEffect(() => {
    if (companyLoading || location === '/onboarding') return;

    // Skip the customer-onboarding redirect when a firm staffer is operating
    // inside a client workspace — the client's onboarding state is the firm's
    // problem to manage, not a hard redirect for the staff member.
    if (isFirmContext) return;

    // Only auto-redirect once per session. If the user has dismissed the
    // wizard (or already filled in company details) we must not trap them
    // in a loop on every navigation — they can resume onboarding manually.
    const REDIRECT_FLAG = 'onboarding_redirect_seen';
    if (sessionStorage.getItem(REDIRECT_FLAG)) return;

    // No company yet — send the user to onboarding so they can create one.
    if (hasNoCompanies) {
      sessionStorage.setItem(REDIRECT_FLAG, '1');
      navigate('/onboarding');
      return;
    }

    if (company && !company.onboardingCompleted) {
      sessionStorage.setItem(REDIRECT_FLAG, '1');
      navigate('/onboarding');
    }
  }, [company, hasNoCompanies, companyLoading, location, navigate, isFirmContext]);


  const style = {
    '--sidebar-width': '16rem',
    '--sidebar-width-icon': '3rem',
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <SkipLink />
      <div className="flex h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <motion.header
            role="banner"
            className="flex items-center justify-between gap-3 px-3 md:px-6 h-14 border-b border-border/70 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60 sticky top-0 z-20"
            initial={{ y: -16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            <div className="flex items-center gap-2">
              <SidebarTrigger
                data-testid="button-sidebar-toggle"
                aria-label="Toggle sidebar"
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
                  aria-label={t.profile}
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
          <FirmContextBanner />
          <main id="main-content" tabIndex={-1} className="flex-1 overflow-auto focus:outline-none">
            <div className="mx-auto w-full max-w-[1480px] px-4 md:px-8 py-6 md:py-10">
              <RouteGuard>
              <AnimatePresence mode="wait">
                <motion.div
                  key={location}
                  initial={false}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                >
                  <SectionBoundary name={routeName(location)}>
                    {children}
                  </SectionBoundary>
                </motion.div>
              </AnimatePresence>
              </RouteGuard>
            </div>
          </main>
        </div>
      </div>
      <OnboardingWizard />
      <CommandPaletteProvider />
      <GlobalShortcutsProvider />
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
  
  // Landing page (public only).
  // `initial={false}` skips the entry fade so the page is visible immediately;
  // a stalled or throttled animation must never leave the root at opacity:0.
  if (location === '/' && !token) {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key="landing"
          initial={false}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Suspense fallback={<MinimalPageLoader />}>
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
          <Suspense fallback={<PageLoader variant="dashboard" />}>
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
        <Suspense fallback={<PageLoader variant="form" />}>
          <Onboarding />
        </Suspense>
      </ProtectedRoute>
    );
  }

  // Public routes (no sidebar)
  if (
    location === '/login' ||
    location === '/register' ||
    location === '/forgot-password' ||
    location === '/reset-password' ||
    location === '/services' ||
    location === '/pricing' ||
    location === '/privacy' ||
    location === '/terms' ||
    location === '/cookies' ||
    location.startsWith('/view/invoice/') ||
    location.startsWith('/portal/')
  ) {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={location}
          initial={false}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.3 }}
        >
          <Suspense fallback={<MinimalPageLoader />}>
            <Switch>
              <Route path="/login" component={Login} />
              <Route path="/register" component={Register} />
              <Route path="/forgot-password" component={ForgotPassword} />
              <Route path="/reset-password" component={ResetPassword} />
              <Route path="/services" component={Services} />
              <Route path="/view/invoice/:token" component={PublicInvoiceView} />
              <Route path="/portal/:token" component={CustomerPortal} />
              <Route path="/pricing" component={Pricing} />
              <Route path="/privacy" component={PrivacyPolicy} />
              <Route path="/terms" component={TermsOfService} />
              <Route path="/cookies" component={CookiePolicy} />
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
        <Suspense fallback={<PageLoader variant="list" />}>
        <Switch>
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/company-profile" component={CompanyProfile} />
          <Route path="/settings/company" component={CompanySettings} />
          <Route path="/accounts" component={Accounts} />
          <Route path="/chart-of-accounts" component={ChartOfAccounts} />
          <Route path="/accounts/:id/ledger" component={AccountLedger} />
          <Route path="/invoices" component={Invoices} />
          <Route path="/recurring-invoices" component={RecurringInvoices} />
          <Route path="/payment-chasing" component={PaymentChasing} />
          <Route path="/journal" component={Journal} />
          <Route path="/journal/:id" component={JournalEntryDetail} />
          <Route path="/reports" component={Reports} />
          <Route path="/receipts" component={Receipts} />
          <Route path="/receipt-autopilot" component={ReceiptAutopilot} />
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
          <Route path="/document-chasing" component={DocumentChasing} />
          <Route path="/referrals" component={Referrals} />
          <Route path="/feedback" component={Feedback} />
          <Route path="/analytics" component={Analytics} />
          <Route path="/admin" component={Admin} />
          <Route path="/bank-reconciliation" component={BankReconciliation} />
          <Route path="/vat-filing" component={VATFiling} />
          <Route path="/vat-autopilot" component={VATAutopilot} />
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
          <Route path="/firm/command-center">
            <FirmRoute><FirmCommandCenter /></FirmRoute>
          </Route>
          <Route path="/firm/value-ops">
            <FirmRoute><ValueOps /></FirmRoute>
          </Route>
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
        <ActiveCompanyProvider>
          <RTLProvider>
            <TooltipProvider>
              <Router />
              <PWAInstallPrompt />
              <MobileNav />
              <Toaster />
            </TooltipProvider>
          </RTLProvider>
        </ActiveCompanyProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
