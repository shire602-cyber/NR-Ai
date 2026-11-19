// WQ1: Receive payment (one receipt applied across several invoices) and Cash sale.
//
// Contract:
//   * every allocation settles through invoices.recordPayment (invoice-payment.service), inside
//     ONE ledger transaction: either every invoice is settled or none is (7.6);
//   * open balances come from the one settlement rule (server/reporting/settlement.ts via
//     getInvoiceBalances); an allocation above an invoice's open balance is a 422;
//   * the amount above the allocations becomes a customer credit (2055) on the last invoice's
//     payment (the payment service's allowCredit path); a bank fee is posted through the ledger
//     kernel: Dr 5110 Bank charges / Cr the bank account, so the bank receives amount - fee;
//   * a cash sale creates, issues (revenue entry) and pays the invoice in one transaction
//     (7.7); the customer is optional and the paid-through cash/bank account is required.
import { journalMemo } from "@shared/journal-memo";
import { type Express, type Request, type Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { DomainError } from "../errors";
import { storage } from "../storage";
import { db } from "../db";
import { accounts, invoices as invoicesTable, invoiceLines } from "../../shared/schema";
import {
  cashSaleSchema,
  receivePaymentSchema,
  type CashSaleInput,
  type ReceivePaymentInput,
} from "../../shared/validators/sales-documents";
import type { CreateInvoiceInput } from "../../shared/validators/invoices";
import { fromFils, mulRate, toFils } from "../../shared/money";
import { defaultChartOfAccounts } from "../defaultChartOfAccounts";
import { getInvoiceBalances } from "../services/invoice-balances";
import { assertCashOrBankAccount, recordInvoicePayment } from "../services/invoice-payment.service";
import { issueInvoiceInTx, isIssuedStatus } from "../services/invoice-posting.service";
import { allocateInvoiceNumber } from "../services/invoice-numbering.service";
import { assertNotFutureDate, assertPeriodNotLocked } from "../services/period-lock.service";
import { bankCurrencyOf } from "../services/fx/bank-currency";
import { loadBaseCurrency, postJournal, withLedgerTx } from "../ledger";
import { emitDomainEvent } from "../platform/domain-events";
import { recordAudit } from "../services/audit.service";
import { lineRow, prepareNewDocument } from "./invoices.routes";

const userOf = (req: Request): string => (req as Request & { user: { id: string } }).user.id;
const toDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

export const BANK_CHARGES_CODE = "5110";
/** Customer name stored on a cash sale with no customer. */
export const CASH_CUSTOMER_NAME = "Cash customer";

async function assertCompanyAccess(req: Request, companyId: string): Promise<void> {
  if (!(await storage.hasCompanyAccess(userOf(req), companyId))) {
    throw new DomainError("COMPANY_ACCESS_DENIED", 403, undefined, "Access denied");
  }
}

async function bankChargesAccountId(companyId: string): Promise<string> {
  const find = async () => {
    const [row] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.companyId, companyId), eq(accounts.code, BANK_CHARGES_CODE)));
    return row?.id ?? null;
  };
  const existing = await find();
  if (existing) return existing;
  const tpl = defaultChartOfAccounts.find((a) => a.code === BANK_CHARGES_CODE);
  await db
    .insert(accounts)
    .values({
      companyId,
      code: BANK_CHARGES_CODE,
      nameEn: tpl?.nameEn ?? "Bank Charges & Fees",
      nameAr: tpl?.nameAr ?? "الرسوم والعمولات البنكية",
      type: "expense",
      subType: tpl?.subType ?? "operating_expense",
      isSystemAccount: true,
    })
    .onConflictDoNothing();
  const id = await find();
  if (!id) throw new DomainError("BANK_CHARGES_ACCOUNT_MISSING", 422);
  return id;
}

const OPEN_RECEIVABLE = new Set(["sent", "posted", "partial", "viewed", "overdue"]);

