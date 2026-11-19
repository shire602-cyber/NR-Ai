/**
 * Deliberate exceptions to the broken-path sweep (tests/e2e/broken-path-sweep.mjs). Every entry
 * names the rule, the route (RegExp, optional), what it matches (RegExp on the detail, optional)
 * and WHY it is not a broken path. Keep this list short; a new entry needs a reason a reviewer
 * accepts, never "flaky".
 */
export const SWEEP_ALLOW = [
  {
    rule: "api-4xx",
    route: /^\/portal\/join#t=0{64}$/,
    detail: /GET 404 \/api\/portal-invitations\/0{64}$/,
    why: "The invalid-invitation state of the join page: an unknown token must answer 404 and the page shows its own 'link not valid' screen (the sweep visits it on purpose).",
  },
];
