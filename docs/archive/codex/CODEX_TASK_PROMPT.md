# Codex Task Prompt — Muhasib.ai / NR-Ai (remaining work)

> Paste everything below the line into Codex. It does the preparation and
> **pauses for you** at every secret, credential, or irreversible confirmation —
> you enter the value (or set it in the environment) and say "continue".

---

## Repo & branch

You are an autonomous engineer + operator on **Muhasib.ai**
(`github.com/shire602-cyber/NR-Ai`): React/Vite client + Node/Express/TypeScript
server, Drizzle ORM on Postgres, deployed on Railway.

- Work on **`fix/p0-correctness-and-security`** (already pushed to origin).
- Read these first — they're the source of truth and say what's already done:
  `docs/EMAIL_INTAKE_PILOT.md`, `docs/PRODUCTION_HARDENING.md`,
  `docs/LAUNCH_READINESS.md`, `docs/BACKUP_RESTORE_DRILL.md`, `docs/TRUST.md`,
  `docs/EINVOICING_PLAN.md`.

## Operating rules (important)

1. **Pause for me at every secret / credential / irreversible action.** Never
   type my passwords, API keys, DB URLs, OAuth secrets, or card details, and
   never invent them. State exactly what you need and where it goes (the exact
   env-var name), then STOP and wait for me to set it or paste it.
2. **Don't do prohibited things yourself**: don't rotate secrets, change access
   controls, run a production migration without my explicit go, execute
   payments, accept ToS, or grant OAuth on my behalf. Prepare and hand off.
3. **Verification gate before every commit — all must pass:**
   ```
   npx tsc --noEmit
   npm run check        # tsc + bundle hygiene + route registration + api contract
   npm run test         # vitest — expect ~850 passing, 1 skipped
   ```
   For client changes also run `npx vite build` (to a temp dir if `dist/` can't
   be cleared).
4. **Commit in small, labelled steps**; keep the branch green; push when asked.
5. **Match existing patterns**: provider seams (`einvoice-provider.ts`,
   `email-intake-provider.ts`), pure-function + unit-test style, firm-gating via
   `requireFirmRole`, migrations registered in `migrations/meta/_journal.json`.
6. Report what changed and what's left after each task.

## Already DONE — do not rebuild (all on the branch)

- Accounting-correctness + security hardening; scale (S); observability seam
  (`monitoring.ts`, O1/O2); reliability (R); money-path tests (T1); legal/support
  pages (L1).
- **Email-intake pilot** (backend + firm UI at `/firm/email-intake`), behind the
  `EMAIL_INTAKE_ENABLED` flag (off) and firm-gated. Mailbox source is still the
  no-op `UnconfiguredEmailIntakeSource` — see Task 3.
- **VAT workpaper grid fixes**: amount fields act as a calculator
  (`evaluateAmountExpression`), row edit/delete with sticky action column.
- **VAT→ledger posting**: manual VAT *sales* rows post to the GL
  (`vat-workpaper-posting.ts` + `postVatWorkpaperRowToLedger`), idempotent,
  reversed on delete. Migrations `0084_email_intake` and
  `0085_vat_row_journal_link` are in the repo.

---

## TASKS (in order)

### Task 1 — Apply database migrations
Migrations to apply: `0084_email_intake` (new intake tables) and
`0085_vat_row_journal_link` (`vat_workpaper_rows.journal_entry_id`). Both are
additive + safe (new tables + one nullable column).

- Command (dev/drizzle): `DATABASE_URL=<from-env> npm run db:migrate`.
  Production-style: `node dist/migrate.js` (runs migrations + `ensureCriticalSchema()`).
- **STOP and confirm with me which database** before running: **staging first**,
  production only after the Task 2 smoke test passes.
- **Get `DATABASE_URL` from the environment — do not paste it in chat.** I'll set
  it in the shell/Railway env; you say it's set and proceed.
- After staging migrate, verify the new objects exist: tables
  `client_email_sources`, `email_intake_messages`, `email_intake_documents`, and
  column `vat_workpaper_rows.journal_entry_id`.

