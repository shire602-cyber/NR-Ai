import { useCallback, useEffect, Suspense } from "react";
import { lazyWithReload, clearChunkReloadGuards } from "@/lib/lazyWithReload";
import { Switch, Route, useLocation, Link } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useIsFetching } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { ErrorBoundary, SectionBoundary } from "@/components/ErrorBoundary";
import { formatMessage, useI18n, useTranslation } from "@/lib/i18n";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { canAccessNraCenter } from "@shared/access";
import { Button } from "@/components/ui/button";
import { User, Building2, ArrowLeft, Search } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import { PageSkeleton } from "@/components/PageSkeleton";

// All pages lazy-loaded for route-level code splitting.
// Layout shell (AppSidebar, ProtectedLayout) is NOT lazy — needed immediately.
const NotFound = lazyWithReload(() => import("@/pages/not-found"));
const Login = lazyWithReload(() => import("@/pages/Login"));
const Register = lazyWithReload(() => import("@/pages/Register"));
const AuthCallback = lazyWithReload(() => import("@/pages/AuthCallback"));
const ForgotPassword = lazyWithReload(() => import("@/pages/ForgotPassword"));
const ResetPassword = lazyWithReload(() => import("@/pages/ResetPassword"));
const Dashboard = lazyWithReload(() => import("@/pages/Dashboard"));
const LandingPage = lazyWithReload(() => import("@/pages/MuhasibLanding"));
const Services = lazyWithReload(() => import("@/pages/Services"));
const Pricing = lazyWithReload(() => import("@/pages/Pricing"));
const PublicInvoiceView = lazyWithReload(() => import("@/pages/PublicInvoiceView"));
const CustomerPortal = lazyWithReload(() => import("@/pages/CustomerPortal"));
const PrivacyPolicy = lazyWithReload(() => import("@/pages/PrivacyPolicy"));
const TermsOfService = lazyWithReload(() => import("@/pages/TermsOfService"));
const CookiePolicy = lazyWithReload(() => import("@/pages/CookiePolicy"));
const TrustSecurity = lazyWithReload(() => import("@/pages/TrustSecurity"));
const HelpCenter = lazyWithReload(() => import("@/pages/HelpCenter"));
const MigrationGuides = lazyWithReload(() => import("@/pages/MigrationGuides"));
const DemoWorkspace = lazyWithReload(() => import("@/pages/DemoWorkspace"));

// Client Portal — lazy loaded
const PortalDashboard = lazyWithReload(() => import("@/pages/portal/PortalDashboard"));
const PortalInvoices = lazyWithReload(() => import("@/pages/portal/PortalInvoices"));
const PortalDocuments = lazyWithReload(() => import("@/pages/portal/PortalDocuments"));
const PortalStatements = lazyWithReload(() => import("@/pages/portal/PortalStatements"));
const PortalMessages = lazyWithReload(() => import("@/pages/portal/PortalMessages"));

// Firm (NRA Management Center) — lazy loaded
const ClientPortfolio = lazyWithReload(() => import("@/pages/firm/ClientPortfolio"));
const ClientProfile = lazyWithReload(() => import("@/pages/firm/ClientProfile"));
const StaffManagement = lazyWithReload(() => import("@/pages/firm/StaffManagement"));
const BulkOperations = lazyWithReload(() => import("@/pages/firm/BulkOperations"));
const FirmHealth = lazyWithReload(() => import("@/pages/firm/FirmHealth"));
const FirmComms = lazyWithReload(() => import("@/pages/firm/FirmComms"));
const EmailIntake = lazyWithReload(() => import("@/pages/firm/EmailIntake"));
const FirmAnalytics = lazyWithReload(() => import("@/pages/firm/FirmAnalytics"));
const LeadPipeline = lazyWithReload(() => import("@/pages/firm/LeadPipeline"));
const ValueOps = lazyWithReload(() => import("@/pages/firm/ValueOps"));
const PracticeWorkspace = lazyWithReload(() => import("@/pages/firm/PracticeWorkspace"));
const FirmCommandCenter = lazyWithReload(() => import("@/pages/FirmCommandCenter"));

