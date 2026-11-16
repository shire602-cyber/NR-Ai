/**
 * Customer and supplier statements of account (W4-D: R16-15, W2-B carry-over R11-15).
 *
 * A statement is per party (customer contact id / vendor id) and per currency (documents keep
 * their own currency; a party trading in two currencies gets two sections):
 *   opening balance (everything dated before `from`) + transactions in [from, asOf] with a
 *   running balance = closing balance, and an ageing footer of the documents still open at asOf.
 *
 * Customer (debit-normal, positive = the customer owes us):
 *   + issued invoices, − issued credit notes, − payments received (full amount, so an
 *   overpayment shows as a credit balance), + refunds of customer credit. Applying an existing
 *   credit to another invoice moves nothing between us and the customer and is not a line.
 * Supplier (credit-normal, positive = we owe the supplier):
 *   + posted bills, − bill payments (reversal rows net them), − debit notes.
 *
 * Amounts are summed in integer fils. Registered as services "statements.customer" and
 * "statements.supplier".
 */
// @ts-expect-error - pdfkit has no type declarations
import PDFDocument from "pdfkit";
import { pool } from "../db";
import { DomainError } from "../errors";
import { has, provide } from "../platform/service-registry";
import { preparePdfDocument } from "./pdf-fonts";
import { payableOpenSql, receivableOpenSql } from "../reporting/settlement";
import type { Company } from "../../shared/schema";

export type StatementKind = "customer" | "supplier";

export interface StatementLine {
  date: string;
  type: "invoice" | "credit_note" | "payment" | "refund" | "bill" | "bill_payment" | "debit_note";
  reference: string;
  description: string;
  documentId: string;
  dueDate: string | null;
  debit: number;
  credit: number;
  balance: number;
}

export interface StatementAging {
  current: number;
  days30: number;
  days60: number;
  days90: number;
  over90: number;
  total: number;
  unappliedCredits: number;
}

export interface StatementSection {
  currency: string;
  openingBalance: number;
  lines: StatementLine[];
  totals: { debit: number; credit: number };
  closingBalance: number;
  aging: StatementAging;
}

export interface Statement {
  kind: StatementKind;
  company: { id: string; name: string; trn: string | null; address: string | null };
  party: { id: string; name: string; email: string | null; trn: string | null };
  from: string | null;
  asOf: string;
  generatedAt: string;
  sections: StatementSection[];
}

const LOCAL = (col: string) => `((${col} + interval '4 hours')::date)`;
const toAmt = (fils: number) => Math.round(fils) / 100;
const todayUae = () => new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);

interface RawRow {
  doc_id: string;
  date: string;
  due: string | null;
  type: StatementLine["type"];
  reference: string | null;
  description: string | null;
  currency: string;
  debit_fils: string;
  credit_fils: string;
}

interface OpenDoc {
  currency: string;
  due: string;
  open_fils: string;
}

function bucket(
  asOf: string,
  due: string
): keyof Omit<StatementAging, "total" | "unappliedCredits"> {
  const days = Math.floor((Date.parse(asOf) - Date.parse(due)) / 86_400_000);
  if (days <= 0) return "current";
  if (days <= 30) return "days30";
  if (days <= 60) return "days60";
  if (days <= 90) return "days90";
  return "over90";
}

