/**
 * PINT AE business rules as an explicit TypeScript list keyed by the official
 * rule id (OpenPeppol PINT AE schematron 2026.5 + the EN 16931 calculation
 * rules it inherits). This runs everywhere — including production images
 * that do not ship the vendored schematron — and is cross-checked against the
 * official schematron in tests/unit/einvoice-pint-ae.test.ts.
 */
import {
  CREDIT_NOTE_REASON_CODES,
  EMIRATE_SUBENTITY_CODES,
  RCM_GOODS_TYPE_CODES,
} from "./pint-ae-codes";
import { all, attr, children, first, fils, parseXml, text, textAt, type XNode } from "./dom";

export type RuleFlag = "fatal" | "warning";

export interface RuleFinding {
  id: string;
  flag: RuleFlag;
  message: string;
  location?: string;
}

interface RuleCtx {
  root: XNode;
  isCredit: boolean;
  typeCode: string | null;
  currency: string | null;
  lines: XNode[];
  seller: XNode | null;
  buyer: XNode | null;
}

interface Rule {
  id: string;
  flag: RuleFlag;
  message: string;
  /** Returns the failing locations (empty = pass). */
  check: (c: RuleCtx) => string[];
}

const ALIGNED_CATEGORIES = ["S", "Z", "E", "O", "AE"];
const fail = (cond: boolean, loc = "/"): string[] => (cond ? [loc] : []);
const lineCategory = (line: XNode) => textAt(line, "cac:Item/cac:ClassifiedTaxCategory/cbc:ID");
const lineLoc = (line: XNode) => `line ${textAt(line, "cbc:ID") ?? "?"}`;

function docAllowances(c: RuleCtx, charge: boolean): XNode[] {
  return children(c.root, "cac:AllowanceCharge").filter(
    (a) => textAt(a, "cbc:ChargeIndicator") === String(charge)
  );
}

function subtotals(c: RuleCtx): XNode[] {
  const tt = children(c.root, "cac:TaxTotal").find(
    (t) => children(t, "cac:TaxSubtotal").length > 0
  );
  return tt ? children(tt, "cac:TaxSubtotal") : [];
}

