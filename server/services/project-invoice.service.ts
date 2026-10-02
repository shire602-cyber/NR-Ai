// Create a DRAFT invoice from a project's unbilled time and billable costs.
//
// Runs under withDocumentLock(projectId, LOCK_NS.PROJECT_INVOICE): the chosen entries are selected FOR UPDATE, one
// draft invoice is created (the shared sales-line writer, one line per entry or cost, each tagged with the project)
// and billed_invoice_id is set on the entries in the same transaction. Ten parallel calls bill each entry once;
// the rest find nothing left (409 NOTHING_TO_BILL). Deleting the draft frees the entries (ON DELETE SET NULL),
// and an entry billed on an invoice that is later voided counts as unbilled again.
//
// Nothing posts here: a draft is a working document. Revenue is recognised, tagged with the project, when the
// invoice is issued (invoice-posting.service).

import { eq, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { invoices } from "../../shared/schema";
import { LOCK_NS, withDocumentLock } from "./document-lock";
import { allocateInvoiceNumber } from "./invoice-numbering.service";
import { replaceInvoiceLines } from "./sales-lines.service";
import { serviceRevenueAccountId } from "./service-revenue";
import { resolveDocumentExchangeRate } from "./document-fx-rate";
import { assertPeriodNotLocked } from "./period-lock.service";
import { buildProjectInvoiceLines } from "./project-billing";
import { err, loadUnbilled } from "./project.service";
import { toCalendarYmd } from "../utils/date";

type Tx = typeof db;

export interface ProjectInvoiceInput {
  timeEntryIds?: string[];
  expenseIds?: string[];
  date?: string;
  dueDate?: string | null;
  vatRate?: 0 | 5;
}

const MAX_FUTURE_MS = 24 * 3_600_000;

export async function createProjectInvoice(args: { companyId: string; project: any; userId: string; input: ProjectInvoiceInput }) {
  const { companyId, project, input } = args;
  if (!project.contactId) {
    throw err(422, "PROJECT_HAS_NO_CUSTOMER", "Choose the customer of this project before invoicing it.");
  }
  const contactRes = await pool.query(
    `SELECT name, trn_number, address, payment_terms FROM customer_contacts WHERE id = $1 AND company_id = $2`,
    [project.contactId, companyId]
  );
  const contact = contactRes.rows[0];
  if (!contact) throw err(422, "PROJECT_HAS_NO_CUSTOMER", "The customer of this project no longer exists.");

  const invoiceDate = new Date(`${input.date ?? toCalendarYmd(new Date())}T00:00:00Z`);
  if (Number.isNaN(invoiceDate.getTime())) throw err(400, "INVALID_DATE", "Invalid invoice date");
  if (invoiceDate.getTime() > Date.now() + MAX_FUTURE_MS) {
    throw err(422, "INVOICE_DATE_IN_FUTURE", "An invoice cannot be dated in the future.");
  }
  await assertPeriodNotLocked(companyId, invoiceDate);

  const currency = String(project.currency || "AED").toUpperCase();
  const fx = await resolveDocumentExchangeRate({ currency, date: invoiceDate, companyId });
  if (!fx.ok) throw err(422, fx.code, fx.message);

  const vatRate = (input.vatRate ?? 5) === 0 ? 0 : 0.05;
  let dueDate: Date | null = null;
  if (input.dueDate) {
    dueDate = new Date(`${input.dueDate}T00:00:00Z`);
    if (Number.isNaN(dueDate.getTime())) throw err(400, "INVALID_DATE", "Invalid due date");
  } else {
    dueDate = new Date(invoiceDate.getTime() + (Number(contact.payment_terms) > 0 ? Number(contact.payment_terms) : 30) * 86_400_000);
  }

  return await withDocumentLock(project.id, LOCK_NS.PROJECT_INVOICE, async (tx: Tx) => {
    // The lock transaction is `tx` (Drizzle); the row locks below need the same connection, so use its client.
    const q: { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> } = {
      query: async (text, params = []) => {
        // sql.param keeps an array as ONE parameter (a bare array would expand into a tuple).
        const chunks = text.split(/\$(\d+)/).map((part, i) => (i % 2 === 0 ? sql.raw(part) : sql.param((params as any[])[Number(part) - 1])));
        const res: any = await tx.execute(sql.join(chunks, sql``));
        return { rows: res.rows ?? res };
      },
    };
    const picked = await loadUnbilled(companyId, project, {
      lockTx: q,
      timeEntryIds: input.timeEntryIds,
      expenseIds: input.expenseIds,
    });

    // Entries that were asked for by id but are not billable or not unbilled are refused, never skipped silently.
    if (input.timeEntryIds && picked.time.length !== new Set(input.timeEntryIds).size) {
      throw err(422, "INVALID_TIME_ENTRY", "A chosen time entry is not billable, is already billed or is not on this project.");
    }
    if (input.expenseIds && picked.expenses.length !== new Set(input.expenseIds).size) {
      throw err(422, "INVALID_EXPENSE", "A chosen cost is not billable, is already billed or is not on this project.");
    }
    if (picked.time.length === 0 && picked.expenses.length === 0) {
      throw err(409, "NOTHING_TO_BILL", "There is nothing left to bill on this project.");
    }
    if (picked.expenses.length > 0 && currency !== "AED") {
      throw err(422, "CURRENCY_MISMATCH", "Costs are in AED; a project invoiced in another currency can bill time only.");
    }

    const drafts = buildProjectInvoiceLines({
      project,
      vatRate: vatRate as 0 | 0.05,
      time: picked.time.map((t: any) => ({ ...t, taskName: t.taskName })),
      expenses: picked.expenses,
    });

    const number = await allocateInvoiceNumber(companyId, "invoice", invoiceDate, tx);
    const [invoice] = await tx
      .insert(invoices)
      .values({
        companyId,
        number,
        customerName: contact.name,
        customerTrn: contact.trn_number ?? null,
        customerAddress: contact.address ?? null,
        contactId: project.contactId,
        date: invoiceDate,
        dueDate,
        currency,
        exchangeRate: fx.rate,
        status: "draft",
        invoiceType: "invoice",
      } as any)
      .returning();

    // Time and recharged costs are service income: 4020, not the 4010 Product Sales default.
    const serviceAccountId = await serviceRevenueAccountId(tx, companyId);
    await replaceInvoiceLines(tx, {
      companyId,
      invoiceId: invoice.id,
      lines: drafts.map((d) => ({
        kind: "item" as const,
        description: d.description,
        quantity: d.quantity,
        unitPrice: d.unitPrice,
        vatRate: d.vatRate,
        vatSupplyType: d.vatSupplyType,
        revenueAccountId: serviceAccountId,
      })),
      exchangeRate: fx.rate,
      itemExtras: (_source, index) => ({ projectId: drafts[index].projectId }),
    });

    const timeIds = picked.time.map((t: any) => t.id);
    const expenseIds = picked.expenses.map((e) => e.id);
    if (timeIds.length > 0) await q.query(`UPDATE time_entries SET billed_invoice_id = $1, updated_at = NOW() WHERE id = ANY($2::uuid[])`, [invoice.id, timeIds]);
    if (expenseIds.length > 0) await q.query(`UPDATE project_expenses SET billed_invoice_id = $1 WHERE id = ANY($2::uuid[])`, [invoice.id, expenseIds]);

    const [withLines] = await tx.select().from(invoices).where(eq(invoices.id, invoice.id));
    return { invoice: withLines ?? invoice, lineCount: drafts.length, timeEntryIds: timeIds, expenseIds };
  });
}