function buildSections(
  rows: RawRow[],
  openDocs: OpenDoc[],
  from: string | null,
  asOf: string,
  sign: 1 | -1
): StatementSection[] {
  const currencies = new Set<string>([
    ...rows.map((r) => r.currency),
    ...openDocs.map((d) => d.currency),
  ]);
  const sections: StatementSection[] = [];
  for (const currency of [...currencies].sort()) {
    const mine = rows.filter((r) => r.currency === currency);
    let openingFils = 0;
    let running = 0;
    const lines: StatementLine[] = [];
    let debitFils = 0;
    let creditFils = 0;
    for (const r of mine) {
      const d = Number(r.debit_fils);
      const c = Number(r.credit_fils);
      const delta = sign * (d - c);
      if (from && r.date < from) {
        openingFils += delta;
        continue;
      }
      if (!lines.length) running = openingFils;
      running += delta;
      debitFils += d;
      creditFils += c;
      lines.push({
        date: r.date,
        type: r.type,
        reference: r.reference ?? "",
        description: r.description ?? "",
        documentId: r.doc_id,
        dueDate: r.due,
        debit: toAmt(d),
        credit: toAmt(c),
        balance: toAmt(running),
      });
    }
    const closingFils = lines.length ? running : openingFils;
    const aging: StatementAging = {
      current: 0,
      days30: 0,
      days60: 0,
      days90: 0,
      over90: 0,
      total: 0,
      unappliedCredits: 0,
    };
    let agedFils = 0;
    const buckets: Record<string, number> = {
      current: 0,
      days30: 0,
      days60: 0,
      days90: 0,
      over90: 0,
    };
    for (const d of openDocs.filter((x) => x.currency === currency)) {
      const f = Number(d.open_fils);
      if (f <= 0) continue;
      buckets[bucket(asOf, d.due)] += f;
      agedFils += f;
    }
    for (const k of Object.keys(buckets))
      (aging as unknown as Record<string, number>)[k] = toAmt(buckets[k]);
    aging.total = toAmt(agedFils);
    // Whatever the documents do not explain is credit on account (overpayments, unapplied credits).
    aging.unappliedCredits = toAmt(Math.min(0, closingFils - agedFils));
    sections.push({
      currency,
      openingBalance: toAmt(openingFils),
      lines,
      totals: { debit: toAmt(debitFils), credit: toAmt(creditFils) },
      closingBalance: toAmt(closingFils),
      aging,
    });
  }
  return sections;
}

async function companyHeader(companyId: string) {
  const { rows } = await pool.query(
    `SELECT id, name, trn_vat_number, business_address FROM companies WHERE id = $1`,
    [companyId]
  );
  if (!rows[0]) throw new DomainError("COMPANY_NOT_FOUND", 404);
  return {
    id: rows[0].id as string,
    name: rows[0].name as string,
    trn: (rows[0].trn_vat_number as string | null) ?? null,
    address: (rows[0].business_address as string | null) ?? null,
  };
}

function normalizeRange(args: { from?: string | null; asOf?: string | null }) {
  const asOf = args.asOf || todayUae();
  const from = args.from || null;
  if (from && from > asOf) {
    throw new DomainError(
      "INVALID_STATEMENT_RANGE",
      400,
      undefined,
      "`from` must not be after `asOf`"
    );
  }
  return { from, asOf };
}

