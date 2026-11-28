import { formatDateRange } from "@/lib/format-date";

/**
 * Practice tasks are generated server-side as "<template> — YYYY-MM-DD to YYYY-MM-DD"
 * (server/services/firm/workflow.service.ts). Display them as "<label>, 1 Jul – 30 Sep 2026"
 * with the template name translated; titles that do not follow the pattern pass through.
 */
const TEMPLATE_KEYS: Record<string, string> = {
  "Monthly bookkeeping close": "firmOps.taskMonthlyClose",
  "VAT return": "firmOps.taskVatReturn",
  "Corporate tax return": "firmOps.taskCorporateTax",
  "Payroll and WPS run": "firmOps.taskPayrollRun",
};

const GENERATED = /^(.*?)\s+—\s+(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/;

export function displayTaskTitle(title: string, t: Record<string, string>, locale: string): string {
  const m = GENERATED.exec(title.trim());
  if (!m) return title;
  const key = TEMPLATE_KEYS[m[1]];
  const label = key && t[key] ? t[key] : m[1];
  return `${label}${locale === "ar" ? "، " : ", "}${formatDateRange(m[2], m[3], locale)}`;
}
