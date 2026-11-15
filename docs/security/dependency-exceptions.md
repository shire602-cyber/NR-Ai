# Production dependency audit exceptions

`npm audit --omit=dev` must show no critical or high advisories. `scripts/qa/audit-gate.mjs` (run in
CI) fails on any critical/high advisory whose package is not listed in the table below; it also
reports listed exceptions that no longer match a live advisory so this file can be pruned.

Last reviewed: 2026-11-15 (council wave 1, W1-A, issue R17-27). Before: 19 production advisories
(2 critical, 12 high, 5 moderate). After: 1 high (below), 0 critical, 0 moderate.

| Package | Severity | Advisory                                                                                                         | Why it is accepted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Exit plan                                                                                                                                                          |
| ------- | -------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `zod`   | high     | GHSA-mrhx-c7xc-m3w5 (memory exhaustion validating oversized constrained collections; fixed only in zod >= 4.6.6) | The root `zod` is pinned to the latest 3.x (3.25.76). The fix exists only in zod 4, a breaking major: `drizzle-zod@0.7` (the `createInsertSchema` helpers in `shared/schema.ts`), `zod-validation-error@4`, and 46 server/shared/client modules use the zod 3 API (`.parse` error shapes, `z.preprocess`, `.refine` signatures, `ZodError.errors`). Exposure is limited: request bodies are capped at 1 MB (10 MB on upload routes) by the body parser before zod runs, so an attacker cannot submit the very large collections the advisory needs. | Migrate to zod 4 (with `drizzle-zod` >= 0.8 / `drizzle-orm` zod integration) as a dedicated change; the W1-B request-contract layer is the natural point to do it. |

## Fixed in this pass

Upgraded directly: `compression` 1.8.2, `nodemailer` 10.5, `pdfjs-dist` 6.5, `@vercel/blob` 2.9,
`express` 4.22.3, `csv-parse` 7.0.3. `isomorphic-dompurify` is pinned to `~3.19.0` (the last line
that supports Node 20.19, which production runs; 3.20+ and 4.x need Node 22 via jsdom 30/31) and
gets the fixed DOMPurify 3.4.18 through the override below.

Node 20.19 note: `pdfjs-dist` 6 declares `node >=22.13` but is only bundled into the browser client
by Vite (`client/src/pages/{Receipts,BankReconciliation}.tsx`); the server never loads it, so the
`EBADENGINE` warning on the Railway install path is expected. `file-type` is held at 21.x (22.x
needs Node 22).

Forced through `overrides` in `package.json` (transitive): `dompurify` ^3.4.18 (also via `jspdf`
and `@pdfme/schemas`), `proxy-addr` ^2.0.8, `body-parser` ^1.20.9, `qs` ^6.17.1, `undici` ^6.29.1 /
^7.30.2, `engine.io` ^6.6.11, `brace-expansion` ^1.1.22 / ^2.1.8, `source-map-js` ^1.2.2,
`fast-copy` ^4.3.1, `fflate` ^0.8.3, `postcss-selector-parser` ^6.1.6, `@vercel/cli-config` ^0.4.0
(pulls zod 4.6.7 for `@vercel/oidc`), and `zod` ^4.6.7 inside `@pdfme/common` (which already
depends on zod 4).

Validate the Railway install path after dependency changes:
`npx -p node@20.19.0 -p npm@10.8.2 -c "npm ci --omit=dev --ignore-scripts"`.
