/**
 * WQ2 purchases finished: AI bill capture (8.2), self-TRN guard (4.7), attachments, debit note
 * from a bill (8.5 / 8.16), expense-claim receipt upload (8.7), the "To approve" queue (8.15),
 * an item on a bill line (11.1) and the bill tables in the Drizzle schema (8.8).
 *
 * The model is stubbed (no live AI in CI): extractBillDocument returns a fixed extraction, so the
 * test runs the real route, the real mapper and the real posting path.
 */
import { describe, expect, it, vi } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { accountByCode, useHarness, type Tenant } from "./harness";

const stub = vi.hoisted(() => ({
  next: null as null | Record<string, unknown>,
  issues: [] as string[],
  calls: 0,
}));

vi.mock("../../server/services/ocr-extraction.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../server/services/ocr-extraction.service")>();
  return {
    ...actual,
    extractBillDocument: vi.fn(async () => {
      stub.calls++;
      if (!stub.next) return { status: "not_configured", data: null, issues: [] };
      return { status: "ok", data: stub.next, issues: stub.issues };
    }),
  };
});

const h = useHarness();

const SUPPLIER_TRN = "100222333400003";
/** A tiny but well-formed PDF (the upload guard sniffs %PDF-). */
const PDF = `data:application/pdf;base64,${Buffer.from(
  "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
).toString("base64")}`;
/** Plain text pretending to be a PDF: wrong magic number. */
const FAKE_PDF = `data:application/pdf;base64,${Buffer.from(
  "this is not a pdf, just text that claims to be one"
).toString("base64")}`;

const base = (t: Tenant) => `/api/companies/${t.company.id}`;

/** Journal lines of one source document as [code, debit, credit] (AED), sorted by code. */
async function linesOf(companyId: string, source: string, sourceId: string) {
  const rows = await h.sql<{ code: string; debit: string; credit: string }>(
    `SELECT a.code, SUM(jl.debit)::text AS debit, SUM(jl.credit)::text AS credit
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.source = $2 AND je.source_id = $3::uuid AND je.status = 'posted'
      GROUP BY a.code ORDER BY a.code`,
    [companyId, source, sourceId]
  );
  return rows.map((r) => [r.code, Number(r.debit), Number(r.credit)]);
}

async function balanceFils(t: Tenant, code: string, side: "credit" | "debit" = "credit") {
  const rows = await h.sql<{ c: string; d: string }>(
    `SELECT COALESCE(SUM(ROUND(jl.credit*100)),0)::bigint AS c, COALESCE(SUM(ROUND(jl.debit*100)),0)::bigint AS d
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = $2`,
    [t.company.id, code]
  );
  const c = Number(rows[0].c);
  const d = Number(rows[0].d);
  return side === "credit" ? c - d : d - c;
}

/** The payables aging (settlement rule) ties to GL 2010. */
async function expectApTiesToGl(t: Tenant) {
  const aging = await t.as.get(`${base(t)}/bills/aging?as_of=2026-12-31`);
  expect(aging.status, aging.text).toBe(200);
  expect(aging.body.reconciliation.isReconciled).toBe(true);
  expect(Math.round(aging.body.reconciliation.agingTotal * 100)).toBe(await balanceFils(t, "2010"));
}

function extraction(over: Record<string, unknown> = {}) {
  return {
    merchant: "Gulf Office Supplies LLC",
    date: "2026-03-10",
    invoiceNumber: "GOS-7781",
    subtotal: 1200,
    vatPercentage: 5,
    vatAmount: 60,
    total: 1260,
    currency: "AED",
    category: "Office Supplies",
    lineItems: [
      { description: "A4 paper (box)", quantity: 10, unitPrice: 80, total: 800 },
      { description: "Toner cartridge", quantity: 2, unitPrice: 200, total: 400 },
    ],
    supplierTrn: SUPPLIER_TRN,
    isTaxInvoice: true,
    reverseChargeSuggested: false,
    confidence: 0.93,
    ...over,
  };
}

