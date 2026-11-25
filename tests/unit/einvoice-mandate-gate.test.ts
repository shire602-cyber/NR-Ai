/**
 * Council F16: FTA reporting (required / report-by / overdue) only exists once the e-invoicing
 * mandate applies to the company. Pre-mandate companies see no deadline; an explicit go-live date
 * that has been reached (opt-in) or the band's go-live date makes it apply.
 */
import { describe, expect, it } from "vitest";
import { einvoiceMandateApplies, EINVOICE_TIMELINE } from "../../server/services/einvoice/scope";
import { reportingRequired } from "../../server/services/einvoice/tracks";

const today = new Date("2026-11-16T10:00:00Z");
const BUYER = "100765432100003";

function required(company: Parameters<typeof einvoiceMandateApplies>[0]) {
  return reportingRequired({
    customerTrn: BUYER,
    companyScope: company.einvoiceScope,
    mandateApplies: einvoiceMandateApplies(company, today),
  });
}

describe("einvoiceMandateApplies", () => {
  it("is false for a company with no scope, scope none, or a go-live in the future", () => {
    expect(einvoiceMandateApplies({}, today)).toBe(false);
    expect(
      einvoiceMandateApplies({ einvoiceScope: "none", einvoiceTurnoverBand: "large" }, today)
    ).toBe(false);
    expect(
      einvoiceMandateApplies({ einvoiceScope: "b2b", einvoiceTurnoverBand: "large" }, today)
    ).toBe(false);
  });

  it("is true after the band go-live or once an explicit go-live date has been reached", () => {
    const after = new Date(`${EINVOICE_TIMELINE.large.goLive}T00:00:00Z`);
    expect(
      einvoiceMandateApplies({ einvoiceScope: "b2b", einvoiceTurnoverBand: "large" }, after)
    ).toBe(true);
    expect(
      einvoiceMandateApplies({ einvoiceScope: "b2b", einvoiceGoLiveDate: "2026-01-01" }, today)
    ).toBe(true);
    expect(
      einvoiceMandateApplies({ einvoiceScope: "b2b", einvoiceGoLiveDate: "2026-12-01" }, today)
    ).toBe(false);
  });
});

describe("reportingRequired gated on the mandate", () => {
  it("is not required before the mandate applies, even with a buyer TRN", () => {
    expect(required({ einvoiceScope: "b2b", einvoiceTurnoverBand: "large" })).toBe(false);
    expect(required({})).toBe(false);
  });
  it("is required for an opted-in company", () => {
    expect(required({ einvoiceScope: "b2b", einvoiceGoLiveDate: "2026-06-01" })).toBe(true);
  });
});
