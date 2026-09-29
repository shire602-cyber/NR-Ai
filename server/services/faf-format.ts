/**
 * FTA Audit File (FAF) layout: EVERY column header, block marker, tax code and
 * file-level constant lives here so the layout can be corrected against the
 * official FTA FAF specification without touching any logic.
 *
 * !! VERIFY BEFORE RELYING ON IT !!
 * The FTA's published FAF specification could not be consulted while this was
 * built (no network access). The block order and the columns below implement
 * the layout as it was described to us (company information, purchase listing,
 * supply listing, general ledger listing, each with a footer of totals), but the
 * exact marker names, column names/order, date format, delimiter, decimal rules
 * and FAF version string MUST be checked against the FTA's published FAF
 * specification (and, ideally, validated with the FTA's own FAF checker) before
 * this file is produced for a real audit.
 */

/** Delimiter between fields. */
export const FAF_DELIMITER = ",";
/** Line terminator (text file for Windows-based FTA tooling). */
export const FAF_EOL = "\r\n";
/** Prefix a UTF-8 byte order mark (helps Excel read Arabic; some parsers dislike it). */
export const FAF_EMIT_BOM = false;

/** Version string written in the company block. UNVERIFIED: confirm against the FTA spec. */
export const FAF_FILE_VERSION = "FAFv1.0";
/** Product name written before the version in the company block. */
export const FAF_PRODUCT_NAME = "Muhasib.ai";

/** Country written on supply lines: we do not record a destination country per invoice. */
export const FAF_DEFAULT_SUPPLY_COUNTRY = "AE";

export const FAF_BLOCKS = {
  company: { start: "CompInfoStart", end: "CompInfoEnd" },
  purchases: { start: "PurcDataStart", end: "PurcDataEnd" },
  supplies: { start: "SuppDataStart", end: "SuppDataEnd" },
  ledger: { start: "GLDataStart", end: "GLDataEnd" },
} as const;

export const FAF_COLUMNS = {
  company: [
    "CompanyName",
    "TaxRegistrationNumber",
    "TaxablePeriodStart",
    "TaxablePeriodEnd",
    "FAFCreationDate",
    "ProductVersion",
    "FAFVersion",
  ],
  purchases: [
    "SupplierName",
    "SupplierTRN",
    "InvoiceDate",
    "InvoiceNo",
    "PermitNo",
    "LineNo",
    "ProductDescription",
    "PurchaseValueAED",
    "VATValueAED",
    "TaxCode",
    "FCYCode",
    "PurchaseFCY",
    "VATFCY",
  ],
  purchasesFooter: ["PurchaseTotalAED", "PurchaseTotalVATAED", "PurchaseTransactionCountTotal"],
  supplies: [
    "CustomerName",
    "CustomerTRN",
    "InvoiceDate",
    "InvoiceNo",
    "LineNo",
    "ProductDescription",
    "SupplyValueAED",
    "VATValueAED",
    "TaxCode",
    "Country",
    "FCYCode",
    "SupplyFCY",
    "VATFCY",
  ],
  suppliesFooter: ["SupplyTotalAED", "SupplyTotalVATAED", "SupplyTransactionCountTotal"],
  ledger: [
    "TransactionDate",
    "AccountID",
    "AccountName",
    "TransactionDescription",
    "Name",
    "TransactionID",
    "SourceDocumentID",
    "SourceType",
    "Debit",
    "Credit",
    "Balance",
  ],
  ledgerFooter: ["TotalDebit", "TotalCredit", "TransactionCountTotal", "GLTCurrency"],
} as const;

/** Currency written in the general ledger footer. */
export const FAF_LEDGER_CURRENCY = "AED";

/**
 * Tax codes. Our VAT classes map as: standard 5% -> SR, zero-rated -> ZR,
 * exempt -> ES, out of scope -> OS, reverse charge -> RC. IG (import of goods)
 * is used on purchase lines flagged as imports. UNVERIFIED against the FTA code list.
 */
export const FAF_TAX_CODES = {
  standardRated: "SR",
  zeroRated: "ZR",
  exempt: "ES",
  outOfScope: "OS",
  reverseCharge: "RC",
  importOfGoods: "IG",
} as const;

export type FafTaxCode = (typeof FAF_TAX_CODES)[keyof typeof FAF_TAX_CODES];

/** Longest range accepted in one file (one financial year). */
export const FAF_MAX_RANGE_DAYS = 366;
