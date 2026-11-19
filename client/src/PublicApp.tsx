import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { Route, Switch, useLocation } from "wouter";
import { lazyWithReload } from "@/lib/lazyWithReload";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DeferredInstallPrompt } from "@/components/DeferredInstallPrompt";
import { RTLProvider } from "@/components/RTLProvider";
import { isCustomerLinkPath, isPublicPath, useI18n } from "@/lib/i18n";

/**
 * Light root for signed-out visitors (D1b, mobile performance).
 *
 * main.tsx mounts this instead of <App /> when the first page is a public one
 * (landing, pricing, auth, legal, help). It renders the same lazily loaded page
 * components as App.tsx, but without the signed-in shell: no sidebar, command
 * palette, realtime socket, motion or form libraries in the startup bundle.
 * The landing page and pricing need no data providers at all; the other public
 * pages get React Query, tooltips and toasts from a lazily loaded provider chunk.
 *
 * The moment the visitor reaches any other path (signing in, an invoice link,
 * the OAuth callback) the full <App /> is loaded and takes over for the rest of
 * the session; it owns every public route as well, so nothing is lost.
 */

/**
 * Form pages build zod schemas when their chunk is evaluated, so the zod configuration (no eval,
 * see lib/zod-config) must be evaluated first. The landing page, pricing and the no-login
 * links need no zod and never load it.
 */
const afterZod =
  <T,>(load: () => Promise<T>) =>
  () =>
    import("@/lib/zod-config").then(load);

const LandingPage = lazyWithReload(() => import("@/pages/MuhasibLanding"));
const Pricing = lazyWithReload(() => import("@/pages/Pricing"));
const Services = lazyWithReload(afterZod(() => import("@/pages/Services")));
const DemoWorkspace = lazyWithReload(afterZod(() => import("@/pages/DemoWorkspace")));
const HelpCenter = lazyWithReload(afterZod(() => import("@/pages/HelpCenter")));
const TrustSecurity = lazyWithReload(afterZod(() => import("@/pages/TrustSecurity")));
const MigrationGuides = lazyWithReload(afterZod(() => import("@/pages/MigrationGuides")));
const PrivacyPolicy = lazyWithReload(afterZod(() => import("@/pages/PrivacyPolicy")));
const TermsOfService = lazyWithReload(afterZod(() => import("@/pages/TermsOfService")));
const CookiePolicy = lazyWithReload(afterZod(() => import("@/pages/CookiePolicy")));
const Login = lazyWithReload(afterZod(() => import("@/pages/Login")));
const Register = lazyWithReload(afterZod(() => import("@/pages/Register")));
const ForgotPassword = lazyWithReload(afterZod(() => import("@/pages/ForgotPassword")));
const ResetPassword = lazyWithReload(afterZod(() => import("@/pages/ResetPassword")));
const CustomerPortal = lazyWithReload(() => import("@/pages/CustomerPortal"));
const EInvoicingApprove = lazyWithReload(() => import("@/pages/EInvoicingApprove"));
const PublicInvoiceView = lazyWithReload(() => import("@/pages/PublicInvoiceView"));
const LinkProviders = lazy(() => import("@/components/customer-link/LinkProviders"));
const PortalJoin = lazyWithReload(afterZod(() => import("@/pages/portal/PortalJoin")));
const PublicProviders = lazy(() => import("@/components/marketing/PublicProviders"));
const FullApp = lazyWithReload(() => import("./App"));

/** Pages that render without React Query / tooltip / toast providers. */
const PROVIDERLESS = new Set(["/", "/pricing"]);

function pathOnly(location: string): string {
  return location.split(/[?#]/)[0] || "/";
}

/** Paths this light root renders itself (the OAuth callback needs the full app). */
function isPublicShellPath(pathname: string): boolean {
  return isPublicPath(pathname) && pathOnly(pathname) !== "/auth/callback";
}

function PublicRoutes() {
  return (
    <Switch>
      <Route path="/" component={LandingPage} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/services" component={Services} />
      <Route path="/demo" component={DemoWorkspace} />
      <Route path="/help" component={HelpCenter} />
      <Route path="/trust" component={TrustSecurity} />
      <Route path="/migration-guides" component={MigrationGuides} />
      <Route path="/privacy" component={PrivacyPolicy} />
      <Route path="/terms" component={TermsOfService} />
      <Route path="/cookies" component={CookiePolicy} />
      <Route path="/login" component={Login} />
      <Route path="/verify-email" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/portal/join" component={PortalJoin} />
      {/* No-login e-mail links: the approver page first (it also matches /portal/:token). */}
      <Route path="/portal/einvoicing-approve/:token" component={EInvoicingApprove} />
      <Route path="/portal/:token" component={CustomerPortal} />
      <Route path="/view/invoice/:token" component={PublicInvoiceView} />
    </Switch>
  );
}

function WithProviders({ path, children }: { path: string; children: ReactNode }) {
  if (PROVIDERLESS.has(path)) return <>{children}</>;
  // The no-login e-mail links need data fetching only (no toasts, no zod/forms).
  if (isCustomerLinkPath(path)) return <LinkProviders>{children}</LinkProviders>;
  return <PublicProviders>{children}</PublicProviders>;
}

export default function PublicApp() {
  const [location] = useLocation();
  const path = pathOnly(location);
  const { locale, setLocale } = useI18n();
  // Once the visitor leaves the public site, the full app owns the session.
  const [full, setFull] = useState(false);
  if (!full && !isPublicShellPath(path)) setFull(true);

  useEffect(() => {
    // Same as App: apply lang/dir for the persisted locale.
    setLocale(locale);
  }, [locale, setLocale]);

  if (full) {
    return (
      <Suspense fallback={null}>
        <FullApp />
      </Suspense>
    );
  }

  return (
    <ErrorBoundary>
      <RTLProvider>
        <Suspense fallback={null}>
          <WithProviders path={path}>
            <PublicRoutes />
          </WithProviders>
        </Suspense>
        {/* A customer opening an invoice link is not asked to install the app. */}
        {!isCustomerLinkPath(path) && <DeferredInstallPrompt />}
      </RTLProvider>
    </ErrorBoundary>
  );
}