// Core accounting
const ChartOfAccounts = lazyWithReload(() => import("@/pages/ChartOfAccounts"));
const AccountLedger = lazyWithReload(() => import("@/pages/AccountLedger"));
const Invoices = lazyWithReload(() => import("@/pages/Invoices"));
const Journal = lazyWithReload(() => import("@/pages/Journal"));
const JournalEntryDetail = lazyWithReload(() => import("@/pages/JournalEntryDetail"));
const Reports = lazyWithReload(() => import("@/pages/Reports"));
const Receipts = lazyWithReload(() => import("@/pages/Receipts"));
const ReceiptAutopilot = lazyWithReload(() => import("@/pages/ReceiptAutopilot"));
const CompanyProfile = lazyWithReload(() => import("@/pages/CompanyProfile"));
const CompanySettings = lazyWithReload(() => import("@/pages/CompanySettings"));
const SecuritySettings = lazyWithReload(() => import("@/pages/SecuritySettings"));
const EInvoicingSettings = lazyWithReload(() => import("@/pages/EInvoicingSettings"));
const ZatcaSettings = lazyWithReload(() => import("@/pages/ZatcaSettings"));

// Lazy-loaded pages (large or infrequently visited)
const Admin = lazyWithReload(() => import("@/pages/Admin"));
const AdminDashboard = lazyWithReload(() => import("@/pages/AdminDashboard"));
const ClientImport = lazyWithReload(() => import("@/pages/ClientImport"));
const AIHub = lazyWithReload(() => import("@/pages/AIHub"));
const AnalyticsHub = lazyWithReload(() => import("@/pages/AnalyticsHub"));
const UserInvitations = lazyWithReload(() => import("@/pages/UserInvitations"));
const ActivityLogs = lazyWithReload(() => import("@/pages/ActivityLogs"));
const AdminDocuments = lazyWithReload(() => import("@/pages/AdminDocuments"));

const Payroll = lazyWithReload(() => import("@/pages/Payroll"));
const FixedAssets = lazyWithReload(() => import("@/pages/FixedAssets"));
const Budgets = lazyWithReload(() => import("@/pages/Budgets"));
const DocumentVault = lazyWithReload(() => import("@/pages/DocumentVault"));
const BillPay = lazyWithReload(() => import("@/pages/BillPay"));
const Vendors = lazyWithReload(() => import("@/pages/Vendors"));
const ExpenseClaims = lazyWithReload(() => import("@/pages/ExpenseClaims"));
const Inventory = lazyWithReload(() => import("@/pages/Inventory"));
const Quotes = lazyWithReload(() => import("@/pages/Quotes"));
const CreditNotes = lazyWithReload(() => import("@/pages/CreditNotes"));
const PurchaseOrders = lazyWithReload(() => import("@/pages/PurchaseOrders"));
const CostCenters = lazyWithReload(() => import("@/pages/CostCenters"));
const FinancialStatements = lazyWithReload(() => import("@/pages/FinancialStatements"));
const ReconciliationRules = lazyWithReload(() => import("@/pages/ReconciliationRules"));
const InvoiceTemplates = lazyWithReload(() => import("@/pages/InvoiceTemplates"));
const DocumentVersions = lazyWithReload(() => import("@/pages/DocumentVersions"));
const DeveloperSettings = lazyWithReload(() => import("@/pages/DeveloperSettings"));
const NotificationPreferences = lazyWithReload(() => import("@/pages/NotificationPreferences"));
const Subscription = lazyWithReload(() => import("@/pages/Subscription"));
const ExchangeRates = lazyWithReload(() => import("@/pages/ExchangeRates"));
const CompanyGroups = lazyWithReload(() => import("@/pages/CompanyGroups"));
const Consolidation = lazyWithReload(() => import("@/pages/Consolidation"));
const RecurringInvoices = lazyWithReload(() => import("@/pages/RecurringInvoices"));
const PaymentChasing = lazyWithReload(() => import("@/pages/PaymentChasing"));

