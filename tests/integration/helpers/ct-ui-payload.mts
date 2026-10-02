// Runs the corporate tax screen's own form logic under Node: the adjustments it would send and the computation it would
// show, so tests/integration/phase9-teardown-t1-reports.test.mjs can hold the client and the server to the same fils.
//   echo '{"revenue":..,"expenses":..,"rows":[..],"elected":true,"periodEnd":"2026-12-31"}' | npx tsx tests/integration/helpers/ct-ui-payload.mts
import { readFileSync } from "node:fs";
import { localComputation, localReliefOffer, rowsToAdjustments, type AdjustmentRow } from "../../../client/src/lib/ct-form";

const input = JSON.parse(readFileSync(0, "utf8")) as { revenue: number; expenses: number; rows: AdjustmentRow[]; elected: boolean; periodEnd: string };
const computation = localComputation({ totalRevenue: input.revenue, totalExpenses: input.expenses, rows: input.rows, elected: input.elected, taxPeriodEnd: input.periodEnd });
console.log(
  JSON.stringify({
    adjustments: rowsToAdjustments(input.rows),
    offer: localReliefOffer(input.revenue, input.periodEnd),
    taxPayable: computation.taxPayable,
    taxableIncome: computation.taxableIncome,
    totalAddBacks: computation.totalAddBacks,
    totalDeductions: computation.totalDeductions,
    applied: computation.smallBusinessRelief.applied,
    reason: computation.smallBusinessRelief.ineligibleReason ?? null,
  })
);
