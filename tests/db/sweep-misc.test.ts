/**
 * W2-D misc sweep: R16-01, R13-03, R10-03, R10-07, R08-10, R16-13, R17-09, W1A-01, W1A-02.
 */
import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";
import { insertRow, snapshotRow } from "./row-factory";

const h = useHarness();

describe("W2-D reminder settings", () => {
  it("[R16-01] tenant B PATCH/DELETE of A's reminder setting is 404 and the row is unchanged", async () => {
    const a = await h.createTenant();
    const b = await h.createSecondTenant();
    const created = await a.as.post(`/api/companies/${a.company.id}/reminder-settings`, {
      reminderType: "invoice_overdue",
      maxReminders: 3,
    });
    expect(created.status).toBe(200);
    const id = created.body.id as string;
    const before = await snapshotRow(h.sql, "reminder_settings", id);

    const patch = await b.as.patch(`/api/reminder-settings/${id}`, { isEnabled: false });
    expect(patch.status).toBe(404);
    const inject = await b.as.patch(`/api/reminder-settings/${id}`, { companyId: b.company.id });
    expect([400, 404]).toContain(inject.status);
    const del = await b.as.delete(`/api/reminder-settings/${id}`);
    expect(del.status).toBe(404);
    expect(await snapshotRow(h.sql, "reminder_settings", id)).toBe(before);

    // the owner can edit; companyId is immutable and bounds are enforced
    expect((await a.as.patch(`/api/reminder-settings/${id}`, { isEnabled: false })).status).toBe(
      200
    );
    expect(
      (await a.as.patch(`/api/reminder-settings/${id}`, { companyId: b.company.id })).status
    ).toBe(400);
    expect((await a.as.patch(`/api/reminder-settings/${id}`, { maxReminders: 500 })).status).toBe(
      400
    );
    expect(
      (await a.as.patch(`/api/reminder-settings/${id}`, { reminderType: "spam" })).status
    ).toBe(400);
    const row = await h.sql("SELECT company_id, is_enabled FROM reminder_settings WHERE id = $1", [
      id,
    ]);
    expect(row[0].company_id).toBe(a.company.id);
    expect(row[0].is_enabled).toBe(false);
  });
});

describe("W2-D analytics", () => {
  it("[R13-03] platform analytics are admin-only; the scoped dashboard returns only the caller's events", async () => {
    const a = await h.createTenant();
    const b = await h.createSecondTenant();
    const admin = await h.createTenant({ isAdmin: true, userType: "admin" });
    expect((await a.as.get("/api/analytics/dashboard")).status).toBe(403);
    expect((await a.as.get("/api/analytics/feature-usage")).status).toBe(403);
    expect((await admin.as.get("/api/analytics/dashboard")).status).toBe(200);
    expect((await admin.as.get("/api/analytics/feature-usage")).status).toBe(200);

    const ev = await a.as.post("/api/analytics/event", {
      eventType: "feature_use",
      eventName: "a_private_marker",
      companyId: a.company.id,
    });
    expect(ev.status).toBe(200);
    // ingestion validates and scopes: cannot attribute an event to someone else's company
    expect(
      (
        await b.as.post("/api/analytics/event", {
          eventType: "feature_use",
          eventName: "x",
          companyId: a.company.id,
        })
      ).status
    ).toBe(403);
    expect(
      (await a.as.post("/api/analytics/event", { eventType: "bogus", eventName: "x" })).status
    ).toBe(400);

    const mine = await a.as.get("/api/analytics/my-dashboard");
    expect(mine.status).toBe(200);
    expect(mine.body.eventsByName.a_private_marker).toBe(1);
    const theirs = await b.as.get("/api/analytics/my-dashboard");
    expect(theirs.status).toBe(200);
    expect(JSON.stringify(theirs.body)).not.toContain("a_private_marker");
  });
});

