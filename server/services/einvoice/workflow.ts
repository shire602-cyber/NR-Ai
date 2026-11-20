/**
 * Persisted e-invoice workflow: submit / refresh / cancel with the
 * einvoice_documents row, the legacy invoice columns and the archive kept in
 * step. Shared by the HTTP routes and the "einvoice.retry" background job.
 *
 * E1: every outcome is also written as two tracks (delivery, FTA reporting) with history
 * (history.ts); a provider that needs a linked legal entity (A-Cube) is gated on it; a
 * submission is claimed first so two requests never hand the same invoice to the ASP twice.
 */
import type { Company, Invoice } from "../../../shared/schema";
import { storage } from "../../storage";
import { createLogger } from "../../config/logger";
import { DomainError } from "../../errors";
import type { EInvoiceProvider, EInvoiceSubmission } from "../einvoice-provider";
import { getEInvoiceProvider } from "../einvoice-provider";
import { cancelEInvoice, refreshEInvoiceStatus, submitEInvoice } from "../einvoice-submit.service";
import { loadEInvoiceContext } from "./context";
import {
  archiveEInvoiceXml,
  dueEInvoiceRetries,
  getEInvoiceDocument,
  upsertEInvoiceDocument,
} from "./store";
import {
  applyTracks,
  claimSubmission,
  recordValidationEvent,
  releaseSubmission,
  type HistorySource,
} from "./history";
import {
  deliveryFromLegacy,
  legacyFromTracks,
  reportByDate,
  reportingRequired,
  type DeliveryStatus,
  type ReportingStatus,
} from "./tracks";
import { einvoiceMandateApplies } from "./scope";
import { assertLegalEntityCanSend, companyTin, getLegalEntity } from "./legal-entities";
import { PEPPOL_SCHEME_UAE_TIN } from "./pint-ae-codes";

const log = createLogger("einvoice-workflow");

type CompanyExtras = Company & {
  peppolScheme?: string | null;
  peppolParticipantId?: string | null;
  einvoiceScope?: string | null;
};

/** Does this provider only transmit for a linked legal entity (A-Cube, Complyance)? */
export function providerRequiresLegalEntity(provider: EInvoiceProvider): boolean {
  return (provider as EInvoiceProvider & { requiresLegalEntity?: boolean }).requiresLegalEntity
    ? true
    : false;
}

/** Whether this invoice must be reported to the FTA (B2B/B2G with a buyer TRN). */
export function invoiceReportingRequired(
  invoice: Invoice,
  company: Company,
  now: Date = new Date()
): boolean {
  return reportingRequired({
    customerTrn: invoice.customerTrn,
    companyScope: (company as CompanyExtras).einvoiceScope ?? null,
    mandateApplies: einvoiceMandateApplies(company as CompanyExtras, now),
  });
}

/**
 * E1 gate (A-Cube; E2 Complyance): the company's legal entity must be active, and the supplier
 * EndpointID we generate (scheme 0235 + TIN) must be the one the provider linked, or it cannot
 * route it (Complyance answers AE-PEPPOL-008 for the same mismatch).
 */
async function assertCanTransmit(company: CompanyExtras, provider: EInvoiceProvider) {
  if (!providerRequiresLegalEntity(provider)) return;
  const le = await getLegalEntity(company.id, provider.name, provider.environment);
  const displayName = provider.displayName ?? provider.name;
  assertLegalEntityCanSend(le, displayName);
  const scheme = company.peppolScheme?.trim() || PEPPOL_SCHEME_UAE_TIN;
  const tin = companyTin(company);
  if (scheme !== PEPPOL_SCHEME_UAE_TIN || tin !== le?.tin) {
    throw new DomainError(
      "EINVOICE_SUPPLIER_ENDPOINT_MISMATCH",
      422,
      { expected: `${PEPPOL_SCHEME_UAE_TIN}:${le?.tin ?? ""}`, actual: `${scheme}:${tin ?? ""}` },
      `The supplier e-invoicing address on the invoice does not match the TIN linked at ${displayName}.`
    );
  }
}

