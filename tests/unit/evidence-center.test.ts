import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  formatEvidenceRequestDraft,
  scoreEvidenceReadiness,
  scoreFromOpenItems,
  statusFromScore,
  type EvidenceWorkflowId,
} from "../../shared/evidence-center";

const workflowIds: EvidenceWorkflowId[] = [
  "refund_pack",
  "proof_drilldown",
  "corporate_tax_workpaper",
  "missing_evidence",
  "client_request_autopilot",
  "month_end_cockpit",
  "filing_risk_scan",
  "smart_excel_import",
  "filing_timeline",
  "owner_actions",
];

describe("evidence center model", () => {
  it("scores evidence readiness from issue severity", () => {
    expect(scoreEvidenceReadiness([])).toBe(100);
    expect(scoreEvidenceReadiness([{ severity: "critical" }, { severity: "warning" }])).toBe(72);
    expect(scoreFromOpenItems(2, 8)).toBe(75);
    expect(statusFromScore(83)).toBe("ready");
    expect(statusFromScore(56)).toBe("needs_review");
    expect(statusFromScore(30)).toBe("blocked");
  });

  it("creates a safe draft request without external side effects", () => {
    const draft = formatEvidenceRequestDraft({
      companyName: "Active Company LLC",
      issues: [
        {
          title: "Missing supplier invoice",
          detail: "Upload the original tax invoice for input VAT recovery.",
        },
      ],
    });

    expect(draft.subject).toBe("Evidence request for Active Company LLC");
    expect(draft.itemCount).toBe(1);
    expect(draft.body).toContain("Missing supplier invoice");
    expect(draft.body).toContain("Please do not reply with passwords, bank OTPs");
  });

  it("keeps all ten workflow ideas represented in API and UI source", () => {
    const serviceSource = readFileSync("server/services/evidence-center.service.ts", "utf8");
    const pageSource = readFileSync("client/src/pages/EvidenceCenter.tsx", "utf8");
    const routeSource = readFileSync("server/routes/evidence-center.routes.ts", "utf8");

    for (const id of workflowIds) {
      expect(serviceSource).toContain(id);
      expect(pageSource).toContain(id);
    }

    expect(serviceSource).toContain("Refund Pack Builder");
    expect(serviceSource).toContain("Every Number Has Proof");
    expect(serviceSource).toContain("Corporate Tax Workpaper");
    expect(serviceSource).toContain("Missing Evidence Inbox");
    expect(serviceSource).toContain("Client Request Autopilot");
    expect(serviceSource).toContain("Month-End Close Cockpit");
    expect(serviceSource).toContain("Error Detector Before Filing");
    expect(serviceSource).toContain("Smart Import From Excel");
    expect(serviceSource).toContain("Filing Timeline With Consequences");
    expect(serviceSource).toContain("Owner-Friendly What Should I Do?");
    expect(routeSource).toContain("authMiddleware");
    expect(routeSource).toContain("requireCustomer");
    expect(routeSource).toContain("storage.hasCompanyAccess");
  });
});
