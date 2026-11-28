/** Statement-of-account endpoints (W4-D service) used by the Report Center page (S4). */
export type PartyKind = "customer" | "supplier";

/** The statement endpoint for a party (JSON, or the PDF download). */
export function statementUrl(
  companyId: string,
  kind: PartyKind,
  partyId: string,
  range: { from?: string; asOf?: string },
  format?: "pdf"
): string {
  const base =
    kind === "customer"
      ? `/api/companies/${companyId}/customer-statements/${partyId}`
      : `/api/companies/${companyId}/supplier-statements/${partyId}`;
  const q = new URLSearchParams();
  if (range.from) q.set("from", range.from);
  if (range.asOf) q.set("asOf", range.asOf);
  if (format) q.set("format", format);
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}
