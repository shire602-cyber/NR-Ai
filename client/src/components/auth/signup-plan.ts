/*
 * STEP4: sign-up plan step state, kept in the URL so Back / Forward work and a reload keeps the
 * step. Pure (no React, no window), unit-tested in tests/unit/step4-signup-plan.test.ts.
 *
 *   /register                                         step 1 (plan), the default plan
 *   /register?plan=professional&cycle=yearly          step 2 (account), from /pricing
 *   /register?step=account&plan=..&cycle=..&src=..    step 2 after Continue
 *   /register?step=plan&plan=..&cycle=..&src=..       step 1 after "Change"
 *
 * An invalid plan or cycle ("gold", "free", "none", "quarterly") is ignored: the default applies
 * and no error is shown. Prices are never typed here: they come from @shared/plans.
 */
import {
  DEFAULT_SIGNUP_CYCLE,
  DEFAULT_SIGNUP_PLAN,
  isBillingCycle,
  isPaidPlanId,
  type BillingCycle,
  type PaidPlanId,
} from "@shared/plans";

export type SignupPlanSource = "signup_default" | "signup_picked" | "pricing_link";
export type SignupStep = "plan" | "account";

export interface SignupPlanState {
  planId: PaidPlanId;
  cycle: BillingCycle;
  source: SignupPlanSource;
  step: SignupStep;
  /** True when the URL named a valid plan (a deep link from /pricing, or a later step). */
  explicit: boolean;
}

const SOURCE_PARAM: Record<string, SignupPlanSource> = {
  default: "signup_default",
  picked: "signup_picked",
  pricing: "pricing_link",
};
const PARAM_FOR_SOURCE: Record<SignupPlanSource, string> = {
  signup_default: "default",
  signup_picked: "picked",
  pricing_link: "pricing",
};

/** The one value of a query parameter, or null when missing or repeated. */
function single(params: URLSearchParams, key: string): string | null {
  const all = params.getAll(key);
  return all.length === 1 ? all[0] : null;
}

export function readSignupPlan(search: string): SignupPlanState {
  const params = new URLSearchParams(search);
  const rawPlan = single(params, "plan");
  const rawCycle = single(params, "cycle");
  const explicit = isPaidPlanId(rawPlan);
  const planId = isPaidPlanId(rawPlan) ? rawPlan : DEFAULT_SIGNUP_PLAN;
  const cycle = isBillingCycle(rawCycle) ? rawCycle : DEFAULT_SIGNUP_CYCLE;
  const stepParam = single(params, "step");
  const srcParam = single(params, "src");
  const source: SignupPlanSource =
    (srcParam && SOURCE_PARAM[srcParam]) || (explicit ? "pricing_link" : "signup_default");
  let step: SignupStep = "plan";
  if (stepParam === "account") step = "account";
  else if (stepParam === "plan") step = "plan";
  else if (explicit) step = "account";
  return { planId, cycle, source, step, explicit };
}

/** `/register?...` for the given state; `step` omitted gives the bare deep link /pricing uses. */
export function signupPlanUrl(
  planId: PaidPlanId,
  cycle: BillingCycle,
  opts: { step?: SignupStep; source?: SignupPlanSource } = {}
): string {
  const params = new URLSearchParams();
  if (opts.step) params.set("step", opts.step);
  params.set("plan", planId);
  params.set("cycle", cycle);
  if (opts.source) params.set("src", PARAM_FOR_SOURCE[opts.source]);
  return `/register?${params.toString()}`;
}

/** The post-sign-in path that carries the choice through Google / Microsoft sign-up. */
export function oauthNextForPlan(state: {
  planId: PaidPlanId;
  cycle: BillingCycle;
  source: SignupPlanSource;
}): string {
  const params = new URLSearchParams({
    signup_plan: state.planId,
    signup_cycle: state.cycle,
    signup_source: state.source,
  });
  return `/dashboard?${params.toString()}`;
}
