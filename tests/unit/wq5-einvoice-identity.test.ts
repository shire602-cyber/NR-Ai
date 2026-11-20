/**
 * WQ5: e-invoicing identity rules (TIN, seller ID, missing fields) and the PINT AE document
 * using the stored TIN and seller ID type, plus the buyer ID type from the contact.
 */
import { describe, expect, it } from "vitest";
import { PINT_AE_FIXTURES, fixtureCompany } from "../fixtures/pint-ae/fixtures";
import { generateEInvoiceXML, validateForEInvoicing } from "../../server/services/einvoice.service";
import { first, parseXml, textAt } from "../../server/services/einvoice/dom";
import { companyTin } from "../../server/services/einvoice/legal-entities";
import {
  companyTaxIdentityBody,
  effectiveTin,
  isValidTin,
  missingSellerFields,
  sellerIdProblem,
  sellerLegalId,
  taxRegistrationSchema,
  tinFromTaxNumber,
  tinProblem,
} from "../../shared/validators/einvoice-identity";
import type { Company } from "../../shared/schema";

describe("WQ5 TIN validation", () => {
  it("accepts 10 digits starting with 1 only", () => {
    expect(isValidTin("1001234567")).toBe(true);
    expect(isValidTin("2001234567")).toBe(false);
    expect(isValidTin("100123456")).toBe(false);
    expect(isValidTin("10012345678")).toBe(false);
    expect(isValidTin("100123456a")).toBe(false);
    expect(isValidTin(null)).toBe(false);
  });

  it("derives the TIN from the first 10 digits of a 15-digit TRN, ignoring separators", () => {
    expect(tinFromTaxNumber("100123456700003")).toBe("1001234567");
    expect(tinFromTaxNumber("100-1234-5670-0003")).toBe("1001234567");
    expect(tinFromTaxNumber("CT-123456789")).toBeNull();
    expect(tinFromTaxNumber("300123456700003")).toBeNull(); // not a UAE TIN
  });

  it("prefers the stored TIN, then the CT TRN, then the VAT TRN", () => {
    expect(
      effectiveTin({
        einvoiceTin: "1111111111",
        corporateTaxId: "100222222200003",
        trnVatNumber: "100333333300003",
      })
    ).toBe("1111111111");
    expect(
      effectiveTin({ corporateTaxId: "100222222200003", trnVatNumber: "100333333300003" })
    ).toBe("1002222222");
    expect(effectiveTin({ trnVatNumber: "100333333300003" })).toBe("1003333333");
    expect(effectiveTin({})).toBeNull();
  });

  it("refuses a TIN that does not match the CT or VAT TRN", () => {
    const co = { corporateTaxId: "100123456700003", trnVatNumber: "100123456700003" };
    expect(tinProblem("1001234567", co)).toBeNull();
    expect(tinProblem("12345", co)).toBe("TIN_FORMAT");
    expect(tinProblem("1009999999", co)).toBe("TIN_CT_TRN_MISMATCH");
    expect(tinProblem("1009999999", { trnVatNumber: "100123456700003" })).toBe(
      "TIN_VAT_TRN_MISMATCH"
    );
    expect(tinProblem("1009999999", {})).toBeNull();
  });

  it("the identity body rejects a TIN that is not 10 digits and unknown keys", () => {
    expect(companyTaxIdentityBody.safeParse({ einvoiceTin: "123" }).success).toBe(false);
    expect(companyTaxIdentityBody.safeParse({ einvoiceTin: "1001234567" }).success).toBe(true);
    expect(companyTaxIdentityBody.safeParse({ trnVatNumber: "x" }).success).toBe(false);
    expect(companyTaxIdentityBody.safeParse({ sellerIdType: "XX" }).success).toBe(false);
  });
});

describe("WQ5 seller legal identifier and missing fields", () => {
  it("uses the explicit type and number, else the trade licence", () => {
    expect(sellerLegalId({ sellerIdType: "EID", sellerIdNumber: "784-1990-1234567-1" })).toEqual({
      type: "EID",
      number: "784-1990-1234567-1",
    });
    expect(sellerLegalId({ tradeLicenceNo: "CN-1" })).toEqual({ type: "TL", number: "CN-1" });
    expect(sellerLegalId({ sellerIdType: "PAS" })).toBeNull();
  });

  it("checks the number format per type", () => {
    expect(sellerIdProblem("EID", "784-1990-1234567-1")).toBeNull();
    expect(sellerIdProblem("EID", "12345")).toBe("SELLER_ID_EID_FORMAT");
    expect(sellerIdProblem("PAS", "N1234567", "in")).toBeNull();
    expect(sellerIdProblem("PAS", "N1234567")).toBe("SELLER_ID_PASSPORT_COUNTRY");
    expect(sellerIdProblem("PAS", "!")).toBe("SELLER_ID_PASSPORT_FORMAT");
    expect(sellerIdProblem("CD", "")).toBe("SELLER_ID_REQUIRED");
  });

  it("lists only what is missing", () => {
    expect(missingSellerFields(fixtureCompany)).toEqual([]);
    expect(
      missingSellerFields({
        name: "Shop",
        addressCountry: "AE",
      })
    ).toEqual(["tin", "sellerId", "addressStreet", "addressCity", "emirate"]);
    expect(
      missingSellerFields({ name: "Shop", corporateTaxId: "100123456700003", addressCountry: "GB" })
    ).toEqual(["sellerId", "addressStreet", "addressCity"]);
  });

  it("typed tax registrations: VAT / CT / excise are 15 digits, an exception is free text", () => {
    expect(
      taxRegistrationSchema.safeParse({ type: "vat", number: "100123456700003" }).success
    ).toBe(true);
    expect(taxRegistrationSchema.safeParse({ type: "ct", number: "123" }).success).toBe(false);
    expect(
      taxRegistrationSchema.safeParse({ type: "vat_exception", number: "EXC-2026-01" }).success
    ).toBe(true);
  });
});

