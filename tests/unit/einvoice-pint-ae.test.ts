/**
 * R07-04 / R07-05: generated PINT AE XML for the fixture documents passes the
 * UBL 2.1 XSD, the official OpenPeppol PINT AE schematron (2026.5, vendored
 * under server/assets/einvoice/) and the TypeScript rule list, with the right
 * tax categories and exemption reasons per line.
 */
import { describe, expect, it } from "vitest";
import {
  PINT_AE_FIXTURES,
  debitNoteFixture,
  fixtureCompany,
  type PintAeFixture,
} from "../fixtures/pint-ae/fixtures";
import {
  frozenEInvoiceLineCurrencyIssue,
  generateEInvoiceXML,
  validateForEInvoicing,
} from "../../server/services/einvoice.service";
import {
  artefactStatus,
  runPintAeSchematron,
  validateEInvoiceXml,
} from "../../server/services/einvoice/validate";
import { runPintAeRules } from "../../server/services/einvoice/pint-ae-rules";
import { children, first, parseXml, textAt } from "../../server/services/einvoice/dom";

function generate(f: PintAeFixture) {
  return generateEInvoiceXML(f.invoice, f.lines, fixtureCompany, f.customer, f.opts);
}

function categories(xml: string) {
  const root = parseXml(xml).documentElement as unknown as Element;
  const lineTag = root.localName === "CreditNote" ? "cac:CreditNoteLine" : "cac:InvoiceLine";
  return children(root, lineTag).map((l) => textAt(l, "cac:Item/cac:ClassifiedTaxCategory/cbc:ID"));
}

describe("PINT AE artefacts are vendored", () => {
  it("has the UBL 2.1 XSD and the PINT AE 2026.5 schematron", () => {
    expect(artefactStatus()).toEqual({ xsd: true, schematron: true, schematronVersion: "2026.5" });
  });
});

describe("R07-04 seven fixture documents validate with zero errors", () => {
  it("covers standard, zero-rated export, exempt, out of scope, reverse charge, credit note and foreign currency", () => {
    expect(PINT_AE_FIXTURES.map((f) => f.name)).toEqual([
      "standard",
      "zero-rated export",
      "exempt",
      "out of scope",
      "reverse charge",
      "credit note",
      "foreign currency",
    ]);
  });

  for (const f of [...PINT_AE_FIXTURES, debitNoteFixture]) {
    it(`${f.name}: XSD + schematron + rule list`, async () => {
      expect(
        validateForEInvoicing(f.invoice, f.lines, fixtureCompany, {
          customer: f.customer,
          originalInvoice: f.opts.originalInvoice ?? null,
          lineExtras: f.opts.lineExtras,
        })
      ).toEqual([]);
      const { xml, documentType } = generate(f);
      expect(documentType).toBe(f.expectTypeCode);
      const r = await validateEInvoiceXml(xml);
      expect(r.xsd.available).toBe(true);
      expect(r.schematron.available).toBe(true);
      expect(r.xsd.errors).toEqual([]);
      expect(r.schematron.errors).toEqual([]);
      expect(r.rules.errors).toEqual([]);
      expect(r.valid).toBe(true);
    }, 60_000);
  }
});

