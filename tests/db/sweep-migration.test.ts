/**
 * Migration 0093 (W2-D) applies idempotently on a seeded database: it backfills sub types,
 * adds the missing seed accounts, dedupes SKUs before the unique index, and a second run is a no-op.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();
const MIGRATION = fs.readFileSync(
  path.join(__dirname, "..", "..", "migrations", "0093_w2d_write_sweep.sql"),
  "utf8"
);

describe("migration 0093_w2d_write_sweep", () => {
  it("[R02-16c][R10-07] backfills seeded sub types, adds missing seeds, dedupes SKUs, and is idempotent", async () => {
    const a = await h.createTenant();
    const cid = a.company.id;

    // Simulate a pre-0093 company: legacy sub types, no COGS / Other Current Assets, duplicate SKUs.
    await h.sql(
      `UPDATE accounts SET sub_type = 'current_asset' WHERE company_id = $1 AND code IN ('1010','1020','1040')`,
      [cid]
    );
    await h.sql(
      `UPDATE accounts SET sub_type = NULL WHERE company_id = $1 AND code IN ('3010','4010','5000')`,
      [cid]
    );
    await h.sql(`DELETE FROM accounts WHERE company_id = $1 AND code IN ('5005','1080')`, [cid]);
    await h.sql(`DROP INDEX IF EXISTS uq_products_company_sku`);
    for (const name of ["First", "Second", "Third"]) {
      await h.sql(
        `INSERT INTO products (company_id, name, sku, unit_price) VALUES ($1, $2, 'DUP-1', 1)`,
        [cid, name]
      );
    }

    await h.sql(MIGRATION);
    const snapshot = async () => ({
      accounts: await h.sql(
        `SELECT code, sub_type FROM accounts WHERE company_id = $1 ORDER BY code`,
        [cid]
      ),
      skus: await h.sql(`SELECT sku FROM products WHERE company_id = $1 ORDER BY sku`, [cid]),
    });
    const first = await snapshot();
    const by = Object.fromEntries(first.accounts.map((r: any) => [r.code, r.sub_type]));
    expect(by["1010"]).toBe("cash");
    expect(by["1020"]).toBe("bank");
    expect(by["1040"]).toBe("receivable");
    expect(by["3010"]).toBe("owner_equity");
    expect(by["4010"]).toBe("operating_revenue");
    expect(by["5000"]).toBe("operating_expense");
    expect(by["5005"]).toBe("cost_of_sales");
    expect(by["1080"]).toBe("other_current_asset");
    const skus = first.skus.map((r: any) => r.sku);
    expect(new Set(skus).size).toBe(3);
    expect(skus.filter((s: string) => s === "DUP-1")).toHaveLength(1);
    const idx = await h.sql(`SELECT 1 FROM pg_indexes WHERE indexname = 'uq_products_company_sku'`);
    expect(idx).toHaveLength(1);

    await h.sql(MIGRATION); // second run
    expect(await snapshot()).toEqual(first);
  });
});
