// Orchestrates e-invoice submission: validate → (re)generate the PINT-AE XML →
// full XSD/schematron/rule validation → hand to the active ASP provider →
// return the status updates to persist (legacy invoice columns plus the
// einvoice_documents row with attempts/backoff/reasons). Persistence and HTTP
// shaping live in the route; this stays storage-agnostic for testability.

import type { Invoice, InvoiceLine, Company } from "../../shared/schema";
import {
  validateForEInvoicing,
  generateEInvoiceXML,
  type EInvoiceIssue,
  type EInvoiceLineExtra,
  type EInvoiceOptions,
  type EInvoiceParty,
} from "./einvoice.service";
import {
  assertEInvoiceTransition,
  canTransitionEInvoice,
  isEInvoiceInFlight,
  nextRetryAt,
  type EInvoiceRejectionReason,
  type EInvoiceStatus,
} from "./einvoice-status";
import type { EInvoiceProvider, EInvoiceProviderResult } from "./einvoice-provider";
import {
  summariseValidation,
  validateEInvoiceXml,
  type EInvoiceValidationSummary,
} from "./einvoice/validate";

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

/** Patch for the einvoice_documents row (see server/services/einvoice/store.ts). */
export interface EInvoiceDocumentUpdate {
  status: EInvoiceStatus;
  provider?: string | null;
  providerMessageId?: string | null;
  attempts?: number;
  nextRetryAt?: Date | null;
  lastError?: string | null;
  rejectionReasons?: EInvoiceRejectionReason[] | null;
  clearedAt?: Date | null;
  uuid?: string | null;
  xmlHash?: string | null;
  documentType?: string | null;
  validation?: EInvoiceValidationSummary | null;
  validatedAt?: Date | null;
}

export interface EInvoiceContext {
  customer?: Partial<EInvoiceParty> & { name?: string };
  originalInvoice?: { number: string; date: Date | string } | null;
  lineExtras?: EInvoiceLineExtra[];
  options?: EInvoiceOptions;
}

type SubmitOk = {
  ok: true;
  update: EInvoiceUpdate;
  document: EInvoiceDocumentUpdate;
  providerMessageId: string;
  xml: string;
  /** True when the ASP took the document (archive it as "submitted"). */
  handedOver: boolean;
};
type SubmitErr = {
  ok: false;
  status: number;
  code: string;
  message: string;
  issues?: EInvoiceIssue[];
  validation?: EInvoiceValidationSummary;
};

/** Produce a valid PINT-AE document, reusing the stored one if already generated. */
export function buildEInvoiceDocument(
  invoice: Invoice,
  lines: InvoiceLine[],
  company: Company,
  ctx: EInvoiceContext = {}
):
  | { ok: true; xml: string; uuid: string; hash: string; documentType: string | null }
  | { ok: false; issues: EInvoiceIssue[] } {
  const issues = validateForEInvoicing(invoice, lines, company, ctx);
  if (issues.length > 0) return { ok: false, issues };
  if (invoice.einvoiceXml && invoice.einvoiceUuid && invoice.einvoiceHash) {
    return {
      ok: true,
      xml: invoice.einvoiceXml,
      uuid: invoice.einvoiceUuid,
      hash: invoice.einvoiceHash,
      documentType: null,
    };
  }
  const customer =
    ctx.customer ??
    (invoice.customerName
      ? { name: invoice.customerName, trn: invoice.customerTrn || undefined }
      : undefined);
  const { xml, uuid, hash, documentType } = generateEInvoiceXML(invoice, lines, company, customer, {
    ...(ctx.options ?? {}),
    originalInvoice: ctx.originalInvoice ?? ctx.options?.originalInvoice ?? null,
    lineExtras: ctx.lineExtras ?? ctx.options?.lineExtras,
  });
  return { ok: true, xml, uuid, hash, documentType };
}

/** Document-row patch for a provider outcome (attempt counting + backoff). */
export function applyProviderOutcome(
  result: EInvoiceProviderResult,
  prevAttempts: number,
  now: Date = new Date()
): EInvoiceDocumentUpdate {
  const attempts = prevAttempts + 1;
  const reasons = result.reasons && result.reasons.length > 0 ? result.reasons : null;
  return {
    status: result.status,
    providerMessageId: result.providerMessageId || null,
    attempts,
    nextRetryAt: result.status === "failed" ? nextRetryAt(attempts, now) : null,
    lastError:
      result.status === "failed" || result.status === "rejected" ? (result.detail ?? null) : null,
    rejectionReasons:
      result.status === "rejected"
        ? (reasons ?? [{ code: "ASP", message: result.detail ?? "Rejected" }])
        : null,
    clearedAt: result.status === "cleared" ? now : null,
  };
}