describe("R07-04 mandatory PINT AE content", () => {
  const { xml } = generate(PINT_AE_FIXTURES[0]);
  const root = parseXml(xml).documentElement as unknown as Element;
  const seller = first(root, "cac:AccountingSupplierParty/cac:Party") as Element;
  const buyer = first(root, "cac:AccountingCustomerParty/cac:Party") as Element;

  it("carries seller and buyer EndpointID with the 0235 scheme", () => {
    expect(first(seller, "cbc:EndpointID")?.getAttribute("schemeID")).toBe("0235");
    expect(textAt(seller, "cbc:EndpointID")).toBe("1001234567");
    expect(textAt(buyer, "cbc:EndpointID")).toBe("1007654321");
  });

  it("carries postal addresses with city and emirate code for both parties", () => {
    expect(textAt(seller, "cac:PostalAddress/cbc:CityName")).toBe("Dubai");
    expect(textAt(seller, "cac:PostalAddress/cbc:CountrySubentity")).toBe("DXB");
    expect(textAt(buyer, "cac:PostalAddress/cbc:StreetName")).toBeTruthy();
    expect(textAt(buyer, "cac:PostalAddress/cbc:CountrySubentity")).toBe("DXB");
  });

  it("carries the trade licence with its authority, IssueTime, DueDate, payment means and terms", () => {
    const legal = first(seller, "cac:PartyLegalEntity/cbc:CompanyID");
    expect(legal?.getAttribute("schemeAgencyID")).toBe("TL");
    expect(legal?.getAttribute("schemeAgencyName")).toContain("Dubai");
    expect(textAt(root, "cbc:IssueTime")).toBe("13:30:00");
    expect(textAt(root, "cbc:DueDate")).toBe("2027-02-14");
    expect(textAt(root, "cac:PaymentMeans/cbc:PaymentMeansCode")).toBe("30");
    expect(textAt(root, "cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:ID")).toMatch(/^AE\d{21}$/);
    expect(textAt(root, "cac:PaymentTerms/cbc:Note")).toBe("Net 30 days");
  });

  it.each([
    ["2026-12-31T19:59:59.999Z", "2026-12-31", "23:59:59"],
    ["2026-12-31T20:00:00.000Z", "2027-01-01", "00:00:00"],
    ["2026-12-31T20:30:45.000Z", "2027-01-01", "00:30:45"],
    ["2027-01-01T00:00:00.000Z", "2027-01-01", "00:00:00"],
    ["2027-01-01T23:59:59.999Z", "2027-01-01", "23:59:59"],
  ])("pairs %s with its UAE business date and clock time", (date, expectedDate, expectedTime) => {
    const f = PINT_AE_FIXTURES[0];
    const { xml: issued } = generateEInvoiceXML(
      { ...f.invoice, date: new Date(date) },
      f.lines,
      fixtureCompany,
      f.customer
    );
    const document = parseXml(issued).documentElement;
    expect(textAt(document, "cbc:IssueDate")).toBe(expectedDate);
    expect(textAt(document, "cbc:IssueTime")).toBe(expectedTime);
  });

  it("states document and line allowances so the totals reconcile", () => {
    const docAllowance = children(root, "cac:AllowanceCharge")[0];
    expect(textAt(docAllowance, "cbc:Amount")).toBe("50.00");
    const line1 = children(root, "cac:InvoiceLine")[0];
    expect(textAt(line1, "cac:AllowanceCharge/cbc:Amount")).toBe("60.00");
    expect(textAt(root, "cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount")).toBe("1690.00");
    expect(textAt(root, "cac:LegalMonetaryTotal/cbc:PayableAmount")).toBe("1774.50");
  });

  it("leaves the signature to the ASP and says so", () => {
    expect(xml).toContain("Digital signature is applied by the Accredited Service Provider");
    expect(xml).not.toContain("<ds:Signature");
  });

  it("states AED VAT, exchange rate and AED total for a foreign-currency invoice", () => {
    const fx = PINT_AE_FIXTURES.find((f) => f.name === "foreign currency") as PintAeFixture;
    const out = generate(fx).xml;
    expect(out).toContain("<cbc:TaxCurrencyCode>AED</cbc:TaxCurrencyCode>");
    expect(out).toContain("<cbc:CalculationRate>3.6725</cbc:CalculationRate>");
    // 50 USD VAT x 3.6725 = 183.63 AED; 1050 x 3.6725 = 3856.13 AED
    expect(out).toContain('<cbc:TaxAmount currencyID="AED">183.63</cbc:TaxAmount>');
    expect(out).toContain("<cbc:DocumentDescription>3856.13</cbc:DocumentDescription>");
  });

  it("[PR174] flags a frozen foreign-currency snapshot whose line amounts are not in AED", () => {
    const fx = PINT_AE_FIXTURES.find((f) => f.name === "foreign currency") as PintAeFixture;
    const out = generate(fx).xml;
    expect(frozenEInvoiceLineCurrencyIssue(out)).toBeNull();
    expect(frozenEInvoiceLineCurrencyIssue(xml)).toBeNull();
    const legacy = out.replace(
      /<cac:ItemPriceExtension>[\s\S]*?<\/cac:ItemPriceExtension>/g,
      (block) => block.replaceAll('currencyID="AED"', 'currencyID="USD"')
    );
    expect(frozenEInvoiceLineCurrencyIssue(legacy)).toBe("EINVOICE_SCHEMA_INVALID");
    expect(frozenEInvoiceLineCurrencyIssue("<Invoice><cbc:ID>")).toBe("EINVOICE_SCHEMA_INVALID");
    expect(frozenEInvoiceLineCurrencyIssue("not xml at all")).toBe("EINVOICE_SCHEMA_INVALID");
  });

  it("credit notes are UBL CreditNote documents with reason code and billing reference", () => {
    const cn = PINT_AE_FIXTURES.find((f) => f.name === "credit note") as PintAeFixture;
    const out = generate(cn).xml;
    expect(out).toContain("<CreditNote ");
    expect(out).toContain("<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>");
    expect(out).toContain("<cbc:ResponseCode>DL8.61.1.C</cbc:ResponseCode>");
    expect(out).toContain("<cbc:ID>INV-2027-0001</cbc:ID>");
    expect(out).toContain('<cbc:CreditedQuantity unitCode="EA">1</cbc:CreditedQuantity>');
  });

  it("debit notes reference the original invoice", () => {
    const out = generate(debitNoteFixture).xml;
    expect(out).toContain("<cac:BillingReference>");
    expect(out).toContain("<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>");
  });
});

