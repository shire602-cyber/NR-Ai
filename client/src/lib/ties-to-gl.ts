/**
 * X6d: the "Ties to GL" rule. Green (`ties`) only when the difference is exactly zero and there
 * is nothing left to explain; any difference is `differs`, and explained return-only items
 * never turn the badge green.
 */
export type TiesState = "ties" | "explained" | "differs" | "none";

/** Pure rule: green ("ties") only when the difference is 0; explained items are never green. */
export function tiesState(args: {
  differenceFils: number;
  explainedFils?: number;
  comparable?: boolean;
}): TiesState {
  if (args.comparable === false) return "none";
  if (args.differenceFils !== 0) return "differs";
  if ((args.explainedFils ?? 0) !== 0) return "explained";
  return "ties";
}
