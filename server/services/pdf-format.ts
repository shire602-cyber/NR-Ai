// Small formatting helpers shared by the Phase 6 PDFs (payslip, statement,
// delivery note). Fixed "en-US" grouping so output never depends on the
// server locale.

export function formatMoney(value: number | string | null | undefined): string {
  const n = Number(value);
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthName(month: number): string {
  return MONTHS[month - 1] ?? String(month);
}

/** "5 Aug 2026" from a Date or an ISO / YYYY-MM-DD string, in UTC; "-" when empty. */
export function formatPdfDate(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const d = value instanceof Date ? value : new Date(String(value).length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`;
}
