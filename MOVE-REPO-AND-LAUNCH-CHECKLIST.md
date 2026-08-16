# Muhasib — Escape the Sync Folder + Launch Checklist

**Date:** 16 August 2026
**Status after this session:** every code-level blocker from both teardown reports is fixed, verified, and committed (`6089cf56` on `main`). What remains is one 15-minute move (below) and the business items.

---

## Part 1 — Move the repo out of the synced folder (15 minutes, do this first)

Your repo lives in `~/Desktop/NR-Ai`, which a cloud-sync daemon manages. Today alone it: resurrected deleted files, created hundreds of `* 2`/`* 3` conflict copies inside `node_modules`, held file locks while tools read them, and left stale `.git/*.lock` files from a crashed git process on Aug 7 that have been silently blocking `git commit` for **nine days**. That's why work kept "disappearing."

Open **Terminal** and paste this block:

```bash
# 1. Make a home for real work, outside any synced folder
mkdir -p ~/dev

# 2. Push the current state (fixes are committed on main)
cd ~/Desktop/NR-Ai
find .git -name "*.lock" -type f -delete   # clear any stale locks first
git push origin main

# 3. Fresh clone OUTSIDE the sync zone
git clone https://github.com/shire602-cyber/NR-Ai.git ~/dev/muhasib
cd ~/dev/muhasib
npm ci
npm run check    # must be green — it is, as of commit 6089cf56
npm test         # 955 unit tests

# 4. Verify, then retire the synced copy (keep it a week as a safety net, then delete)
mv ~/Desktop/NR-Ai ~/Desktop/NR-Ai-RETIRED-DO-NOT-EDIT
```

**Important before step 2:** you have uncommitted work-in-progress in the synced copy (VAT reskin, i18n, route changes — ~60 modified files) and 3 git stashes. If you want that WIP preserved, commit it first:

```bash
cd ~/Desktop/NR-Ai
git add -A && git commit -m "wip: carry over uncommitted work before repo move"
git push origin main
```

From then on: **work only in `~/dev/muhasib`.** Never open the old folder in an editor again.

Defenses now in place even before you move: `.gitignore` blocks `* 2.*`, `.fuse_hidden*`, `.~lock.*` artifacts, and `npm run check` fails the instant a conflict copy appears in source.

---

## Part 2 — What was fixed this session (all verified live)

| # | Issue (from the teardown reports) | Fix | Proof |
|---|---|---|---|
| 1 | Clean checkout failed `tsc` — 13 orphaned UI components imported deleted packages | Deleted all 13 (zero importers each) | `npm run check` green from fresh `npm ci` |
| 2 | 5 sync-conflict duplicates (`Reports 2.tsx` etc.) breaking the build | Deleted; checker + gitignore now block recurrence | `check-no-stray-duplicates` green |
| 3 | Tracked junk: `.~lock` files, `.tmp` PDF copies | Removed from git | — |
| 4 | Malformed UUID in any URL → HTTP 500 (~59 route files affected) | Central fix: Postgres `22P02` → `400 INVALID_IDENTIFIER` in the error handler | Live probe: `GET /api/companies/not-a-uuid` → 400; +2 unit tests |
| 5 | Fatal boot log printed `{"error":{}}` — undiagnosable failed deploys | pino `err`/`error` serializers + console fallback | Forced a boot failure: full message + stack now logged |
| 6 | AI endpoints 500 without a key | Already fixed pre-session; re-verified | ai-degradation suite 13/13 |
| 7 | Nine-day-old stale `.git` locks blocking every commit | Cleared; fixes committed | commit `6089cf56` |

**Full verification, this session, on the fixed code:** `npm run check` (tsc + 7 guards) green · **955 unit tests** · production build green · live server on real Postgres 18 · **130/130 integration assertions** (fixes 18, flow 47, concurrency 9, modules 43, ai-degradation 13).

---

## Part 3 — The launch checklist (what only you can do)

In order. Items 1–2 are afternoons; 3–5 are the real gate.

1. **Move the repo** (Part 1). ~15 min. Everything else is unsafe until this is done.
2. **Configure object storage (Vercel Blob — you already use Vercel/Neon).** ~15 minutes:
   - Vercel dashboard → your project → **Storage** tab → **Create Database** → **Blob** → create a store.
   - It generates `BLOB_READ_WRITE_TOKEN` — copy it.
   - Add `BLOB_READ_WRITE_TOKEN` to your production host's environment variables (Railway → your service → Variables, if that's where the server runs) and redeploy.
   - Verify: the boot log warning "Receipt image storage is EPHEMERAL" disappears. Done.
3. **Turn on the AI (you have the key).** ~10 minutes to wire, then a week of watching:
   - Add to production env: `OPENAI_API_KEY=sk-...` (and optionally `AI_MODEL` to pin a model). Redeploy.
   - Verify: boot log no longer says "AI routes registered without OpenAI"; `/api/ai/*` stops returning 503.
   - Then the real test: run ~100 real receipts through categorization. Is the suggested account right? What does each cost? Does the 0.9 autopilot threshold hold? You're selling AI — this is the first time anyone watches it work.
4. **Sign the accredited ASP contract.** The e-invoice adapter is written and tested; without the contract you legally cannot transmit. The <AED 50m filer deadline is **31 Mar 2027** — this is the only item with an external clock.
5. **File one real VAT 201 with a real accountant** and reconcile Muhasib's figures against what was actually submitted to the FTA. All 130 integration assertions verify the engine against fixtures we wrote — one real return is worth all of them.
6. *(post-launch)* Consolidate 113 screens → ~20. Do this after a design partner tells you which 20 they live in — not before.

When 1–5 are done, you're launch-ready. The engine has been through four adversarial teardowns and holds. The remaining distance is logistics, not engineering.
