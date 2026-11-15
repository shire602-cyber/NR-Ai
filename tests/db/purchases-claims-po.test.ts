/**
 * W3-B procure-to-pay: expense claims and purchase orders. Issue ids in test names.
 */
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();

const claimsUrl = (t: Tenant) => `/api/companies/${t.company.id}/expense-claims`;
const poUrl = (t: Tenant) => `/api/companies/${t.company.id}/purchase-orders`;

function item(over: Record<string, unknown> = {}) {
  return {
    expense_date: "2026-01-10",
    category: "Travel",
    description: "Taxi to client",
    amount: 100,
    vat_amount: 5,
    has_tax_invoice: true,
    ...over,
  };
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

async function addMember(owner: Tenant, member: Tenant, role: string) {
  await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, $3)`, [
    owner.company.id,
    member.user.id,
    role,
  ]);
}

async function submittedClaim(t: Tenant, items = [item()]) {
  const c = await t.as.post(claimsUrl(t), { title: "January travel", items });
  expect(c.status, c.text).toBe(200);
  const s = await t.as.post(`/api/expense-claims/${c.body.id}/submit`, {});
  expect(s.status, s.text).toBe(200);
  return c.body;
}

describe("W3-B expense claims", () => {
  it("[R04-12] strict validation: an item without a date (or category) is 400, never 500", async () => {
    const t = await h.createTenant();
    for (const bad of [
      { amount: 10 },
      item({ expense_date: undefined }),
      item({ category: "" }),
      item({ extra: 1 }),
    ]) {
      const r = await t.as.post(claimsUrl(t), { title: "x", items: [bad] });
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await t.as.post(claimsUrl(t), { title: "x", status: "approved" })).status).toBe(400);
    expect(
      (await t.as.post(claimsUrl(t), { title: "x", items: [item({ supplier_trn: "1234" })] }))
        .status
    ).toBe(400);
  });

  it("[R04-06] negative claim amounts are rejected", async () => {
    const t = await h.createTenant();
    const r = await t.as.post(claimsUrl(t), {
      title: "x",
      items: [item({ amount: -500, vat_amount: 0 })],
    });
    expect(r.status).toBe(400);
  });

  it("[R04-12] parallel claim creation yields unique claim numbers", async () => {
    const t = await h.createTenant();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        t.as.post(claimsUrl(t), { title: `Claim ${i}`, items: [item()] })
      )
    );
    for (const r of results) expect(r.status, r.text).toBe(200);
    const numbers = results.map((r) => r.body.claim_number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("[R04-11] the submitter cannot approve their own claim (multi-member company)", async () => {
    const owner = await h.createTenant();
    const accountant = await h.createSecondTenant();
    await addMember(owner, accountant, "accountant");
    const claim = await submittedClaim(owner);
    const self = await owner.as.post(`/api/expense-claims/${claim.id}/approve`, {});
    expect(self.status).toBe(403);
    expect(self.body.code).toBe("SAME_ACTOR_APPROVAL");
    const other = await accountant.as.post(`/api/expense-claims/${claim.id}/approve`, {});
    expect(other.status, other.text).toBe(200);
    expect(other.body.status).toBe("approved");
  });

  it("[R04-03] mark-paid posts Dr 2045 / Cr the chosen bank, netting 2045 to zero", async () => {
    const t = await h.createTenant();
    const claim = await submittedClaim(t, [
      item(),
      item({ category: "Software", amount: 200, vat_amount: 10 }),
    ]);
    const a = await t.as.post(`/api/expense-claims/${claim.id}/approve`, {});
    expect(a.status, a.text).toBe(200);
    expect(await balanceFils(t, "2045")).toBe(31_500);
    const petty = await accountByCode(t, "1030");
    const paid = await t.as.post(`/api/expense-claims/${claim.id}/mark-paid`, {
      payment_reference: "TRX-1",
      payment_account_id: petty.id,
      payment_date: "2026-01-20",
    });
    expect(paid.status, paid.text).toBe(200);
    expect(paid.body.status).toBe("paid");
    expect(await balanceFils(t, "2045")).toBe(0);
    expect(await balanceFils(t, "1030", "debit")).toBe(-31_500);
    expect((await t.as.post(`/api/expense-claims/${claim.id}/mark-paid`, {})).status).toBe(409);
  });

  it("[R04-20] mileage / per-diem items are rate based, foreign items convert, VAT needs a tax invoice, receipts enforced", async () => {
    const t = await h.createTenant();
    const noRate = await t.as.post(claimsUrl(t), {
      title: "Mileage",
      items: [item({ item_type: "mileage", quantity: 100, amount: undefined, vat_amount: 0 })],
    });
    expect(noRate.status).toBe(422);
    const settings = await t.as.put(`${claimsUrl(t)}/settings`, { mileage_rate: 0.5, per_diem_rate: 150 });
    expect(settings.status, settings.text).toBe(200);
    await t.as.post(`/api/companies/${t.company.id}/exchange-rates`, {
      fromCurrency: "USD",
      rate: 3.6725,
      effectiveDate: "2026-01-09",
    });
    const c = await t.as.post(claimsUrl(t), {
      title: "Trip",
      items: [
        item({
          item_type: "mileage",
          category: "Mileage",
          quantity: 100,
          amount: undefined,
          vat_amount: 0,
        }),
        item({
          item_type: "per_diem",
          category: "Per diem",
          quantity: 2,
          amount: undefined,
          vat_amount: 0,
        }),
        item({ category: "Hotel", amount: 100, vat_amount: 0, currency: "USD" }),
        item({ category: "Meals", amount: 100, vat_amount: 5, has_tax_invoice: false }),
      ],
    });
    expect(c.status, c.text).toBe(200);
    const amounts = c.body.items.map((i: { amount: string }) => i.amount).sort();
    expect(amounts).toEqual(["100.00", "300.00", "367.25", "50.00"].sort());
    expect(c.body.total_amount).toBe("822.25");
    const meals = c.body.items.find((i: { category: string }) => i.category === "Meals");
    expect(meals.vat_recoverable).toBe(false);

    await t.as.post(`${claimsUrl(t)}/policies`, { category: "Hotel", receipt_required: true });
    const sub = await t.as.post(`/api/expense-claims/${c.body.id}/submit`, {});
    expect(sub.status).toBe(422);
    expect(sub.body.code).toBe("RECEIPT_REQUIRED");
    await h.sql(
      `UPDATE expense_claim_items SET receipt_url = 'https://files.example/r.pdf' WHERE claim_id = $1 AND category = 'Hotel'`,
      [c.body.id]
    );
    expect((await t.as.post(`/api/expense-claims/${c.body.id}/submit`, {})).status).toBe(200);
    expect((await t.as.post(`/api/expense-claims/${c.body.id}/approve`, {})).status).toBe(200);
    // Non-recoverable VAT is cost; only nothing reaches input VAT here.
    expect(await balanceFils(t, "1050", "debit")).toBe(0);
    expect(await balanceFils(t, "2045")).toBe(82_225);
  });
});

describe("W3-B purchase orders", () => {
  it("[R04-09] PO validation: {} → 400, 7% VAT → 400, negative quantity → 400, client number → 400", async () => {
    const t = await h.createTenant();
    expect((await t.as.post(poUrl(t), {})).status).toBe(400);
    const base = { vendorName: "Acme", date: "2026-01-15" };
    expect(
      (
        await t.as.post(poUrl(t), {
          ...base,
          lines: [{ description: "x", quantity: 1, unitPrice: 10, vatRate: 7 }],
        })
      ).status
    ).toBe(400);
    expect(
      (
        await t.as.post(poUrl(t), {
          ...base,
          lines: [{ description: "x", quantity: -5, unitPrice: 10, vatRate: 5 }],
        })
      ).status
    ).toBe(400);
    expect(
      (
        await t.as.post(poUrl(t), {
          ...base,
          number: "PO-1",
          lines: [{ description: "x", quantity: 1, unitPrice: 10 }],
        })
      ).status
    ).toBe(400);
    const ok = await t.as.post(poUrl(t), {
      ...base,
      lines: [{ description: "x", quantity: 3, unitPrice: 10, vatRate: 5 }],
    });
    expect(ok.status, ok.text).toBe(201);
    expect(ok.body.number).toMatch(/^PO-\d{4}$/);
    expect(Number(ok.body.total)).toBe(31.5);
  });

  it("[R04-10] PUT never sets status; cancel has its own endpoint", async () => {
    const t = await h.createTenant();
    const po = await t.as.post(poUrl(t), {
      vendorName: "Acme",
      date: "2026-01-15",
      lines: [{ description: "x", quantity: 1, unitPrice: 10, vatRate: 5 }],
    });
    const put = await t.as.put(`/api/purchase-orders/${po.body.id}`, { status: "received" });
    expect(put.status).toBe(400);
    const row = await h.sql(`SELECT status FROM purchase_orders WHERE id = $1`, [po.body.id]);
    expect(row[0].status).toBe("draft");
    const recv = await t.as.post(`/api/purchase-orders/${po.body.id}/receive`, {});
    expect(recv.status).toBe(409);
    const cancel = await t.as.post(`/api/purchase-orders/${po.body.id}/cancel`, {
      reason: "Not needed",
    });
    expect(cancel.status, cancel.text).toBe(200);
    expect(cancel.body.status).toBe("cancelled");
    expect((await t.as.post(`/api/purchase-orders/${po.body.id}/approve`, {})).status).toBe(409);
  });

  it("[R04-17] PO 10 → receive 6 → bill 6 → 4 outstanding; 3-way match; send without email provider is honest", async () => {
    const t = await h.createTenant();
    const po = await t.as.post(poUrl(t), {
      vendorName: "Acme Supplies",
      date: "2026-01-15",
      lines: [{ description: "Chairs", quantity: 10, unitPrice: 100, vatRate: 5 }],
    });
    expect(po.status, po.text).toBe(201);
    const emailed = await t.as.post(`/api/purchase-orders/${po.body.id}/send`, {
      to: "vendor@example.com",
    });
    expect(emailed.status).toBe(502);
    expect(emailed.body.code).toBe("EMAIL_NOT_SENT");
    const sent = await t.as.post(`/api/purchase-orders/${po.body.id}/send`, {});
    expect(sent.status, sent.text).toBe(200);
    expect(sent.body.emailed).toBe(false);
    expect((await t.as.post(`/api/purchase-orders/${po.body.id}/approve`, {})).status).toBe(200);
    const lineId = po.body.lines[0].id;
    const r1 = await t.as.post(`/api/purchase-orders/${po.body.id}/receive`, {
      receivedDate: "2026-01-20",
      lines: [{ lineId, quantity: 6 }],
    });
    expect(r1.status, r1.text).toBe(200);
    expect(r1.body.status).toBe("partially_received");
    const over = await t.as.post(`/api/purchase-orders/${po.body.id}/receive`, {
      lines: [{ lineId, quantity: 5 }],
    });
    expect(over.status).toBe(409);
    const conv = await t.as.post(`/api/purchase-orders/${po.body.id}/convert-to-bill`, {
      billDate: "2026-01-21",
    });
    expect(conv.status, conv.text).toBe(201);
    expect(conv.body.bill.status).toBe("pending");
    expect(conv.body.bill.total_amount).toBe("630.00");
    expect(conv.body.bill.purchase_order_id).toBe(po.body.id);
    const match = await t.as.get(`/api/purchase-orders/${po.body.id}/match`);
    expect(match.body.lines[0]).toMatchObject({
      ordered: 10,
      received: 6,
      billed: 6,
      outstandingToReceive: 4,
      outstandingToBill: 4,
    });
    expect(match.body.bills).toHaveLength(1);
    const nothing = await t.as.post(`/api/purchase-orders/${po.body.id}/convert-to-bill`, {});
    expect(nothing.status).toBe(409);
    const r2 = await t.as.post(`/api/purchase-orders/${po.body.id}/receive`, {});
    expect(r2.body.status).toBe("received");
    expect((await t.as.post(`/api/purchase-orders/${po.body.id}/cancel`, {})).status).toBe(409);
  });
});