describe("W2-D products and inventory", () => {
  it("[R10-03] a rejected over-sale writes no movement row (purchase 20, sale 15, sale 15 -> 422)", async () => {
    const a = await h.createTenant();
    const p = await a.as.post(`/api/companies/${a.company.id}/products`, {
      name: "Widget",
      sku: "W-1",
      unitPrice: 10,
    });
    expect(p.status).toBe(200);
    const id = p.body.id as string;
    const mv = (type: string, quantity: number) =>
      a.as.post(`/api/products/${id}/movements`, { type, quantity });
    expect((await mv("purchase", 20)).status).toBe(200);
    expect((await mv("sale", 15)).status).toBe(200);
    const rejected = await mv("sale", 15);
    expect(rejected.status).toBe(422);
    expect(rejected.body.code).toBe("INSUFFICIENT_STOCK");
    const rows = await h.sql<{ type: string }>(
      "SELECT type FROM inventory_movements WHERE product_id = $1 ORDER BY created_at",
      [id]
    );
    expect(rows.map((r) => r.type)).toEqual(["purchase", "sale"]);
    const stock = await h.sql("SELECT current_stock FROM products WHERE id = $1", [id]);
    expect(stock[0].current_stock).toBe(5);

    // concurrent sales cannot both pass the stock check
    const race = await Promise.all([mv("sale", 4), mv("sale", 4), mv("sale", 4)]);
    expect(race.filter((r) => r.status === 200).length).toBe(1);
    const after = await h.sql("SELECT current_stock FROM products WHERE id = $1", [id]);
    expect(after[0].current_stock).toBe(1);
  });

  it("[R10-07] negative prices, duplicate SKU and direct stock edits are rejected", async () => {
    const a = await h.createTenant();
    const b = await h.createSecondTenant();
    const url = `/api/companies/${a.company.id}/products`;
    expect((await a.as.post(url, { name: "Neg", unitPrice: -5 })).status).toBe(400);
    expect((await a.as.post(url, { name: "NegCost", unitPrice: 5, costPrice: -1 })).status).toBe(
      400
    );
    expect(
      (await a.as.post(url, { name: "NegStock", unitPrice: 5, currentStock: -3 })).status
    ).toBe(400);
    expect(
      (await a.as.post(url, { name: "Extra", unitPrice: 5, companyId: b.company.id })).status
    ).toBe(400);
    const first = await a.as.post(url, { name: "One", sku: "SKU-1", unitPrice: 5 });
    expect(first.status).toBe(200);
    const dup = await a.as.post(url, { name: "Two", sku: "sku-1", unitPrice: 5 });
    expect(dup.status).toBe(409);
    // same SKU in another company is fine
    expect(
      (
        await b.as.post(`/api/companies/${b.company.id}/products`, {
          name: "B",
          sku: "SKU-1",
          unitPrice: 1,
        })
      ).status
    ).toBe(200);
    // stock is only changed by movements
    expect((await a.as.patch(`/api/products/${first.body.id}`, { currentStock: 999 })).status).toBe(
      400
    );
    expect((await a.as.patch(`/api/products/${first.body.id}`, { unitPrice: 7 })).status).toBe(200);
  });
});

