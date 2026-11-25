/**
 * R20-10: the evidence centre API is exercised through the real app (replaces the unit test that
 * grepped service/route/page source): all ten workflows come back with their titles, the route
 * requires authentication and company membership.
 */
import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();

// Titles follow the sentence-case templates in shared/server-copy.ts (Fable B10).
const WORKFLOWS: Record<string, string> = {
  refund_pack: "Refund pack builder",
  proof_drilldown: "Every number has proof",
  corporate_tax_workpaper: "Corporate tax workpaper",
  missing_evidence: "Missing evidence inbox",
  client_request_autopilot: "Client request autopilot",
  month_end_cockpit: "Month-end close cockpit",
  filing_risk_scan: "Error detector before filing",
  smart_excel_import: "Smart import from Excel",
  filing_timeline: "Filing timeline with consequences",
  owner_actions: "Owner-friendly what should I do?",
};

describe("R20-10 evidence centre API", () => {
  it("returns all ten workflow ideas with their titles to a company member", async () => {
    const a = await h.createTenant({ name: "EvidenceA" });
    const res = await a.as.get(`/api/companies/${a.company.id}/evidence-center`);
    expect(res.status).toBe(200);
    const workflows = res.body.workflows as Array<{ id: string; title: string }>;
    expect(Object.fromEntries(workflows.map((w) => [w.id, w.title]))).toEqual(WORKFLOWS);
  });

  it("refuses another tenant and anonymous callers", async () => {
    const a = await h.createTenant({ name: "EvidenceOwner" });
    const b = await h.createSecondTenant({ name: "EvidenceOther" });
    const other = await b.as.get(`/api/companies/${a.company.id}/evidence-center`);
    expect([403, 404]).toContain(other.status);
    const anon = await h.anon.get(`/api/companies/${a.company.id}/evidence-center`);
    expect(anon.status).toBe(401);
  });
});
