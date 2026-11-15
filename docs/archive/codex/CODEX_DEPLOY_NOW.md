# Codex Command — deploy storage + receipt-upload fixes

> Paste below the line into Codex. Tested commits, no migration.

---

## Context
Repo `github.com/shire602-cyber/NR-Ai`, branch **`fix/p0-correctness-and-security`**.
Production serves `1fdab3f7`. **Three new commits** since then:

- `79203dc0` fix(receipts): EACCES mkdir '/uploads' — resolve uploads root from cwd
- `f4fba0c6` feat(storage): durable S3-compatible receipt-image storage (R2/S3)
- `f1e06374` fix(receipts): handle HEIC uploads, warn before losing unsaved, show real save errors

Branch may be slightly behind main; the reconcile step pulls main back in.
**No database migration is needed.** Adds the `@aws-sdk/client-s3` dependency
(installed automatically by `npm install` on deploy).

## Operating rules
1. Push only the branch's commits; don't sweep unrelated dirty worktree files.
2. Gate before deploy — all must pass: `npx tsc --noEmit` · `npm run check` ·
   `npm run test` (~868 pass, 1 skipped) · `npx vite build`.
3. Deploy only if green. Rollback to `1fdab3f7` is safe (no migration).

## CRITICAL deploy lesson
After deploying, **redeploy the app services — `NR-Ai` and `NR-Ai-Backend`** —
not just Postgres. Confirm `/api/version` shows the new commit and
`/health/ready` is `"database":"ok"`.

## Tasks
1. **Push**: `git push origin fix/p0-correctness-and-security` (if the index is
   dirty from a stale lock: `rm -f .git/index.lock && git reset` first).
2. **Reconcile + deploy**: merge `origin/main` into a clean deploy branch
   (keep BOTH sides on any `POSTABLE_VAT_CATEGORIES` conflict). Run the gate,
   deploy only if green, **redeploy the app services**, verify `/api/version` +
   `/health/ready`.
3. **Smoke tests** on production:
   - **EACCES fixed:** in Receipts, scan a receipt image and **Save** it —
     should succeed (no "permission denied, mkdir '/uploads'").
   - **HEIC:** upload an iPhone HEIC photo → it should convert and save (or show
     a clear message in a non-Safari browser), not "Invalid image MIME type".
   - **Unsaved guard:** with extracted-but-unsaved receipts on screen, try to
     refresh → browser warns before leaving.

## After deploy — set up DURABLE storage (owner, ~10 min)
The EACCES fix alone saves images to the container's *ephemeral* disk (lost on
redeploy). To make receipt images durable, create an S3-compatible bucket
(Cloudflare R2 recommended — cheap, free egress) and set on the `NR-Ai` service:
`S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`
(R2: `https://<account>.r2.cloudflarestorage.com`), `S3_REGION=auto`. The admin
integration-status page will then show storage as "S3-compatible bucket". (This
is also the prerequisite for any Vercel move — see docs/VERCEL_MIGRATION.md.)

## Done when
Three commits live; `/health/ready` = ok; a receipt image saves without EACCES;
gate green.
