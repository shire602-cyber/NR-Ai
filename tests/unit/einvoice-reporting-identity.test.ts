import { describe, expect, it } from "vitest";
import type { Company, EInvoiceDocument } from "../../shared/schema";
import {
  invoiceReportingDeadline,
  invoiceReportingRequired,
  projectReportingObligation,
  projectInvoiceTracks,
} from "../../server/services/einvoice/reporting";
import { einvoicingScope } from "../../server/services/einvoice/scope";
import { deriveInvoiceTracks, reportByDate } from "../../server/services/einvoice/tracks";
import { generateEInvoiceXML } from "../../server/services/einvoice.service";
import { fixtureCompany, PINT_AE_FIXTURES } from "../fixtures/pint-ae/fixtures";

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
  it("starts the go-live obligation at Dubai midnight regardless of server time zone", () => {
    const rollout = { ...company, einvoiceGoLiveDate: "2027-01-01" };
    const lastDay = new Date("2026-12-31T19:59:59.999Z");
    const goLive = new Date("2026-12-31T20:30:00.000Z");
    const frozen = { customerTrn: null, einvoiceXml: buyerXml("VAT", TRN) };
    expect(einvoicingScope(rollout, lastDay)).toMatchObject({ mandatory: false, daysToGoLive: 1 });
    expect(einvoicingScope(rollout, goLive)).toMatchObject({ mandatory: true, daysToGoLive: 0 });
    expect(invoiceReportingRequired(frozen, rollout, lastDay)).toBe(false);
    expect(invoiceReportingRequired(frozen, rollout, goLive)).toBe(true);
    expect(reportByDate(new Date("2026-12-31T20:00:00Z"))).toBe("2027-01-15");
    const tracks = deriveInvoiceTracks({
      invoiceStatus: "sent",
      legacyStatus: "submitted",
      doc: null,
      obligation: { required: true, known: true, reportBy: "2026-12-31" },
      now: goLive,
    });
    expect(tracks.overdue).toBe(true);
  });

  it("freezes a Dubai-midnight business issue date in XML and the reporting deadline", () => {
    const original = PINT_AE_FIXTURES[0];
    const invoice = { ...original.invoice, date: new Date("2026-12-31T20:00:00Z") };
    const { xml } = generateEInvoiceXML(
      invoice,
      original.lines,
      fixtureCompany,
      original.customer,
      original.opts
    );
    expect(xml).toContain("<cbc:IssueDate>2027-01-01</cbc:IssueDate>");
    expect(invoiceReportingDeadline({ ...invoice, einvoiceXml: xml })).toBe("2027-01-15");
  });
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

describe("FTA reporting deadline projection", () => {
  const issued = {
    id: "issued-invoice",
    source: "app",
    buyerType: null,
    einvoiceBuyerContactId: null,
    customerTrn: TRN,
    date: new Date("2026-03-01T00:00:00Z"),
    status: "sent",
    einvoiceStatus: "generated",
    einvoiceProvider: null,
    einvoiceSubmittedAt: null,
    einvoiceProviderMessageId: null,
  };
  const document = (changes: Partial<EInvoiceDocument>) =>
    ({ status: "generated", ...changes }) as EInvoiceDocument;

  it("projects both tracks for a business cash buyer with a Peppol endpoint and no VAT TRN", () => {
    const invoice = {
      ...issued,
      source: "cash_sale",
      buyerType: "business" as const,
      customerTrn: null,
    };
    const endpoint = { endpointId: "1007654321", endpointScheme: "0235" };
    const tracks = projectInvoiceTracks(invoice, null, company, now, null, endpoint);
    expect(tracks).toMatchObject({
      delivery: "validated",
      reporting: "pending",
      reportingRequired: true,
      reportingObligationKnown: true,
      reportBy: "2026-03-15",
    });
    expect(
      projectInvoiceTracks(
        { ...invoice, buyerType: "consumer" },
        null,
        company,
        now,
        null,
        endpoint
      )
    ).toMatchObject({
      delivery: "not_applicable",
      reporting: "not_required",
      reportingRequired: false,
    });
    expect(
      projectInvoiceTracks(invoice, null, { ...company, einvoiceScope: "b2g" }, now, null, endpoint)
        .reportingRequired
    ).toBe(false);
    const xml = buyerXml("CT", "1007654321").replace(
      "<cac:PartyTaxScheme>",
      '<cbc:EndpointID schemeID="0235">1007654321</cbc:EndpointID><cac:PartyTaxScheme>'
    );
    expect(invoiceReportingRequired({ ...invoice, einvoiceXml: xml }, company, now)).toBe(true);
    expect(
      invoiceReportingRequired({ ...invoice, buyerType: null, einvoiceXml: xml }, company, now)
    ).toBe(true);
  });

  it("re-evaluates a generated-only deadline until transmission work is queued", () => {
    const preview = document({
      reportBy: "2026-08-01",
      validation: { submission: { reportingRequired: true } },
    });
    expect(projectReportingObligation(issued, preview, company, now, null)).toEqual({
      required: false,
      known: true,
      reportBy: null,
    });
    expect(projectReportingObligation(issued, preview, company, now)).toEqual({
      required: true,
      known: true,
      reportBy: "2026-03-15",
    });
    const queued = document({
      ...preview,
      validation: { submission: { operationId: "sealed-operation", reportingRequired: true } },
    });
    expect(projectReportingObligation(issued, queued, company, now, null)).toEqual({
      required: true,
      known: true,
      reportBy: "2026-08-01",
    });
  });

  it("keeps a recorded due date over a conflicting flag and keeps a missing historical deadline unknown", () => {
    const historical = {
      ...issued,
      einvoiceStatus: "submitted",
      einvoiceProviderMessageId: "original-reference",
    };
    const snapshot = { submission: { reportingRequired: false } };
    expect(
      projectReportingObligation(
        historical,
        document({ validation: snapshot, reportBy: "2026-02-07" }),
        company,
        now
      )
    ).toEqual({ required: true, known: true, reportBy: "2026-02-07" });
    expect(
      projectReportingObligation(historical, document({ validation: snapshot }), company, now)
    ).toEqual({ required: false, known: true, reportBy: null });
    expect(
      projectReportingObligation(
        historical,
        document({ validation: { submission: { reportingRequired: true } } }),
        company,
        now
      )
    ).toEqual({ required: true, known: true, reportBy: null });
    expect(projectReportingObligation(historical, undefined, company, now)).toEqual({
      required: false,
      known: false,
      reportBy: null,
    });
  });
});
