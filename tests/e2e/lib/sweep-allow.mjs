/**
 * Deliberate exceptions to the broken-path sweep (tests/e2e/broken-path-sweep.mjs). Every entry
 * names the rule, the route (RegExp, optional), what it matches (RegExp on the detail, optional)
 * and WHY it is not a broken path. Keep this list short; a new entry needs a reason a reviewer
 * accepts, never "flaky".
 */
export const SWEEP_ALLOW = [];
