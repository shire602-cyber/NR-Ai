# Muhasib.ai — Next Steps Plan

_Snapshot + prioritized roadmap. Living doc._

## Where we are (what's live / built)

**Live in production** (`229d8a4e`, + the date fix `a19d0afd` deploying now):
- Accounting engine hardened (void/credit-note/payment correctness, FX, financial
  statements), security pass, scale/observability/reliability baselines, legal +
  support pages.
- **Full VAT→ledger posting matrix**: sales (standard/zero-rated/exempt), standard
  purchases, reverse-charge, and imports all post correct, balanced double-entries
  that tie to the VAT 201. Manual rows post on demand; deleting a row reverses it.
- VAT workpaper grid usability: formula amount fields, row edit/delete with sticky
  actions, date-defaults.
- Decluttered dashboard (the one screen that read as "too much").

**Built and tested, dormant until you flip a switch:**
- **Email document intake pilot** — end to end: clients email docs → inbound
  webhook → OCR → autopilot drafts the books → completeness check vs bank feed →
  document chasing → firm review UI. Needs a provider + secret to go live (Phase 1).

---

## Phase 1 — Activate what's already built (days, owner setup, ~no code)

1. **Turn on email intake.** Pick a provider (Mailgun / Postmark / SendGrid
   Inbound Parse), set `EMAIL_INTAKE_WEBHOOK_SECRET`, point it at
   `POST /api/webhooks/email-intake`, set `EMAIL_INTAKE_ENABLED=true`. Then, in the
   firm UI (`/firm/email-intake`), link each client's sender email to their company.
   → The whole intake pipeline goes live with zero further code.
2. **Wire Sentry** (error tracking): create a project, set `SENTRY_DSN`. The
   capture seam is already in place; add the SDK + forward call (small).
3. **Housekeeping:** delete the leftover `SMOKE-…` rows in-app (also proves the
   delete-reversal once more).

## Phase 2 — Go-live readiness → private beta (1–2 weeks, owner secrets + light code)

From `LAUNCH_READINESS.md` — all owner inputs, enforcement already coded/tested:
1. **Email delivery:** `RESEND_API_KEY` (or SMTP) → activates resets, invoice send,
   chasing.
2. **Stripe:** keys + 8 price IDs, test a checkout, then flip
   `BILLING_ENFORCEMENT=true` **last**.
3. **Domain:** buy + point DNS at Railway, set `FRONTEND_URL` (feeds CORS + reset
   links).
4. **Web push:** `npx web-push generate-vapid-keys`, paste both.
5. **Bank feed:** choose Tarabut / Dapi / Salt Edge / Lean, sandbox creds (the
   adapter + reconciliation are ready — and bank recon is what powers the intake
   completeness check).
6. Then open a **private beta** to a handful of real companies.

## Phase 3 — Run the email-intake pilot (the 6-month proof, owner-led)

Per `EMAIL_INTAKE_PILOT.md` §7 — NR Accounting's own clients only, controlled:
- Track a per-return scorecard: extraction accuracy (total/VAT/date/TRN),
  sales-vs-purchase classification precision, completeness (no period filed with a
  known unreconciled gap), and **time saved per return** (the headline ROI).
- Parallel VAT run for one period (Muhasib + incumbent) before switching a client.
- Week-1 daily backup/restore drill (`BACKUP_RESTORE_DRILL.md`).
- Exit gate before any public release: the scorecard targets hold for ≥6 months.

## Phase 4 — E-invoicing compliance (the big strategic item, deferred)

Per `EINVOICING_PLAN.md`. UAE FTA mandate (Peppol 5-corner / PINT-AE) is the
load-bearing future requirement. The provider-agnostic adapter seam is built; the
generated XML validates against the PINT-AE shape locally. Remaining:
1. **Pick + sign an accredited ASP** (aggregator recommended for go-live, e.g.
   Complyance; Flick as accredited fallback) — owner decision/contract.
2. Build the real ASP adapter against their sandbox (submit → status → webhook).
3. Endpoint/EAS handling, full `<CreditNote>` validation, then live submission.
   Until then the honest public claim stays **"e-invoice ready / PINT-AE / Peppol-
   ready,"** not "compliant."

## Ongoing — depth & competitiveness (parallel, code)

- **T2 golden-ledger CI tests:** DB-backed integration tests on the money paths
  (invoice→payment→credit-note→void, VAT-row→post→reverse). Needs a Postgres CI
  job; then the suite guards every posting path against regressions.
- **Remaining VAT edge categories** (tourist refund, reverse-charge output, import
  adjustment) — only if clients need them; kept manual for now by design.
- **Competitive parity** (`COMPETITIVE_ROADMAP.md`): continue closing gaps vs
  Wafeq / Zoho / QuickBooks where they matter for UAE SMEs.

---

## Recommended order of operations

1. **Deploy the date fix** (in progress).
2. **Phase 1** — flip on email intake + Sentry; it's the biggest capability unlock
   for the least effort (the code's done).
3. **Phase 2** — Stripe + email + domain → **private beta**.
4. **Phase 3** — run the intake pilot on NR's clients while beta hardens.
5. **Phase 4** — start the ASP conversation now (long lead time), build once signed.

The single highest-leverage move right now: **activate email intake (Phase 1).**
Everything for it is built and tested — it just needs a mailbox provider and a
secret to become a real, differentiating feature.