export async function buildCustomerStatement(args: {
  companyId: string;
  contactId: string;
  from?: string | null;
  asOf?: string | null;
}): Promise<Statement> {
  const { from, asOf } = normalizeRange(args);
  const { rows: contactRows } = await pool.query(
    `SELECT id, name, email, trn_number FROM customer_contacts WHERE id = $1 AND company_id = $2`,
    [args.contactId, args.companyId]
  );
  const contact = contactRows[0];
  if (!contact) throw new DomainError("CONTACT_NOT_FOUND", 404, undefined, "Customer not found");
  const params = [args.companyId, args.contactId, asOf];
  const { rows }: { rows: RawRow[] } = await pool.query(
    `SELECT * FROM (
       SELECT i.id AS doc_id, ${LOCAL("i.date")}::text AS date, ${LOCAL("i.due_date")}::text AS due,
              'invoice' AS type, i.number AS reference, 'Invoice' AS description,
              upper(coalesce(i.currency, 'AED')) AS currency,
              ROUND(i.total * 100)::bigint::text AS debit_fils, '0' AS credit_fils, i.created_at AS seq
         FROM invoices i
        WHERE i.company_id = $1 AND i.contact_id = $2 AND i.invoice_type <> 'credit_note'
          AND i.status IN ('sent', 'posted', 'partial', 'paid') AND ${LOCAL("i.date")} <= $3::date
       UNION ALL
       SELECT i.id, ${LOCAL("i.date")}::text, NULL, 'credit_note', i.number, 'Credit note',
              upper(coalesce(i.currency, 'AED')), '0', ROUND(abs(i.total) * 100)::bigint::text, i.created_at
         FROM invoices i
        WHERE i.company_id = $1 AND i.contact_id = $2 AND i.invoice_type = 'credit_note'
          AND i.status IN ('sent', 'posted', 'partial', 'paid') AND ${LOCAL("i.date")} <= $3::date
       UNION ALL
       SELECT p.id, ${LOCAL("p.date")}::text, NULL, 'payment', coalesce(p.reference, i.number),
              'Payment — ' || i.number, upper(coalesce(i.currency, 'AED')), '0',
              ROUND(p.amount * 100)::bigint::text, p.created_at
         FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
        WHERE p.company_id = $1 AND i.contact_id = $2 AND ${LOCAL("p.date")} <= $3::date
       UNION ALL
       SELECT a.id, ${LOCAL("a.date")}::text, NULL, 'refund', coalesce(a.reference, ''),
              'Refund of credit', upper(c.currency), ROUND(a.amount * 100)::bigint::text, '0', a.created_at
         FROM customer_credit_allocations a JOIN customer_credits c ON c.id = a.credit_id
        WHERE a.company_id = $1 AND c.contact_id = $2 AND a.kind = 'refund'
          AND ${LOCAL("a.date")} <= $3::date
     ) t ORDER BY date, seq, doc_id`,
    params
  );
  const { rows: openDocs }: { rows: OpenDoc[] } = await pool.query(
    `SELECT upper(coalesce(i.currency, 'AED')) AS currency,
            coalesce(${LOCAL("i.due_date")}, ${LOCAL("i.date")})::text AS due,
            ROUND(${receivableOpenSql("i", { asOf: "$3::date" })} * 100)::bigint::text AS open_fils
       FROM invoices i
      WHERE i.company_id = $1 AND i.contact_id = $2 AND i.invoice_type <> 'credit_note'
        AND i.status IN ('sent', 'posted', 'partial', 'paid') AND ${LOCAL("i.date")} <= $3::date`,
    params
  );
  return {
    kind: "customer",
    company: await companyHeader(args.companyId),
    party: {
      id: contact.id,
      name: contact.name,
      email: contact.email ?? null,
      trn: contact.trn_number ?? null,
    },
    from,
    asOf,
    generatedAt: new Date().toISOString(),
    sections: buildSections(rows, openDocs, from, asOf, 1),
  };
}