describe("W2-D portal", () => {
  it("[R08-10] tax return archive is validated (never 500) and has update + delete", async () => {
    const a = await h.createTenant();
    const b = await h.createSecondTenant();
    const url = `/api/companies/${a.company.id}/tax-returns-archive`;
    const bad = await a.as.post(url, { periodLabel: "bad" });
    expect(bad.status).toBe(400);
    for (const body of [
      { periodLabel: "Q1", periodStart: "x", periodEnd: "2026-03-31", filingDate: "2026-04-10" },
      {
        periodLabel: "Q1",
        periodStart: "2026-03-31",
        periodEnd: "2026-01-01",
        filingDate: "2026-04-10",
      },
      {
        periodLabel: "Q1",
        periodStart: "2026-01-01",
        periodEnd: "2026-03-31",
        filingDate: "2026-04-10",
        returnType: "nope",
      },
      {
        periodLabel: "Q1",
        periodStart: "2026-01-01",
        periodEnd: "2026-03-31",
        filingDate: "2026-04-10",
        paymentStatus: "maybe",
      },
      {
        periodLabel: "Q1",
        periodStart: "2026-01-01",
        periodEnd: "2026-03-31",
        filingDate: "2026-04-10",
        taxAmount: -5,
      },
      {
        periodLabel: "Q1",
        periodStart: "2026-01-01",
        periodEnd: "2026-03-31",
        filingDate: "2026-04-10",
        fileUrl: "javascript:alert(1)",
      },
    ]) {
      expect((await a.as.post(url, body)).status, JSON.stringify(body)).toBe(400);
    }
    const ok = await a.as.post(url, {
      returnType: "vat",
      periodLabel: "Q1 2026",
      periodStart: "2026-01-01",
      periodEnd: "2026-03-31",
      filingDate: "2026-04-10",
      taxAmount: 1250.5,
      paymentStatus: "paid",
      fileUrl: "/uploads/q1 return.pdf",
    });
    expect(ok.status).toBe(201);
    const id = ok.body.id as string;
    expect(
      (await b.as.put(`/api/tax-returns-archive/${id}`, { periodLabel: "hijack" })).status
    ).toBe(404);
    expect((await b.as.delete(`/api/tax-returns-archive/${id}`)).status).toBe(404);
    const upd = await a.as.put(`/api/tax-returns-archive/${id}`, { paymentStatus: "partial" });
    expect(upd.status).toBe(200);
    expect(upd.body.paymentStatus).toBe("partial");
    expect(
      (await a.as.put(`/api/tax-returns-archive/${id}`, { companyId: b.company.id })).status
    ).toBe(400);
    expect((await a.as.delete(`/api/tax-returns-archive/${id}`)).status).toBe(200);
  });

  it("[R16-13] compliance task PATCH and message POST are validated; recipient must belong to the company", async () => {
    const a = await h.createTenant();
    const b = await h.createSecondTenant();
    const task = await a.as.post(`/api/companies/${a.company.id}/compliance-tasks`, {
      title: "File VAT",
      dueDate: "2026-04-28",
    });
    expect(task.status).toBe(201);
    const tid = task.body.id as string;
    expect((await a.as.patch(`/api/compliance-tasks/${tid}`, { status: "banana" })).status).toBe(
      400
    );
    expect(
      (await a.as.patch(`/api/compliance-tasks/${tid}`, { dueDate: "not-a-date" })).status
    ).toBe(400);
    expect(
      (await a.as.patch(`/api/compliance-tasks/${tid}`, { companyId: b.company.id })).status
    ).toBe(400);
    expect((await a.as.patch(`/api/compliance-tasks/${tid}`, { status: "completed" })).status).toBe(
      200
    );
    // Another tenant's row id is answered like a missing row (central RBAC policy, server/tenancy).
    expect((await b.as.patch(`/api/compliance-tasks/${tid}`, { status: "cancelled" })).status).toBe(
      404
    );

    const msgUrl = `/api/companies/${a.company.id}/messages`;
    expect((await a.as.post(msgUrl, { content: "" })).status).toBe(400);
    const stranger = await a.as.post(msgUrl, { content: "hi", recipientId: b.user.id });
    expect(stranger.status).toBe(400);
    expect(stranger.body.code).toBe("RECIPIENT_NOT_IN_COMPANY");
    expect(
      (await a.as.post(msgUrl, { content: "hello team", recipientId: a.user.id })).status
    ).toBe(201);
  });

  it("[R16-13] document create accepts https or internal keys only", async () => {
    const a = await h.createTenant();
    const url = `/api/companies/${a.company.id}/documents`;
    for (const fileUrl of [
      "javascript:alert(1)",
      "data:text/html;base64,PGgxPg==",
      "//evil.example/x",
      "file:///etc/passwd",
      "../../etc/passwd",
      "http://insecure.example/x.pdf",
    ]) {
      expect(
        (await a.as.post(url, { name: "d", fileUrl, fileName: "d.pdf" })).status,
        fileUrl
      ).toBe(400);
    }
    expect(
      (
        await a.as.post(url, {
          name: "d",
          fileUrl: "https://files.example.com/d.pdf",
          fileName: "d.pdf",
        })
      ).status
    ).toBe(201);
    expect(
      (await a.as.post(url, { name: "d", fileUrl: "/uploads/d.pdf", fileName: "d.pdf" })).status
    ).toBe(201);
    expect((await a.as.post(url, { name: "d", fileName: "d.pdf", companyId: "x" })).status).toBe(
      400
    );
  });
});

