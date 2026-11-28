import { describe, expect, it } from "vitest";

import {
  formatEvidenceRequestDraft,
  scoreEvidenceReadiness,
  scoreFromOpenItems,
  statusFromScore,
} from "../../shared/evidence-center";

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
});

// The ten-workflow API/route checks moved to tests/db/evidence-center-surface.test.ts (real app).
