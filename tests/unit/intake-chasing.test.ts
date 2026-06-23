import { describe, it, expect } from "vitest";
import {
  gapToDocumentType,
  markerFor,
  gapsToRequirementInputs,
  filterNewGapRequests,
  GAP_REQUIREMENT_MARKER,
} from "../../server/services/intake-chasing";
import type { EvidenceGap } from "../../server/services/intake-completeness";

const gap = (over: Partial<EvidenceGap> = {}): EvidenceGap => ({
  bankTransactionId: "bt1",
  date: new Date("2026-02-10T00:00:00Z"),
  amount: 250,
  direction: "outflow",
  kind: "missing_purchase_evidence",
  description: "CARD PURCHASE NOON",
  ...over,
});

const DUE = new Date("2026-04-28T00:00:00Z");

describe("gapToDocumentType", () => {
  it("maps purchase gap → purchase_invoice", () => {
    expect(gapToDocumentType("missing_purchase_evidence")).toBe("purchase_invoice");
  });
  it("maps sales gap → sales_invoice", () => {
    expect(gapToDocumentType("missing_sales_evidence")).toBe("sales_invoice");
  });
});

describe("gapsToRequirementInputs", () => {
  it("builds a requirement input with type, marker and a human description", () => {
    const [inp] = gapsToRequirementInputs([gap()], { dueDate: DUE });
    expect(inp.documentType).toBe("purchase_invoice");
    expect(inp.notes).toBe(markerFor("bt1"));
    expect(inp.notes).toContain(GAP_REQUIREMENT_MARKER);
    expect(inp.dueDate).toBe(DUE);
    expect(inp.description).toContain("AED 250.00");
    expect(inp.description).toContain("2026-02-10");
    expect(inp.description).toContain("CARD PURCHASE NOON");
  });

  it("labels a sales gap as a sales invoice and honours currency", () => {
    const [inp] = gapsToRequirementInputs([gap({ kind: "missing_sales_evidence", description: "" })], {
      dueDate: DUE,
      currency: "USD",
    });
    expect(inp.documentType).toBe("sales_invoice");
    expect(inp.description).toContain("sales invoice");
    expect(inp.description).toContain("USD 250.00");
    expect(inp.description).not.toContain('—  ""'); // no empty quote fragment
  });
});

describe("filterNewGapRequests (dedup)", () => {
  it("drops a gap already chased (marker present in existing notes)", () => {
    const inputs = gapsToRequirementInputs([gap({ bankTransactionId: "bt1" }), gap({ bankTransactionId: "bt2" })], {
      dueDate: DUE,
    });
    const out = filterNewGapRequests(inputs, [markerFor("bt1"), "some unrelated note"]);
    expect(out.map((i) => i.bankTransactionId)).toEqual(["bt2"]);
  });

  it("dedups within the incoming batch", () => {
    const dup = gapsToRequirementInputs([gap({ bankTransactionId: "bt9" }), gap({ bankTransactionId: "bt9" })], {
      dueDate: DUE,
    });
    expect(filterNewGapRequests(dup, [])).toHaveLength(1);
  });

  it("keeps everything when nothing matches", () => {
    const inputs = gapsToRequirementInputs([gap({ bankTransactionId: "x" })], { dueDate: DUE });
    expect(filterNewGapRequests(inputs, [null, undefined, "intake-gap:other"])).toHaveLength(1);
  });
});
