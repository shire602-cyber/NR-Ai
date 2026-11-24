import { Suspense, lazy, useEffect, useState } from "react";
import { canInstall, onInstallPromptAvailable } from "@/lib/pwa";

const PWAInstallPrompt = lazy(() =>
  import("@/components/PWAInstallPrompt").then((m) => ({ default: m.PWAInstallPrompt }))
);

/**
 * Mounts the install banner (and with it framer-motion) only once the browser has actually
 * offered an install (`beforeinstallprompt`) and the page has finished loading. Until then it
 * downloads nothing, so a phone on a slow connection spends no bytes on a banner that may never
 * show. It is never first-paint UI.
 */
export function DeferredInstallPrompt() {
  const [loaded, setLoaded] = useState(() => document.readyState === "complete");
  const [offered, setOffered] = useState(() => canInstall());

  useEffect(() => {
    if (loaded) return;
    const onLoad = () => setLoaded(true);
    window.addEventListener("load", onLoad, { once: true });
    return () => window.removeEventListener("load", onLoad);
  }, [loaded]);

  useEffect(() => onInstallPromptAvailable(() => setOffered(true)), []);

  if (!loaded || !offered) return null;
  return (
    <Suspense fallback={null}>
      <PWAInstallPrompt />
    </Suspense>
  );
}
