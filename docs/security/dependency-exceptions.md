# Production dependency audit exceptions

`npm audit --omit=dev` must show no critical or high advisories. `scripts/qa/audit-gate.mjs` (run in
CI) fails on any critical/high advisory whose package is not listed in the table below; it also
reports listed exceptions that no longer match a live advisory so this file can be pruned.

Last reviewed: 2026-11-16 (re-audit fix loop F3, issue R17-27). `npm audit --omit=dev`: 0 critical,
0 high, 0 moderate. There are no accepted exceptions.

| Package | Severity | Advisory | Why it is accepted | Exit plan |
| ------- | -------- | -------- | ------------------ | --------- |

## Resolved exceptions

- `zod` high, GHSA-mrhx-c7xc-m3w5 (memory exhaustion validating oversized constrained
  collections; fixed only in zod >= 4.6.6). Resolved in F3 by upgrading to `zod` ^4.6.7 with
  `drizzle-zod` 0.8 and `@hookform/resolvers` 5. Validation keeps the zod 3 accept/reject
  behaviour and error responses: `shared/zod-config.ts` installs the zod 3 English messages,
  `shared/schema.ts` builds insert schemas with `z.guid()` for uuid columns and optional
  custom-type (money/rate) columns as drizzle-zod 0.7 did, `client/src/lib/zod-resolver.ts`
  keeps the 3.x resolver typing, and `server/http/strict-body.ts` drops the length issue zod 4
  adds after a type mismatch. Regression: `tests/unit/zod4-upgrade.test.ts`.

## Fixed in this pass

Upgraded directly: `compression` 1.8.2, `nodemailer` 10.5, `pdfjs-dist` 6.5, `@vercel/blob` 2.9,
`express` 4.22.3, `csv-parse` 7.0.3. `isomorphic-dompurify` is pinned to `~3.19.0` (the last line
that supports Node 20.19, which production runs; 3.20+ and 4.x need Node 22 via jsdom 30/31) and
gets the fixed DOMPurify 3.4.18 through the override below.

Node 20.19 note: `pdfjs-dist` 6 declares `node >=22.13` but is only bundled into the browser client
by Vite (`client/src/pages/{Receipts,BankReconciliation}.tsx`); the server never loads it, so the
`EBADENGINE` warning on the Railway install path is expected.

Forced through `overrides` in `package.json` (transitive): `dompurify` ^3.4.18 (via `jspdf`), `proxy-addr` ^2.0.8, `body-parser` ^1.20.9, `qs` ^6.17.1, `undici` ^6.29.1 /
^7.30.2, `engine.io` ^6.6.11, `brace-expansion` ^1.1.22 / ^2.1.8, `source-map-js` ^1.2.2,
`fast-copy` ^4.3.1, `fflate` ^0.8.3, `postcss-selector-parser` ^6.1.6, `@vercel/cli-config` ^0.4.0
(pulls zod 4.6.7 for `@vercel/oidc`).

Validate the Railway install path after dependency changes:
`npx -p node@20.19.0 -p npm@10.8.2 -c "npm ci --omit=dev --ignore-scripts"`.