describe("W2-D sanitisation", () => {
  it("[R17-09] free text on contacts, products, receipts, accounts and companies is stripped of markup", async () => {
    const a = await h.createTenant();
    const payload = "<img src=x onerror=alert(1)>Bob<script>x()</script>";
    const contact = await a.as.post(`/api/companies/${a.company.id}/customer-contacts`, {
      name: payload,
      address: payload,
    });
    expect(contact.status).toBe(200);
    expect(contact.body.name).toBe("Bobx()");
    expect(contact.body.address).toBe("Bobx()");
    const product = await a.as.post(`/api/companies/${a.company.id}/products`, {
      name: payload,
      unitPrice: 1,
      description: payload,
    });
    expect(product.body.name).toBe("Bobx()");
    expect(product.body.description).toBe("Bobx()");
    const receipt = await a.as.post(`/api/companies/${a.company.id}/receipts`, {
      merchant: payload,
      date: "2026-01-15",
      amount: 10,
      category: payload,
    });
    expect(receipt.body.merchant).toBe("Bobx()");
    expect(receipt.body.category).toBe("Bobx()");
    const account = await a.as.post(`/api/companies/${a.company.id}/accounts`, {
      code: "7001",
      nameEn: payload,
      type: "expense",
    });
    expect(account.body.nameEn).toBe("Bobx()");
    const company = await a.as.patch(`/api/companies/${a.company.id}`, { legalName: payload });
    expect(company.body.legalName).toBe("Bobx()");
  });
});

describe("W2-D wave-1 findings", () => {
  it("[W1A-01] purchase-order PUT cannot move the PO or change status/number/totals", async () => {
    const a = await h.createTenant();
    const b = await h.createSecondTenant();
    // W3-B (R04-09/R04-10): number is server-assigned and server-owned fields are a 400.
    const created = await a.as.post(`/api/companies/${a.company.id}/purchase-orders`, {
      vendorName: "Vendor",
      date: "2026-01-10T00:00:00.000Z",
      lines: [{ description: "Item", quantity: 2, unitPrice: 50, vatRate: 0.05 }],
    });
    expect(created.status).toBe(201);
    const poId = created.body.id as string;
    const before = await h.sql(
      "SELECT company_id, status, number, total::text AS total FROM purchase_orders WHERE id = $1",
      [poId]
    );
    const r = await a.as.put(`/api/purchase-orders/${poId}`, {
      companyId: b.company.id,
      status: "received",
      number: "HACKED",
      total: 1,
      vendorName: "Renamed Vendor",
    });
    expect(r.status).toBe(400);
    const ok = await a.as.put(`/api/purchase-orders/${poId}`, { vendorName: "Renamed Vendor" });
    expect(ok.status).toBe(200);
    const after = await h.sql(
      "SELECT company_id, status, number, total::text AS total, vendor_name FROM purchase_orders WHERE id = $1",
      [poId]
    );
    expect(after[0].company_id).toBe(a.company.id);
    expect(after[0].status).toBe(before[0].status);
    expect(after[0].number).toBe(before[0].number);
    expect(after[0].total).toBe(before[0].total);
    expect(after[0].vendor_name).toBe("Renamed Vendor");
  });

  it("[W1A-02] AI-GL queue reject/accept by another tenant is refused and the row is unchanged", async () => {
    const a = await h.createTenant();
    const b = await h.createSecondTenant();
    const id = await insertRow(
      h.sql,
      "ai_gl_queue",
      { companyId: a.company.id, userId: a.user.id },
      { status: "pending_review" }
    );
    const before = await snapshotRow(h.sql, "ai_gl_queue", id);
    const reject = await b.as.post(`/api/companies/${b.company.id}/ai-gl/queue/${id}/reject`, {});
    expect(reject.status).toBe(400);
    const accept = await b.as.post(`/api/companies/${b.company.id}/ai-gl/queue/${id}/accept`, {});
    expect(accept.status).toBe(400);
    expect(await snapshotRow(h.sql, "ai_gl_queue", id)).toBe(before);
    const own = await a.as.post(`/api/companies/${a.company.id}/ai-gl/queue/${id}/reject`, {});
    expect(own.status).toBe(200);
    const row = await h.sql("SELECT status FROM ai_gl_queue WHERE id = $1", [id]);
    expect(row[0].status).toBe("rejected");
  });
});
