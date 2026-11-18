import type { ComponentType } from "react";
import { createRoot } from "react-dom/client";
// Self-hosted fonts (Fontsource) — no external Google Fonts dependency, so the
// app never blocks on, nor leaks the user's IP to, a third-party CDN. One Latin
// family (Geist Sans; display is the same family) plus Geist Mono for code/IDs;
// Noto Sans Arabic loads on the first RTL render (RTLProvider).
import "@fontsource/geist-sans/300.css";
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-sans/700.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-mono/600.css";
import "./index.css";
import { registerServiceWorker } from "@/lib/pwa";
import { hasAuthHint } from "@/lib/authHint";
import { warmOnFirstInteraction } from "@/lib/warmOnInteraction";
import {
  isCustomerLinkPath,
  isLocaleLoaded,
  isPortalAppPath,
  isPublicPath,
  loadLocale,
  loadLocaleForPath,
  setPublicBootScope,
  useI18n,
} from "@/lib/i18n";

// D1b (mobile performance): signed-out visitors on a public page get the light
// PublicApp root (no signed-in shell in the startup bundle); everyone else, and a
// returning user landing on "/" (who is redirected to the app), gets <App />.
// PublicApp hands over to <App /> as soon as the visitor leaves the public pages.
const pathname = window.location.pathname;
const locale = useI18n.getState().locale;
const publicShell =
  isPublicPath(pathname) && pathname !== "/auth/callback" && !(pathname === "/" && hasAuthHint());

// A signed-in client opening a client-portal page gets the light PortalApp root (no accounting
// shell); a signed-out visitor still goes through <App /> and its sign-in redirect.
const portalShell = !publicShell && isPortalAppPath(pathname) && hasAuthHint();

// The page chunk of the public route the visitor landed on, fetched in parallel with
// the root and its catalogs so the first paint does not wait for another round trip.
const PUBLIC_ROUTE_CHUNKS: Record<string, () => Promise<unknown>> = {
  "/": () => import("@/pages/MuhasibLanding"),
  "/pricing": () => import("@/pages/Pricing"),
  "/login": () => import("@/pages/Login"),
  "/forgot-password": () => import("@/pages/ForgotPassword"),
  "/reset-password": () => import("@/pages/ResetPassword"),
  "/register": () => import("@/pages/Register"),
};

/** The page chunk of a no-login e-mail link (fetched in parallel with the root and catalogs). */
function customerLinkChunk(path: string): (() => Promise<unknown>) | undefined {
  if (/^\/portal\/einvoicing-approve\/[^/]+\/?$/.test(path))
    return () => import("@/pages/EInvoicingApprove");
  if (/^\/portal\/[^/]+\/?$/.test(path)) return () => import("@/pages/CustomerPortal");
  if (/^\/view\/invoice\/[^/]+\/?$/.test(path)) return () => import("@/pages/PublicInvoiceView");
  return undefined;
}

// zod must be configured (jitless, no eval) before any module builds a schema. The landing page,
// pricing and the no-login e-mail links (portal, invoice, approver) build none, so they never
// download zod; every other first page loads the configuration first (a few ms: the same chunk
// the form pages need anyway) and then its root and page chunk. PublicApp does the same before
// it lazily opens a form page after a client-side navigation.
const zodFree =
  portalShell ||
  (publicShell && (pathname === "/" || pathname === "/pricing" || isCustomerLinkPath(pathname)));
const zodReady: Promise<unknown> = zodFree ? Promise.resolve() : import("@/lib/zod-config");

const loadRoot: () => Promise<{ default: ComponentType }> = publicShell
  ? () => import("./PublicApp")
  : portalShell
    ? () => import("./PortalApp")
    : () => import("./App");

// S5: locale catalogs are code-split; load what the first route needs before the first render
// so translated copy never flashes keys. D1b: public pages load only their own namespaces
// (lib/i18n.ts namespacesForPath); app routes load every namespace as before. A failed
// catalog chunk still renders (keys fall back).
const lightBoot = publicShell || portalShell;
setPublicBootScope(lightBoot ? pathname : "/__app");
void Promise.all([
  zodReady.then(loadRoot),
  loadLocaleForPath(locale, lightBoot ? pathname : "/__app").catch(() => undefined),
  publicShell
    ? zodReady.then(() =>
        (PUBLIC_ROUTE_CHUNKS[pathname] ?? customerLinkChunk(pathname))?.().catch(() => undefined)
      )
    : undefined,
]).then(([{ default: Root }]) => {
  createRoot(document.getElementById("root")!).render(<Root />);
});

// Sign-in and registration lead straight into the app: warm the remaining catalogs so the first
// signed-in screen renders without waiting for them. Registration warms once the page is idle;
// sign-in waits for the first touch of the form (or 8 s), so on a slow phone the form paints
// before ~40 catalog requests start (lib/warmOnInteraction.ts).
if (pathname === "/login" || pathname === "/register") {
  const warm = () => {
    const current = useI18n.getState().locale;
    if (!isLocaleLoaded(current)) void loadLocale(current).catch(() => undefined);
  };
  window.addEventListener("load", () => {
    if (pathname === "/login") warmOnFirstInteraction(warm);
    else if ("requestIdleCallback" in window) window.requestIdleCallback(warm, { timeout: 4000 });
    else setTimeout(warm, 2000);
  });
}

// Register the service worker after the React app has mounted so the initial
// render isn't blocked by network registration.
if (import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void registerServiceWorker();
  });
}
