import { Suspense, useState } from "react";
import { useLocation } from "wouter";
import { lazyWithReload } from "@/lib/lazyWithReload";
import PhaseSite from "./PhaseSite";
import { siteLocale } from "./routes";

const PublicApp = lazyWithReload(() => import("@/PublicApp"));

/** Keep the phase pages independent of the auth and application shells at first paint. */
export default function PhaseRoot() {
  const [location] = useLocation();
  const path = location.split(/[?#]/, 1)[0] || "/";
  const onPhaseSite = path === "/" || !!siteLocale(path);
  const [handedOff, setHandedOff] = useState(false);
  if (!onPhaseSite && !handedOff) setHandedOff(true);
  if (onPhaseSite && !handedOff) return <PhaseSite />;
  return (
    <Suspense fallback={null}>
      <PublicApp />
    </Suspense>
  );
}
