// Orchestrates e-invoice submission: validate → (re)generate the PINT-AE XML →
// full XSD/schematron/rule validation → hand to the active ASP provider →
// return the status updates to persist (legacy invoice columns plus the
// einvoice_documents row with attempts/backoff/reasons). Persistence and HTTP
// shaping live in the route; this stays storage-agnostic for testability.

import {
  EINVOICE_NOT_REQUIRED,
  EINVOICE_NOT_REQUIRED_MESSAGE,
  isB2cCashSale,
} from "./einvoice/applicability";
import type { Invoice, InvoiceLine, Company } from "../../shared/schema";
import {
  validateForEInvoicing,
  generateEInvoiceXML,
  readEInvoiceDocumentType,
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
import type {
  EInvoiceDocumentRef,
  EInvoiceProvider,
  EInvoiceProviderResult,
} from "./einvoice-provider";
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

export type SubmitOk = {
  ok: true;
  update: EInvoiceUpdate;
  document: EInvoiceDocumentUpdate;
  providerMessageId: string;
  xml: string;
  /** True when the ASP took the document (archive it as "submitted"). */
  handedOver: boolean;
  /** E1: the provider's own outcome (two-track status, error code). */
  result: EInvoiceProviderResult;
};
export type SubmitErr = {
  ok: false;
  status: number;
  code: string;
  message: string;
  issues?: EInvoiceIssue[];
  validation?: EInvoiceValidationSummary;
};

/** Generate a fresh PINT AE document from the current data (no rule checks, nothing stored). */
function generateFreshDocument(
  invoice: Invoice,
  lines: InvoiceLine[],
  company: Company,
  ctx: EInvoiceContext,
  uuid: string | undefined
) {
  const customer =
    ctx.customer ??
    (invoice.customerName
      ? { name: invoice.customerName, trn: invoice.customerTrn || undefined }
      : undefined);
  return generateEInvoiceXML(invoice, lines, company, customer, {
    ...(ctx.options ?? {}),
    uuid,
    originalInvoice: ctx.originalInvoice ?? ctx.options?.originalInvoice ?? null,
    lineExtras: ctx.lineExtras ?? ctx.options?.lineExtras,
  });
}

export interface EInvoicePreflight {
  applicable: boolean;
  /** Data-level issues (the fix-it list). Non-empty means no document was built. */
  issues: EInvoiceIssue[];
  /** The document built from the current data, when there were no data-level issues. */
  built: { xml: string; uuid: string; hash: string; documentType: string | null } | null;
  /** XSD / PINT AE schematron / rule validation of `built`. */
  validation: EInvoiceValidationSummary | null;
  /** True exactly when generate-einvoice would accept and store this document. */
  valid: boolean;
}

/**
 * X6a (FIX_QUEUE G7, before e-invoicing goes on item 5): the ONE rule set behind both the
 * pre-flight check (GET /api/invoices/:id/einvoice/validate) and generate-einvoice: the data
 * rules (validateForEInvoicing), then a fresh document validated against the UBL 2.1 XSD, the
 * PINT AE schematron and the rule list. The submit path runs the same two steps.
 */
export async function preflightEInvoice(
  invoice: Invoice,
  lines: InvoiceLine[],
  company: Company,
  ctx: EInvoiceContext = {},
  opts: { uuid?: string; now?: Date } = {}
): Promise<EInvoicePreflight> {
  if (isB2cCashSale(invoice, ctx.customer)) {
    return { applicable: false, issues: [], built: null, validation: null, valid: false };
  }
  const issues = validateForEInvoicing(invoice, lines, company, ctx);
  if (issues.length > 0)
    return { applicable: true, issues, built: null, validation: null, valid: false };
  const g = generateFreshDocument(invoice, lines, company, ctx, opts.uuid);
  const validation = summariseValidation(
    await validateEInvoiceXml(g.xml, opts.now ? { now: opts.now } : undefined)
  );
  return {
    applicable: true,
    issues,
    built: { xml: g.xml, uuid: g.uuid, hash: g.hash, documentType: g.documentType },
    validation,
    valid: validation.valid,
  };
}

/** Produce a valid PINT-AE document, reusing the stored one if already generated. */
export function buildEInvoiceDocument(
  invoice: Invoice,
  lines: InvoiceLine[],
  company: Company,
  ctx: EInvoiceContext = {}
):
  | { ok: true; xml: string; uuid: string; hash: string; documentType: string | null }
  | { ok: false; issues: EInvoiceIssue[] } {
  if (isB2cCashSale(invoice, ctx.customer)) {
    return {
      ok: false,
      issues: [
        { field: "invoice", code: EINVOICE_NOT_REQUIRED, message: EINVOICE_NOT_REQUIRED_MESSAGE },
      ],
    };
  }
  const issues = validateForEInvoicing(invoice, lines, company, ctx);
  if (issues.length > 0) return { ok: false, issues };
  // E1: a regenerated document keeps the invoice's e-invoice UUID, so a resubmission after a
  // fix is the same document to the ASP (idempotency key) rather than a new one.
  const uuid = ctx.options?.uuid ?? invoice.einvoiceUuid ?? undefined;
  if (invoice.einvoiceXml && invoice.einvoiceUuid && invoice.einvoiceHash) {
    return {
      ok: true,
      xml: invoice.einvoiceXml,
      uuid: invoice.einvoiceUuid,
      hash: invoice.einvoiceHash,
      documentType: readEInvoiceDocumentType(invoice.einvoiceXml),
    };
  }
  const generated = generateFreshDocument(invoice, lines, company, ctx, uuid);
  return {
    ok: true,
    xml: generated.xml,
    uuid: generated.uuid,
    hash: generated.hash,
    documentType: generated.documentType,
  };
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
      reasons ??
      (result.status === "rejected"
        ? [{ code: "ASP", message: result.detail ?? "Rejected" }]
        : null),
    clearedAt: result.status === "cleared" ? now : null,
  };
}