describe("R07-05 categories come from the stored supply type via classifySupply", () => {
  const expected: Record<string, string[]> = {
    standard: ["S", "S"],
    "zero-rated export": ["Z"],
    exempt: ["E", "S"],
    "out of scope": ["O"],
    "reverse charge": ["AE"],
    "credit note": ["S"],
    "foreign currency": ["S"],
  };
  for (const f of PINT_AE_FIXTURES) {
    it(`${f.name} lines are ${expected[f.name].join(",")}`, () => {
      expect(categories(generate(f).xml)).toEqual(expected[f.name]);
    });
  }

  it("a mixed invoice yields one TaxSubtotal per category with exemption reasons", () => {
    const base = PINT_AE_FIXTURES[0];
    const mixed: PintAeFixture = {
      ...base,
      invoice: {
        ...base.invoice,
        discountType: null,
        discountValue: null,
        discountAmount: 0,
        subtotal: 1600,
        vatAmount: 50,
        total: 1650,
      } as PintAeFixture["invoice"],
      lines: [
        {
          ...base.lines[1],
          description: "Standard",
          unitPrice: 1000,
          vatRate: 0.05,
          vatSupplyType: "standard_rated",
        },
        {
          ...base.lines[1],
          description: "Zero",
          unitPrice: 300,
          vatRate: 0,
          vatSupplyType: "zero_rated",
        },
        {
          ...base.lines[1],
          description: "Exempt",
          unitPrice: 200,
          vatRate: 0,
          vatSupplyType: "exempt",
        },
        {
          ...base.lines[1],
          description: "Out of scope",
          unitPrice: 100,
          vatRate: 0,
          vatSupplyType: "out_of_scope",
        },
      ] as PintAeFixture["lines"],
    };
    const { xml } = generate(mixed);
    const root = parseXml(xml).documentElement as unknown as Element;
    const subs = children(first(root, "cac:TaxTotal") as Element, "cac:TaxSubtotal").map((s) => ({
      id: textAt(s, "cac:TaxCategory/cbc:ID"),
      taxable: textAt(s, "cbc:TaxableAmount"),
      reason: textAt(s, "cac:TaxCategory/cbc:TaxExemptionReasonCode"),
    }));
    expect(subs).toEqual([
      { id: "S", taxable: "1000.00", reason: null },
      { id: "Z", taxable: "300.00", reason: null },
      { id: "E", taxable: "200.00", reason: "VATEX-AE-EX" },
      { id: "O", taxable: "100.00", reason: "VATEX-AE-OOS" },
    ]);
    expect(categories(xml)).toEqual(["S", "Z", "E", "O"]);
    expect(runPintAeRules(xml).filter((f) => f.flag === "fatal")).toEqual([]);
  });
});

