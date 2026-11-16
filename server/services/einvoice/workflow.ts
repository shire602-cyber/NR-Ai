/**
 * Persisted e-invoice workflow: submit / refresh / cancel with the
 * einvoice_documents row, the legacy invoice columns and the archive kept in
 * step. Shared by the HTTP routes and the "einvoice.retry" background job.
 */
import type { Company, Invoice } from "../../../shared/schema";
import { storage } from "../../storage";
import { createLogger } from "../../config/logger";
import type { EInvoiceProvider } from "../einvoice-provider";
import { getEInvoiceProvider } from "../einvoice-provider";
import { cancelEInvoice, refreshEInvoiceStatus, submitEInvoice } from "../einvoice-submit.service";
import { loadEInvoiceContext } from "./context";
import {
  archiveEInvoiceXml,
  dueEInvoiceRetries,
  getEInvoiceDocument,
  upsertEInvoiceDocument,
} from "./store";

const log = createLogger("einvoice-workflow");

export async function submitAndPersist(args: {
  invoice: Invoice;
  company: Company;
  provider: EInvoiceProvider;
  now?: Date;
}) {
  const { invoice, company, provider } = args;
  const now = args.now ?? new Date();
  const lines = await storage.getInvoiceLinesByInvoiceId(invoice.id);
  const ctx = await loadEInvoiceContext(invoice, company, lines);
  const existing = await getEInvoiceDocument(company.id, invoice.id);
  const result = await submitEInvoice({
    invoice,
    lines,
    company,
    provider,
    ctx,
    attempts: existing?.attempts ?? 0,
    now,
  });
  if (!result.ok) {
    if (result.validation) {
      await upsertEInvoiceDocument(company.id, invoice.id, {
        status: (existing?.status as string) ?? "generated",
        validation: result.validation,
        validatedAt: now,
      });
    }
    return result;
  }
  await storage.updateInvoice(invoice.id, company.id, result.update);
  const doc = await upsertEInvoiceDocument(company.id, invoice.id, result.document);
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
}

export async function refreshAndPersist(args: {
  invoice: Invoice;
  company: Company;
  provider: EInvoiceProvider;
  now?: Date;
}) {
  const { invoice, company, provider } = args;
  const now = args.now ?? new Date();
  const result = await refreshEInvoiceStatus({ invoice, provider, now });
  if (!result.ok) return result;
  await storage.updateInvoice(invoice.id, company.id, result.update);
  const doc = await upsertEInvoiceDocument(company.id, invoice.id, result.document);
  if (result.document.status === "cleared" && invoice.einvoiceXml) {
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
  return { ...result, documentRow: doc };
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
  const doc = await upsertEInvoiceDocument(args.company.id, args.invoice.id, result.document);
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
      const r = await submitAndPersist({ invoice, company, provider, now });
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