export const PINT_AE_RULES: readonly Rule[] = [
  {
    id: "aligned-ibrp-001-ae",
    flag: "fatal",
    message: "Specification identifier (ibt-024) MUST start with 'urn:peppol:pint:billing-1@ae-1'.",
    check: (c) =>
      fail(
        !(textAt(c.root, "cbc:CustomizationID") ?? "").startsWith("urn:peppol:pint:billing-1@ae-1")
      ),
  },
  {
    id: "aligned-ibrp-002-ae",
    flag: "fatal",
    message: "Business process (ibt-023) MUST be 'urn:peppol:bis:billing'.",
    check: (c) => fail(textAt(c.root, "cbc:ProfileID") !== "urn:peppol:bis:billing"),
  },
  {
    id: "ibr-154-ae",
    flag: "fatal",
    message: "Invoice transaction type code (BTAE-02) MUST be eight 0/1 characters.",
    check: (c) => fail(!/^[01]{8}$/.test(textAt(c.root, "cbc:ProfileExecutionID") ?? "")),
  },
  {
    id: "ibr-193-ae",
    flag: "fatal",
    message: "The unique identifier number (BTAE-07, cbc:UUID) must be provided.",
    check: (c) => fail(!textAt(c.root, "cbc:UUID")),
  },
  {
    id: "PINT-IssueTime",
    flag: "fatal",
    message: "Invoice issue time (cbc:IssueTime) must be provided for UAE e-invoices.",
    check: (c) => fail(!/^\d{2}:\d{2}:\d{2}/.test(textAt(c.root, "cbc:IssueTime") ?? "")),
  },
  {
    id: "ibr-127-ae",
    flag: "fatal",
    message: "Payment due date (IBT-009) MUST be present when the amount due is greater than 0.",
    check: (c) =>
      fail(
        !c.isCredit &&
          fils(textAt(c.root, "cac:LegalMonetaryTotal/cbc:PayableAmount")) > 0 &&
          !textAt(c.root, "cbc:DueDate")
      ),
  },
  {
    id: "ibr-158-ae",
    flag: "fatal",
    message: "A credit note MUST carry a credit note reason code (BTAE-03).",
    check: (c) =>
      fail(c.typeCode === "381" && !textAt(c.root, "cac:DiscrepancyResponse/cbc:ResponseCode")),
  },
  {
    id: "ibr-001-ae",
    flag: "fatal",
    message: "Credit note reason code (BTAE-03) must be from the credit note reason code list.",
    check: (c) => {
      const code = textAt(c.root, "cac:DiscrepancyResponse/cbc:ResponseCode");
      return fail(code !== null && !(code in CREDIT_NOTE_REASON_CODES));
    },
  },
  {
    id: "ibr-055-ae",
    flag: "fatal",
    message: "A credit note MUST reference the preceding invoice (IBG-03) unless the reason is VD.",
    check: (c) =>
      fail(
        c.typeCode === "381" &&
          textAt(c.root, "cac:DiscrepancyResponse/cbc:ResponseCode") !== "VD" &&
          !textAt(c.root, "cac:BillingReference/cac:InvoiceDocumentReference/cbc:ID")
      ),
  },
  {
    id: "ibr-124-ae",
    flag: "fatal",
    message: "VAT point date (IBT-007) MUST not be there on a credit note.",
    check: (c) => fail(c.isCredit && !!textAt(c.root, "cbc:TaxPointDate")),
  },
  {
    id: "ibr-140-ae",
    flag: "fatal",
    message: "When the VAT accounting currency (IBT-006) is present it shall be AED.",
    check: (c) => {
      const t = textAt(c.root, "cbc:TaxCurrencyCode");
      return fail(t !== null && t !== "AED");
    },
  },
  {
    id: "ibr-159-ae",
    flag: "fatal",
    message: "Currency exchange rate (BTAE-04) is required when the invoice currency is not AED.",
    check: (c) =>
      fail(c.currency !== "AED" && !textAt(c.root, "cac:TaxExchangeRate/cbc:CalculationRate")),
  },
  {
    id: "ibr-002-ae",
    flag: "fatal",
    message: "Currency exchange rate (BTAE-04) may have at most 6 decimal places.",
    check: (c) => {
      const r = textAt(c.root, "cac:TaxExchangeRate/cbc:CalculationRate");
      return fail(r !== null && !/^[0-9]+(\.[0-9]{1,6})?$/.test(r));
    },
  },
  {
    id: "ibr-153-ae",
    flag: "fatal",
    message: "Tax exchange rate must convert from the invoice currency to AED.",
    check: (c) =>
      fail(
        c.currency !== "AED" &&
          textAt(c.root, "cbc:TaxCurrencyCode") === "AED" &&
          (textAt(c.root, "cac:TaxExchangeRate/cbc:SourceCurrencyCode") !== c.currency ||
            textAt(c.root, "cac:TaxExchangeRate/cbc:TargetCurrencyCode") !== "AED")
      ),
  },
  {
    id: "ibr-175-ae",
    flag: "fatal",
    message: "A foreign-currency invoice MUST state total VAT and total incl. VAT in AED.",
    check: (c) => {
      if (c.currency === "AED") return [];
      const aedTax = children(c.root, "cac:TaxTotal").some(
        (t) => attr(first(t, "cbc:TaxAmount"), "currencyID") === "AED"
      );
      const aedTotal = children(c.root, "cac:AdditionalDocumentReference").some(
        (r) =>
          textAt(r, "cbc:DocumentTypeCode") === "aedtotal-incl-vat" &&
          !!textAt(r, "cbc:DocumentDescription")
      );
      return fail(textAt(c.root, "cbc:TaxCurrencyCode") !== "AED" || !aedTax || !aedTotal);
    },
  },
  {
    id: "PINT-EndpointID",
    flag: "fatal",
    message:
      "Seller and buyer electronic addresses (IBT-034 / IBT-049) with a scheme are required.",
    check: (c) =>
      [c.seller, c.buyer].flatMap((p, i) =>
        fail(
          !p || !textAt(p, "cbc:EndpointID") || !attr(first(p, "cbc:EndpointID"), "schemeID"),
          i ? "buyer" : "seller"
        )
      ),
  },
  {
    id: "ibr-128-ae",
    flag: "fatal",
    message: "A UAE address must use an emirate code (AUH, DXB, SHJ, UAQ, FUJ, AJM, RAK).",
    check: (c) =>
      [c.seller, c.buyer]
        .filter((p): p is XNode => !!p)
        .flatMap((p) => all(p, "cac:PostalAddress"))
        .filter((a) => textAt(a, "cac:Country/cbc:IdentificationCode") === "AE")
        .flatMap((a) =>
          fail(
            !(EMIRATE_SUBENTITY_CODES as readonly string[]).includes(
              textAt(a, "cbc:CountrySubentity") ?? ""
            ),
            "PostalAddress"
          )
        ),
  },
  {
    id: "ibr-143-ae",
    flag: "fatal",
    message: "Seller address line 1, city and country subdivision must be provided.",
    check: (c) => {
      const a = c.seller ? first(c.seller, "cac:PostalAddress") : null;
      return fail(
        !a ||
          !textAt(a, "cbc:StreetName") ||
          !textAt(a, "cbc:CityName") ||
          !textAt(a, "cbc:CountrySubentity")
      );
    },
  },
  {
    id: "ibr-144-ae",
    flag: "fatal",
    message: "Buyer address line 1, city and country subdivision must be provided.",
    check: (c) => {
      const a = c.buyer ? first(c.buyer, "cac:PostalAddress") : null;
      return fail(
        !a ||
          !textAt(a, "cbc:StreetName") ||
          !textAt(a, "cbc:CityName") ||
          !textAt(a, "cbc:CountrySubentity")
      );
    },
  },
  {
    id: "ibr-152-ae",
    flag: "fatal",
    message:
      "An export (BTAE-02 XXXXXXX1) MUST state the deliver-to address line 1, city and subdivision.",
    check: (c) => {
      if (!/^[01]{7}1$/.test(textAt(c.root, "cbc:ProfileExecutionID") ?? "")) return [];
      const a = first(c.root, "cac:Delivery/cac:DeliveryLocation/cac:Address");
      if (a && textAt(a, "cac:Country/cbc:IdentificationCode") === "AE") return [];
      return fail(
        !a ||
          !textAt(a, "cbc:StreetName") ||
          !textAt(a, "cbc:CityName") ||
          !textAt(a, "cbc:CountrySubentity")
      );
    },
  },
  {
    id: "ibr-cl-01",
    flag: "fatal",
    message:
      "Document type code (ibt-003) must be 380/480 for an Invoice or 381/81 for a CreditNote.",
    check: (c) => fail(!(c.isCredit ? ["381", "81"] : ["380", "480"]).includes(c.typeCode ?? "")),
  },
  {
    id: "ibr-132-ae",
    flag: "fatal",
    message: "VAT identifier must be a TRN: 15 digits, starting with 1 and ending with 03.",
    check: (c) =>
      [c.seller, c.buyer]
        .filter((p): p is XNode => !!p)
        .flatMap((p) => all(p, "cac:PartyTaxScheme"))
        .filter((t) => textAt(t, "cac:TaxScheme/cbc:ID") === "VAT")
        .flatMap((t) =>
          fail(!/^1\d{12}03$/.test(textAt(t, "cbc:CompanyID") ?? ""), "PartyTaxScheme")
        ),
  },
  {
    id: "ibr-134-ae",
    flag: "fatal",
    message: "Seller VAT identifier (IBT-031) MUST be there except on out-of-scope invoices.",
    check: (c) =>
      fail(
        c.typeCode !== "480" &&
          c.typeCode !== "81" &&
          !(c.seller && textAt(c.seller, "cac:PartyTaxScheme/cbc:CompanyID"))
      ),
  },
  {
    id: "ibr-150-ae",
    flag: "fatal",
    message: "Seller legal registration identifier (IBT-030) MUST be provided for scheme 0235.",
    check: (c) =>
      fail(
        !!c.seller &&
          attr(first(c.seller, "cbc:EndpointID"), "schemeID") === "0235" &&
          !textAt(c.seller, "cac:PartyLegalEntity/cbc:CompanyID")
      ),
  },
  {
    id: "ibr-181-ae",
    flag: "fatal",
    message: "Seller legal registration identifier type (BTAE-15) MUST be present for scheme 0235.",
    check: (c) => {
      const id = c.seller ? first(c.seller, "cac:PartyLegalEntity/cbc:CompanyID") : null;
      return fail(
        !!id &&
          attr(first(c.seller as XNode, "cbc:EndpointID"), "schemeID") === "0235" &&
          !["TL", "EID", "PAS", "CD"].includes(attr(id, "schemeAgencyID") ?? "")
      );
    },
  },
  {
    id: "ibr-172-ae",
    flag: "fatal",
    message: "Authority name (BTAE-12) MUST be there for a commercial/trade licence.",
    check: (c) =>
      [c.seller, c.buyer]
        .filter((p): p is XNode => !!p)
        .map((p) => first(p, "cac:PartyLegalEntity/cbc:CompanyID"))
        .flatMap((id) =>
          fail(
            !!id && attr(id, "schemeAgencyID") === "TL" && !attr(id, "schemeAgencyName"),
            "CompanyID"
          )
        ),
  },
  {
    id: "ibr-103-ae",
    flag: "fatal",
    message: "A reverse-charge invoice MUST carry the buyer VAT identifier (IBT-048).",
    check: (c) =>
      fail(
        c.lines.some((l) => lineCategory(l) === "AE") &&
          !(c.buyer && textAt(c.buyer, "cac:PartyTaxScheme/cbc:CompanyID"))
      ),
  },
  {
    id: "ibr-145-ae",
    flag: "fatal",
    message: "Each invoice line MUST carry an item VAT category code (IBT-151).",
    check: (c) => c.lines.flatMap((l) => fail(!lineCategory(l), lineLoc(l))),
  },
  {
    id: "ibr-139-ae",
    flag: "fatal",
    message: "Tax category codes must be from the aligned code list (S, Z, E, O, AE).",
    check: (c) => {
      const codes = [
        ...c.lines.map((l) => lineCategory(l)),
        ...subtotals(c).map((s) => textAt(s, "cac:TaxCategory/cbc:ID")),
        ...children(c.root, "cac:AllowanceCharge").map((a) => textAt(a, "cac:TaxCategory/cbc:ID")),
      ];
      return codes.flatMap((code) => fail(!ALIGNED_CATEGORIES.includes(code ?? ""), String(code)));
    },
  },
  {
    id: "ibr-123-ae",
    flag: "fatal",
    message: "Line VAT information (IBG-30) can occur at most once per line.",
    check: (c) =>
      c.lines.flatMap((l) =>
        fail(all(l, "cac:Item/cac:ClassifiedTaxCategory").length !== 1, lineLoc(l))
      ),
  },
  {
    id: "ibr-125-ae",
    flag: "fatal",
    message: "Item description (IBT-154) MUST be there.",
    check: (c) => c.lines.flatMap((l) => fail(!textAt(l, "cac:Item/cbc:Description"), lineLoc(l))),
  },
  {
    id: "ibr-126-ae",
    flag: "fatal",
    message: "Item price base quantity (IBT-149) and gross price (IBT-148) MUST be there.",
    check: (c) =>
      c.lines.flatMap((l) =>
        fail(
          !textAt(l, "cac:Price/cbc:BaseQuantity") ||
            !textAt(l, "cac:Price/cac:AllowanceCharge/cbc:BaseAmount"),
          lineLoc(l)
        )
      ),
  },
  {
    id: "ibr-104-ae",
    flag: "fatal",
    message:
      "Lines with VAT information must state the line amount (BTAE-10) and line VAT (BTAE-08).",
    check: (c) =>
      c.lines
        .filter((l) => lineCategory(l) !== "E")
        .flatMap((l) =>
          fail(
            !textAt(l, "cac:ItemPriceExtension/cbc:Amount") ||
              !textAt(l, "cac:ItemPriceExtension/cac:TaxTotal/cbc:TaxAmount"),
            lineLoc(l)
          )
        ),
  },
  {
    id: "ibr-194-ae",
    flag: "fatal",
    message: "Invoice line amount payable (BTAE-10) must be provided.",
    check: (c) =>
      c.lines.flatMap((l) => fail(!textAt(l, "cac:ItemPriceExtension/cbc:Amount"), lineLoc(l))),
  },
  {
    id: "ibr-163-ae",
    flag: "fatal",
    message: "An exempt line shall not carry a VAT line amount (BTAE-08).",
    check: (c) =>
      c.lines
        .filter((l) => lineCategory(l) === "E")
        .flatMap((l) =>
          fail(!!textAt(l, "cac:ItemPriceExtension/cac:TaxTotal/cbc:TaxAmount"), lineLoc(l))
        ),
  },
  {
    id: "ibr-165-ae",
    flag: "fatal",
    message: "A zero-rated line MUST carry a zero VAT line amount (BTAE-08).",
    check: (c) =>
      c.lines
        .filter((l) => lineCategory(l) === "Z")
        .flatMap((l) =>
          fail(
            fils(textAt(l, "cac:ItemPriceExtension/cac:TaxTotal/cbc:TaxAmount")) !== 0,
            lineLoc(l)
          )
        ),
  },
  {
    id: "ibr-162-ae",
    flag: "fatal",
    message: "A reverse-charge line MUST carry a zero VAT line amount (BTAE-08).",
    check: (c) =>
      c.lines
        .filter((l) => lineCategory(l) === "AE")
        .flatMap((l) =>
          fail(
            fils(textAt(l, "cac:ItemPriceExtension/cac:TaxTotal/cbc:TaxAmount")) !== 0,
            lineLoc(l)
          )
        ),
  },
  {
    id: "ibr-167-ae",
    flag: "fatal",
    message: "An exempt line MUST carry a VAT exemption reason code (IBT-186).",
    check: (c) =>
      c.lines
        .filter((l) => lineCategory(l) === "E")
        .flatMap((l) =>
          fail(
            !textAt(l, "cac:Item/cac:ClassifiedTaxCategory/cbc:TaxExemptionReasonCode"),
            lineLoc(l)
          )
        ),
  },
  {
    id: "ibr-174-ae",
    flag: "fatal",
    message: "A reverse-charge item MUST carry a standard identifier with scheme 0160.",
    check: (c) =>
      c.lines
        .filter((l) => lineCategory(l) === "AE")
        .flatMap((l) =>
          fail(
            attr(first(l, "cac:Item/cac:StandardItemIdentification/cbc:ID"), "schemeID") !== "0160",
            lineLoc(l)
          )
        ),
  },
  {
    id: "ibr-166-ae",
    flag: "fatal",
    message:
      "A reverse-charge item MUST state the type of goods or services (BTAE-09) from the RCM list.",
    check: (c) =>
      c.lines
        .filter((l) => lineCategory(l) === "AE")
        .flatMap((l) =>
          fail(
            !(RCM_GOODS_TYPE_CODES as readonly string[]).includes(
              textAt(l, "cac:Item/cac:CommodityClassification/cbc:NatureCode") ?? ""
            ),
            lineLoc(l)
          )
        ),
  },
  {
    id: "ibr-190-ae",
    flag: "fatal",
    message: "Standard-rated categories must use the 5% rate.",
    check: (c) => {
      const percents = [
        ...c.lines
          .map((l) => first(l, "cac:Item/cac:ClassifiedTaxCategory"))
          .filter((t): t is XNode => !!t && textAt(t, "cbc:ID") === "S"),
        ...subtotals(c)
          .map((s) => first(s, "cac:TaxCategory"))
          .filter((t): t is XNode => !!t && textAt(t, "cbc:ID") === "S"),
      ].map((t) => Number(textAt(t, "cbc:Percent")));
      return percents.flatMap((p) => fail(p !== 5, "S"));
    },
  },
  {
    id: "ibr-120-ae",
    flag: "fatal",
    message: "A zero-rated VAT breakdown shall have a 0 rate.",
    check: (c) =>
      subtotals(c)
        .filter((s) => textAt(s, "cac:TaxCategory/cbc:ID") === "Z")
        .flatMap((s) => fail(Number(textAt(s, "cac:TaxCategory/cbc:Percent")) !== 0, "Z")),
  },
  {
    id: "ibr-121-ae",
    flag: "fatal",
    message: "An exempt VAT breakdown shall not carry a rate.",
    check: (c) =>
      subtotals(c)
        .filter((s) => textAt(s, "cac:TaxCategory/cbc:ID") === "E")
        .flatMap((s) => fail(!!textAt(s, "cac:TaxCategory/cbc:Percent"), "E")),
  },
  {
    id: "aligned-ibrp-o-11-ae",
    flag: "fatal",
    message: "An out-of-scope VAT breakdown shall not carry a rate.",
    check: (c) =>
      subtotals(c)
        .filter((s) => textAt(s, "cac:TaxCategory/cbc:ID") === "O")
        .flatMap((s) => fail(!!textAt(s, "cac:TaxCategory/cbc:Percent"), "O")),
  },
  {
    id: "aligned-ibrp-ae-09-ae",
    flag: "fatal",
    message: "A reverse-charge VAT breakdown MUST have a zero tax amount.",
    check: (c) =>
      subtotals(c)
        .filter((s) => textAt(s, "cac:TaxCategory/cbc:ID") === "AE")
        .flatMap((s) => fail(fils(textAt(s, "cbc:TaxAmount")) !== 0, "AE")),
  },
  {
    id: "ibr-191-ae",
    flag: "fatal",
    message: "Payment means type code (ibt-081) must be provided except on credit notes.",
    check: (c) => fail(!c.isCredit && !textAt(c.root, "cac:PaymentMeans/cbc:PaymentMeansCode")),
  },
  {
    id: "ibr-192-ae",
    flag: "fatal",
    message: "A credit-transfer payment means must carry the payment account identifier (ibt-084).",
    check: (c) =>
      children(c.root, "cac:PaymentMeans")
        .filter((p) => ["30", "58"].includes(textAt(p, "cbc:PaymentMeansCode") ?? ""))
        .flatMap((p) => fail(!textAt(p, "cac:PayeeFinancialAccount/cbc:ID"), "PaymentMeans")),
  },
  {
    id: "ibr-147-ae",
    flag: "fatal",
    message:
      "Line net amount MUST equal quantity x net price less line allowances plus line charges.",
    check: (c) =>
      c.lines.flatMap((l) => {
        const qty = Number(textAt(l, "cbc:InvoicedQuantity") ?? textAt(l, "cbc:CreditedQuantity"));
        const price = fils(textAt(l, "cac:Price/cbc:PriceAmount"));
        const base = Number(textAt(l, "cac:Price/cbc:BaseQuantity") ?? 1) || 1;
        const ac = children(l, "cac:AllowanceCharge");
        const allowance = ac
          .filter((a) => textAt(a, "cbc:ChargeIndicator") === "false")
          .reduce((s, a) => s + fils(textAt(a, "cbc:Amount")), 0);
        const charge = ac
          .filter((a) => textAt(a, "cbc:ChargeIndicator") === "true")
          .reduce((s, a) => s + fils(textAt(a, "cbc:Amount")), 0);
        const expected = Math.round((qty * price) / base) + charge - allowance;
        return fail(
          Math.abs(expected - fils(textAt(l, "cbc:LineExtensionAmount"))) > 1,
          lineLoc(l)
        );
      }),
  },
  {
    id: "BR-CO-10",
    flag: "fatal",
    message: "Sum of invoice line net amounts MUST equal the document line extension amount.",
    check: (c) => {
      const sum = c.lines.reduce((s, l) => s + fils(textAt(l, "cbc:LineExtensionAmount")), 0);
      return fail(sum !== fils(textAt(c.root, "cac:LegalMonetaryTotal/cbc:LineExtensionAmount")));
    },
  },
  {
    id: "BR-CO-13",
    flag: "fatal",
    message: "Tax exclusive amount MUST equal line total less allowances plus charges.",
    check: (c) => {
      const lm = first(c.root, "cac:LegalMonetaryTotal");
      if (!lm) return ["LegalMonetaryTotal"];
      const allowances = docAllowances(c, false).reduce(
        (s, a) => s + fils(textAt(a, "cbc:Amount")),
        0
      );
      const charges = docAllowances(c, true).reduce((s, a) => s + fils(textAt(a, "cbc:Amount")), 0);
      return fail(
        fils(textAt(lm, "cbc:LineExtensionAmount")) - allowances + charges !==
          fils(textAt(lm, "cbc:TaxExclusiveAmount"))
      );
    },
  },
  {
    id: "BR-CO-14",
    flag: "fatal",
    message: "Invoice total VAT MUST equal the sum of VAT category tax amounts.",
    check: (c) => {
      const tt = children(c.root, "cac:TaxTotal").find(
        (t) => children(t, "cac:TaxSubtotal").length > 0
      );
      if (!tt) return ["TaxTotal"];
      const sum = children(tt, "cac:TaxSubtotal").reduce(
        (s, st) => s + fils(textAt(st, "cbc:TaxAmount")),
        0
      );
      return fail(sum !== fils(textAt(tt, "cbc:TaxAmount")));
    },
  },
  {
    id: "BR-CO-15",
    flag: "fatal",
    message: "Tax inclusive amount MUST equal tax exclusive amount plus total VAT.",
    check: (c) => {
      const lm = first(c.root, "cac:LegalMonetaryTotal");
      const tt = children(c.root, "cac:TaxTotal").find(
        (t) => attr(first(t, "cbc:TaxAmount"), "currencyID") === c.currency
      );
      if (!lm || !tt) return ["LegalMonetaryTotal"];
      return fail(
        fils(textAt(lm, "cbc:TaxExclusiveAmount")) + fils(textAt(tt, "cbc:TaxAmount")) !==
          fils(textAt(lm, "cbc:TaxInclusiveAmount"))
      );
    },
  },
  {
    id: "BR-CAT-08",
    flag: "fatal",
    message: "Each VAT category taxable amount MUST equal its line net amounts less allowances.",
    check: (c) =>
      subtotals(c).flatMap((st) => {
        const cat = textAt(st, "cac:TaxCategory/cbc:ID");
        const lines = c.lines
          .filter((l) => lineCategory(l) === cat)
          .reduce((s, l) => s + fils(textAt(l, "cbc:LineExtensionAmount")), 0);
        const allowances = docAllowances(c, false)
          .filter((a) => textAt(a, "cac:TaxCategory/cbc:ID") === cat)
          .reduce((s, a) => s + fils(textAt(a, "cbc:Amount")), 0);
        const charges = docAllowances(c, true)
          .filter((a) => textAt(a, "cac:TaxCategory/cbc:ID") === cat)
          .reduce((s, a) => s + fils(textAt(a, "cbc:Amount")), 0);
        return fail(
          lines - allowances + charges !== fils(textAt(st, "cbc:TaxableAmount")),
          String(cat)
        );
      }),
  },
  {
    id: "ibr-151-ae",
    flag: "warning",
    message:
      "A commercial invoice or credit note should not contain only exempt and/or out-of-scope lines.",
    check: (c) =>
      fail(
        (c.typeCode === "380" || c.typeCode === "381") &&
          c.lines.length > 0 &&
          c.lines.every((l) => ["E", "O"].includes(lineCategory(l) ?? ""))
      ),
  },
];

/** Run the rule list on a UBL document. Malformed XML yields one fatal finding. */
export function runPintAeRules(xml: string): RuleFinding[] {
  let doc: Document;
  try {
    doc = parseXml(xml);
  } catch (err) {
    return [{ id: "XML-WELLFORMED", flag: "fatal", message: (err as Error).message }];
  }
  const root = doc.documentElement as unknown as XNode;
  const isCredit = root.localName === "CreditNote";
  const ctx: RuleCtx = {
    root,
    isCredit,
    typeCode: text(first(root, isCredit ? "cbc:CreditNoteTypeCode" : "cbc:InvoiceTypeCode")),
    currency: textAt(root, "cbc:DocumentCurrencyCode"),
    lines: children(root, isCredit ? "cac:CreditNoteLine" : "cac:InvoiceLine"),
    seller: first(root, "cac:AccountingSupplierParty/cac:Party"),
    buyer: first(root, "cac:AccountingCustomerParty/cac:Party"),
  };
  const findings: RuleFinding[] = [];
  for (const rule of PINT_AE_RULES) {
    for (const location of rule.check(ctx)) {
      findings.push({ id: rule.id, flag: rule.flag, message: rule.message, location });
    }
  }
  return findings;
}
