import { useEffect } from 'react';
import { Switch, Route, useLocation, Link } from 'wouter';
import { queryClient } from './lib/queryClient';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { useI18n } from '@/lib/i18n';
import { getToken } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { User } from 'lucide-react';

// Pages
import NotFound from '@/pages/not-found';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import Dashboard from '@/pages/Dashboard';
import Accounts from '@/pages/Accounts';
import ChartOfAccounts from '@/pages/ChartOfAccounts';
import AccountLedger from '@/pages/AccountLedger';
import Invoices from '@/pages/Invoices';
import Journal from '@/pages/Journal';
import Reports from '@/pages/Reports';
import AICFO from '@/pages/AICFO';
import Receipts from '@/pages/Receipts';
import Landing from '@/pages/Landing';
import Services from '@/pages/Services';
import CompanyProfile from '@/pages/CompanyProfile';
import Integrations from '@/pages/Integrations';
import WhatsAppDashboard from '@/pages/WhatsAppDashboard';
import AIFeatures from '@/pages/AIFeatures';
import SmartAssistant from '@/pages/SmartAssistant';
import AdvancedAnalytics from '@/pages/AdvancedAnalytics';
import IntegrationsHub from '@/pages/IntegrationsHub';
import Notifications from '@/pages/Notifications';
import Reminders from '@/pages/Reminders';
import Referrals from '@/pages/Referrals';
import Feedback from '@/pages/Feedback';
import Analytics from '@/pages/Analytics';
import Admin from '@/pages/Admin';
import BankReconciliation from '@/pages/BankReconciliation';
import VATFiling from '@/pages/VATFiling';
import TeamManagement from '@/pages/TeamManagement';
import AdvancedReports from '@/pages/AdvancedReports';
import DocumentVault from '@/pages/DocumentVault';
import TaxReturnArchive from '@/pages/TaxReturnArchive';
import ComplianceCalendar from '@/pages/ComplianceCalendar';
import TaskCenter from '@/pages/TaskCenter';
import UAENewsFeed from '@/pages/UAENewsFeed';
import AdminDashboard from '@/pages/AdminDashboard';
import ClientManagement from '@/pages/ClientManagement';
import UserInvitations from '@/pages/UserInvitations';
import ActivityLogs from '@/pages/ActivityLogs';
import AdminDocuments from '@/pages/AdminDocuments';

// Components
import { OnboardingWizard } from '@/components/Onboarding';

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const style = {
    '--sidebar-width': '16rem',
    '--sidebar-width-icon': '3rem',
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between p-4 border-b bg-background sticky top-0 z-10">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <Link href="/company-profile">
              <Button variant="ghost" size="sm" data-testid="button-profile">
                <User className="w-4 h-4 mr-2" />
                Profile
              </Button>
            </Link>
          </header>
          <main className="flex-1 overflow-auto p-8">
            {children}
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
    return <Landing />;
  }
  
  // Public routes (no sidebar)
  if (location === '/login' || location === '/register' || location === '/services') {
    return (
      <Switch>
        <Route path="/login" component={Login} />
        <Route path="/register" component={Register} />
        <Route path="/services" component={Services} />
      </Switch>
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
          <Route path="/reports" component={Reports} />
          <Route path="/receipts" component={Receipts} />
          <Route path="/ai-cfo" component={AICFO} />
          <Route path="/ai-features" component={AIFeatures} />
          <Route path="/smart-assistant" component={SmartAssistant} />
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
          <Route path="/advanced-reports" component={AdvancedReports} />
          <Route path="/document-vault" component={DocumentVault} />
          <Route path="/tax-return-archive" component={TaxReturnArchive} />
          <Route path="/compliance-calendar" component={ComplianceCalendar} />
          <Route path="/task-center" component={TaskCenter} />
          <Route path="/news-feed" component={UAENewsFeed} />
          
          {/* Admin Routes */}
          <Route path="/admin/dashboard" component={AdminDashboard} />
          <Route path="/admin/clients" component={ClientManagement} />
          <Route path="/admin/documents" component={AdminDocuments} />
          <Route path="/admin/invitations" component={UserInvitations} />
          <Route path="/admin/activity-logs" component={ActivityLogs} />
          <Route path="/admin/users" component={Admin} />
          <Route path="/admin" component={Admin} />
          
          <Route component={NotFound} />
        </Switch>
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
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
