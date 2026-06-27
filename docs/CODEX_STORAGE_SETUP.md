# Codex Task — set up durable receipt-image storage (R2 / S3)

> Paste below the line into Codex. Goal: make receipt images durable. The code is
> already deployed; this is pure provisioning + config. Codex does what it can via
> CLI/API and **pauses for the owner at any secret/credential or billing step.**

---

## Why
Receipt images are currently written to the container's ephemeral disk and are
wiped on every redeploy. The app already ships an **S3-compatible storage
adapter** (`server/services/fileStorage.ts`); it just needs a bucket + credentials.
This is also a prerequisite for any future Vercel move.

## Goal
Provision an S3-compatible bucket and set these 5 env vars on the **Railway
`NR-Ai` service**, then redeploy it:

```
S3_BUCKET=muhasib-receipts
S3_ACCESS_KEY_ID=<access key id>
S3_SECRET_ACCESS_KEY=<secret access key>
S3_ENDPOINT=https://<cloudflare-account-id>.r2.cloudflarestorage.com   # R2; omit for AWS S3
S3_REGION=auto                                                          # R2: auto; AWS: the region
```

Recommended provider: **Cloudflare R2** (cheap, no egress fees, S3-compatible).
AWS S3 also works — same env vars, real region, no `S3_ENDPOINT`.

## Operating rules
1. **Pause for the owner at every secret/credential and billing step.** Don't
   invent or expose tokens. When the bucket's Secret Access Key is generated, the
   owner copies it; you never echo it. Same for entering it into Railway.
2. Don't change application code — this is config only.
3. After setting the vars, the app service must be **redeployed** (env vars load
   on container start).

## Tasks
1. **Provision the bucket.**
   - If `wrangler` is authenticated (`wrangler whoami`), create the bucket:
     `wrangler r2 bucket create muhasib-receipts`. Otherwise, walk the owner
     through Cloudflare → R2 → Create bucket (enabling R2 may require the owner to
     add billing — pause for that).
   - Get the **Account ID** (R2 overview / `wrangler whoami`) to build
     `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`.
2. **Create an R2 API token** with **Object Read & Write** (scoped to the bucket).
   The Secret Access Key shows once — **the owner copies it; do not print it.**
   Pause here for the owner.
3. **Set the 5 env vars on the Railway `NR-Ai` service.**
   - If the Railway CLI is authenticated, you may set the non-secret ones
     (`S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`) and **pause for the owner to paste
     the two secret values** (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`).
   - Otherwise guide the owner through the Railway dashboard → NR-Ai → Variables.
4. **Redeploy** the `NR-Ai` service (and `NR-Ai-Backend` if it also writes
   receipts) so the new vars load.
5. **Verify:**
   - Admin **integration-status** page shows "Receipt image storage:
     S3-compatible bucket" (was "local disk (ephemeral)").
   - Upload + save a receipt in the app → it succeeds.
   - Confirm the object appears in the bucket (`wrangler r2 object get …` or the
     R2 dashboard), proving it's stored off-container.
   - Bonus: redeploy once more and confirm a previously-saved receipt image still
     loads (durability proof).

## Done when
The 5 vars are set, the service redeployed, integration-status shows the bucket,
and a saved receipt image survives a redeploy. Every secret was entered by the
owner, never printed.