/** Wrap the provider so an ambiguous earlier attempt is looked up before posting again. */
function withLookup(provider: EInvoiceProvider): EInvoiceProvider {
  if (!provider.lookupSubmission) return provider;
  const wrapped = Object.create(provider) as EInvoiceProvider;
  wrapped.submit = async (s: EInvoiceSubmission) => {
    const found = await provider.lookupSubmission!(s).catch(() => null);
    if (found) {
      log.info({ invoiceId: s.invoiceId }, "e-invoice found at the ASP; not posting it again");
      return found;
    }
    return provider.submit(s);
  };
  return wrapped;
}

/** Last outcomes after which the ASP may hold the document without us knowing its id. */
const AMBIGUOUS_CODES: ReadonlySet<string> = new Set(["TRANSPORT_ERROR", "EINVOICE_NEEDS_LINK"]);

/**
 * X6a (before e-invoicing goes on, item 3): after an ambiguous transport error, an ASP that
 * answers "this number is already used" without naming the document most likely holds THIS
 * invoice (it may have delivered and reported it). Record "needs link", never "rejected", and do
 * not schedule another send: a person links the provider's document.
 */
function withAmbiguityGuard(provider: EInvoiceProvider): EInvoiceProvider {
  const wrapped = Object.create(provider) as EInvoiceProvider;
  wrapped.submit = async (s: EInvoiceSubmission) => {
    const r = await provider.submit(s);
    if (!r.numberAlreadyHeld) return r;
    log.warn({ invoiceId: s.invoiceId }, "e-invoice number already held after a lost response");
    return {
      ...r,
      providerMessageId: "",
      status: legacyFromTracks("needs_link", r.reporting ?? "pending"),
      delivery: "needs_link",
      reporting: r.reporting ?? "pending",
      errorCode: "EINVOICE_NEEDS_LINK",
    };
  };
  return wrapped;
}

