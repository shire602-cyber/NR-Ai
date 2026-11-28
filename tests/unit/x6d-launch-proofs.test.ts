import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tiesState } from "../../client/src/lib/ties-to-gl";
import { deriveInvoiceTracks } from "../../server/services/einvoice/tracks";
import { composeHandoffMessage } from "../../server/routes/najma-handoff.routes";

const catalog = (loc: string, ns: string): Record<string, string> =>
  JSON.parse(readFileSync(join(process.cwd(), `client/src/locales/${loc}/${ns}.json`), "utf8"));

describe("X6d Ties to GL badge rule", () => {
  it("is green only when the difference is exactly zero", () => {
    expect(tiesState({ differenceFils: 0 })).toBe("ties");
    expect(tiesState({ differenceFils: 1 })).toBe("differs");
    expect(tiesState({ differenceFils: 0, explainedFils: 500 })).toBe("explained");
    expect(tiesState({ differenceFils: 100, explainedFils: 500 })).toBe("differs");
    expect(tiesState({ differenceFils: 0, comparable: false })).toBe("none");
  });
});

describe("X6d compliance tracks (shared by status view and list pills)", () => {
  const base = {
    invoiceStatus: "sent",
    legacyStatus: "not_generated",
    doc: null,
    obligation: { required: true, known: true, reportBy: "2026-03-15" },
  };
  it("gives a report-by date and marks it overdue once past", () => {
    const early = deriveInvoiceTracks({ ...base, now: new Date("2026-03-05") });
    expect(early.reportBy).toBe("2026-03-15");
    expect(early.overdue).toBe(false);
    expect(early.reporting).toBe("pending");
    const late = deriveInvoiceTracks({ ...base, now: new Date("2026-04-01") });
    expect(late.overdue).toBe(true);
  });
  it("has no deadline for a draft or an unreported-not-required invoice", () => {
    expect(deriveInvoiceTracks({ ...base, invoiceStatus: "draft" }).reportBy).toBeNull();
    const none = deriveInvoiceTracks({
      ...base,
      obligation: { required: false, known: true, reportBy: null },
    });
    expect(none.reportBy).toBeNull();
    expect(none.reporting).toBe("not_required");
  });
  it("shows delivered only when the stored track includes a recipient receipt", () => {
    const t = deriveInvoiceTracks({
      ...base,
      doc: {
        provider: "complyance",
        providerMessageId: "provider-document",
        providerStatus: "delivery_success",
        deliveryStatus: "delivered",
        reportingStatus: "reported",
        validation: { submission: { reportingEvidence: { reported: "2026-03-04T09:00:00Z" } } },
      },
    });
    expect(t).toMatchObject({ delivery: "delivered", reporting: "reported", overdue: false });
    const missingReference = deriveInvoiceTracks({
      ...base,
      doc: {
        provider: "complyance",
        providerStatus: "delivery_success",
        deliveryStatus: "delivered",
      },
    });
    expect(missingReference).toMatchObject({
      delivery: "queued",
      deliveryConfirmationUnavailable: true,
    });
  });
});

describe("X6d handoff message", () => {
  it("carries the period, reference, figures and note", () => {
    const text = composeHandoffMessage({
      topic: "vat201",
      period: "Q1",
      reference: "ab12",
      figures: [{ label: "Net", value: "AED 5.00" }],
      note: "hello",
    });
    expect(text).toContain("Topic: VAT 201");
    expect(text).toContain("Period: Q1");
    expect(text).toContain("Reference: ab12");
    expect(text).toContain("Net: AED 5.00");
    expect(text).toContain("hello");
  });
});

describe("X6d catalogs", () => {
  it("launchProof en and ar have the same keys and real Arabic", () => {
    const en = catalog("en", "launchProof");
    const ar = catalog("ar", "launchProof");
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
    for (const [k, v] of Object.entries(ar)) {
      if (k === "launchProof.contactName" || k.startsWith("launchProof.topic")) continue;
      expect(v, k).toMatch(/[؀-ۿ]/);
    }
  });
  it("e-invoicing dates are labelled as guidance to confirm, and sending is off honestly", () => {
    const en = catalog("en", "launchProof");
    expect(en["launchProof.readinessCountdown"]).toMatch(/Ministry of Finance timeline/);
    expect(en["launchProof.readinessCountdown"]).toMatch(/Confirm for your entity/);
    expect(en["launchProof.readinessTxOff"]).toMatch(/until an accredited e-invoicing provider/);
  });
});