const CustomerContacts = lazyWithReload(() => import("@/pages/CustomerContacts"));
const IntegrationsHub = lazyWithReload(() => import("@/pages/IntegrationsHub"));
const Notifications = lazyWithReload(() => import("@/pages/Notifications"));
const Reminders = lazyWithReload(() => import("@/pages/Reminders"));
const DocumentChasing = lazyWithReload(() => import("@/pages/DocumentChasing"));
const Referrals = lazyWithReload(() => import("@/pages/Referrals"));
const Feedback = lazyWithReload(() => import("@/pages/Feedback"));

const Onboarding = lazyWithReload(() => import("@/pages/Onboarding"));
const BankReconciliation = lazyWithReload(() => import("@/pages/BankReconciliation"));
const BankAccounts = lazyWithReload(() => import("@/pages/BankAccounts"));
const BankFeeds = lazyWithReload(() => import("@/pages/BankFeeds"));
const EvidenceCenter = lazyWithReload(() => import("@/pages/EvidenceCenter"));
const VATFiling = lazyWithReload(() => import("@/pages/VATFiling"));
const VATAutopilot = lazyWithReload(() => import("@/pages/VATAutopilot"));
const CorporateTax = lazyWithReload(() => import("@/pages/CorporateTax"));
const TeamManagement = lazyWithReload(() => import("@/pages/TeamManagement"));
const TaxReturnArchive = lazyWithReload(() => import("@/pages/TaxReturnArchive"));
const ComplianceCalendar = lazyWithReload(() => import("@/pages/ComplianceCalendar"));
const TaskCenter = lazyWithReload(() => import("@/pages/TaskCenter"));
const UAENewsFeed = lazyWithReload(() => import("@/pages/UAENewsFeed"));
const History = lazyWithReload(() => import("@/pages/History"));
const BackupRestore = lazyWithReload(() => import("@/pages/BackupRestore"));
const ImportWizard = lazyWithReload(() => import("@/pages/ImportWizard"));
const CashFlowForecast = lazyWithReload(() => import("@/pages/CashFlowForecast"));
const AnomalyDetection = lazyWithReload(() => import("@/pages/AnomalyDetection"));
const AutoReconcile = lazyWithReload(() => import("@/pages/AutoReconcile"));
const MonthEndClose = lazyWithReload(() => import("@/pages/MonthEndClose"));

function PageLoader({
  variant,
}: { variant?: "list" | "detail" | "dashboard" | "form" | "minimal" } = {}) {
  return <PageSkeleton variant={variant ?? "list"} />;
}

