// Period-comparison metric rows for the Reports page (current vs previous range).
// Split from the Reports page comparisonRows memo (R20-09); behaviour unchanged: figures are
// computed first, then the metric rows are emitted in the original order.
import type { ComparisonMetricRow } from "../shared";
import type { ComparisonRowsInput } from "./comparisonRowsInput";
import { computeDocumentComparisonFigures } from "./documentFigures";
import { computeOperationsComparisonFigures } from "./operationsFigures";
import { financialComparisonMetrics } from "./financialMetrics";
import { automationComparisonMetrics } from "./automationMetrics";
import { complianceComparisonMetrics } from "./complianceMetrics";

export type { ComparisonRowsInput } from "./comparisonRowsInput";

export function buildComparisonRows(input: ComparisonRowsInput): ComparisonMetricRow[] {
  const documentScope = { ...input, ...computeDocumentComparisonFigures(input) };
  const scope = { ...documentScope, ...computeOperationsComparisonFigures(documentScope) };
  return [
    ...financialComparisonMetrics(scope),
    ...automationComparisonMetrics(scope),
    ...complianceComparisonMetrics(scope),
  ];
}
