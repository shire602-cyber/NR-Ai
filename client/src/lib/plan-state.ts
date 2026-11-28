/*
 * STEP4: the one state rule for "where is this customer after sign-up".
 *
 *   trial   running | ended
 *   choice  none | chosen | requested   (a plan chosen at sign-up or in Settings; "requested" =
 *                                        the customer pressed Activate and we owe a confirmation)
 *
 * Subscription.tsx, TrialBanner, PlanLockBanner, PlanLimitDialog and the plan-choice emails all
 * read this one rule, so they never disagree: each of the six states has one call to action and
 * dates that are true for it (no "stays open until <past date>", no "choose a plan" to someone who
 * already chose). Choosing a plan alone never keeps a workspace working: it only records the
 * customer's wish; the plan is active once we (or checkout) activate it.
 */
export type TrialPhase = "running" | "ended";
export type ChoicePhase = "none" | "chosen" | "requested";
export type PlanPhaseKey = `${TrialPhase}-${ChoicePhase}`;

export interface PlanPhase {
  trial: TrialPhase;
  choice: ChoicePhase;
  key: PlanPhaseKey;
}

/** What the one button of a state does. */
export type PlanCta = "choose" | "activate" | "see-plan";

export function planPhase(input: {
  trialEnded: boolean;
  chosen: boolean;
  activationRequestedAt?: string | null;
}): PlanPhase {
  const trial: TrialPhase = input.trialEnded ? "ended" : "running";
  // A request without a choice cannot exist (the server refuses it); treat it as no choice.
  const choice: ChoicePhase = !input.chosen
    ? "none"
    : input.activationRequestedAt
      ? "requested"
      : "chosen";
  return { trial, choice, key: `${trial}-${choice}` };
}

/** One CTA per state: choose a plan, activate the chosen one, or look at the plan already asked for. */
export function planCta(phase: PlanPhase): PlanCta {
  if (phase.choice === "none") return "choose";
  return phase.choice === "chosen" ? "activate" : "see-plan";
}

/** Catalog key of a plan name as it reads inside a sentence (Arabic: "خطة المؤسسات"). */
export function planPhraseKey(planId: string): string {
  return `marketing.prPlanPhrase_${planId}`;
}
