// Builds the sample PINT AE documents used by the ASP sandbox dry run
// (scripts/ops/asp-sandbox-dryrun.ts) and the live A-Cube sandbox suite
// (tests/live/acube-sandbox.test.ts). One builder, so both exercise the same document.
// No network, no database. Throws (never exits) so a test can report the reason.
import { randomUUID } from "node:crypto";

export const SAMPLE_TRN_RE = /^1\d{12}03$/;

export interface SampleDocumentOptions {
  sellerTrn?: string;
  buyerTrn?: string;
  /** A credit note (381) that references `original`, instead of a standard invoice. */
  creditNoteFor?: { number: string; date: string };
  /** Number prefix, default DRYRUN (credit notes use `<prefix>-CN`). */
  prefix?: string;
}

export async function buildSampleDocument(opts: SampleDocumentOptions = {}) {
  const { PINT_AE_FIXTURES, fixtureCompany, uaeBuyer } =
    await import("../../tests/fixtures/pint-ae/fixtures");
  const { generateEInvoiceXML, validateForEInvoicing } =
    await import("../../server/services/einvoice.service");
  const { summariseValidation, validateEInvoiceXml } =
    await import("../../server/services/einvoice/validate");
  const sellerTrn =
    opts.sellerTrn?.trim() ||
    process.env.ASP_DRYRUN_SELLER_TRN?.trim() ||
    fixtureCompany.trnVatNumber;
  const buyerTrn =
    opts.buyerTrn?.trim() || process.env.ASP_DRYRUN_BUYER_TRN?.trim() || uaeBuyer.trn;
  for (const [name, trn] of [
    ["ASP_DRYRUN_SELLER_TRN", sellerTrn],
    ["ASP_DRYRUN_BUYER_TRN", buyerTrn],
  ] as const) {
    if (!trn || !SAMPLE_TRN_RE.test(trn)) {
      throw new Error(`${name} must be a 15-digit UAE TRN (starts with 1, ends with 03)`);
    }
  }
  const credit = opts.creditNoteFor;
  const f = PINT_AE_FIXTURES.find((x) => x.name === (credit ? "credit note" : "standard"))!;
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const prefix = opts.prefix ?? "DRYRUN";
  const invoice = {
    ...f.invoice,
    number: credit ? `${prefix}-CN-${stamp}` : `${prefix}-${stamp}`,
    date: new Date(`${today}T00:00:00Z`),
    dueDate: credit ? null : new Date(`${due}T00:00:00Z`),
    customerTrn: buyerTrn,
  };
  const company = { ...fixtureCompany, trnVatNumber: sellerTrn };
  // EndpointIDs are derived from the TRNs (scheme 0235 + 10-digit TIN), as in production.
  const customer = { ...uaeBuyer, trn: buyerTrn, endpointId: null, endpointScheme: null };
  const options = {
    ...f.opts,
    ...(credit ? { originalInvoice: credit } : {}),
    uuid: randomUUID(),
  };
  const issues = validateForEInvoicing(invoice, f.lines, company, {
    customer,
    originalInvoice: credit ?? null,
  });
  if (issues.length > 0) {
    throw new Error(`sample document fails the data checks: ${JSON.stringify(issues)}`);
  }
  const built = generateEInvoiceXML(invoice, f.lines, company, customer, options);
  const validation = summariseValidation(await validateEInvoiceXml(built.xml));
  return {
    invoice,
    company,
    xml: built.xml,
    uuid: options.uuid,
    documentType: built.documentType ?? (credit ? "381" : "380"),
    validation,
  };
}

/** An invoice that cannot pass A-Cube's validation: the buyer TRN is not 15 digits. */
export function invalidateSampleXml(xml: string): string {
  // The buyer's tax-scheme CompanyID is the second one in the document (seller first).
  let seen = 0;
  const out = xml.replace(/(<cbc:CompanyID>)(\d{15})(<\/cbc:CompanyID>)/g, (m, a, _id, c) =>
    ++seen === 2 ? `${a}12345${c}` : m
  );
  if (out === xml) throw new Error("could not locate the buyer CompanyID to invalidate");
  return out;
}
