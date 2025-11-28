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
          <Route path="/invoices" component={Invoices} />
          <Route path="/journal" component={Journal} />
          <Route path="/reports" component={Reports} />
          <Route path="/receipts" component={Receipts} />
          <Route path="/ai-cfo" component={AICFO} />
          <Route path="/ai-features" component={AIFeatures} />
          <Route path="/smart-assistant" component={SmartAssistant} />
          <Route path="/integrations" component={Integrations} />
          <Route path="/whatsapp" component={WhatsAppDashboard} />
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
