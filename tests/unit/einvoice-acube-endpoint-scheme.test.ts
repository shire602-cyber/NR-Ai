/**
 * E1 item 9: the supplier EndpointID scheme.
 *
 * A-Cube's "Formats" page sample shows the supplier as EndpointID schemeID="9922"
 * (value OPTBCNTRLP1005) and the buyer as 0235. Its Quick Start, which is the document a
 * sandbox legal entity actually sends, uses schemeID="0235" with the supplier's 10-digit TIN for
 * both parties, and its submit/list responses identify parties as "0235:<TIN>"
 * (senderIdentifier / recipientIdentifier). A-Cube links a legal entity by TIN, so it can only
 * route a document whose supplier endpoint is 0235:<that TIN>.
 *
 * Decision (docs/einvoicing-acube.md): keep 0235 + TIN as the default, keep the scheme
 * configurable per company (companies.peppol_scheme), and refuse to transmit through A-Cube when
 * the configured endpoint differs from the linked TIN (EINVOICE_SUPPLIER_ENDPOINT_MISMATCH).
 */
import { describe, expect, it } from "vitest";
import { PINT_AE_FIXTURES, fixtureCompany } from "../fixtures/pint-ae/fixtures";
import { generateEInvoiceXML } from "../../server/services/einvoice.service";
import { first, parseXml, textAt } from "../../server/services/einvoice/dom";
import { companyTin, requireCompanyTin } from "../../server/services/einvoice/legal-entities";

function supplierEndpoint(company: typeof fixtureCompany) {
  const f = PINT_AE_FIXTURES[0];
  const { xml } = generateEInvoiceXML(f.invoice, f.lines, company, f.customer, f.opts);
  const root = parseXml(xml).documentElement as unknown as Element;
  const seller = first(root, "cac:AccountingSupplierParty/cac:Party") as Element;
  return {
    scheme: first(seller, "cbc:EndpointID")?.getAttribute("schemeID"),
    value: textAt(seller, "cbc:EndpointID"),
  };
}

describe("E1 supplier EndpointID scheme for A-Cube", () => {
  it("defaults to 0235 + TIN, the shape A-Cube's Quick Start sends and its senderIdentifier echoes", () => {
    const company = { ...fixtureCompany, peppolScheme: null, peppolParticipantId: null };
    expect(supplierEndpoint(company as typeof fixtureCompany)).toEqual({
      scheme: "0235",
      value: "1001234567", // first 10 digits of TRN 100123456700003
    });
    expect(companyTin(company)).toBe("1001234567");
  });

  it("allows a valid legacy 0235 identity when no statutory registration is stored", () => {
    expect(requireCompanyTin({ peppolScheme: "0235", peppolParticipantId: "1001234567" })).toBe(
      "1001234567"
    );
    expect(() =>
      requireCompanyTin({ peppolScheme: "9922", peppolParticipantId: "1001234567" })
    ).toThrow(expect.objectContaining({ code: "EINVOICE_TIN_MISSING" }));
  });

  it("refuses inconsistent Peppol, stored TIN and statutory TRN values", () => {
    const registered = { trnVatNumber: "100123456700003" };
    expect(() => requireCompanyTin({ ...registered, peppolParticipantId: "1005555555" })).toThrow(
      expect.objectContaining({ code: "EINVOICE_SUPPLIER_ENDPOINT_MISMATCH" })
    );
    expect(() => requireCompanyTin({ ...registered, einvoiceTin: "1005555555" })).toThrow(
      expect.objectContaining({ code: "EINVOICE_SUPPLIER_ENDPOINT_MISMATCH" })
    );
    expect(() => requireCompanyTin({ ...registered, corporateTaxId: "100555555500003" })).toThrow(
      expect.objectContaining({ code: "EINVOICE_SUPPLIER_ENDPOINT_MISMATCH" })
    );
  });

  it("stays configurable per company (e.g. the 9922 identifier in A-Cube's Formats sample)", () => {
    const company = {
      ...fixtureCompany,
      peppolScheme: "9922",
      peppolParticipantId: "OPTBCNTRLP1005",
    } as typeof fixtureCompany;
    expect(supplierEndpoint(company)).toEqual({ scheme: "9922", value: "OPTBCNTRLP1005" });
    // A non-TIN participant id falls back to the TRN's TIN for the A-Cube legal entity.
    expect(companyTin(company)).toBe("1001234567");
  });
});
