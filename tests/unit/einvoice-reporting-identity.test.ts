import { describe, expect, it } from "vitest";
import type { Company } from "../../shared/schema";
import {
  invoiceReportingDeadline,
  invoiceReportingRequired,
} from "../../server/services/einvoice/reporting";

const TRN = "100765432100003";
const company = { einvoiceScope: "b2b", einvoiceGoLiveDate: "2026-01-01" } as Company;
const now = new Date("2026-11-18T10:00:00Z");

function buyerXml(scheme: string, number: string) {
  return `<Invoice xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
<cbc:IssueDate>2026-10-09</cbc:IssueDate>
<cac:AccountingCustomerParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>${number}</cbc:CompanyID><cac:TaxScheme><cbc:ID>${scheme}</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme></cac:Party></cac:AccountingCustomerParty>
</Invoice>`;
}

describe("reporting obligation of the frozen buyer", () => {
  it("uses the VAT TRN emitted in the XML even after the sales record or contact changes", () => {
    const original = { customerTrn: null, einvoiceXml: buyerXml("VAT", TRN) };
    expect(invoiceReportingRequired(original, company, now, null)).toBe(true);
    expect(
      invoiceReportingRequired(
        original,
        { ...company, einvoiceGoLiveDate: "2027-01-01" },
        now,
        null
      )
    ).toBe(false);
  });

  it("does not treat a non-VAT identifier or a changed sales contact as VAT data in a frozen document", () => {
    expect(
      invoiceReportingRequired(
        { customerTrn: TRN, einvoiceXml: buyerXml("CT", TRN) },
        company,
        now,
        TRN
      )
    ).toBe(false);
  });

  it("uses the resolved contact for preflight when XML has not been created", () => {
    expect(invoiceReportingRequired({ customerTrn: null }, company, now, TRN)).toBe(true);
    expect(invoiceReportingRequired({ customerTrn: null }, company, now, null)).toBe(false);
  });

  it("uses the freeze date in XML and falls back to the issue date on older rows without usable XML", () => {
    const date = new Date("2026-11-14T00:00:00.000Z");
    expect(invoiceReportingDeadline({ einvoiceXml: buyerXml("VAT", TRN), date })).toBe(
      "2026-10-23"
    );
    expect(invoiceReportingDeadline({ einvoiceXml: null, date })).toBe("2026-11-28");
    expect(invoiceReportingDeadline({ einvoiceXml: "not an XML document", date })).toBe(
      "2026-11-28"
    );
  });
});
