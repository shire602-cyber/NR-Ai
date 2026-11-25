# Muhasib — Fourth System-Wide Teardown & Launch Verdict

**Date:** 16 August 2026
**Method:** clean dependency install → typecheck + guard scripts → 950 unit tests → production build → live server on a real Postgres 18 with real HTTP → the full integration suite → a fresh adversarial probe of my own → the production security verifier.
**Branch under test:** `codex/launch-hardening-main-sync` (working tree, uncommitted).

---

## The verdict: **Not launch-ready.**

Same headline as the third teardown, and mostly for the same reasons — which is itself the story. Since 13 August the commit log is almost entirely **Arabic i18n and a VAT-form reskin**. Nice polish. **None of it moved a single launch blocker.** Meanwhile the working tree you'd merge today fails your own CI gate on two independent counts.

To be clear about what is *not* the problem: **the accounting engine is genuinely strong.** I attacked it with parallel writes, malformed UUIDs, SQL-ish injection, script tags, negative prices, 500% tax rates, cross-tenant reads and privilege escalation. The ledger balanced every single time and every adversarial input came back a clean 4xx. This is a better-tested engine than most products that *do* launch. The things blocking you are around it, not in it.

---

## What's green (and it's a lot)

| Gate | Result |
|---|---|
| Unit tests (vitest, 84 files) | **950 passed, 1 skipped, 0 failed** |
| Integration — `fixes` (live server) | **18/18** |
| Integration — `flow` (VAT 201, financials, IDOR) | **47/47** |
| Integration — `concurrency` | **9/9** |
| Integration — `modules` (payroll/bank/bills/VAT box 9) | **43/43** |
| Integration — `ai-degradation` | **13/13** |
| My fresh adversarial probe | **12/13** (1 real finding, below) |
| Production build (vite + esbuild) | **passes** |
| Guard scripts (money-types, route-shadowing, api-contract, …) | **6/6 pass** |
| Production security verifier | **passes** (one advisory: set `JWT_SECRET_ROTATED_AFTER_BACKDOOR`) |

Concurrency held where ledgers actually break: 10 parallel "issue" calls recognised revenue **once**, 5 parallel credit notes produced **one**, negative journal lines were rejected, and a `companyType` self-promotion was ignored rather than 500'ing. Cross-tenant reads of invoices, balance sheets and individual records were all denied.

---

## The roast — what's actually wrong

### 1. Your CI gate is red on this branch right now 🔴 (blocks merge, not just launch)
Someone slimmed the bundle by deleting 13 UI dependencies from `package.json` (`@radix-ui/react-aspect-ratio`, `embla-carousel-react`, `vaul`, `input-otp`, `react-resizable-panels`, `html2canvas`, and 7 more) **but left the 13 `client/src/components/ui/*.tsx` files that import them.** From a clean `npm ci` — which is exactly what CI and Docker run — `tsc` fails with **13 "Cannot find module" errors**, so `npm run check` (the "Typecheck · Test · Build" job) goes red.

The good news: all 13 orphaned components have **zero importers**. Delete them and it's fixed. This is not a design problem, it's an unfinished edit sitting in your working tree.

### 2. Sync-conflict rot is back — for the third teardown running 🔴
`check-no-stray-duplicates` caught **5 cloud-sync duplicate files** that break `tsc`:
`useHealthCheck 2.ts`, `pdf-invoice 2.ts`, `whatsapp-templates 2.ts`, `Reports 2.tsx`, `WhatsAppDashboard 2.tsx`.
The repo still lives in a synced Desktop folder — there are `.fuse_hidden*` files, `.~lock.*` files and a stray git stash littered through the tree (122 dirty paths). **I have now told you three times: move this repo out of the synced folder.** Every teardown, the sync layer manufactures a new build-breaker.

### 3. NEW: a malformed ID in any URL returns a 500 🟠 (low severity, class bug)
`GET /api/companies/not-a-uuid` throws a raw Postgres `22P02 invalid input syntax for type uuid`, which surfaces as **HTTP 500 `INTERNAL_ERROR`**. There's no UUID-guard on path params, and **~59 route files** pass `:id`/`:companyId` straight to a DB query, so this is a whole class of trivially-triggered 500s.

Not a security hole — the response is generic, nothing leaks — but it's a self-inflicted 500 that pollutes error tracking and hands anyone a one-request way to spam your logs. Fix once, centrally: a `z.string().uuid()` guard on path params, or map `22P02` → 400 in the error handler.

### 4. Your fatal-crash log is blind on the one line that matters 🟠
When the production server fails to boot it logs `{"error":{}}` — an **empty object, no message, no stack** — because `log.fatal({ error }, "Failed to start server")` hands pino a key it doesn't serialise. During a real failed deploy at 2am, this log tells your on-call *nothing*. I literally had to patch the compiled bundle to find out why the server wouldn't start. Change the key to `err` (pino's std serializer) or serialize the error explicitly.

### 5. Test coverage is flat and the effort went elsewhere 🟡
Unit count is **950**, essentially unchanged from the 953 reported on 13 August. The modules the last teardown flagged as thin — bank reconciliation, expense claims, cost centres, recurring invoices, credit-note edge cases — are still thin (the new `modules` integration test does now exercise payroll, bank and bill-pay, which is real progress). The point stands: three days of work bought Arabic translations and a prettier VAT form, not coverage on the modules most likely to hide a money bug.

---

## The launch blockers — unchanged, and still not code

These are the same two from the third teardown. Nothing this cycle touched them.

| Blocker | Why it blocks launch | Owner |
|---|---|---|
| **No accredited ASP contract** | You legally cannot transmit a UAE e-invoice without one. The adapter is written and tested; this is a signature, not code. | You |
| **No design partner has filed a real return** | Every VAT 201 figure is verified against fixtures written in-house. Until a real accountant reconciles a Muhasib return against one they actually filed with the FTA, the only test that counts hasn't been run. | You + 1 accountant |

---

## What I'd do before you say the word "launch"

1. **Delete the 13 orphaned `components/ui/*.tsx` files** (or re-add the deps) so `npm run check` passes from a clean `npm ci`. *~10 minutes.*
2. **Delete the 5 `* 2.ts` sync duplicates and move the repo off the synced Desktop folder.** *~10 minutes, and it stops recurring.*
3. **Add a UUID path-param guard** (or map `22P02` → 400). Kills a class of 500s. *~30 minutes.*
4. **Fix the fatal-startup logger** (`error` → `err`). *~2 minutes, saves hours during a bad deploy.*
5. **Sign the ASP contract** and **get one accountant to reconcile one real VAT 201.** *This is the whole ballgame.*

Items 1–4 are an afternoon. Item 5 is the launch. The engine is ready; the paperwork and the one real-world reconciliation are not.

---

*All figures above were produced this session against a live server + real Postgres 18, not from cached reports.*
