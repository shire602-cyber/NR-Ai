// Shared HTTP helper for the live-server integration scripts (R20-02/R20-03).
//
// - Self-throttles: a 429 is retried after the server's Retry-After (or
//   RateLimit-Reset) delay instead of being reported as a skip, up to
//   INTEGRATION_MAX_RATE_WAIT_MS of total waiting per request.
// - Reads the same RL_API_MAX / RL_READ_MAX / RL_AUTH_MAX the server uses and
//   prints the budget it assumes, so a too-low server budget is visible.
// - Never silently skips: callers use requireOk()/fail() which exit non-zero.
//
// The real-Postgres harness (npm run test:db) covers these flows in-process
// with rate limits off; these scripts remain for smoke-testing a live server.

const envInt = (name, fallback) => {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const RATE_BUDGET = {
  api: envInt("RL_API_MAX", 100),
  read: envInt("RL_READ_MAX", 600),
  auth: envInt("RL_AUTH_MAX", 5),
};
const MAX_WAIT_MS = envInt("INTEGRATION_MAX_RATE_WAIT_MS", 180_000);

let announced = false;
export let rateLimitRetries = 0;

function retryDelayMs(res) {
  const ra = res.headers.get("retry-after");
  if (ra) {
    const secs = Number(ra);
    if (Number.isFinite(secs)) return Math.max(250, secs * 1000);
    const at = Date.parse(ra);
    if (Number.isFinite(at)) return Math.max(250, at - Date.now());
  }
  const reset = Number(res.headers.get("ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) return reset * 1000;
  return 5_000;
}

/** fetch() that waits out 429s using the server's Retry-After. */
export async function throttledFetch(url, init = {}) {
  if (!announced) {
    announced = true;
    console.log(
      `[integration] assuming server budgets api=${RATE_BUDGET.api}/min read=${RATE_BUDGET.read}/min ` +
        `auth=${RATE_BUDGET.auth}/min (set RL_* to match the server); 429s are retried, not skipped`
    );
  }
  let waited = 0;
  for (;;) {
    const res = await fetch(url, init);
    if (res.status !== 429) return res;
    const delay = Math.min(retryDelayMs(res), 60_000);
    if (waited + delay > MAX_WAIT_MS) return res;
    rateLimitRetries++;
    await res.arrayBuffer().catch(() => undefined);
    await new Promise((r) => setTimeout(r, delay));
    waited += delay;
  }
}

/** Abort the suite with a non-zero exit (never a silent skip). */
export function fail(message, detail) {
  console.error(`FAIL: ${message}${detail === undefined ? "" : " " + JSON.stringify(detail)}`);
  process.exit(1);
}

/** Abort unless `cond` holds. */
export function requireOk(cond, message, detail) {
  if (!cond) fail(message, detail);
}