export async function buildSupplierStatement(args: {
  companyId: string;
  vendorId: string;
  from?: string | null;
  asOf?: string | null;
}): Promise<Statement> {
  const { from, asOf } = normalizeRange(args);
  const { rows: vendorRows } = await pool.query(
    `SELECT id, name, email, trn FROM vendors WHERE id = $1 AND company_id = $2`,
    [args.vendorId, args.companyId]
  );
  const vendor = vendorRows[0];
  if (!vendor) throw new DomainError("VENDOR_NOT_FOUND", 404, undefined, "Supplier not found");
  // Bills linked by vendor id, or (legacy rows with no vendor id) by exact vendor name.
  const billFilter = `b.company_id = $1 AND (b.vendor_id = $2 OR (b.vendor_id IS NULL
      AND lower(trim(b.vendor_name)) = lower(trim($4))))
      AND coalesce(b.status, 'pending') IN ('approved', 'overdue', 'partial', 'paid')`;
  const params = [args.companyId, args.vendorId, asOf, vendor.name];
  const { rows }: { rows: RawRow[] } = await pool.query(
    `SELECT * FROM (
       SELECT b.id AS doc_id, ${LOCAL("b.bill_date")}::text AS date, ${LOCAL("b.due_date")}::text AS due,
              'bill' AS type, coalesce(b.bill_number, '') AS reference, 'Bill' AS description,
              upper(coalesce(b.currency, 'AED')) AS currency, '0' AS debit_fils,
              ROUND(coalesce(b.total_amount, 0) * 100)::bigint::text AS credit_fils, b.created_at AS seq
         FROM vendor_bills b WHERE ${billFilter} AND ${LOCAL("b.bill_date")} <= $3::date
       UNION ALL
       SELECT bp.id, ${LOCAL("bp.payment_date")}::text, NULL, 'bill_payment',
              coalesce(b.bill_number, ''), 'Payment', upper(coalesce(b.currency, 'AED')),
              ROUND(bp.amount * 100)::bigint::text, '0', bp.created_at
         FROM bill_payments bp JOIN vendor_bills b ON b.id = bp.bill_id
        WHERE ${billFilter} AND ${LOCAL("bp.payment_date")} <= $3::date
          -- A debit note already debits the statement (and A/P) when raised; applying it to a
          -- bill moves no A/P, so its application rows (and their reversals) are not movements.
          AND bp.kind <> 'vendor_credit'
          AND NOT (bp.kind = 'reversal' AND EXISTS (
                SELECT 1 FROM bill_payments vc
                 WHERE vc.id = bp.reverses_payment_id AND vc.kind = 'vendor_credit'))
       UNION ALL
       SELECT d.id, ${LOCAL("d.note_date")}::text, NULL, 'debit_note', d.debit_note_number,
              'Debit note', upper(d.currency), ROUND(d.total_amount * 100)::bigint::text, '0', d.created_at
         FROM vendor_debit_notes d
        WHERE d.company_id = $1 AND d.vendor_id = $2 AND d.status <> 'void'
          AND ${LOCAL("d.note_date")} <= $3::date
     ) t ORDER BY date, seq, doc_id`,
    params
  );
  const { rows: openDocs }: { rows: OpenDoc[] } = await pool.query(
    `SELECT upper(coalesce(b.currency, 'AED')) AS currency,
            coalesce(${LOCAL("b.due_date")}, ${LOCAL("b.bill_date")})::text AS due,
            ROUND(${payableOpenSql("b", { asOf: "$3::date" })} * 100)::bigint::text AS open_fils
       FROM vendor_bills b WHERE ${billFilter} AND ${LOCAL("b.bill_date")} <= $3::date`,
    params
  );
  return {
    kind: "supplier",
    company: await companyHeader(args.companyId),
    party: {
      id: vendor.id,
      name: vendor.name,
      email: vendor.email ?? null,
      trn: vendor.trn ?? null,
    },
    from,
    asOf,
    generatedAt: new Date().toISOString(),
    sections: buildSections(rows, openDocs, from, asOf, -1),
  };
}

// ─── PDF ────────────────────────────────────────────────────────────────────

const money = (n: number) =>
  n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Bilingual statement PDF (Noto Sans + Noto Naskh Arabic via pdf-fonts). */
