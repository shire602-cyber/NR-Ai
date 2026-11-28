# Codex Task — fix Railway Volume permissions so receipt saves work (and persist)

> **Why this is urgent:** A Railway Volume was attached to the `NR-Ai` service at
> mount path `/app/uploads` to make receipt images durable. But the volume mounts
> **owned by root**, while the app runs as the unprivileged `muhasib` user (uid
> 1001). Result: **saving a receipt now fails** with
> `EACCES: permission denied, mkdir '/app/uploads/receipts'`.
>
> The fix lets the container **start as root**, chown the volume to the app user,
> then **drop privileges back to `muhasib`** in-process. The app still runs
> unprivileged at runtime. Two files change. No new dependencies.

---

## Change 1 — `Dockerfile`

Find (near the bottom, after the `COPY --from=builder ... migrations` lines):

```dockerfile
RUN mkdir -p uploads && chown -R muhasib:nodejs uploads

USER muhasib

EXPOSE ${PORT:-5000}
```

Replace with:

```dockerfile
RUN mkdir -p uploads/receipts && chown -R muhasib:nodejs uploads

# NOTE: we intentionally do NOT `USER muhasib` here. Railway mounts the durable
# uploads Volume owned by root, so the container must start as root to chown the
# mount; server/index.ts then drops privileges to the muhasib user (uid 1001)
# at startup. The app process therefore still runs unprivileged at runtime.

EXPOSE ${PORT:-5000}
```

(i.e. delete the `USER muhasib` line; the app drops privileges itself.)

## Change 2 — `server/index.ts`

**2a.** Add the import alongside the existing `fs`/`path` imports near the top:

```ts
import { execSync } from "child_process";
```

**2b.** Replace the existing "Ensure required directories exist" block:

```ts
// ─── Ensure required directories exist ───────────────────────
const uploadsDir = path.resolve(projectRoot, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  log.info(`Created uploads directory: ${uploadsDir}`);
}
```

with:

```ts
// ─── Ensure required directories exist & fix mounted-volume ownership ──
// On Railway, the durable receipt-image storage is a mounted Volume. Railway
// mounts volumes owned by ROOT, but the container runs as the unprivileged
// `muhasib` user (uid 1001) — so the app gets EACCES creating/writing inside
// the mount (e.g. `mkdir /app/uploads/receipts`). To fix this cleanly we let
// the container start as root, make the uploads tree writable by the app
// user, then DROP privileges back to that user for the rest of the process.
const uploadsDir = path.resolve(projectRoot, "uploads");
const receiptsDir = path.join(uploadsDir, "receipts");

// Must match the user/group created in the Dockerfile (muhasib:nodejs).
const APP_UID = 1001;
const APP_GID = 1001;

const runningAsRoot =
  process.platform === "linux" &&
  typeof process.getuid === "function" &&
  process.getuid() === 0;

if (runningAsRoot) {
  // We own everything right now — create the tree and hand the (root-owned)
  // volume mount over to the app user so it stays writable after we drop.
  try {
    fs.mkdirSync(receiptsDir, { recursive: true });
    execSync(`chown -R ${APP_UID}:${APP_GID} ${uploadsDir}`);
    log.info({ uploadsDir }, "Prepared uploads volume and chowned to app user");
  } catch (err) {
    log.error(
      { err: (err as Error).message, uploadsDir },
      "Failed to prepare/chown uploads volume; saves still work as root"
    );
  }
  // Drop privileges: setgid BEFORE setuid (cannot setgid once unprivileged).
  try {
    if (typeof process.setgid === "function" && typeof process.setuid === "function") {
      process.setgid(APP_GID);
      process.setuid(APP_UID);
      log.info({ uid: APP_UID, gid: APP_GID }, "Dropped privileges to app user");
    }
  } catch (err) {
    // Staying root is acceptable: the volume is already chowned and root can
    // write it, so receipt saving works — we only lose the hardening.
    log.error(
      { err: (err as Error).message },
      "Failed to drop privileges; continuing as root"
    );
  }
} else {
  // Non-root (local dev, or already-unprivileged): just ensure the dirs.
  try {
    fs.mkdirSync(receiptsDir, { recursive: true });
  } catch (err) {
    log.warn(
      { err: (err as Error).message, receiptsDir },
      "Could not create uploads directory"
    );
  }
}
```

## Gates (must pass before deploy)

```bash
npm run check        # tsc + route/contract checks — must be clean
npm run build        # vite + esbuild server bundle — must succeed
npm test             # vitest — should be all green
```

(Confirmed locally: `tsc --noEmit` exits 0 and the esbuild server bundle builds.)

## Deploy

1. Commit + push the two files to the branch Railway auto-deploys.
2. **Redeploy the `NR-Ai` service** (the Volume stays attached at `/app/uploads`).
3. Watch the deploy logs for: `Prepared uploads volume and chowned to app user`
   then `Dropped privileges to app user`. No EACCES.

## Verify (the end-to-end durability proof)

1. `GET https://nr-ai-production.up.railway.app/health/ready` → `{"status":"ok"}`.
2. In the app: **Purchases → Expenses (Receipt Scanner)** → upload an image →
   **Process** → **Save All**. It must say **saved** (no "save failed" / EACCES).
3. **Redeploy `NR-Ai` once more**, then reopen that saved receipt's image — it
   must still load. That proves images now survive redeploys on the Volume.

## Done when

Receipt save succeeds (no EACCES), the deploy logs show the privilege drop, and a
saved receipt image survives a redeploy.
