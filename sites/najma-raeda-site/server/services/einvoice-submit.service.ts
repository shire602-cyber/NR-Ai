// Orchestrates e-invoice submission: validate → (re)generate the PINT-AE XML →
// hand to the active ASP provider → return the status update to persist. Thin
// wiring around the tested pieces (validateForEInvoicing / generateEInvoiceXML,
// the lifecycle state machine, and the provider seam). Persistence and HTTP
// shaping live in the route; this stays storage-agnostic for testability.

import type { Invoice, InvoiceLine, Company } from "../../shared/schema";
import { validateForEInvoicing, generateEInvoiceXML, type EInvoiceIssue } from "./einvoice.service";
import { assertEInvoiceTransition, type EInvoiceStatus } from "./einvoice-status";
import type { EInvoiceProvider } from "./einvoice-provider";

export interface EInvoiceUpdate {
  einvoiceUuid?: string;
  einvoiceXml?: string;
  einvoiceHash?: string;
  einvoiceStatus: EInvoiceStatus;
  einvoiceProvider?: string | null;
  einvoiceProviderMessageId?: string | null;
  einvoiceSubmittedAt?: Date | null;
  einvoiceStatusDetail?: string | null;
}

type SubmitOk = { ok: true; update: EInvoiceUpdate; providerMessageId: string };
type SubmitErr = { ok: false; status: number; code: string; message: string; issues?: EInvoiceIssue[] };

/** Produce a valid PINT-AE document, reusing the stored one if already generated. */
export function buildEInvoiceDocument(
  invoice: Invoice,
  lines: InvoiceLine[],
  company: Company
): { ok: true; xml: string; uuid: string; hash: string } | { ok: false; issues: EInvoiceIssue[] } {
  const issues = validateForEInvoicing(invoice, lines, company);
  if (issues.length > 0) return { ok: false, issues };
  if (invoice.einvoiceXml && invoice.einvoiceUuid && invoice.einvoiceHash) {
    return { ok: true, xml: invoice.einvoiceXml, uuid: invoice.einvoiceUuid, hash: invoice.einvoiceHash };
  }
  const customer = invoice.customerName
    ? { name: invoice.customerName, trn: invoice.customerTrn || undefined }
    : undefined;
  const { xml, uuid, hash } = generateEInvoiceXML(invoice, lines, company, customer);
  return { ok: true, xml, uuid, hash };
}

export async function submitEInvoice(args: {
  invoice: Invoice;
  lines: InvoiceLine[];
  company: Company;
  provider: EInvoiceProvider;
}): Promise<SubmitOk | SubmitErr> {
  const { invoice, lines, company, provider } = args;
  const current = (invoice.einvoiceStatus as string) || "not_generated";
  if (current === "accepted") {
    return { ok: false, status: 409, code: "EINVOICE_ALREADY_ACCEPTED", message: "This e-invoice has already been cleared." };
  }

  const built = buildEInvoiceDocument(invoice, lines, company);
  if (!built.ok) {
    return { ok: false, status: 422, code: "EINVOICE_VALIDATION_FAILED", message: "Invoice is not e-invoicing ready", issues: built.issues };
  }

  // After (re)generation the document is in "generated"; confirm the move.
  assertEInvoiceTransition("generated", "submitted");

  const result = await provider.submit({
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    uuid: built.uuid,
    xml: built.xml,
  });

  return {
    ok: true,
    providerMessageId: result.providerMessageId,
    update: {
      einvoiceUuid: built.uuid,
      einvoiceXml: built.xml,
      einvoiceHash: built.hash,
      einvoiceStatus: result.status, // "submitted"
      einvoiceProvider: provider.name,
      einvoiceProviderMessageId: result.providerMessageId,
      einvoiceSubmittedAt: new Date(),
      einvoiceStatusDetail: result.detail ?? null,
    },
  };
}

export async function refreshEInvoiceStatus(args: {
  invoice: Invoice;
  provider: EInvoiceProvider;
}): Promise<{ ok: true; update: EInvoiceUpdate } | SubmitErr> {
  const { invoice, provider } = args;
  const messageId = invoice.einvoiceProviderMessageId;
  if (!messageId) {
    return { ok: false, status: 409, code: "EINVOICE_NOT_SUBMITTED", message: "This e-invoice has not been submitted to a provider." };
  }
  const result = await provider.getStatus(messageId);
  const current = (invoice.einvoiceStatus as string) || "not_generated";
  // Validate the lifecycle move (submitted → accepted/rejected/failed, etc.).
  assertEInvoiceTransition(current, result.status);
  return {
    ok: true,
    update: { einvoiceStatus: result.status, einvoiceStatusDetail: result.detail ?? null },
  };
}
