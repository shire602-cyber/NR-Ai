import { Suspense, useEffect, useState, type ReactNode } from "react";
import { Route, Switch, useLocation } from "wouter";
import { lazyWithReload } from "@/lib/lazyWithReload";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { RTLProvider } from "@/components/RTLProvider";
import { PortalLayout } from "@/components/layout/PortalLayout";
import PortalProviders from "@/components/portal/PortalProviders";
import { useTranslation } from "@/lib/i18n";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { isPortalAppPath, useI18n } from "@/lib/i18n";
// The portal tables become stacked cards on phones (mobile.css) and the app mirrors in Arabic
// (rtl.css); both ship with the signed-in app, so the light root loads them itself.
import "@/styles/rtl.css";
import "@/styles/mobile.css";

/**
 * Light root for the signed-in client portal (/client-portal/dashboard, invoices, documents,
 * statements, messages).
 *
 * main.tsx mounts this instead of <App /> when a signed-in client lands on one of those pages:
 * a client opening their statement on a phone should not download the whole accounting app
 * (sidebar, command palette, realtime socket, motion, every catalog). Anything else, a signed-out
 * visitor, a staff user, or a client navigating off the portal, is handed to the full app, which
 * owns the same routes (sign-in redirect, access message) exactly as before.
 */

const PortalDashboard = lazyWithReload(() => import("@/pages/portal/PortalDashboard"));
const PortalInvoices = lazyWithReload(() => import("@/pages/portal/PortalInvoices"));
const PortalDocuments = lazyWithReload(() => import("@/pages/portal/PortalDocuments"));
const PortalStatements = lazyWithReload(() => import("@/pages/portal/PortalStatements"));
const PortalMessages = lazyWithReload(() => import("@/pages/portal/PortalMessages"));
const PortalAccount = lazyWithReload(() => import("@/pages/portal/PortalAccount"));
// The full app builds zod schemas: configure zod (no eval) before it loads, as main.tsx would.
const FullApp = lazyWithReload(() => import("@/lib/zod-config").then(() => import("./App")));

function PageSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-[960px] space-y-4" role="status" aria-busy="true">
      <span className="sr-only">{t["components.ui.loading"]}</span>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

/** Only a client_portal user (or a platform admin) stays here; everyone else goes to the full app. */
function PortalGate({ children, onHandOver }: { children: ReactNode; onHandOver: () => void }) {
  const { data: user, isLoading } = useCurrentUser();
  const allowed = !!user && (user.userType === "client_portal" || !!user.isAdmin);
  useEffect(() => {
    if (!isLoading && !allowed) onHandOver();
  }, [isLoading, allowed, onHandOver]);
  if (isLoading || !allowed) return <PageSkeleton />;
  return <>{children}</>;
}

export default function PortalApp() {
  const [location] = useLocation();
  const { locale, setLocale } = useI18n();
  const [full, setFull] = useState(false);
  if (!full && !isPortalAppPath(location)) setFull(true);

  useEffect(() => {
    // Same as App: apply lang/dir for the persisted locale.
    setLocale(locale);
  }, [locale, setLocale]);

  if (full) {
    return (
      <Suspense fallback={<PageSkeleton />}>
        <FullApp />
      </Suspense>
    );
  }

  return (
    <ErrorBoundary>
      <RTLProvider>
        <PortalProviders>
          <PortalGate onHandOver={() => setFull(true)}>
            <PortalLayout>
              <Suspense fallback={<PageSkeleton />}>
                <Switch>
                  <Route path="/client-portal/dashboard" component={PortalDashboard} />
                  <Route path="/client-portal/invoices" component={PortalInvoices} />
                  <Route path="/client-portal/documents" component={PortalDocuments} />
                  <Route path="/client-portal/statements" component={PortalStatements} />
                  <Route path="/client-portal/messages" component={PortalMessages} />
                  <Route path="/client-portal/account" component={PortalAccount} />
                </Switch>
              </Suspense>
            </PortalLayout>
          </PortalGate>
        </PortalProviders>
      </RTLProvider>
    </ErrorBoundary>
  );
}
