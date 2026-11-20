# Muhasib — System-Wide Test & Launch Verdict

**Date:** 14 August 2026
**Pitch under test:** "AI accounting and bookkeeping software"
**Method:** fresh clone, full build, real Postgres, whole-surface HTTP sweep, AI attack.

---

## THE VERDICT: not launch-ready. Two blockers, and one of them is on fire.

I'll give you the number first because you've earned a straight answer: **the accounting engine is ~90% and genuinely good. The product as a shippable thing is maybe 40%. And the repository itself is actively broken right now.**

Here's what a fresh clone did the moment I ran it, before I tested a single feature:

```
$ npm run check
client/src/components/ui/toggle-group.tsx(1,1743): error TS1127: Invalid character.
... exit 2
```

**The build fails. Today. On a clean checkout.**

---

## 🔴 BLOCKER 1 — Your repository is being corrupted by cloud sync, live, as you work

This is the single most important sentence in this document: **you are developing a production financial system inside a folder that a cloud-sync daemon is scrambling.**

Evidence, gathered today from the real repo:

- **Files I deleted are back.** `toggle-group.tsx`, `pagination.tsx`, `slider.tsx`, `WhatsAppDashboard.tsx` (58 KB), `Landing.tsx` (60 KB) — all resurrected. My cleanup was silently reverted.
- **Tracked files are overwritten with garbage.** `toggle-group.tsx` is now 1,751 bytes on a **single line** of binary junk. `git status` shows it Modified. That is not source code any more.
- **Conflict duplicates are multiplying.** Eight right now, including `Reports 2.tsx` (a copy of your 21,000-line file), `pdf-invoice 2.ts`, `_journal 2.json` — a duplicate of the file that decides which database migrations run against customer books.
- **Files are locked mid-write.** `grep` returned `Resource deadlock avoided` on five files — the sync process had them open while I read.

I had to remove **~18 corrupt/resurrected files** just to get a clean build in my test copy. In the real folder they will come back, because the daemon is still running.

**Nothing else on this list matters until this is fixed.** Every correctness fix I have made across five rounds is at risk of being silently reverted or corrupted. You cannot ship, cannot even reliably `git commit`, from a scrambled tree.

**The fix is one afternoon and zero code:**
1. `git clone` the repo to a path **outside** iCloud/Dropbox/OneDrive (e.g. `~/dev/muhasib`).
2. Work there. Push to a real remote (GitHub).
3. Delete the synced copy.
4. I added `scripts/check-no-stray-duplicates.mjs` to `npm run check` — it will now fail the build the instant a conflict file appears, so you find out immediately instead of at 2am.

---

## 🟠 BLOCKER 2 — The "AI" in "AI accounting software" is unproven, and was crashing

You are selling AI. So I pointed the test at the AI. Two things:

### It was returning HTTP 500 on its headline features

With no `OPENAI_API_KEY` configured — which is the state of every environment until you provision the key — I called the marquee AI endpoints:

| Endpoint | Was | Now |
|---|---|---|
| `/api/ai/cfo-advice` | **500** | 503 |
| `/api/ai/detect-anomalies` | **500** | 503 |
| `/api/ai/forecast-cashflow` | **500** | 503 |
| `/api/ai/parse-bank-statement` | **500** | 503 |
| `/api/ai/nl-gateway` | **500** | 503 |

Every route hardcoded `res.status(500)` in its catch, ignoring the 503 the code intended. So the product named after AI answered its AI features with "Internal Server Error." **Fixed** — all AI endpoints now degrade to a clean `503 AI_NOT_CONFIGURED`, and I added `tests/integration/ai-degradation.test.mjs` (13 assertions) so it can't regress.

### The good news: the AI architecture is actually sound

Reading the code, the AI design is more careful than most:

- **Hallucination guard.** When the model suggests an expense account, the code validates it against the company's *actual* chart of accounts and rejects anything it invented (`ai.routes.ts:173-179`).
- **Internal classifier first.** `/categorize`, `/reconcile`, `/batch-categorize` run a local classifier and only call OpenAI below 0.8 confidence — so they work, and cost nothing, without a key.
- **Auto-posting is gated three ways.** The receipt autopilot only posts a journal entry itself when: the company opted in, the rule was human-accepted ≥5 times, AND confidence ≥0.9. It never silently books low-confidence AI guesses.

### The catch: I could not test any of it for real

