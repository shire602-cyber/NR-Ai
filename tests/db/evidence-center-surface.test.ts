/**
 * R20-10: the evidence centre API is exercised through the real app (replaces the unit test that
 * grepped service/route/page source): all ten workflows come back with their titles, the route
 * requires authentication and company membership.
 */
import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();

const WORKFLOWS: Record<string, string> = {
  refund_pack: "Refund Pack Builder",
  proof_drilldown: "Every Number Has Proof",
  corporate_tax_workpaper: "Corporate Tax Workpaper",
  missing_evidence: "Missing Evidence Inbox",
  client_request_autopilot: "Client Request Autopilot",
  month_end_cockpit: "Month-End Close Cockpit",
  filing_risk_scan: "Error Detector Before Filing",
  smart_excel_import: "Smart Import From Excel",
  filing_timeline: "Filing Timeline With Consequences",
  owner_actions: "Owner-Friendly What Should I Do?",
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