### Task 2 — Smoke-test the demo-critical flows on staging
On the staging deploy, confirm end to end (these are what I'm demoing):
1. **VAT calculator**: in the VAT workpaper entry grid, type `7800+1850` in an
   amount field → it resolves to `9650`.
2. **Row edit/delete**: edit an existing row; delete a row; confirm the Actions
   column stays visible when the grid scrolls horizontally (sticky).
3. **VAT→ledger posting** (the big one): add a manual **standard sale**, net
   `100`, VAT `5`, click **Post**. Then verify it shows across the books:
   - a journal entry exists: Dr Accounts Receivable 105 / Cr Sales Revenue 100 /
     Cr Output VAT 5;
   - it appears in the P&L (revenue +100) and balance sheet (AR +105, VAT
     payable +5);
   - deleting the row removes/reverses that journal entry;
   - re-posting the same row is blocked (idempotent).
   Report anything that doesn't tie out.

### Task 3 — Build a real mailbox adapter (main remaining code work)
The intake pipeline has no input source yet. Implement **one** `EmailIntakeSource`
against `server/services/email-intake-provider.ts` and register it in
`getEmailIntakeSource`. Recommended: an **inbound-webhook adapter**
(Mailgun/Postmark-style):
- Add `POST /api/webhooks/email-intake` that the provider calls with the parsed
  email + attachments. **Verify the provider's HMAC signature on every request**;
  reject unsigned.
- Map the payload to `RawInboundMessage[]` and run it through the existing
  `pollEmailIntakeOnce` pipeline (routing, gating, dedup, OCR, autopilot).
- Add the signing secret env var (e.g. `EMAIL_INTAKE_WEBHOOK_SECRET`) in
  `server/config/env.ts`; set `EMAIL_INTAKE_PROVIDER=inbound`.
- Unit-test the pure parts (signature check, payload→RawInboundMessage mapping).
- Alternative (ask me first): a Gmail-API / IMAP **poller** wired into
  `server/services/scheduler.service.ts` instead of a webhook.

**Pause points:** creating the mailbox/provider account, the signing secret, and
the env vars — STOP, name the exact variables, wait for me.

### Task 4 — Schedule the poll (only if Task 3 is pull-based)
If you built a poller (not a webhook), wire `pollEmailIntakeOnce` into
`scheduler.service.ts` (~every 15 min), guarded by `isEmailIntakeEnabled()`.
Skip if webhook-based.

### Task 5 — Observability: wire the error tracker (O3)
`monitoring.ts` already has the `captureException` seam + an env-gated forward
hook. Add Sentry: `npm i @sentry/node`, init in `server/index.ts`, fill the
forward block so it forwards when `SENTRY_DSN` is set (no-op otherwise). Add an
uptime monitor on `/health/ready`.
**Pause:** I'll create the Sentry project and set `SENTRY_DSN` — name the var, wait.

### Task 6 — Launch-ops env (L2) — you prepare, I enter secrets
Per `docs/LAUNCH_READINESS.md`, walk me through each integration: explain what it
unlocks, get me to the exact provider screen, name the exact Railway variable(s),
then STOP while I set them. Order:
1. **Email** — `RESEND_API_KEY` (+ `RESEND_FROM`) or `SMTP_*`.
2. **Stripe** — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, the 8
   `STRIPE_PRICE_*` IDs. Test a checkout. **Set `BILLING_ENFORCEMENT=true` LAST**,
   only after a successful test and my explicit confirm.
3. **Web push** — `npx web-push generate-vapid-keys`, I paste both keys.
4. **Domain** — point DNS at Railway, set `FRONTEND_URL` (also feeds CORS + reset
   links).
5. **Bank feed** — pick Tarabut/Dapi/Salt Edge/Lean, sandbox creds.
Never enter these values yourself — prepare and pause.

### Task 7 — DB-backed golden-ledger tests (T2)
Extend the CI Postgres-job pattern (the `credit-note-consolidation` integration
test) with end-to-end posting tests asserting debits = credits and final
balances: invoice → payment → credit-note → void, **and** VAT-row → post →
delete-reverses. Skip cleanly when no DB is present, like the existing one.

### Task 8 — shire602 admin-revoke migration (my decision)
`docs/proposed-migrations/revoke-shire602-admin.sql` exists. Access-control change
with self-lockout risk. **Do not apply it.** Summarise what it does + the risk,
then wait for my explicit yes/no.

---

## Definition of done
- Migrations `0084` + `0085` applied to the DB I chose; staging smoke test
  (Task 2) passes, including VAT-row posting tying out across journal/P&L/balance
  sheet.
- A working mailbox adapter ingesting real email through the pipeline, with
  `EMAIL_INTAKE_ENABLED=true` and the mailbox connected.
- Sentry receiving errors; uptime monitor live.
- Email + Stripe (+ enforcement) + push + domain configured; a real test
  transaction passes.
- `npx tsc --noEmit`, `npm run check`, `npm run test` all green; client builds.
- Every secret was entered by me, never by you.
