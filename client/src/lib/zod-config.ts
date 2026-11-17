import { z } from "zod";

/**
 * Zod 4 probes `new Function("")` to decide whether it may compile fast-path parsers. Under our
 * CSP (script-src without 'unsafe-eval') the probe throws, zod swallows it, but the browser still
 * reports a `securitypolicyviolation` (seen as a report-only violation on /login). Browser form
 * schemas are tiny, so run zod in its interpreted mode and never touch eval.
 *
 * Must be imported before any module that builds a zod schema (first import in main.tsx).
 */
z.config({ jitless: true });
