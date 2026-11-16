import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { Route, Switch, useLocation } from "wouter";
import { lazyWithReload } from "@/lib/lazyWithReload";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { RTLProvider } from "@/components/RTLProvider";
import { isPublicPath, useI18n } from "@/lib/i18n";

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

const LandingPage = lazyWithReload(() => import("@/pages/MuhasibLanding"));
const Pricing = lazyWithReload(() => import("@/pages/Pricing"));
const Services = lazyWithReload(() => import("@/pages/Services"));
const DemoWorkspace = lazyWithReload(() => import("@/pages/DemoWorkspace"));
const HelpCenter = lazyWithReload(() => import("@/pages/HelpCenter"));
const TrustSecurity = lazyWithReload(() => import("@/pages/TrustSecurity"));
const MigrationGuides = lazyWithReload(() => import("@/pages/MigrationGuides"));
const PrivacyPolicy = lazyWithReload(() => import("@/pages/PrivacyPolicy"));
const TermsOfService = lazyWithReload(() => import("@/pages/TermsOfService"));
const CookiePolicy = lazyWithReload(() => import("@/pages/CookiePolicy"));
const Login = lazyWithReload(() => import("@/pages/Login"));
const Register = lazyWithReload(() => import("@/pages/Register"));
const ForgotPassword = lazyWithReload(() => import("@/pages/ForgotPassword"));
const ResetPassword = lazyWithReload(() => import("@/pages/ResetPassword"));
const PublicProviders = lazy(() => import("@/components/marketing/PublicProviders"));
const FullApp = lazyWithReload(() => import("./App"));
const PWAInstallPrompt = lazy(() =>
  import("@/components/PWAInstallPrompt").then((m) => ({ default: m.PWAInstallPrompt }))
);

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
    </Switch>
  );
}

/** Mount the install prompt only after the page has loaded (it is never first-paint UI). */
function DeferredInstallPrompt() {
  const [ready, setReady] = useState(() => document.readyState === "complete");
  useEffect(() => {
    if (ready) return;
    const onLoad = () => setReady(true);
    window.addEventListener("load", onLoad, { once: true });
    return () => window.removeEventListener("load", onLoad);
  }, [ready]);
  if (!ready) return null;
  return (
    <Suspense fallback={null}>
      <PWAInstallPrompt />
    </Suspense>
  );
}

function WithProviders({ path, children }: { path: string; children: ReactNode }) {
  if (PROVIDERLESS.has(path)) return <>{children}</>;
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
        <DeferredInstallPrompt />
      </RTLProvider>
    </ErrorBoundary>
  );
}