export async function prepareEInvoiceSubmission(args: {
  invoice: Invoice;
  lines: InvoiceLine[];
  company: Company;
  ctx?: EInvoiceContext;
  now?: Date;
}): Promise<PreparedSubmission | SubmitErr> {
  const { invoice, lines, company } = args;
  const now = args.now ?? new Date();
  const current = (invoice.einvoiceStatus as string) || "not_generated";
  if (invoice.status === "draft" || invoice.status === "void" || invoice.status === "cancelled") {
    return {
      ok: false,
      status: 409,
      code: invoice.status === "draft" ? "EINVOICE_INVOICE_NOT_ISSUED" : "EINVOICE_INVOICE_VOID",
      message:
        invoice.status === "draft"
          ? "Issue the invoice before transmitting it as an e-invoice."
          : "The invoice was voided or cancelled and cannot be transmitted.",
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

  if (isB2cCashSale(invoice, args.ctx?.customer)) {
    return {
      ok: false,
      status: 409,
      code: EINVOICE_NOT_REQUIRED,
      message: EINVOICE_NOT_REQUIRED_MESSAGE,
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

  return { ...built, validation };
}

export type PreparedSubmission = Extract<ReturnType<typeof buildEInvoiceDocument>, { ok: true }> & {
  validation: EInvoiceValidationSummary;
};

export function submittedEInvoiceOutcome(
  built: PreparedSubmission,
  provider: EInvoiceProvider,
  result: EInvoiceProviderResult,
  prevAttempts: number,
  now: Date
): SubmitOk {
  const docPatch = applyProviderOutcome(result, prevAttempts, now);
  return {
    ok: true,
    result,
    providerMessageId: result.providerMessageId,
    xml: built.xml,
    handedOver: !!result.providerMessageId,
    document: {
      ...docPatch,
      provider: provider.name,
      uuid: built.uuid,
      xmlHash: built.hash,
      documentType: built.documentType,
      validation: built.validation,
      validatedAt: now,
    },
    update: {
      einvoiceUuid: built.uuid,
      einvoiceXml: built.xml,
      einvoiceHash: built.hash,
      einvoiceStatus: result.status,
      einvoiceProvider: provider.name,
      einvoiceProviderMessageId: result.providerMessageId || null,
      einvoiceSubmittedAt: result.providerMessageId ? now : null,
      einvoiceStatusDetail: result.detail ?? null,
    },
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
  const { invoice, company, provider } = args;
  const now = args.now ?? new Date();
  const built = await prepareEInvoiceSubmission({ ...args, now });
  if (!built.ok) return built;

  assertEInvoiceTransition("generated", "submitted");
  const result = await provider.submit({
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    uuid: built.uuid,
    xml: built.xml,
    documentType: built.documentType ?? undefined,
    companyId: company.id,
  });
  return submittedEInvoiceOutcome(built, provider, result, args.attempts ?? 0, now);
}

/** Provider error codes that mean "could not ask", not "the document failed". */
const TRANSIENT_POLL_CODES = new Set([
  "TRANSPORT_ERROR",
  "ACUBE_UNAVAILABLE",
  "ACUBE_AUTH_FAILED",
  "ACUBE_RATE_LIMITED",
  "ACUBE_UNKNOWN_STATUS",
  // E2: Complyance
  "COMPLYANCE_UNAVAILABLE",
  "COMPLYANCE_AUTH_FAILED",
  "COMPLYANCE_RATE_LIMITED",
  "COMPLYANCE_UNKNOWN_STATE",
]);

export async function refreshEInvoiceStatus(args: {
  invoice: Invoice;
  provider: EInvoiceProvider;
  now?: Date;
  ref?: EInvoiceDocumentRef;
}): Promise<
  | {
      ok: true;
      update: EInvoiceUpdate;
      document: EInvoiceDocumentUpdate;
      result: EInvoiceProviderResult;
    }
  | (SubmitErr & { verifiedReportingApproval?: true })
> {
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
  const result = await provider.getStatus(messageId, args.ref);
  if (
    result.providerMessageId !== messageId ||
    (result.errorCode && TRANSIENT_POLL_CODES.has(result.errorCode))
  ) {
    // E1: a failed poll says nothing about the document; keep its status.
    return {
      ok: false,
      status: 502,
      code: "EINVOICE_PROVIDER_UNAVAILABLE",
      message: result.detail ?? "The service provider could not be reached.",
    };
  }
  const current = (invoice.einvoiceStatus as string) || "not_generated";
  if (!canTransitionEInvoice(current, result.status)) {
    return {
      ok: false,
      status: 409,
      code: "EINVOICE_INVALID_TRANSITION",
      message: `The provider reported ${result.status} for a document that is ${current}.`,
      ...(provider.name === "complyance" && result.reporting === "reported"
        ? { verifiedReportingApproval: true as const }
        : {}),
    };
  }
  const reasons = result.reasons && result.reasons.length > 0 ? result.reasons : null;
  return {
    ok: true,
    result,
    update: { einvoiceStatus: result.status, einvoiceStatusDetail: result.detail ?? null },
    document: {
      status: result.status,
      lastError:
        result.status === "rejected" || result.status === "failed" ? (result.detail ?? null) : null,
      rejectionReasons:
        reasons ??
        (result.status === "rejected"
          ? [{ code: "ASP", message: result.detail ?? "Rejected" }]
          : null),
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