describe("the validators reject broken documents (they are not no-ops)", () => {
  it("official schematron and rule list both flag missing seller/buyer cities (ibr-143-ae / ibr-144-ae)", async () => {
    const { xml } = generate(PINT_AE_FIXTURES[0]);
    const broken = xml.replace(/<cbc:CityName>Dubai<\/cbc:CityName>/g, "");
    const sch = await runPintAeSchematron(broken);
    expect(sch.errors.map((e) => e.id).sort()).toEqual(["ibr-143-ae", "ibr-144-ae"]);
    expect(
      runPintAeRules(broken)
        .map((e) => e.id)
        .sort()
    ).toEqual(["ibr-143-ae", "ibr-144-ae"]);
  }, 60_000);

  it("the rule list is stricter than the shadowed official ibr-128-ae for party addresses", async () => {
    const { xml } = generate(PINT_AE_FIXTURES[0]);
    const broken = xml.replace(
      /<cbc:CountrySubentity>DXB<\/cbc:CountrySubentity>/g,
      "<cbc:CountrySubentity>Dubai</cbc:CountrySubentity>"
    );
    // Official 2026.5: ibr-128-ae sits on a lower-priority cac:PostalAddress rule, so
    // seller/buyer addresses (matched by higher-priority rules) are not checked.
    expect((await runPintAeSchematron(broken)).errors.map((e) => e.id)).not.toContain("ibr-128-ae");
    expect(runPintAeRules(broken).filter((e) => e.id === "ibr-128-ae")).toHaveLength(2);
  }, 60_000);

  it("XSD rejects elements out of UBL order", async () => {
    const { xml } = generate(PINT_AE_FIXTURES[0]);
    const broken = xml
      .replace("<cbc:IssueTime>13:30:00</cbc:IssueTime>", "")
      .replace(
        "<cbc:DueDate>2027-02-14</cbc:DueDate>",
        "<cbc:DueDate>2027-02-14</cbc:DueDate>\n  <cbc:IssueTime>13:30:00</cbc:IssueTime>"
      );
    const r = await validateEInvoiceXml(broken);
    expect(r.xsd.valid).toBe(false);
    expect(r.valid).toBe(false);
  }, 60_000);

  it("a reverse-charge line without GTIN / goods type is refused before generation", () => {
    const rc = PINT_AE_FIXTURES.find((f) => f.name === "reverse charge") as PintAeFixture;
    const issues = validateForEInvoicing(rc.invoice, rc.lines, fixtureCompany, {
      customer: rc.customer,
    });
    expect(issues.map((i) => i.field)).toEqual(["lines[0].gtin", "lines[0].rcmGoodsType"]);
  });

  it("an incomplete company is refused with the PINT AE rule ids", () => {
    const issues = validateForEInvoicing(PINT_AE_FIXTURES[0].invoice, PINT_AE_FIXTURES[0].lines, {
      ...fixtureCompany,
      addressCity: null,
      emirate: null,
      tradeLicenceNo: null,
    } as typeof fixtureCompany);
    expect(issues.map((i) => i.field)).toEqual([
      "company.addressCity",
      "company.emirate",
      "company.tradeLicenceNo",
    ]);
  });
});
