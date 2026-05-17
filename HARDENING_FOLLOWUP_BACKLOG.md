# Hardening Follow-Up Backlog

## Audit Items Remaining After Production Gate

- Moderate npm audit findings remain in `@anthropic-ai/sdk`, `vite`/`esbuild`, `drizzle-kit`, `exceljs`/`uuid`, `googleapis`, and `resend` dependency chains. `npm audit --audit-level=high` is clean; removing the remaining findings needs breaking upgrades or package swaps.
- `npm run lint` passes with warnings. Most are pre-existing unused imports, React compiler warnings, and Fast Refresh warnings. The production gate allows these warnings, but they should be reduced so new warnings become meaningful.
- The new browser spreadsheet path uses `exceljs`, which is audit-clean at high severity but creates a large `vendor-spreadsheet` chunk. Consider moving generic client exports to server-generated XLSX files if bundle size becomes a priority.

## Recommended Next Batch

- Upgrade `@anthropic-ai/sdk` after checking API compatibility.
- Plan a Vite/esbuild major upgrade separately from this security batch.
- Replace or isolate `exceljs` if the moderate `uuid` advisory becomes unacceptable.
- Clean lint warnings by subsystem, starting with auth/client portal files touched in this hardening batch.
- Add browser/e2e tests for cookie login, refresh after access expiry, logout cache clearing, and client portal navigation.