function MinimalPageLoader() {
  return (
    <div className="flex items-center justify-center h-64" aria-busy="true">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function routeName(location: string): string {
  const seg = location.split("/").filter(Boolean)[0] ?? "app";
  return seg
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function pathnameOnly(location: string): string {
  return location.split(/[?#]/)[0] || "/";
}

function loginRedirectForCurrentPath(): string {
  const next = `${window.location.pathname}${window.location.search}`;
  if (
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.startsWith("/\\") ||
    next === "/login"
  ) {
    return "/login";
  }
  return `/login?next=${encodeURIComponent(next)}`;
}

import { PWAInstallPrompt } from "@/components/PWAInstallPrompt";
import { MobileNav } from "@/components/MobileNav";
import { NotificationBell } from "@/components/NotificationBell";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { RouteGuard } from "@/components/layout/RouteGuard";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { ActiveCompanyProvider, useActiveCompany } from "@/components/ActiveCompanyProvider";
import { RTLProvider } from "@/components/RTLProvider";
import "@/styles/rtl.css";
import "@/styles/mobile.css";

// Components
import { OnboardingWizard } from "@/components/Onboarding";
import { CommandPaletteProvider } from "@/components/CommandPalette";
import { GlobalShortcutsProvider } from "@/components/ShortcutsHelp";
import { SkipLink } from "@/components/SkipLink";
import { RedirectTo } from "@/components/layout/RedirectTo";
import { openCommandPalette } from "@/lib/commandPalette";

function FirmContextBanner() {
  const { company, isFirmContext, clearActiveClientCompany } = useActiveCompany();
  const [, navigate] = useLocation();
  const { t } = useTranslation();

  if (!isFirmContext || !company) return null;

  const goBackToFirm = () => {
    clearActiveClientCompany();
    navigate("/firm/clients");
  };

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 bg-primary/10 border-b border-primary/20 px-3 py-2 md:px-4"
      data-testid="firm-context-banner"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Building2 className="w-4 h-4 text-primary shrink-0" />
        <span className="text-xs uppercase tracking-wide text-primary/80 shrink-0">
          {t["shell.managing"]}
        </span>
        <span className="font-semibold text-sm truncate" data-testid="firm-context-company-name">
          {company.name}
        </span>
        {company.trnVatNumber && (
          <span className="text-xs text-muted-foreground hidden sm:inline">
            · {formatMessage(t["shell.trn"], { trn: company.trnVatNumber })}
          </span>
        )}
      </div>
      <Button size="sm" variant="outline" onClick={goBackToFirm} data-testid="button-back-to-firm">
        <ArrowLeft className="w-3.5 h-3.5 me-1.5 rtl:rotate-180" />
        {t["shell.backToFirm"]}
      </Button>
    </div>
  );
}

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const { t } = useTranslation();
  const { company, hasNoCompanies, isLoading: companyLoading } = useDefaultCompany();
  const { isFirmContext } = useActiveCompany();
  const companiesFetching = useIsFetching({ queryKey: ["/api/companies"] });
  const pathname = pathnameOnly(location);

  useEffect(() => {
    if (companyLoading || pathname === "/onboarding") return;

    // Skip the customer-onboarding redirect when a firm staffer is operating
    // inside a client workspace — the client's onboarding state is the firm's
    // problem to manage, not a hard redirect for the staff member.
    if (isFirmContext) return;

    // R18-08: the redirect is deterministic per-user state, not a per-session
    // flag. While the company has not finished onboarding the user is always
    // sent to /onboarding; every exit from the wizard (express setup, "Save &
    // continue later", finishing) marks the company complete server-side, so
    // there is no loop. Wait for in-flight company refetches first so a
    // just-completed wizard does not bounce back on stale data.
    if (companiesFetching > 0) return;

    // No company yet — send the user to onboarding so they can create one.
    if (hasNoCompanies) {
      navigate("/onboarding");
      return;
    }

    if (company && !company.onboardingCompleted) {
      navigate("/onboarding");
    }
  }, [
    company,
    hasNoCompanies,
    companyLoading,
    companiesFetching,
    pathname,
    navigate,
    isFirmContext,
  ]);

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
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
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <div className="flex items-center gap-2">
              <SidebarTrigger
                data-testid="button-sidebar-toggle"
                aria-label={t["shell.toggleSidebar"]}
                className="text-muted-foreground hover:text-foreground"
              />
              <div className="hidden md:flex items-center gap-2 ps-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-success-subtle text-success-subtle-foreground text-[10px] font-semibold tracking-wide uppercase">
                  <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse-dot" />
                  {t["shell.uaeTaxReady"]}
                </span>
                <span className="text-border">·</span>
                <span className="font-mono text-[11px] tracking-tight">
                  {t["shell.regionCurrency"]}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openCommandPalette}
                data-testid="button-command-palette"
                title={t["shell.searchAndCommands"]}
                aria-keyshortcuts="Control+K Meta+K"
                className="hidden md:flex items-center gap-2 h-8 ps-3 pe-2 rounded-full border border-border/70 bg-card/50 text-muted-foreground hover:text-foreground hover:bg-card hover:border-border transition-colors"
              >
                <Search className="w-3.5 h-3.5" />
                <span className="text-[12.5px] font-medium pe-4">{t["shell.search"]}</span>
                <kbd
                  aria-hidden="true"
                  className="inline-flex items-center gap-0.5 rounded border border-border/70 bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground"
                >
                  ⌘K
                </kbd>
              </button>
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
                    transition={{ duration: 0.25, ease: "easeOut" }}
                  >
                    <SectionBoundary name={routeName(location)}>{children}</SectionBoundary>
                  </motion.div>
                </AnimatePresence>
              </RouteGuard>
            </div>
          </main>
        </div>
      </div>
      <MobileNav />
      <OnboardingWizard />
      <CommandPaletteProvider />
      <GlobalShortcutsProvider />
    </SidebarProvider>
  );
}

// Guard: client portal routes require userType 'client_portal' or 'client'
function AccessRedirect({
  title,
  description,
  redirectTo,
  actionLabel,
}: {
  title: string;
  description: string;
  redirectTo: string;
  actionLabel?: string;
}) {
  const [, navigate] = useLocation();
  const { t } = useTranslation();
  const redirect = useCallback(() => {
    navigate(redirectTo);
    if (redirectTo.startsWith("/login")) {
      window.location.replace(redirectTo);
    }
  }, [navigate, redirectTo]);

  useEffect(() => {
    redirect();
  }, [redirect]);

  return (
    <div className="min-h-[50vh] flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-3">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
        <Button variant="outline" onClick={redirect}>
          {actionLabel ?? t["shell.goToDashboard"]}
        </Button>
      </div>
    </div>
  );
}

function PortalRoute({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useCurrentUser();
  const { t } = useTranslation();

  if (isLoading) return null;
  if (!user)
    return (
      <AccessRedirect
        title={t["shell.signInRequiredTitle"]}
        description={t["shell.signInPortalDescription"]}
        redirectTo={loginRedirectForCurrentPath()}
        actionLabel={t["shell.signIn"]}
      />
    );
  if (user.userType !== "client_portal" && !user.isAdmin) {
    return (
      <AccessRedirect
        title={t["shell.portalAccessTitle"]}
        description={t["shell.portalAccessDescription"]}
        redirectTo="/dashboard"
      />
    );
  }
  return <>{children}</>;
}

// Guard: NRA Center routes — platform admins and firm staff only (canonical
// model in shared/access.ts, mirrored server-side by requireNraAccess()).
function FirmRoute({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useCurrentUser();
  const { t } = useTranslation();

  if (isLoading) return null;
  if (!user)
    return (
      <AccessRedirect
        title={t["shell.signInRequiredTitle"]}
        description={t["shell.signInFirmDescription"]}
        redirectTo={loginRedirectForCurrentPath()}
        actionLabel={t["shell.signIn"]}
      />
    );
  if (!canAccessNraCenter(user)) {
    return (
      <AccessRedirect
        title={t["shell.firmAccessTitle"]}
        description={t["shell.firmAccessDescription"]}
        redirectTo="/dashboard"
      />
    );
  }
  return <>{children}</>;
}

function Router() {
  const [location, setLocation] = useLocation();
  const { data: user, isLoading: userLoading } = useCurrentUser();
  const pathname = pathnameOnly(location);

  // Redirect authenticated users from landing to their home (portal or main dashboard)
  useEffect(() => {
    if (pathname === "/" && user) {
      setLocation(user.userType === "client_portal" ? "/client-portal/dashboard" : "/dashboard");
    }
  }, [pathname, user, setLocation]);

  // Guard: authenticated users at root - wait for redirect
  if (pathname === "/" && userLoading) {
    return null;
  }

  if (pathname === "/" && user) {
    return null;
  }

  // Landing page (public only).
  // `initial={false}` skips the entry fade so the page is visible immediately;
  // a stalled or throttled animation must never leave the root at opacity:0.
  if (pathname === "/" && !user) {
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
  if (pathname.startsWith("/client-portal")) {
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
  if (pathname === "/onboarding") {
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
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/auth/callback" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname === "/verify-email" ||
    pathname === "/services" ||
    pathname === "/pricing" ||
    pathname === "/trust" ||
    pathname === "/help" ||
    pathname === "/migration-guides" ||
    pathname === "/demo" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname === "/cookies" ||
    pathname.startsWith("/view/invoice/") ||
    pathname.startsWith("/portal/")
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
              <Route path="/auth/callback" component={AuthCallback} />
              <Route path="/forgot-password" component={ForgotPassword} />
              <Route path="/reset-password" component={ResetPassword} />
              <Route path="/verify-email" component={Login} />
              <Route path="/services" component={Services} />
              <Route path="/view/invoice/:token" component={PublicInvoiceView} />
              <Route path="/portal/:token" component={CustomerPortal} />
              <Route path="/pricing" component={Pricing} />
              <Route path="/trust" component={TrustSecurity} />
              <Route path="/help" component={HelpCenter} />
              <Route path="/migration-guides" component={MigrationGuides} />
              <Route path="/demo" component={DemoWorkspace} />
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
            <Route path="/settings/security" component={SecuritySettings} />
            <Route path="/settings/einvoicing" component={EInvoicingSettings} />
            <Route path="/settings/zatca" component={ZatcaSettings} />
            {/* Consolidated routes (R18-09, R20-08, R15-09): legacy URLs redirect */}
            <Route path="/accounts">
              <RedirectTo to="/chart-of-accounts" />
            </Route>
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
            <Route path="/quotes" component={Quotes} />
            <Route path="/credit-notes" component={CreditNotes} />
            <Route path="/purchase-orders" component={PurchaseOrders} />
            <Route path="/cost-centers" component={CostCenters} />
            <Route path="/financial-statements" component={FinancialStatements} />
            <Route path="/reconciliation-rules" component={ReconciliationRules} />
            <Route path="/invoice-templates" component={InvoiceTemplates} />
            <Route path="/document-versions" component={DocumentVersions} />
            <Route path="/developer-settings" component={DeveloperSettings} />
            <Route path="/notification-preferences" component={NotificationPreferences} />
            <Route path="/subscription" component={Subscription} />
            <Route path="/exchange-rates" component={ExchangeRates} />
            <Route path="/company-groups" component={CompanyGroups} />
            <Route path="/consolidation" component={Consolidation} />
            <Route path="/payroll" component={Payroll} />
            <Route path="/bill-pay" component={BillPay} />
            <Route path="/vendors" component={Vendors} />
            <Route path="/fixed-assets" component={FixedAssets} />
            <Route path="/budgets" component={Budgets} />
            <Route path="/expense-claims" component={ExpenseClaims} />
            <Route path="/cashflow-forecast" component={CashFlowForecast} />
            <Route path="/anomaly-detection" component={AnomalyDetection} />
            <Route path="/auto-reconcile" component={AutoReconcile} />
            <Route path="/ai" component={AIHub} />
            <Route path="/ai-inbox">
              <RedirectTo to="/ai?tab=inbox" />
            </Route>
            <Route path="/month-end" component={MonthEndClose} />
            <Route path="/ai-cfo">
              <RedirectTo to="/ai?tab=cfo" />
            </Route>
            <Route path="/ai-features">
              <RedirectTo to="/ai?tab=features" />
            </Route>
            <Route path="/smart-assistant">
              <RedirectTo to="/ai?tab=assistant" />
            </Route>
            <Route path="/ai-chat">
              <RedirectTo to="/ai?tab=chat" />
            </Route>
            <Route path="/advanced-analytics">
              <RedirectTo to="/analytics?view=advanced" />
            </Route>
            <Route path="/integrations">
              <RedirectTo to="/integrations-hub" />
            </Route>
            <Route path="/integrations-hub" component={IntegrationsHub} />
            <Route path="/notifications" component={Notifications} />
            <Route path="/reminders" component={Reminders} />
            <Route path="/referrals" component={Referrals} />
            <Route path="/feedback" component={Feedback} />
            <Route path="/analytics" component={AnalyticsHub} />
            <Route path="/bank-reconciliation" component={BankReconciliation} />
            <Route path="/bank-accounts" component={BankAccounts} />
            <Route path="/bank-feeds/callback" component={BankFeeds} />
            <Route path="/bank-feeds" component={BankFeeds} />
            <Route path="/evidence-center" component={EvidenceCenter} />
            <Route path="/vat-filing" component={VATFiling} />
            <Route path="/vat-autopilot" component={VATAutopilot} />
            <Route path="/corporate-tax" component={CorporateTax} />
            <Route path="/team" component={TeamManagement} />
            <Route path="/history" component={History} />
            <Route path="/backup-restore" component={BackupRestore} />
            <Route path="/import" component={ImportWizard} />
            <Route path="/advanced-reports">
              <RedirectTo to="/analytics?view=reports" />
            </Route>
            <Route path="/document-vault" component={DocumentVault} />
            <Route path="/tax-return-archive" component={TaxReturnArchive} />
            <Route path="/compliance-calendar" component={ComplianceCalendar} />
            <Route path="/task-center" component={TaskCenter} />
            <Route path="/news-feed" component={UAENewsFeed} />

            {/* Admin Routes */}
            <Route path="/admin/dashboard" component={AdminDashboard} />
            {/* Legacy admin client pages were replaced by the /firm/clients portfolio (R15-09) */}
            <Route path="/admin/clients">
              <RedirectTo to="/firm/clients" />
            </Route>
            <Route path="/admin/clients/:id/documents">
              {(params) => <RedirectTo to={`/firm/clients/${params.id}`} />}
            </Route>
            <Route path="/admin/clients/:id/tasks">
              {(params) => <RedirectTo to={`/firm/clients/${params.id}`} />}
            </Route>
            <Route path="/admin/clients/:id">
              {(params) => <RedirectTo to={`/firm/clients/${params.id}`} />}
            </Route>
            <Route path="/admin/documents" component={AdminDocuments} />
            <Route path="/admin/invitations" component={UserInvitations} />
            <Route path="/admin/import" component={ClientImport} />
            <Route path="/admin/activity-logs" component={ActivityLogs} />
            <Route path="/admin/users" component={Admin} />
            <Route path="/admin">
              <RedirectTo to="/admin/users" />
            </Route>

            {/* NRA Firm Management Center */}
            <Route path="/firm/command-center">
              <FirmRoute>
                <FirmCommandCenter />
              </FirmRoute>
            </Route>
            <Route path="/firm/value-ops">
              <FirmRoute>
                <ValueOps />
              </FirmRoute>
            </Route>
            <Route path="/firm/health">
              <FirmRoute>
                <FirmHealth />
              </FirmRoute>
            </Route>
            <Route path="/firm/clients/:companyId">
              <FirmRoute>
                <ClientProfile />
              </FirmRoute>
            </Route>
            <Route path="/firm/clients">
              <FirmRoute>
                <ClientPortfolio />
              </FirmRoute>
            </Route>
            <Route path="/firm/practice">
              <FirmRoute>
                <PracticeWorkspace />
              </FirmRoute>
            </Route>
            <Route path="/firm/staff">
              <FirmRoute>
                <StaffManagement />
              </FirmRoute>
            </Route>
            <Route path="/firm/bulk">
              <FirmRoute>
                <BulkOperations />
              </FirmRoute>
            </Route>
            <Route path="/firm/comms">
              <FirmRoute>
                <FirmComms />
              </FirmRoute>
            </Route>
            <Route path="/firm/document-chasing">
              <FirmRoute>
                <DocumentChasing />
              </FirmRoute>
            </Route>
            <Route path="/firm/email-intake">
              <FirmRoute>
                <EmailIntake />
              </FirmRoute>
            </Route>
            <Route path="/firm/analytics">
              <FirmRoute>
                <FirmAnalytics />
              </FirmRoute>
            </Route>
            <Route path="/firm/pipeline">
              <FirmRoute>
                <LeadPipeline />
              </FirmRoute>
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
  }, [locale, setLocale]);

  useEffect(() => {
    // App booted successfully — clear any stale-chunk reload guards so a future
    // deploy can trigger a fresh one-time recovery reload if needed.
    clearChunkReloadGuards();
  }, []);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ActiveCompanyProvider>
          <RTLProvider>
            <TooltipProvider>
              <Router />
              <PWAInstallPrompt />
              <Toaster />
            </TooltipProvider>
          </RTLProvider>
        </ActiveCompanyProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