export async function submitAndPersist(args: {
  invoice: Invoice;
  company: Company;
  provider: EInvoiceProvider;
  now?: Date;
  source?: HistorySource;
  /** Regenerate the XML from the current invoice data (fix and resubmit). */
  regenerate?: boolean;
}) {
  const { company, provider } = args;
  const now = args.now ?? new Date();
  const source = args.source ?? "user";
  await assertCanTransmit(company as CompanyExtras, provider);

  if (!(await claimSubmission(company.id, args.invoice.id, now))) {
    return {
      ok: false as const,
      status: 409,
      code: "EINVOICE_SUBMISSION_IN_PROGRESS",
      message: "This e-invoice is already being sent; refresh its status in a moment.",
    };
  }
  try {
    // Re-read under the claim: a request that lost the race to a finished submission must see
    // the stored status (already submitted), not the snapshot it loaded before the claim.
    const fresh = (await storage.getInvoice(args.invoice.id, company.id)) ?? args.invoice;
    const inFlight = ["submitted", "accepted", "cleared"].includes(fresh.einvoiceStatus ?? "");
    const base: Invoice =
      args.regenerate && !inFlight
        ? { ...fresh, einvoiceStatus: args.invoice.einvoiceStatus }
        : fresh;
    const invoice: Invoice =
      args.regenerate || base.einvoiceStatus === "rejected"
        ? { ...base, einvoiceXml: null, einvoiceHash: null }
        : base;
    const lines = await storage.getInvoiceLinesByInvoiceId(invoice.id);
    const ctx = await loadEInvoiceContext(invoice, company, lines);
    const existing = await getEInvoiceDocument(company.id, invoice.id);
    // A transport failure is ambiguous: A-Cube may have created the document before the
    // connection dropped. Look it up before posting it again (never double-submit).
    const ambiguous = AMBIGUOUS_CODES.has(existing?.lastErrorCode ?? "");
    const result = await submitEInvoice({
      invoice,
      lines,
      company,
      provider: ambiguous ? withAmbiguityGuard(withLookup(provider)) : provider,
      ctx,
      attempts: existing?.attempts ?? 0,
      now,
    });
    const required = invoiceReportingRequired(invoice, company);
    const reportBy = required ? reportByDate(invoice.date) : null;
    if (!result.ok) {
      if (result.validation) {
        await upsertEInvoiceDocument(company.id, invoice.id, {
          status: (existing?.status as string) ?? "generated",
          validation: result.validation,
          validatedAt: now,
        });
      }
      if (result.validation || result.issues) {
        await recordValidationEvent(company.id, invoice.id, false, {
          source,
          message: result.message,
          now,
        });
      }
      return result;
    }
    await storage.updateInvoice(invoice.id, company.id, result.update);
    await recordValidationEvent(company.id, invoice.id, true, { source, now });
    const r = result.result;
    const delivery: DeliveryStatus = r.delivery ?? deliveryFromLegacy(r.status);
    const reporting: ReportingStatus = !required
      ? "not_required"
      : r.reporting && r.reporting !== "pending"
        ? r.reporting
        : r.status === "cleared"
          ? "reported"
          : "pending";
    const failed = delivery === "delivery_failed" || delivery === "rejected";
    const needsLink = delivery === "needs_link";
    const doc = await applyTracks(
      company.id,
      invoice.id,
      {
        delivery,
        reporting,
        providerStatus: r.providerStatus ?? null,
        errorCode: needsLink
          ? "EINVOICE_NEEDS_LINK"
          : failed
            ? (r.errorCode ?? (delivery === "rejected" ? "EINVOICE_VALIDATION" : "TRANSPORT_ERROR"))
            : null,
        errorMessage: failed || needsLink ? (r.detail ?? null) : null,
        reportBy,
      },
      {
        source,
        provider: provider.name,
        now,
        document: { ...result.document, submitClaimedAt: null },
      }
    );
    if (result.handedOver) {
      await archiveEInvoiceXml({
        companyId: company.id,
        invoiceId: invoice.id,
        direction: "outbound",
        kind: "submitted",
        documentNumber: invoice.number,
        documentType: result.document.documentType ?? null,
        uuid: result.document.uuid ?? null,
        xml: result.xml,
        provider: provider.name,
        providerMessageId: result.providerMessageId,
        now,
      });
    }
    if (result.document.status === "cleared") {
      await archiveEInvoiceXml({
        companyId: company.id,
        invoiceId: invoice.id,
        direction: "outbound",
        kind: "cleared",
        documentNumber: invoice.number,
        documentType: result.document.documentType ?? null,
        uuid: result.document.uuid ?? null,
        xml: result.xml,
        provider: provider.name,
        providerMessageId: result.providerMessageId,
        now,
      });
    }
    return { ...result, documentRow: doc };
  } finally {
    await releaseSubmission(company.id, args.invoice.id);
  }
}