**There is no OpenAI key in any environment, so the live AI has never run in my testing.** Every AI claim above is from reading code, not from watching it categorize a real receipt or draft real CFO advice. For a product whose *name* is the AI, that is the biggest unknown on the board. Before launch you need a key, a budget, and a human checking that the categorizations are actually good — because "the code validates the account exists" is not the same as "the AI picks the *right* account."

---

## What I tested this round, and what held

Fresh clone → `npm ci` → `npm run check` (after removing sync corruption) → 954 unit → build → migrate → boot → full sweep.

| Area | Result |
|---|---|
| **37 read endpoints across every module** | **0 returned 500** |
| Health (`/api/version`, `/health`, `/health/ready`, `/health/live`) | all 200 |
| Auth enforcement on sensitive routes | POST without a token → 403 (no leaks; the one flagged was a GET on a POST-only route) |
| **All 5 integration suites** | **130 assertions, 0 failures** |
| Unit tests | 954 pass |
| CI guards | 7, all green (money-types, migration-journal, no-stray-duplicates, route-shadowing, bundle, routes, api-contract) |

The accounting core — double entry, VAT-to-GL reconciliation, concurrency locks, tenant isolation, corporate tax, the eleven modules fixed last round — all held.

---

## The scoreboard hasn't moved where it counts

| Metric | Baseline | Now | Target |
|---|---:|---:|---|
| Integration assertions | 0 | **130** | — |
| Unit tests | 939 | **954** | — |
| Reads that 500 | — | **0 / 37** | 0 ✓ |
| AI endpoints crashing (no key) | 4 | **0** | 0 ✓ |
| **Client routes** | 113 | **113** | **20** |
| **Nav destinations** | 61 | **61** | **12** |
| **Largest file** | 21,779 | **21,779** | **800** |
| Real VAT returns filed | 0 | **0** | ≥1 |
| Signed ASP contract | ✗ | ✗ | ✓ |
| Live AI verified with a key | ✗ | ✗ | ✓ |

---

## Launch readiness, by dimension

| Dimension | Score | Why |
|---|---:|---|
| **Ledger correctness** | 90% | Five teardowns, 24 defects fixed, all test-backed. Peripheral endpoints still under-tested. |
| **AI (the actual pitch)** | 35% | Architecture sound, degradation fixed — but never run live, never cost-tested, never quality-checked against real receipts. |
| **Reliability / ops** | 30% | **Repo is corrupting itself.** No object storage configured (receipt images are ephemeral). No real deployment shakedown. |
| **Compliance** | Blocked | Code ready, ASP unsigned. 31 Mar 2027 deadline. No real return filed. |
| **Product** | 40% | 113 screens, zero customers. Correct ≠ chosen. |

**Weighted: this is a strong engine in a broken workshop, wearing a badge for a feature nobody has watched work.**

---

## What "launch-ready" actually requires, in order

1. **Get the repo out of the sync folder — today.** Nothing is safe until this is done. One afternoon, zero code.
2. **Provision an OpenAI key and actually use the AI.** Categorize 100 real receipts. Measure: are the accounts right? What does it cost per transaction? Does the autopilot's 0.9 threshold hold up? Right now your headline feature is a black box you've never opened.
3. **Configure object storage** (`S3_BUCKET` or `BLOB_READ_WRITE_TOKEN`). Receipt images are on ephemeral disk and vanish on redeploy — the server literally warns about this on boot.
4. **Sign the ASP.** Only item with an external clock.
5. **File one real VAT return** with a real accountant and reconcile it.
6. **Then delete.** 113 → 20 screens. Not before.

Say "launch-ready" when items 1–5 are done. You are currently blocked at item 1 — a fresh clone doesn't build.

---

## The one line

**The accounting is the best it's ever been and the repository is the worst — it's overwriting your fixes with garbage while you read this, and the AI you're selling has never once run in a test.** Move the repo, turn on the AI, and file one real return. Then we can talk about launch.

---

### Reproduce

```bash
git clone <repo-OUTSIDE-a-sync-folder> && cd muhasib
npm ci && npm run check      # must be green on a clean clone — today it is not
npm test                     # 954 unit
npm run build && node dist/migrate.js
RL_API_MAX=100000 RL_READ_MAX=100000 npm start &
BASE_URL=http://127.0.0.1:5000 npm run test:integration   # 130 assertions
```
