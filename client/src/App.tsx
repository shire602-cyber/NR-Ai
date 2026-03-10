import { lazy, Suspense, useEffect } from 'react';
import { Switch, Route, useLocation, Link } from 'wouter';
import { queryClient } from './lib/queryClient';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { getToken } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { User } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Pages (lazy-loaded for code splitting)
const NotFound = lazy(() => import('@/pages/not-found'));
const Login = lazy(() => import('@/pages/Login'));
const Register = lazy(() => import('@/pages/Register'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Accounts = lazy(() => import('@/pages/Accounts'));
const ChartOfAccounts = lazy(() => import('@/pages/ChartOfAccounts'));
const AccountLedger = lazy(() => import('@/pages/AccountLedger'));
const Invoices = lazy(() => import('@/pages/Invoices'));
const Journal = lazy(() => import('@/pages/Journal'));
const JournalEntryDetail = lazy(() => import('@/pages/JournalEntryDetail'));
const Reports = lazy(() => import('@/pages/Reports'));
const AICFO = lazy(() => import('@/pages/AICFO'));
const AIChat = lazy(() => import('@/pages/AIChat'));
const Receipts = lazy(() => import('@/pages/Receipts'));
const CustomerContacts = lazy(() => import('@/pages/CustomerContacts'));
const Landing = lazy(() => import('@/pages/Landing'));
const Services = lazy(() => import('@/pages/Services'));
const CompanyProfile = lazy(() => import('@/pages/CompanyProfile'));
const Integrations = lazy(() => import('@/pages/Integrations'));
const WhatsAppDashboard = lazy(() => import('@/pages/WhatsAppDashboard'));
const AIFeatures = lazy(() => import('@/pages/AIFeatures'));
const SmartAssistant = lazy(() => import('@/pages/SmartAssistant'));
const AdvancedAnalytics = lazy(() => import('@/pages/AdvancedAnalytics'));
const IntegrationsHub = lazy(() => import('@/pages/IntegrationsHub'));
const Notifications = lazy(() => import('@/pages/Notifications'));
const Reminders = lazy(() => import('@/pages/Reminders'));
const Referrals = lazy(() => import('@/pages/Referrals'));
const Feedback = lazy(() => import('@/pages/Feedback'));
const Analytics = lazy(() => import('@/pages/Analytics'));
const Admin = lazy(() => import('@/pages/Admin'));
const BankReconciliation = lazy(() => import('@/pages/BankReconciliation'));
const VATFiling = lazy(() => import('@/pages/VATFiling'));
const TeamManagement = lazy(() => import('@/pages/TeamManagement'));
const AdvancedReports = lazy(() => import('@/pages/AdvancedReports'));
const DocumentVault = lazy(() => import('@/pages/DocumentVault'));
const TaxReturnArchive = lazy(() => import('@/pages/TaxReturnArchive'));
const ComplianceCalendar = lazy(() => import('@/pages/ComplianceCalendar'));
const TaskCenter = lazy(() => import('@/pages/TaskCenter'));
const UAENewsFeed = lazy(() => import('@/pages/UAENewsFeed'));
const AdminDashboard = lazy(() => import('@/pages/AdminDashboard'));
const ClientManagement = lazy(() => import('@/pages/ClientManagement'));
const UserInvitations = lazy(() => import('@/pages/UserInvitations'));
const ActivityLogs = lazy(() => import('@/pages/ActivityLogs'));
const AdminDocuments = lazy(() => import('@/pages/AdminDocuments'));
const ClientImport = lazy(() => import('@/pages/ClientImport'));
const ClientDocuments = lazy(() => import('@/pages/ClientDocuments'));
const ClientTasks = lazy(() => import('@/pages/ClientTasks'));
const ClientDetails = lazy(() => import('@/pages/ClientDetails'));
const History = lazy(() => import('@/pages/History'));
const BackupRestore = lazy(() => import('@/pages/BackupRestore'));
const TrialBalance = lazy(() => import('@/pages/TrialBalance'));

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
          <main className="flex-1 overflow-auto p-4 md:p-6 lg:p-8">
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
          </main>
        </div>
      </div>
      <OnboardingWizard />
    </SidebarProvider>
  );
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
  if (location === '/login' || location === '/register' || location === '/services') {
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
      </Switch>
        </motion.div>
      </AnimatePresence>
    );
  }

  // Protected routes (with sidebar)
  return (
    <ProtectedRoute>
      <ProtectedLayout>
        <Switch>
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/company-profile" component={CompanyProfile} />
          <Route path="/accounts" component={Accounts} />
          <Route path="/chart-of-accounts" component={ChartOfAccounts} />
          <Route path="/accounts/:id/ledger" component={AccountLedger} />
          <Route path="/invoices" component={Invoices} />
          <Route path="/journal" component={Journal} />
          <Route path="/journal/:id" component={JournalEntryDetail} />
          <Route path="/reports" component={Reports} />
          <Route path="/trial-balance" component={TrialBalance} />
          <Route path="/receipts" component={Receipts} />
          <Route path="/contacts" component={CustomerContacts} />
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
          
          <Route component={NotFound} />
        </Switch>
      </ProtectedLayout>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>}>
            <Router />
          </Suspense>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
