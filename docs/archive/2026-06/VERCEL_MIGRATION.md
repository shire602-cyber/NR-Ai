# Moving off Railway — Vercel assessment & plan

_Honest CTO read. Read the "Reality check" before committing to a path._

## TL;DR

Your **client** (the Vite/React app) is a perfect fit for Vercel — static build,
instant CDN, cheap. **But this app's backend is not a Vercel-shaped backend.** It
is a long-running, *stateful* Express server, and three of its core pieces don't
work on Vercel's serverless model without re-architecture:

- **WebSockets / Socket.io** (`server/services/socket.service.ts`) — Vercel
  serverless functions can't hold persistent socket connections. This is the hard
  blocker.
- **Background scheduler** (`scheduler.service.ts`, `node-cron`) — cron loops
  don't run on serverless; they'd need to become Vercel Cron jobs.
- **In-memory rate limiting** (`rateLimit.ts` sliding-window in memory) — each
  serverless invocation has its own memory, so in-memory limits silently stop
  working; this would need Redis.

Plus: serverless opens a DB connection per invocation, so you'd need a connection
pooler (Neon serverless driver / Supabase pooler / PgBouncer) or Postgres
connection limits get exhausted under load.

**So "fast move everything to Vercel" isn't accurate for the backend** — it's a
multi-week re-architecture, and you'd still have to run the realtime piece
somewhere else. The fast, low-risk win is a **hybrid**.

## The three honest options

### Option A — Hybrid (recommended): client on Vercel, backend on a persistent host
- Move the **client to Vercel** now (it's what Vercel is great at — and you
  already run apps there). Point it at the backend API URL.
- Keep the **backend** on a persistent-server host. If the gripe is Railway
  specifically, move it to **Render** or **Fly.io** — both run a normal Node
  server exactly like Railway (near lift-and-shift), often cheaper, nicer UX.
- **Effort: low. Risk: low.** You get Vercel where it helps, keep WebSockets +
  cron + sessions working untouched.

### Option B — Full Vercel (serverless backend)
Wrap Express as a Vercel function (`api/[...].ts`) and re-architect the stateful
parts:
- Replace Socket.io with a managed realtime service (Ably / Pusher) **or** drop
  realtime features.
- Convert the scheduler to **Vercel Cron**.
- Move rate-limit + any in-memory state to **Redis** (you already have Redis).
- Put Postgres behind a serverless pooler — easiest is migrating to **Neon**
  (the code already detects Neon).
- Move receipt-image storage to object storage (**DONE** — S3/R2 adapter shipped).
- **Effort: high (multi-week). Risk: medium-high.** Only worth it if you want to
  be fully serverless.

### Option C — Just leave Railway (lift-and-shift to Render/Fly)
If the real goal is "I don't like Railway," the simplest move is the backend to
**Render** or **Fly.io** and (optionally) the client to Vercel. No
re-architecture — same Node server, same Postgres/Redis. **Effort: low.**

## Prerequisites already done / needed for serverless (Option B)
- [x] **Receipt-image storage → object storage** (S3/R2 adapter) — shipped.
- [ ] Move **VAT-evidence uploads** off local disk to the same S3 adapter (same
  fix; one remaining disk writer).
- [ ] **Redis-backed rate limiting** (replace the in-memory sliding window).
- [ ] **Scheduler → Vercel Cron** (extract each job into a callable handler).
- [ ] **DB pooler** — move to Neon or front Railway PG with PgBouncer.
- [ ] **Realtime decision** — Ably/Pusher, a separate socket service, or remove.

## Recommended path (fast + safe)
1. **Now:** deploy the current fixes (storage/OCR/VAT) wherever you are.
2. **This week — client to Vercel:** create a Vercel project from the repo, build
   only the client (`vite build`), set `VITE_API_URL` to the backend's URL, ship.
   Zero backend risk; immediate Vercel benefits for the UI.
3. **Backend:** decide Option A (move backend to Render/Fly) vs Option B (full
   serverless). If you want it done quickly and reliably, do **A** — it's the
   90% win for 10% of the effort.
4. **Data move (whichever backend host):** `pg_dump` the Postgres, restore to the
   new managed Postgres (Neon/Render/Supabase), repoint `DATABASE_URL`, verify,
   cut DNS over. Keep the old DB read-only until verified.

## What I'd tell you as your CTO
Vercel is the right home for your **frontend** and you should move it there. But
forcing a WebSocket + cron + stateful Express backend onto Vercel serverless is
fighting the platform — you'd spend weeks rebuilding plumbing that already works.
Put the client on Vercel, and put the backend on a persistent host (Render/Fly)
if you want off Railway. Revisit full-serverless later only if there's a concrete
reason (scale-to-zero cost, edge latency) that justifies it.