export async function refreshAndPersist(args: {
  invoice: Invoice;
  company: Company;
  provider: EInvoiceProvider;
  now?: Date;
  source?: HistorySource;
  providerEventId?: string | null;
}) {
  const { invoice, company, provider } = args;
  const now = args.now ?? new Date();
  const existing = await getEInvoiceDocument(company.id, invoice.id);
  const ref = { documentType: existing?.documentType ?? null };
  const result = await refreshEInvoiceStatus({ invoice, provider, now, ref });
  if (!result.ok) return result;
  const required = invoiceReportingRequired(invoice, company);
  const r = result.result;
  const delivery: DeliveryStatus = r.delivery ?? deliveryFromLegacy(r.status);
  // E2: a provider that reports the FTA track in the status itself (Complyance: final_valid /
  // final_invalid) is taken at its word; "pending" from a provider never overrides what we know.
  const providerReporting =
    r.reporting === "reported" || r.reporting === "report_failed" ? r.reporting : null;
  let reporting: ReportingStatus = !required
    ? "not_required"
    : (providerReporting ??
      (r.status === "cleared"
        ? "reported"
        : ((existing?.reportingStatus as ReportingStatus | null) ?? "pending")));
  if (
    required &&
    delivery === "delivered" &&
    reporting === "pending" &&
    provider.getReportingStatus &&
    invoice.einvoiceProviderMessageId
  ) {
    try {
      reporting = (await provider.getReportingStatus(invoice.einvoiceProviderMessageId, ref))
        .reporting;
    } catch (err) {
      log.warn({ invoiceId: invoice.id, err: (err as Error).message }, "reporting check failed");
    }
  }
  // Two-track providers drive the legacy status from the tracks; others report it directly.
  const legacy = r.delivery ? legacyFromTracks(delivery, reporting) : result.update.einvoiceStatus;
  const failed =
    delivery === "delivery_failed" || delivery === "rejected" || reporting === "report_failed";
  const doc = await applyTracks(
    company.id,
    invoice.id,
    {
      delivery,
      reporting,
      providerStatus: r.providerStatus ?? null,
      errorCode: failed ? (r.errorCode ?? "EINVOICE_DELIVERY_FAILED") : null,
      errorMessage: failed ? (r.detail ?? null) : null,
    },
    {
      source: args.source ?? "user",
      provider: provider.name,
      providerEventId: args.providerEventId ?? null,
      now,
      document: {
        ...result.document,
        status: legacy,
        clearedAt: legacy === "cleared" ? (existing?.clearedAt ?? now) : result.document.clearedAt,
      },
    }
  );
  const update = { ...result.update, einvoiceStatus: legacy };
  await storage.updateInvoice(invoice.id, company.id, update);
  if (legacy === "cleared" && invoice.einvoiceXml) {
    await archiveEInvoiceXml({
      companyId: company.id,
      invoiceId: invoice.id,
      direction: "outbound",
      kind: "cleared",
      documentNumber: invoice.number,
      documentType: doc.documentType,
      uuid: invoice.einvoiceUuid,
      xml: invoice.einvoiceXml,
      provider: provider.name,
      providerMessageId: invoice.einvoiceProviderMessageId,
      now,
    });
  }
  return { ...result, update, documentRow: doc };
}

export async function cancelAndPersist(args: {
  invoice: Invoice;
  company: Company;
  provider: EInvoiceProvider;
  reason: string;
}) {
  const result = await cancelEInvoice(args);
  if (!result.ok) return result;
  await storage.updateInvoice(args.invoice.id, args.company.id, result.update);
  const doc = await applyTracks(
    args.company.id,
    args.invoice.id,
    { delivery: "rejected", errorCode: "EINVOICE_CANCELLED", errorMessage: args.reason },
    { source: "user", provider: args.provider.name, document: result.document }
  );
  return { ...result, documentRow: doc };
}

/**
 * Background retry of transport failures whose backoff elapsed. Business
 * rejections are never retried (they need a corrected document).
 */
export async function runEInvoiceRetries(
  now: Date = new Date(),
  providerFactory: () => EInvoiceProvider = () => getEInvoiceProvider()
): Promise<{ attempted: number; submitted: number }> {
  const due = await dueEInvoiceRetries(now);
  if (due.length === 0) return { attempted: 0, submitted: 0 };
  let provider: EInvoiceProvider;
  try {
    provider = providerFactory();
  } catch (err) {
    log.warn({ err: (err as Error).message }, "e-invoice retries skipped: provider not configured");
    return { attempted: 0, submitted: 0 };
  }
  let submitted = 0;
  for (const doc of due) {
    try {
      const invoice = await storage.getInvoice(doc.invoiceId, doc.companyId);
      const company = await storage.getCompany(doc.companyId);
      if (!invoice || !company) continue;
      const r = await submitAndPersist({ invoice, company, provider, now, source: "job" });
      if (r.ok && r.document.status !== "failed") submitted++;
    } catch (err) {
      log.error(
        { invoiceId: doc.invoiceId, err: (err as Error).message },
        "e-invoice retry failed"
      );
    }
  }
  return { attempted: due.length, submitted };
}
