import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  deliveryFromLegacyStatus,
  rejectionSummary,
} from "../../client/src/components/einvoice/einvoice-meta";

// F15 N2/N3: the invoice header strip shows the rejection reason and the FTA chip label.
describe("e-invoice header strip", () => {
  it("maps stored rejected documents to the rejected delivery state", () => {
    expect(deliveryFromLegacyStatus("rejected")).toBe("rejected");
  });
  it("summarises the first provider reason with its field and rule", () => {
    const s = rejectionSummary({
      code: "ACUBE_REJECTED",
      message: "Rejected",
      reasons: [
        { message: "Buyer TRN is invalid", field: "invoice.customerTrn", code: "PINT-R012" },
      ],
      retryScheduledAt: null,
      resubmittable: true,
    });
    expect(s).toMatchObject({
      message: "Buyer TRN is invalid",
      field: "invoice.customerTrn",
      rule: "PINT-R012",
    });
    expect(rejectionSummary(null)).toBeNull();
  });
  it("renders a rejection banner with resubmit and a labelled FTA chip, in both locales", () => {
    const strip = readFileSync("client/src/components/einvoice/EInvoiceHeaderStrip.tsx", "utf8");
    expect(strip).toContain("einvoice-header-rejection");
    expect(strip).toContain("showReportingLabel");
    for (const l of ["en", "ar"]) {
      const cat = JSON.parse(readFileSync(`client/src/locales/${l}/einvoicing.json`, "utf8"));
      for (const k of [
        "ftaChip_pending",
        "ftaChip_reported",
        "ftaChip_not_sent",
        "ftaChip_report_failed",
        "headerRejected",
      ]) {
        expect(cat[`einvoicing.${k}`]).toBeTruthy();
      }
    }
  });
});