export function renderStatementPdf(st: Statement): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 40,
        info: { Title: `Statement of account — ${st.party.name}`, Author: st.company.name },
      });
      preparePdfDocument(doc);
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const left = 40;
      const width = 515;
      doc.rect(0, 0, 595.28, 80).fill("#1E40AF");
      doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(18);
      doc.text(st.company.name, left, 22, { width: width * 0.6 });
      doc.fontSize(12).text("Statement of Account / كشف حساب", left, 28, { width, align: "right" });
      doc.font("Helvetica").fontSize(9);
      if (st.company.trn) doc.text(`TRN: ${st.company.trn}`, left, 52, { width: width * 0.6 });

      let y = 96;
      doc.fillColor("#111827").font("Helvetica-Bold").fontSize(10);
      doc.text(
        `${st.kind === "customer" ? "Customer / العميل" : "Supplier / المورد"}: ${st.party.name}`,
        left,
        y,
        { width }
      );
      y += 16;
      doc.font("Helvetica").fontSize(9);
      doc.text(
        `${st.from ? `From / من ${st.from}  ` : ""}As of / حتى ${st.asOf}${st.party.trn ? `   TRN: ${st.party.trn}` : ""}`,
        left,
        y,
        { width }
      );
      y += 22;

      const cols = [
        { key: "date", label: "Date / التاريخ", x: left, w: 70 },
        { key: "reference", label: "Reference / المرجع", x: left + 72, w: 120 },
        { key: "description", label: "Details / البيان", x: left + 194, w: 120 },
        { key: "debit", label: "Debit / مدين", x: left + 316, w: 65 },
        { key: "credit", label: "Credit / دائن", x: left + 383, w: 65 },
        { key: "balance", label: "Balance / الرصيد", x: left + 450, w: 65 },
      ];
      for (const s of st.sections) {
        if (y > 720) {
          doc.addPage();
          y = 40;
        }
        doc.font("Helvetica-Bold").fontSize(10).fillColor("#1E40AF");
        doc.text(`${s.currency}`, left, y);
        y += 16;
        doc.rect(left, y - 2, width, 16).fill("#F3F4F6");
        doc.fillColor("#374151").font("Helvetica-Bold").fontSize(8);
        for (const c of cols) {
          doc.text(c.label, c.x + 2, y + 2, {
            width: c.w - 4,
            align: ["debit", "credit", "balance"].includes(c.key) ? "right" : "left",
          });
        }
        y += 18;
        doc.font("Helvetica").fontSize(8).fillColor("#111827");
        doc.text("Opening balance / الرصيد الافتتاحي", cols[2].x + 2, y, { width: 240 });
        doc.text(money(s.openingBalance), cols[5].x, y, { width: cols[5].w - 2, align: "right" });
        y += 14;
        for (const l of s.lines) {
          if (y > 760) {
            doc.addPage();
            y = 40;
          }
          doc.text(l.date, cols[0].x + 2, y, { width: cols[0].w - 4 });
          doc.text(l.reference, cols[1].x + 2, y, { width: cols[1].w - 4 });
          doc.text(l.description, cols[2].x + 2, y, { width: cols[2].w - 4 });
          doc.text(l.debit ? money(l.debit) : "", cols[3].x, y, {
            width: cols[3].w - 2,
            align: "right",
          });
          doc.text(l.credit ? money(l.credit) : "", cols[4].x, y, {
            width: cols[4].w - 2,
            align: "right",
          });
          doc.text(money(l.balance), cols[5].x, y, { width: cols[5].w - 2, align: "right" });
          y += 13;
        }
        doc.font("Helvetica-Bold");
        doc.text("Closing balance / الرصيد الختامي", cols[2].x + 2, y + 2, { width: 240 });
        doc.text(money(s.closingBalance), cols[5].x, y + 2, {
          width: cols[5].w - 2,
          align: "right",
        });
        y += 24;
        const a = s.aging;
        const agingCols: Array<[string, number]> = [
          ["Current / جاري", a.current],
          ["1-30", a.days30],
          ["31-60", a.days60],
          ["61-90", a.days90],
          ["90+", a.over90],
          ["Total / الإجمالي", a.total],
        ];
        doc.rect(left, y - 2, width, 30).fill("#F9FAFB");
        doc.fillColor("#374151").fontSize(8);
        agingCols.forEach(([label, value], i) => {
          const x = left + i * (width / 6);
          doc
            .font("Helvetica-Bold")
            .text(label, x + 2, y, { width: width / 6 - 4, align: "right" });
          doc
            .font("Helvetica")
            .text(money(value), x + 2, y + 13, { width: width / 6 - 4, align: "right" });
        });
        y += 40;
        doc.fillColor("#111827");
      }
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export type CustomerStatementService = typeof buildCustomerStatement;
export type SupplierStatementService = typeof buildSupplierStatement;

/** Register "statements.customer" / "statements.supplier" (idempotent). */
export function registerStatementServices(): void {
  if (!has("statements.customer")) provide("statements.customer", buildCustomerStatement);
  if (!has("statements.supplier")) provide("statements.supplier", buildSupplierStatement);
}

/** For emails: the company record used by email templates. */
export function statementCompanyStub(st: Statement): Pick<Company, "id" | "name"> {
  return { id: st.company.id, name: st.company.name };
}
