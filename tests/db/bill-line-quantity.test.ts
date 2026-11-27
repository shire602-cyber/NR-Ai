import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();
const line = {
  description: "Fractional purchase",
  quantity: "1.234",
  unit_price: "1000",
  vat_rate: 5,
};
const bill = {
  vendor_name: "Fractional supplier",
  vendor_trn: "100000000000003",
  bill_date: "2026-01-15",
  line_items: [line],
};

describe("Four-decimal bill quantities", () => {
  it("applies migration 0160 twice and preserves values and the quantity default", async () => {
    const migration = readFileSync(
      new URL("../../migrations/0160_widen_bill_line_quantity.sql", import.meta.url),
      "utf8"
    );
    // Temporary tables shadow the migrated tables for this statement only.
    await h.sql(`DO $test$
      BEGIN
        CREATE TEMP TABLE bill_line_items (quantity numeric(10,2) DEFAULT 1) ON COMMIT DROP;
        CREATE TEMP TABLE purchase_order_lines (
          quantity real NOT NULL,
          quantity_received real NOT NULL DEFAULT 0,
          quantity_billed real NOT NULL DEFAULT 0
        ) ON COMMIT DROP;
        CREATE TEMP TABLE purchase_order_receipt_lines (quantity real NOT NULL) ON COMMIT DROP;
        INSERT INTO bill_line_items VALUES (12.34), (0.01), (0), (NULL), (DEFAULT);
        INSERT INTO purchase_order_lines VALUES (2.5, 0.1, 0.1), (2048.001, DEFAULT, DEFAULT);
        INSERT INTO purchase_order_receipt_lines VALUES (0.1), (2.5);
        EXECUTE $migration$${migration}$migration$;
        IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
            WHERE attrelid = 'pg_temp.bill_line_items'::regclass AND attname = 'quantity')
            IS DISTINCT FROM 'numeric(16,4)' THEN
          RAISE EXCEPTION 'Migration did not widen the quantity column';
        END IF;
        INSERT INTO bill_line_items VALUES (1.234), (0.004), (DEFAULT);
        INSERT INTO purchase_order_lines VALUES (2048.0001, 2048.0001, 0.0001);
        INSERT INTO purchase_order_receipt_lines VALUES (2048.0001);
        EXECUTE $migration$${migration}$migration$;
        IF (SELECT array_agg(quantity ORDER BY quantity NULLS LAST) FROM bill_line_items)
            IS DISTINCT FROM ARRAY[0, 0.004, 0.01, 1, 1, 1.234, 12.34, NULL]::numeric[] THEN
          RAISE EXCEPTION 'Migration changed stored quantities or the default';
        END IF;
        IF EXISTS (
          SELECT 1 FROM pg_attribute
          WHERE (
            (attrelid = 'pg_temp.purchase_order_lines'::regclass
              AND attname IN ('quantity', 'quantity_received', 'quantity_billed'))
            OR (attrelid = 'pg_temp.purchase_order_receipt_lines'::regclass AND attname = 'quantity')
          ) AND format_type(atttypid, atttypmod) <> 'numeric(16,4)'
        ) THEN
          RAISE EXCEPTION 'Migration did not widen all purchase order and receipt quantities';
        END IF;
        IF (SELECT array_agg(ARRAY[quantity, quantity_received, quantity_billed] ORDER BY quantity)
            FROM purchase_order_lines)
            IS DISTINCT FROM ARRAY[[2.5, 0.1, 0.1], [2048.0001, 2048.0001, 0.0001], [2048.001, 0, 0]]::numeric[]
          OR (SELECT array_agg(quantity ORDER BY quantity) FROM purchase_order_receipt_lines)
            IS DISTINCT FROM ARRAY[0.1, 2.5, 2048.0001]::numeric[] THEN
          RAISE EXCEPTION 'Migration changed purchase order or receipt quantities';
        END IF;
      END $test$`);
  });

  it.each(["ordered", "received", "explicit"])(
    "converts %s PO quantities to bills at the exact net",
    async (mode) => {
      const t = await h.createTenant();
      const po = await t.as.post(`/api/companies/${t.company.id}/purchase-orders`, {
        vendorName: bill.vendor_name,
        date: bill.bill_date,
        lines: [
          { description: "Large quantity", quantity: "2048.0001", unitPrice: 1000, vatRate: 0 },
          { description: "Small quantity", quantity: "0.0049", unitPrice: 1000, vatRate: 0 },
        ],
      });
      expect(po.status, po.text).toBe(201);
      const url = `/api/purchase-orders/${po.body.id}`;
      const [large, small] = po.body.lines;
      expect(large.quantity).toBe(2048.0001);
      expect(small.quantity).toBe(0.0049);
      expect((await t.as.post(`${url}/approve`, {})).status).toBe(200);

      if (mode === "received") {
        const receipt = await t.as.post(`${url}/receive`, {});
        expect(receipt.status, receipt.text).toBe(200);
        expect(receipt.body.status).toBe("received");
        expect(
          await h.sql(
            "SELECT quantity::text AS quantity FROM purchase_order_receipt_lines WHERE receipt_id = $1 ORDER BY purchase_order_receipt_lines.quantity",
            [receipt.body.receiptId]
          )
        ).toEqual([{ quantity: "0.0049" }, { quantity: "2048.0001" }]);
      }

      const convert = `${url}/convert-to-bill`;
      for (const quantity of ["0.00495", 0.00495]) {
        const invalid = await t.as.post(convert, { lines: [{ lineId: small.id, quantity }] });
        expect(invalid.status, invalid.text).toBe(422);
        expect(invalid.body.code).toBe("INVALID_QUANTITY");
      }
      const result = await t.as.post(
        convert,
        mode === "explicit"
          ? {
              lines: [
                { lineId: large.id, quantity: "2048.0001" },
                { lineId: small.id, quantity: 0.0049 },
              ],
            }
          : {}
      );
      expect(result.status, result.text).toBe(201);
      const saved = await t.as.get(`/api/bills/${result.body.bill.id}`);
      expect(saved.status, saved.text).toBe(200);
      expect(saved.body).toMatchObject({
        subtotal: "2048005.00",
        line_items: expect.arrayContaining([
          expect.objectContaining({ quantity: "2048.0001", amount: "2048000.10" }),
          expect.objectContaining({ quantity: "0.0049", amount: "4.90" }),
        ]),
      });
      expect(result.body.match.lines).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ lineId: large.id, billed: 2048.0001, outstandingToBill: 0 }),
          expect.objectContaining({ lineId: small.id, billed: 0.0049, outstandingToBill: 0 }),
        ])
      );
    }
  );

  it("bills the exact remainder after a partial receipt and partial conversion", async () => {
    const t = await h.createTenant();
    const po = await t.as.post(`/api/companies/${t.company.id}/purchase-orders`, {
      vendorName: bill.vendor_name,
      date: bill.bill_date,
      lines: [{ description: "Partial purchase", quantity: 0.3, unitPrice: 1000, vatRate: 0 }],
    });
    expect(po.status, po.text).toBe(201);
    const url = `/api/purchase-orders/${po.body.id}`;
    const lineId = po.body.lines[0].id;
    expect((await t.as.post(`${url}/approve`, {})).status).toBe(200);
    const receipt = await t.as.post(`${url}/receive`, { lines: [{ lineId, quantity: 0.2 }] });
    expect(receipt.status, receipt.text).toBe(200);
    expect(receipt.body.match.lines[0].outstandingToReceive).toBe(0.1);
    const convert = `${url}/convert-to-bill`;
    const partial = await t.as.post(convert, { lines: [{ lineId, quantity: 0.1 }] });
    expect(partial.status, partial.text).toBe(201);
    expect(partial.body.match.lines[0].outstandingToBill).toBe(0.2);
    const remaining = await t.as.post(convert, {});
    expect(remaining.status, remaining.text).toBe(201);
    expect(remaining.body.bill.line_items[0]).toMatchObject({
      quantity: "0.1000",
      amount: "100.00",
    });
    expect(remaining.body.match.lines[0]).toMatchObject({ billed: 0.2, outstandingToBill: 0.1 });
    expect((await t.as.post(convert, {})).status).toBe(409);
    expect((await t.as.post(`${url}/receive`, {})).status).toBe(200);
    const final = await t.as.post(convert, {});
    expect(final.status, final.text).toBe(201);
    expect(final.body.match.lines[0]).toMatchObject({ billed: 0.3, outstandingToBill: 0 });
  });

  it.each(["AED", "USD"])("saves and reopens fractional quantities in %s", async (currency) => {
    const t = await h.createTenant();
    const exchange_rate = currency === "USD" ? "3.675123" : null;
    const posted = await t.as.post(`/api/companies/${t.company.id}/bills`, {
      ...bill,
      currency,
      exchange_rate,
      save_as_draft: true,
    });
    expect(posted.status, posted.text).toBe(200);
    const url = `/api/bills/${posted.body.id}`;
    const roundTrip = {
      currency,
      subtotal: "1234.00",
      vat_amount: "61.70",
      total_amount: "1295.70",
      line_items: [
        expect.objectContaining({ quantity: "1.2340", amount: "1234.00", vat_amount: "61.70" }),
      ],
    };
    expect(posted.body).toMatchObject(roundTrip);
    const reopened = await t.as.get(url);
    expect(reopened.status, reopened.text).toBe(200);
    expect(reopened.body).toMatchObject(roundTrip);
    const resaved = await t.as.patch(url, {
      ...bill,
      currency,
      exchange_rate,
      notes: "Save again",
    });
    expect(resaved.status, resaved.text).toBe(200);
    expect(resaved.body).toMatchObject(roundTrip);

    const small = await t.as.patch(url, { line_items: [{ ...line, quantity: "0.004" }] });
    expect(small.status, small.text).toBe(200);
    expect((await t.as.get(url)).body).toMatchObject({
      subtotal: "4.00",
      vat_amount: "0.20",
      line_items: [
        expect.objectContaining({ quantity: "0.0040", amount: "4.00", vat_amount: "0.20" }),
      ],
    });
  });

  it("runs a recurring template with a sub-centesimal quantity", async () => {
    const t = await h.createTenant();
    const url = `/api/companies/${t.company.id}/recurring-bills`;
    const recurring = await t.as.post(url, {
      name: "Monthly purchase",
      frequency: "monthly",
      next_run_on: "2026-01-15",
      template: { ...bill, line_items: [{ ...line, quantity: "0.004" }] },
    });
    expect(recurring.status, recurring.text).toBe(201);
    const run = await t.as.post(`${url}/${recurring.body.id}/run`, {});
    expect(run.status, run.text).toBe(200);
    expect(run.body).toMatchObject({
      created: true,
      bill: { subtotal: "4.00", vat_amount: "0.20" },
    });
    const saved = await t.as.get(`/api/bills/${run.body.bill.id}`);
    expect(saved.body.line_items).toEqual([
      expect.objectContaining({ quantity: "0.0040", amount: "4.00", vat_amount: "0.20" }),
    ]);
  });
});