export async function submitEInvoice(args: {
  invoice: Invoice;
  lines: InvoiceLine[];
  company: Company;
  provider: EInvoiceProvider;
  ctx?: EInvoiceContext;
  attempts?: number;
  now?: Date;
}): Promise<SubmitOk | SubmitErr> {
  const { invoice, lines, company, provider } = args;
  const now = args.now ?? new Date();
  const current = (invoice.einvoiceStatus as string) || "not_generated";
  if (invoice.status === "draft" || invoice.status === "void") {
    return {
      ok: false,
      status: 409,
      code: invoice.status === "void" ? "EINVOICE_INVOICE_VOID" : "EINVOICE_INVOICE_NOT_ISSUED",
      message:
        invoice.status === "void"
          ? "A void invoice cannot be transmitted."
          : "Issue the invoice before transmitting it as an e-invoice.",
    };
  }
  if (current === "accepted" || current === "cleared") {
    return {
      ok: false,
      status: 409,
      code: "EINVOICE_ALREADY_ACCEPTED",
      message: "This e-invoice has already been accepted by the service provider.",
    };
  }
  if (isEInvoiceInFlight(current)) {
    return {
      ok: false,
      status: 409,
      code: "EINVOICE_ALREADY_SUBMITTED",
      message: "This e-invoice is with the service provider; refresh its status instead.",
    };
  }
  if (current === "cancelled") {
    return {
      ok: false,
      status: 409,
      code: "EINVOICE_CANCELLED",
      message: "This e-invoice was cancelled.",
    };
  }

  const built = buildEInvoiceDocument(invoice, lines, company, args.ctx);
  if (!built.ok) {
    return {
      ok: false,
      status: 422,
      code: "EINVOICE_VALIDATION_FAILED",
      message: "Invoice is not e-invoicing ready",
      issues: built.issues,
    };
  }

  // The stored XML is checked against UBL 2.1 XSD + PINT AE schematron + the
  // rule list before it ever leaves the building.
  const validation = summariseValidation(await validateEInvoiceXml(built.xml, { now }));
  if (!validation.valid) {
    return {
      ok: false,
      status: 422,
      code: "EINVOICE_SCHEMA_INVALID",
      message: "The generated e-invoice failed PINT AE validation",
      validation,
    };
  }

  assertEInvoiceTransition("generated", "submitted");
  const result = await provider.submit({
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    uuid: built.uuid,
    xml: built.xml,
    documentType: built.documentType ?? undefined,
  });

  const docPatch = applyProviderOutcome(result, args.attempts ?? 0, now);
  return {
    ok: true,
    providerMessageId: result.providerMessageId,
    xml: built.xml,
    handedOver: result.status !== "failed" && !!result.providerMessageId,
    document: {
      ...docPatch,
      provider: provider.name,
      uuid: built.uuid,
      xmlHash: built.hash,
      documentType: built.documentType,
      validation,
      validatedAt: now,
    },
    update: {
      einvoiceUuid: built.uuid,
      einvoiceXml: built.xml,
      einvoiceHash: built.hash,
      einvoiceStatus: result.status,
      einvoiceProvider: provider.name,
      einvoiceProviderMessageId: result.providerMessageId || null,
      einvoiceSubmittedAt: now,
      einvoiceStatusDetail: result.detail ?? null,
    },
  };
}

export async function refreshEInvoiceStatus(args: {
  invoice: Invoice;
  provider: EInvoiceProvider;
  now?: Date;
}): Promise<{ ok: true; update: EInvoiceUpdate; document: EInvoiceDocumentUpdate } | SubmitErr> {
  const { invoice, provider } = args;
  const now = args.now ?? new Date();
  const messageId = invoice.einvoiceProviderMessageId;
  if (!messageId) {
    return {
      ok: false,
      status: 409,
      code: "EINVOICE_NOT_SUBMITTED",
      message: "This e-invoice has not been submitted to a provider.",
    };
  }
  const result = await provider.getStatus(messageId);
  const current = (invoice.einvoiceStatus as string) || "not_generated";
  if (!canTransitionEInvoice(current, result.status)) {
    return {
      ok: false,
      status: 409,
      code: "EINVOICE_INVALID_TRANSITION",
      message: `The provider reported ${result.status} for a document that is ${current}.`,
    };
  }
  const reasons = result.reasons && result.reasons.length > 0 ? result.reasons : null;
  return {
    ok: true,
    update: { einvoiceStatus: result.status, einvoiceStatusDetail: result.detail ?? null },
    document: {
      status: result.status,
      lastError:
        result.status === "rejected" || result.status === "failed" ? (result.detail ?? null) : null,
      rejectionReasons:
        result.status === "rejected"
          ? (reasons ?? [{ code: "ASP", message: result.detail ?? "Rejected" }])
          : null,
      clearedAt: result.status === "cleared" ? now : null,
    },
  };
}

export async function cancelEInvoice(args: {
  invoice: Invoice;
  provider: EInvoiceProvider;
  reason: string;
}): Promise<{ ok: true; update: EInvoiceUpdate; document: EInvoiceDocumentUpdate } | SubmitErr> {
  const { invoice, provider, reason } = args;
  const current = (invoice.einvoiceStatus as string) || "not_generated";
  if (current === "cleared" || current === "accepted") {
    return {
      ok: false,
      status: 409,
      code: "EINVOICE_CREDIT_NOTE_REQUIRED",
      message: "An accepted or cleared e-invoice cannot be cancelled; issue a credit note.",
    };
  }
  if (!canTransitionEInvoice(current, "cancelled")) {
    return {
      ok: false,
      status: 409,
      code: "EINVOICE_INVALID_TRANSITION",
      message: `An e-invoice that is ${current} cannot be cancelled.`,
    };
  }
  if (current === "submitted" && invoice.einvoiceProviderMessageId) {
    if (!provider.capabilities.cancel) {
      return {
        ok: false,
        status: 501,
        code: "EINVOICE_CAPABILITY_UNSUPPORTED",
        message: "The configured service provider does not support cancellation.",
      };
    }
    const r = await provider.cancel(invoice.einvoiceProviderMessageId, reason);
    if (r.status !== "cancelled") {
      return {
        ok: false,
        status: 502,
        code: "EINVOICE_CANCEL_FAILED",
        message: r.detail ?? "The service provider did not confirm the cancellation.",
      };
    }
  }
  return {
    ok: true,
    update: { einvoiceStatus: "cancelled", einvoiceStatusDetail: reason },
    document: { status: "cancelled", lastError: null, nextRetryAt: null },
  };
}
