// Firm build only (see vite.config.ts `FIRM_BUILD`). Evaluated before main.tsx, in import order:
// it pulls the signed-in app and the two firm landing screens into the entry chunk, and tells
// main.tsx to use that root instead of fetching it.
// zod is configured before any module that builds a schema (same rule as main.tsx).
import "@/lib/zod-config";
import App from "./App";
import "@/pages/firm/ClientPortfolio";
import "@/pages/FirmCommandCenter";
import { registerStaticRoot } from "@/lib/staticRoot";

registerStaticRoot(App);