describe("WQ2 8.8: bill tables in the Drizzle schema", () => {
  it("[8.8] vendor_bills, bill_line_items and bill_payments match the migrated columns exactly", async () => {
    const schema = await import("../../shared/schema");
    for (const table of [schema.vendorBills, schema.billLineItems, schema.billPayments]) {
      const cfg = getTableConfig(table);
      const db = await h.sql<{
        column_name: string;
        is_nullable: string;
        udt_name: string;
        numeric_precision: number | null;
        numeric_scale: number | null;
      }>(
        `SELECT column_name, is_nullable, udt_name, numeric_precision, numeric_scale
           FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
        [cfg.name]
      );
      const dbCols = new Map(db.map((c) => [c.column_name, c]));
      expect([...dbCols.keys()].sort(), cfg.name).toEqual(cfg.columns.map((c) => c.name).sort());
      for (const col of cfg.columns) {
        const d = dbCols.get(col.name)!;
        expect(d.is_nullable === "NO", `${cfg.name}.${col.name} not null`).toBe(col.notNull);
        const sqlType = col.getSQLType();
        const udt = { uuid: "uuid", text: "text", boolean: "bool", integer: "int4" } as const;
        if (sqlType.startsWith("numeric")) {
          expect(d.udt_name, `${cfg.name}.${col.name}`).toBe("numeric");
          const m = /numeric\((\d+), ?(\d+)\)/.exec(sqlType);
          expect(m, `${cfg.name}.${col.name} precision`).not.toBeNull();
          expect([d.numeric_precision, d.numeric_scale], `${cfg.name}.${col.name}`).toEqual([
            Number(m![1]),
            Number(m![2]),
          ]);
        } else if (sqlType.startsWith("timestamp")) {
          expect(d.udt_name, `${cfg.name}.${col.name}`).toBe("timestamp");
        } else {
          expect(d.udt_name, `${cfg.name}.${col.name}`).toBe(udt[sqlType as keyof typeof udt]);
        }
      }
    }
  });
});

describe("WQ2 8.2: AI capture fills the bill form; nothing posts until approval", () => {
  it("[8.2] capture → draft with per-field confidence, supplier matched by TRN; save + approve posts Dr expense / Dr 1050 / Cr 2010 exactly", async () => {
    const t = await h.createTenant();
    const vendor = await t.as.post(`${base(t)}/vendors`, {
      name: "Gulf Office Supplies L.L.C.",
      trn: SUPPLIER_TRN,
      payment_terms_days: 30,
    });
    expect(vendor.status, vendor.text).toBeLessThan(300);

    const entriesBefore = await h.sql(`SELECT 1 FROM journal_entries WHERE company_id = $1`, [
      t.company.id,
    ]);
    stub.next = extraction();
    stub.issues = [];
    const cap = await t.as.post(`${base(t)}/bills/capture`, { file: PDF, filename: "gos.pdf" });
    expect(cap.status, cap.text).toBe(200);
    expect(cap.body.supplierMatch).toBe("trn");
    expect(cap.body.draft).toMatchObject({
      vendor_id: vendor.body.id,
      vendor_trn: SUPPLIER_TRN,
      bill_number: "GOS-7781",
      bill_date: "2026-03-10",
      due_date: "2026-04-09",
      currency: "AED",
      reverse_charge: false,
    });
    expect(cap.body.draft.line_items).toEqual([
      {
        description: "A4 paper (box)",
        quantity: 10,
        unit_price: "80.00",
        vat_supply_type: "standard_rated",
      },
      {
        description: "Toner cartridge",
        quantity: 2,
        unit_price: "200.00",
        vat_supply_type: "standard_rated",
      },
    ]);
    expect(cap.body.confidence).toMatchObject({ supplier: "high", total: "high", lines: "high" });
    expect(cap.body.totals).toEqual({ subtotal: "1200.00", vat: "60.00", total: "1260.00" });
    // Capture wrote nothing: no bill, no journal, no stored file.
    expect(
      await h.sql(`SELECT 1 FROM vendor_bills WHERE company_id = $1`, [t.company.id])
    ).toHaveLength(0);
    expect(
      await h.sql(`SELECT 1 FROM journal_entries WHERE company_id = $1`, [t.company.id])
    ).toHaveLength(entriesBefore.length);

    // The user picks the expense account and saves the draft as filled.
    const office = await accountByCode(t, "5010");
    const d = cap.body.draft;
    const created = await t.as.post(`${base(t)}/bills`, {
      vendor_id: d.vendor_id,
      vendor_name: d.vendor_name,
      vendor_trn: d.vendor_trn,
      bill_number: d.bill_number,
      bill_date: d.bill_date,
      due_date: d.due_date,
      currency: d.currency,
      reverse_charge: d.reverse_charge,
      line_items: d.line_items.map((l: Record<string, unknown>) => ({
        ...l,
        vat_rate: 5,
        account_id: office.id,
      })),
    });
    expect(created.status, created.text).toBe(200);
    expect(created.body.total_amount).toBe("1260.00");
    expect(await linesOf(t.company.id, "bill", created.body.id)).toEqual([]);

    // The captured file is kept as the bill attachment.
    const up = await t.as.post(`/api/bills/${created.body.id}/attachment`, {
      file: PDF,
      filename: "gos.pdf",
    });
    expect(up.status, up.text).toBe(200);
    const read = await t.as.get(`/api/bills/${created.body.id}/attachment`);
    expect(read.status).toBe(200);
    expect(read.headers.get("content-type")).toContain("application/pdf");
    expect(read.text.startsWith("%PDF-")).toBe(true);
    const detail = await t.as.get(`/api/bills/${created.body.id}`);
    expect(detail.body.has_attachment).toBe(true);
    expect(detail.body.attachment_name).toBe("gos.pdf");

    // Another tenant cannot read it (404, not 403) or overwrite it.
    const other = await h.createTenant();
    expect((await other.as.get(`/api/bills/${created.body.id}/attachment`)).status).toBe(404);
    expect(
      (await other.as.post(`/api/bills/${created.body.id}/attachment`, { file: PDF })).status
    ).toBe(404);

    const ok = await t.as.post(`/api/bills/${created.body.id}/approve`, {});
    expect(ok.status, ok.text).toBe(200);
    expect(await linesOf(t.company.id, "bill", created.body.id)).toEqual([
      ["1050", 60, 0],
      ["2010", 0, 1260],
      ["5010", 1200, 0],
    ]);
    await expectApTiesToGl(t);
  });

  it("[8.2] an unknown supplier comes back as 'Create supplier'; a wrong magic number is 400; no AI provider is 503 with a clear code", async () => {
    const t = await h.createTenant();
    stub.next = extraction({ supplierTrn: null, merchant: "Brand New Trading" });
    const cap = await t.as.post(`${base(t)}/bills/capture`, { file: PDF });
    expect(cap.status, cap.text).toBe(200);
    expect(cap.body.supplierMatch).toBe("none");
    expect(cap.body.draft.vendor_id).toBeNull();
    expect(cap.body.draft.vendor_name).toBe("Brand New Trading");
    expect(cap.body.confidence.supplier).not.toBe("high");

    const calls = stub.calls;
    const bad = await t.as.post(`${base(t)}/bills/capture`, { file: FAKE_PDF });
    expect(bad.status, bad.text).toBe(400);
    expect(bad.body.code).toBe("UNSUPPORTED_FILE");
    expect(stub.calls).toBe(calls); // never reached the model

    stub.next = null;
    const off = await t.as.post(`${base(t)}/bills/capture`, { file: PDF });
    expect(off.status).toBe(503);
    expect(off.body.code).toBe("AI_NOT_CONFIGURED");

    // A viewer may not spend AI credits on capture.
    const viewer = await h.createTenant({ role: "viewer" });
    expect((await viewer.as.post(`${base(viewer)}/bills/capture`, { file: PDF })).status).toBe(403);
  });

  it("[8.2] amounts that do not add up lower the amount confidence and are flagged", async () => {
    const t = await h.createTenant();
    stub.next = extraction({ total: 1300, vatAmount: 60, confidence: 0.95 });
    stub.issues = ["AMOUNT_MISMATCH"];
    const cap = await t.as.post(`${base(t)}/bills/capture`, { file: PDF });
    expect(cap.status, cap.text).toBe(200);
    expect(cap.body.confidence.total).toBe("low");
    expect(cap.body.checks).toEqual(expect.arrayContaining(["AMOUNT_MISMATCH"]));
    stub.issues = [];
  });
});

describe("WQ2 4.7: self-TRN guard", () => {
  it("[4.7] a document whose seller TRN is the company's own TRN is refused (capture 422 SELF_TRN_DOCUMENT, bill 422 SELF_TRN_BILL)", async () => {
    const t = await h.createTenant();
    const own = (
      await h.sql<{ trn: string }>(`SELECT trn_vat_number AS trn FROM companies WHERE id = $1`, [
        t.company.id,
      ])
    )[0].trn;
    expect(own).toMatch(/^100\d{12}$/);
    stub.next = extraction({ supplierTrn: own });
    const cap = await t.as.post(`${base(t)}/bills/capture`, { file: PDF });
    expect(cap.status, cap.text).toBe(422);
    expect(cap.body.code).toBe("SELF_TRN_DOCUMENT");

    const bill = await t.as.post(`${base(t)}/bills`, {
      vendor_name: "Ourselves",
      vendor_trn: own,
      bill_date: "2026-03-10",
      line_items: [{ description: "Our own invoice", quantity: 1, unit_price: 100, vat_rate: 5 }],
    });
    expect(bill.status, bill.text).toBe(422);
    expect(bill.body.code).toBe("SELF_TRN_BILL");
    expect(bill.body.message).toMatch(/your own company's TRN/);
    expect(
      await h.sql(`SELECT 1 FROM vendor_bills WHERE company_id = $1`, [t.company.id])
    ).toHaveLength(0);
  });
});

describe("WQ2 8.5 / 8.16: supplier credit (debit note) from a bill", () => {
  it("[8.16] a partial debit note from a bill posts Dr 2010 / Cr expense / Cr 1050, lowers Box 9 and applies to the bill", async () => {
    const t = await h.createTenant();
    const office = await accountByCode(t, "5010");
    const b = await t.as.post(`${base(t)}/bills`, {
      vendor_name: "Gulf Office Supplies LLC",
      vendor_trn: SUPPLIER_TRN,
      bill_date: "2026-03-10",
      line_items: [
        { description: "Chairs", quantity: 4, unit_price: 500, vat_rate: 5, account_id: office.id },
      ],
    });
    expect(b.status, b.text).toBe(200);
    expect((await t.as.post(`/api/bills/${b.body.id}/approve`, {})).status).toBe(200);
    const vatBefore = await t.as.get(`${base(t)}/reports/vat-return?from=2026-01-01&to=2026-03-31`);
    expect(vatBefore.body.boxes.box9ExpensesAmount).toBe(2000);
    expect(vatBefore.body.boxes.box9ExpensesVat).toBe(100);

    const dn = await t.as.post(`${base(t)}/debit-notes`, {
      bill_id: b.body.id,
      note_date: "2026-03-20",
      reason: "One chair returned damaged",
      lines: [{ description: "Chairs", amount: 500, vat_rate: 5, account_id: office.id }],
    });
    expect(dn.status, dn.text).toBe(201);
    expect(dn.body.total_amount).toBe("525.00");
    expect(await linesOf(t.company.id, "vendor_debit_note", dn.body.id)).toEqual([
      ["1050", 0, 25],
      ["2010", 525, 0],
      ["5010", 0, 500],
    ]);
    const vatAfter = await t.as.get(`${base(t)}/reports/vat-return?from=2026-01-01&to=2026-03-31`);
    expect(vatAfter.body.boxes.box9ExpensesAmount).toBe(1500);
    expect(vatAfter.body.boxes.box9ExpensesVat).toBe(75);

    const listed = await t.as.get(`${base(t)}/debit-notes`);
    expect(listed.body.map((n: { id: string }) => n.id)).toContain(dn.body.id);
    const ap = await t.as.post(`${base(t)}/debit-notes/${dn.body.id}/apply`, {
      bill_id: b.body.id,
      amount: 525,
      date: "2026-03-21",
    });
    expect(ap.status, ap.text).toBe(200);
    expect(ap.body.bill_status).toBe("partial");
    expect(await balanceFils(t, "2010")).toBe(210_000 - 52_500);
    await expectApTiesToGl(t);
  });
});

describe("WQ2 11.1: an item on a bill line moves stock through the inventory module", () => {
  it("[11.1] a stock item line posts Dr 1070 (not expense) and adds the quantity on hand", async () => {
    const t = await h.createTenant();
    const p = await t.as.post(`${base(t)}/products`, {
      name: "Printer paper box",
      unitPrice: 120,
      costPrice: 80,
      productType: "inventory",
    });
    expect(p.status, p.text).toBeLessThan(300);
    const b = await t.as.post(`${base(t)}/bills`, {
      vendor_name: "Gulf Office Supplies LLC",
      vendor_trn: SUPPLIER_TRN,
      bill_date: "2026-03-10",
      line_items: [
        { description: "Printer paper box", quantity: 10, unit_price: 80, product_id: p.body.id },
      ],
    });
    expect(b.status, b.text).toBe(200);
    expect((await t.as.post(`/api/bills/${b.body.id}/approve`, {})).status).toBe(200);
    expect(await linesOf(t.company.id, "bill", b.body.id)).toEqual([
      ["1050", 40, 0],
      ["1070", 800, 0],
      ["2010", 0, 840],
    ]);
    const stock = await h.sql<{ current_stock: number }>(
      `SELECT current_stock FROM products WHERE id = $1`,
      [p.body.id]
    );
    expect(stock[0].current_stock).toBe(10);
  });
});

describe("WQ2 8.15: the To approve queue follows the approval rules", () => {
  it("[8.15] an owner-only band: the accountant sees the bill but may not sign; the owner may; the maker is blocked", async () => {
    const owner = await h.createTenant();
    const accountant = await h.createTenant();
    await h.sql(
      `INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'accountant')`,
      [owner.company.id, accountant.user.id]
    );
    const rule = await owner.as.post(`${base(owner)}/approval-rules`, {
      name: "Large bills",
      document_type: "bill",
      min_amount: 1000,
      required_role: "owner",
    });
    expect(rule.status, rule.text).toBeLessThan(300);
    const mk = (who: Tenant, unit: number) =>
      who.as.post(`${base(owner)}/bills`, {
        vendor_name: "Acme Hosting LLC",
        vendor_trn: SUPPLIER_TRN,
        bill_date: "2026-03-10",
        line_items: [{ description: "Hosting", quantity: 1, unit_price: unit, vat_rate: 5 }],
      });
    const big = await mk(accountant, 2000);
    const small = await mk(owner, 100);
    expect(big.status, big.text).toBe(200);
    expect(small.status, small.text).toBe(200);

    const qa = await accountant.as.get(`${base(owner)}/bills/approval-queue`);
    expect(qa.status, qa.text).toBe(200);
    const byId = (rows: Array<{ bill_id: string }>, id: string) =>
      rows.find((r) => r.bill_id === id) as Record<string, unknown>;
    // The accountant made the big bill (maker) and the owner-only rule also applies.
    expect(byId(qa.body, big.body.id)).toMatchObject({ awaiting_me: false, blocked: "maker" });
    expect(byId(qa.body, small.body.id)).toMatchObject({ awaiting_me: true, steps_total: 0 });

    const qo = await owner.as.get(`${base(owner)}/bills/approval-queue`);
    expect(byId(qo.body, big.body.id)).toMatchObject({
      awaiting_me: true,
      step: 1,
      steps_total: 1,
      required: [{ role: "owner", permission: "documents.approve" }],
    });
    expect(byId(qo.body, small.body.id)).toMatchObject({ awaiting_me: false, blocked: "maker" });

    // The queue never writes: approving still goes through the approve route and its rules.
    expect((await accountant.as.post(`/api/bills/${small.body.id}/approve`, {})).status).toBe(200);
    const after = await owner.as.get(`${base(owner)}/bills/approval-queue`);
    expect(after.body.map((r: { bill_id: string }) => r.bill_id)).toEqual([big.body.id]);
  });
});

describe("WQ2 8.7: expense-claim receipt upload", () => {
  it("[8.7] upload → ref → item keeps the file; same tenant reads it, another tenant 404; wrong magic number 400; forged or foreign ref 422", async () => {
    const t = await h.createTenant();
    const bad = await t.as.post(`${base(t)}/expense-claims/receipts`, {
      file: FAKE_PDF,
      filename: "receipt.pdf",
    });
    expect(bad.status, bad.text).toBe(400);
    expect(bad.body.code).toBe("UNSUPPORTED_FILE");

    const up = await t.as.post(`${base(t)}/expense-claims/receipts`, {
      file: PDF,
      filename: "taxi.pdf",
    });
    expect(up.status, up.text).toBe(201);
    expect(up.body.receipt_name).toBe("taxi.pdf");
    expect(String(up.body.receipt_ref)).not.toContain("receipts/");

    const item = {
      expense_date: "2026-03-05",
      category: "Travel",
      description: "Taxi to client",
      amount: 50,
      receipt_ref: up.body.receipt_ref,
      receipt_name: "taxi.pdf",
    };
    const claim = await t.as.post(`${base(t)}/expense-claims`, { title: "March", items: [item] });
    expect(claim.status, claim.text).toBe(200);
    const saved = claim.body.items[0];
    expect(saved.has_receipt).toBe(true);
    expect(saved.receipt_name).toBe("taxi.pdf");
    expect(saved).not.toHaveProperty("receipt_path");

    const file = await t.as.get(`/api/expense-claims/${claim.body.id}/items/${saved.id}/receipt`);
    expect(file.status).toBe(200);
    expect(file.text.startsWith("%PDF-")).toBe(true);

    // An edit sends the ref back and keeps the file.
    const edit = await t.as.patch(`/api/expense-claims/${claim.body.id}`, {
      items: [{ ...item, description: "Taxi to client (return)", receipt_ref: saved.receipt_ref }],
    });
    expect(edit.status, edit.text).toBe(200);
    expect(edit.body.items[0].has_receipt).toBe(true);

    const other = await h.createTenant();
    const newId = edit.body.items[0].id;
    expect(
      (await other.as.get(`/api/expense-claims/${claim.body.id}/items/${newId}/receipt`)).status
    ).toBe(404);
    // Another company cannot reuse this company's ref, and a forged ref is refused.
    const reuse = await other.as.post(`${base(other)}/expense-claims`, {
      title: "Stolen",
      items: [{ ...item, receipt_ref: saved.receipt_ref }],
    });
    expect(reuse.status, reuse.text).toBe(422);
    expect(reuse.body.code).toBe("RECEIPT_REF_INVALID");
    const forged = await t.as.post(`${base(t)}/expense-claims`, {
      title: "Forged",
      items: [
        {
          ...item,
          receipt_ref: `${Buffer.from("receipts/someone-else.pdf").toString("base64url")}.AAAA`,
        },
      ],
    });
    expect(forged.status).toBe(422);
  });
});
