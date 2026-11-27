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
    // A temporary table shadows the migrated table for this statement only.
    await h.sql(`DO $test$
      BEGIN
        CREATE TEMP TABLE bill_line_items (quantity numeric(10,2) DEFAULT 1) ON COMMIT DROP;
        INSERT INTO bill_line_items VALUES (12.34), (0.01), (0), (NULL), (DEFAULT);
        EXECUTE $migration$${migration}$migration$;
        IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
            WHERE attrelid = 'pg_temp.bill_line_items'::regclass AND attname = 'quantity')
            IS DISTINCT FROM 'numeric(16,4)' THEN
          RAISE EXCEPTION 'Migration did not widen the quantity column';
        END IF;
        INSERT INTO bill_line_items VALUES (1.234), (0.004), (DEFAULT);
        EXECUTE $migration$${migration}$migration$;
        IF (SELECT array_agg(quantity ORDER BY quantity NULLS LAST) FROM bill_line_items)
            IS DISTINCT FROM ARRAY[0, 0.004, 0.01, 1, 1, 1.234, 12.34, NULL]::numeric[] THEN
          RAISE EXCEPTION 'Migration changed stored quantities or the default';
        END IF;
      END $test$`);
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