export function registerSalesReceiptRoutes(app: Express) {
  // ── Open invoices of one customer, oldest due first (Receive payment picker) ──
  app.get(
    "/api/companies/:companyId/receive-payments/open-invoices",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      const contactId =
        typeof req.query.contactId === "string" && /^[0-9a-f-]{36}$/i.test(req.query.contactId)
          ? req.query.contactId
          : null;
      const name = typeof req.query.customerName === "string" ? req.query.customerName.trim() : "";
      if (!contactId && !name) return res.json([]);
      const rows = await db
        .select()
        .from(invoicesTable)
        .where(
          and(
            eq(invoicesTable.companyId, companyId),
            inArray(invoicesTable.invoiceType, ["invoice", "debit_note"]),
            inArray(invoicesTable.status, [...OPEN_RECEIVABLE]),
            contactId
              ? eq(invoicesTable.contactId, contactId)
              : eq(invoicesTable.customerName, name)
          )
        );
      const balances = await getInvoiceBalances(
        companyId,
        rows.map((r: { id: string }) => r.id)
      );
      const out = rows
        .map((r: typeof invoicesTable.$inferSelect) => ({
          id: r.id,
          number: r.number,
          date: r.date ? new Date(r.date).toISOString().slice(0, 10) : null,
          dueDate: r.dueDate ? new Date(r.dueDate).toISOString().slice(0, 10) : null,
          currency: r.currency,
          exchangeRate: Number(r.exchangeRate) || 1,
          total: Number(r.total),
          openBalance: balances.get(r.id)?.openBalance ?? 0,
        }))
        .filter((r: { openBalance: number }) => r.openBalance > 0)
        .sort((a: { dueDate: string | null; date: string | null }, b: typeof a) =>
          `${a.dueDate ?? a.date}` < `${b.dueDate ?? b.date}` ? -1 : 1
        );
      res.json(out);
    })
  );

  // ── Receive payment: one receipt over several invoices ──────────────────
  app.post(
    "/api/companies/:companyId/receive-payments",
    authMiddleware,
    requireCustomer,
    strictBody(receivePaymentSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = userOf(req);
      await assertCompanyAccess(req, companyId);
      const body = parsedBody<ReceivePaymentInput>(req);
      const date = toDate(body.date);
      await assertPeriodNotLocked(companyId, date);
      assertNotFutureDate(date);
      await assertCashOrBankAccount(companyId, body.paymentAccountId);

      const ids = body.allocations.map((a) => a.invoiceId);
      const rows: Array<typeof invoicesTable.$inferSelect> = await db
        .select()
        .from(invoicesTable)
        .where(and(eq(invoicesTable.companyId, companyId), inArray(invoicesTable.id, ids)));
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const id of ids) {
        // Another tenant's invoice is a 404, never an existence oracle.
        if (!byId.has(id)) throw new DomainError("INVOICE_NOT_FOUND", 404, { invoiceId: id });
      }
      const currencies = new Set(rows.map((r) => r.currency));
      if (currencies.size > 1) {
        throw new DomainError(
          "RECEIPT_CURRENCY_MIXED",
          422,
          { currencies: [...currencies] },
          "A receipt applies to invoices in one currency"
        );
      }
      const customers = new Set(rows.map((r) => r.contactId ?? `name:${r.customerName}`));
      const expected = body.contactId
        ? body.contactId
        : body.customerName
          ? `name:${body.customerName.trim()}`
          : null;
      if (customers.size > 1 || (expected && !customers.has(expected))) {
        throw new DomainError(
          "RECEIPT_CUSTOMER_MISMATCH",
          422,
          undefined,
          "Every invoice on a receipt belongs to the same customer"
        );
      }
      const balances = await getInvoiceBalances(companyId, ids);
      for (const a of body.allocations) {
        const inv = byId.get(a.invoiceId)!;
        if (inv.invoiceType === "credit_note" || !isIssuedStatus(inv.status)) {
          throw new DomainError(
            "INVOICE_NOT_OPEN",
            422,
            { invoiceId: inv.id, number: inv.number, status: inv.status },
            `Invoice ${inv.number} is not open for payment`
          );
        }
        const openFils = toFils(balances.get(inv.id)?.openBalance ?? 0, { rounding: "halfUp" });
        if (a.amount > openFils) {
          throw new DomainError(
            "ALLOCATION_EXCEEDS_BALANCE",
            422,
            { invoiceId: inv.id, number: inv.number, open: fromFils(openFils) },
            `The amount applied to ${inv.number} is more than its open balance ${fromFils(openFils)}`
          );
        }
      }
      const appliedFils = body.allocations.reduce((s, a) => s + a.amount, 0);
      const creditFils = body.amount - appliedFils;
      const feeFils = body.bankFee ?? 0;
      const baseCurrency = await loadBaseCurrency(companyId);
      if (feeFils > 0) {
        const bankCur = (await bankCurrencyOf(companyId, body.paymentAccountId)) ?? baseCurrency;
        if (bankCur !== baseCurrency) {
          throw new DomainError(
            "BANK_FEE_BASE_CURRENCY_ONLY",
            422,
            { fields: { bankFee: [`Record the fee on a ${baseCurrency} account`] } },
            `A bank fee can be recorded on a ${baseCurrency} bank account`
          );
        }
        const rate = body.exchangeRate || Number(rows[0].exchangeRate) || 1;
        const receivedBase =
          [...currencies][0] === baseCurrency ? body.amount : mulRate(body.amount, rate);
        if (feeFils >= receivedBase) {
          throw new DomainError(
            "BANK_FEE_TOO_LARGE",
            422,
            { fields: { bankFee: ["The fee must be less than the amount received"] } },
            "The bank fee must be less than the amount received"
          );
        }
      }
      const feeAccountId = feeFils > 0 ? await bankChargesAccountId(companyId) : null;

      const result = await withLedgerTx(async (tx) => {
        const payments: Array<{
          invoiceId: string;
          paymentId: string;
          journalEntryId: string;
          status: string;
        }> = [];
        for (let i = 0; i < body.allocations.length; i++) {
          const a = body.allocations[i];
          const last = i === body.allocations.length - 1;
          const amountFils = last ? a.amount + creditFils : a.amount;
          const r = await recordInvoicePayment({
            invoiceId: a.invoiceId,
            companyId,
            amount: Number(fromFils(amountFils)),
            date,
            method: body.method || "bank",
            reference: body.reference ?? null,
            notes: body.notes ?? null,
            paymentAccountId: body.paymentAccountId,
            paymentExchangeRate: body.exchangeRate ?? null,
            createdBy: userId,
            allowCredit: last && creditFils > 0,
            tx,
          });
          payments.push({
            invoiceId: a.invoiceId,
            paymentId: r.payment.id,
            journalEntryId: r.journalEntryId,
            status: r.invoice.status,
          });
        }
        let feeEntryId: string | null = null;
        if (feeFils > 0 && feeAccountId) {
          const { entry } = await postJournal(
            {
              companyId,
              date: body.date,
              ...(body.reference
                ? journalMemo("bankFeeRef", { ref: body.reference })
                : journalMemo("bankFee")),
              status: "posted",
              source: "customer_receipt_fee",
              sourceId: payments[0]?.paymentId ?? null,
              lines: [
                {
                  accountId: feeAccountId,
                  debitFils: feeFils,
                  description: "Bank fee on customer receipt",
                },
                {
                  accountId: body.paymentAccountId,
                  creditFils: feeFils,
                  description: "Bank fee on customer receipt",
                },
              ],
            },
            { actorId: userId, tx }
          );
          feeEntryId = entry.id;
        }
        return { payments, feeEntryId };
      });

      await recordAudit({
        userId,
        companyId,
        action: "invoice.receive_payment",
        entityType: "invoice",
        entityId: result.payments[0]?.invoiceId ?? null,
        before: null,
        after: {
          amount: fromFils(body.amount),
          applied: fromFils(appliedFils),
          customerCredit: fromFils(creditFils),
          bankFee: fromFils(feeFils),
          invoices: result.payments.map((p) => p.invoiceId),
        },
        req,
      });
      res.status(201).json({
        payments: result.payments,
        applied: fromFils(appliedFils),
        customerCredit: fromFils(creditFils),
        bankFee: fromFils(feeFils),
        feeEntryId: result.feeEntryId,
      });
    })
  );

  // ── Cash sale: invoice issued and paid in one transaction ───────────────
  app.post(
    "/api/companies/:companyId/cash-sales",
    authMiddleware,
    requireCustomer,
    strictBody(cashSaleSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = userOf(req);
      await assertCompanyAccess(req, companyId);
      const body = parsedBody<CashSaleInput>(req);
      const invoiceDate = toDate(body.date);
      await assertPeriodNotLocked(companyId, invoiceDate);
      assertNotFutureDate(invoiceDate);
      await assertCashOrBankAccount(companyId, body.paymentAccountId);
      const { paymentAccountId, method, reference, customerName, ...invoiceBody }: CashSaleInput =
        body;
      const doc = await prepareNewDocument(companyId, {
        ...invoiceBody,
        customerName: customerName?.trim() || (body.contactId ? undefined : CASH_CUSTOMER_NAME),
        paymentTerms: "due_on_receipt",
        dueDate: body.date,
      } as CreateInvoiceInput);

      const result = await withLedgerTx(async (tx) => {
        // CASH-SERIES: cash sales take numbers only from their own series (Settings › Numbering),
        // allocated inside this transaction, so a failed save rolls the counter back too.
        const number = await allocateInvoiceNumber(companyId, "cash_sale", invoiceDate, tx);
        const [inserted] = await tx
          .insert(invoicesTable)
          .values({
            companyId,
            number,
            ...doc.header,
            dueDate: invoiceDate,
            date: invoiceDate,
            supplyDate: body.supplyDate ? toDate(body.supplyDate) : null,
            currency: doc.currency,
            exchangeRate: doc.rate,
            baseCurrencyAmount: Number(fromFils(mulRate(doc.totals.totalFils || 0, doc.rate) || 0)),
            subtotal: Number(fromFils(doc.totals.subtotalFils)),
            vatAmount: Number(fromFils(doc.totals.vatFils)),
            total: Number(fromFils(doc.totals.totalFils)),
            discountType: body.discountType ?? null,
            discountValue: body.discountValue ?? null,
            discountAmount: Number(fromFils(doc.totals.discountFils)),
            reverseCharge: body.reverseCharge ?? false,
            notes: body.notes ?? null,
            templateId: body.templateId ?? null,
            documentLanguage: body.documentLanguage ?? null,
            source: "cash_sale",
            status: "draft",
            invoiceType: "invoice",
          })
          .returning();
        for (const r of doc.rows) await tx.insert(invoiceLines).values(lineRow(inserted.id, r));
        const issued = await issueInvoiceInTx(tx, inserted.id, companyId, userId, "sent");
        const paid = await recordInvoicePayment({
          invoiceId: inserted.id,
          companyId,
          amount: Number(fromFils(doc.totals.totalFils)),
          date: invoiceDate,
          method: method || "cash",
          reference: reference ?? null,
          notes: null,
          paymentAccountId,
          createdBy: userId,
          tx,
        });
        return { invoice: paid.invoice, issued: issued.invoice, payment: paid.payment, paid };
      });

      emitDomainEvent("invoice.created", {
        companyId,
        entityId: result.invoice.id,
        number: result.invoice.number,
        totalFils: doc.totals.totalFils,
        actorUserId: userId,
      });
      emitDomainEvent("invoice.issued", {
        companyId,
        entityId: result.invoice.id,
        number: result.invoice.number,
        totalFils: doc.totals.totalFils,
        actorUserId: userId,
      });
      await recordAudit({
        userId,
        companyId,
        action: "invoice.cash_sale",
        entityType: "invoice",
        entityId: result.invoice.id,
        before: null,
        after: {
          number: result.invoice.number,
          total: result.invoice.total,
          status: result.invoice.status,
          paymentId: result.payment.id,
        },
        req,
      });
      const lines = await storage.getInvoiceLinesByInvoiceId(result.invoice.id);
      res.status(201).json({
        ...result.invoice,
        lines,
        payment: result.payment,
        journalEntryId: result.paid.journalEntryId,
      });
    })
  );
}