function sellerAndBuyer(company: Company, customer = PINT_AE_FIXTURES[0].customer) {
  const f = PINT_AE_FIXTURES[0];
  const { xml } = generateEInvoiceXML(f.invoice, f.lines, company, customer, f.opts);
  const root = parseXml(xml).documentElement as unknown as Element;
  const seller = first(root, "cac:AccountingSupplierParty/cac:Party") as Element;
  const buyer = first(root, "cac:AccountingCustomerParty/cac:Party") as Element;
  const legal = (p: Element) => first(p, "cac:PartyLegalEntity/cbc:CompanyID") as Element | null;
  return {
    seller: {
      endpoint: textAt(seller, "cbc:EndpointID"),
      legalId: legal(seller)?.textContent ?? null,
      legalType: legal(seller)?.getAttribute("schemeAgencyID") ?? null,
      legalAuthority: legal(seller)?.getAttribute("schemeAgencyName") || null,
    },
    buyer: {
      legalId: legal(buyer)?.textContent ?? null,
      legalType: legal(buyer)?.getAttribute("schemeAgencyID") ?? null,
    },
  };
}

describe("WQ5 PINT AE document uses the stored identity", () => {
  const base = {
    ...fixtureCompany,
    peppolParticipantId: null,
    peppolScheme: null,
  } as unknown as Company;

  it("EndpointID is the stored TIN (not the TRN's first 10) when no participant id is set", () => {
    const company = {
      ...base,
      trnVatNumber: null,
      einvoiceTin: "1007777777",
    } as unknown as Company;
    expect(sellerAndBuyer(company).seller.endpoint).toBe("1007777777");
    expect(companyTin(company)).toBe("1007777777");
  });

  it("falls back to the CT TRN's first 10 digits, then the VAT TRN", () => {
    const company = {
      ...base,
      corporateTaxId: "100555555500003",
    } as unknown as Company;
    expect(sellerAndBuyer(company).seller.endpoint).toBe("1005555555");
    expect(sellerAndBuyer(base).seller.endpoint).toBe("1001234567");
  });

  it("writes the seller ID type (Emirates ID) instead of the trade licence", () => {
    const company = {
      ...base,
      sellerIdType: "EID",
      sellerIdNumber: "784-1990-1234567-1",
    } as unknown as Company;
    expect(sellerAndBuyer(company).seller).toMatchObject({
      legalId: "784-1990-1234567-1",
      legalType: "EID",
      legalAuthority: null,
    });
    // Passport: the issuing country goes in schemeAgencyName (BTAE-18, ibr-012-ae).
    const pas = {
      ...base,
      sellerIdType: "PAS",
      sellerIdNumber: "N1234567",
      sellerIdCountry: "IN",
    } as unknown as Company;
    expect(sellerAndBuyer(pas).seller).toMatchObject({
      legalId: "N1234567",
      legalType: "PAS",
      legalAuthority: "IN",
    });
    // Trade licence keeps its authority.
    expect(sellerAndBuyer(base).seller).toMatchObject({
      legalId: "CN-1234567",
      legalType: "TL",
      legalAuthority: "Dubai Department of Economy and Tourism",
    });
  });

  it("the buyer ID type from the contact reaches the XML", () => {
    const customer = {
      ...PINT_AE_FIXTURES[0].customer,
      legalId: "N1234567",
      legalIdType: "PAS" as const,
    };
    expect(sellerAndBuyer(base, customer).buyer).toEqual({ legalId: "N1234567", legalType: "PAS" });
  });

  it("validation accepts a seller ID other than a trade licence and flags a bad stored TIN", () => {
    const f = PINT_AE_FIXTURES[0];
    const eid = {
      ...base,
      tradeLicenceNo: null,
      registrationNumber: null,
      sellerIdType: "EID",
      sellerIdNumber: "784-1990-1234567-1",
    } as unknown as Company;
    const fields = (c: Company) =>
      validateForEInvoicing(f.invoice, f.lines, c, { customer: f.customer }).map((i) => i.field);
    expect(fields(eid)).not.toContain("company.tradeLicenceNo");
    const none = { ...eid, sellerIdType: null, sellerIdNumber: null } as unknown as Company;
    expect(fields(none)).toContain("company.tradeLicenceNo");
    const badTin = { ...base, einvoiceTin: "1009999999" } as unknown as Company;
    expect(fields(badTin)).toContain("company.einvoiceTin");
  });
});
