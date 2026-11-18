/**
 * Migration 0094 (W2-E): tenant scoping backfill and inverted-rate canonicalisation.
 * Issue ids: R14-01, R14-02.
 *
 * Each case rewinds exchange_rates to its pre-0094 shape, inserts legacy fixture rows,
 * re-applies the migration file and checks the result (and that a second run is a no-op).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";
import { repoRoot } from "./pg-admin";

const h = useHarness();
const migration = fs.readFileSync(path.join(repoRoot, "migrations/0094_w2e_fx_core.sql"), "utf8");
const DAY = "2026-10-01";

async function rewindToPre0094() {
  await h.sql(`DELETE FROM exchange_rates`);
  await h.sql(`DROP INDEX IF EXISTS uniq_exchange_rates_scope_pair_day`);
  await h.sql(`DROP INDEX IF EXISTS idx_exchange_rates_company_pair_date`);
  await h.sql(
    `ALTER TABLE exchange_rates
       DROP COLUMN IF EXISTS company_id, DROP COLUMN IF EXISTS rate_type,
       DROP COLUMN IF EXISTS created_by, DROP COLUMN IF EXISTS legacy_unscoped,
       DROP COLUMN IF EXISTS legacy_inverted`
  );
  await h.sql(
    `CREATE UNIQUE INDEX IF NOT EXISTS uniq_exchange_rates_per_day_source
       ON exchange_rates (base_currency, target_currency, ((date)::date), source)`
  );
}

async function insertLegacy(base: string, target: string, rate: number, source: string) {
  await h.sql(
    `INSERT INTO exchange_rates (base_currency, target_currency, rate, date, source) VALUES ($1, $2, $3, $4, $5)`,
    [base, target, rate, `${DAY}T00:00:00Z`, source]
  );
}

const snapshot = () =>
  h.sql<{
    base_currency: string;
    target_currency: string;
    rate: string;
    source: string;
    company_id: string | null;
    legacy_unscoped: boolean;
    legacy_inverted: boolean;
  }>(
    `SELECT base_currency, target_currency, rate::text AS rate, source, company_id::text,
            legacy_unscoped, legacy_inverted
       FROM exchange_rates ORDER BY base_currency, target_currency, source`
  );

describe("migration 0094", () => {
  it("R14-02 R14-01: single company — rows assigned, inverted UI row rewritten, FTA stays system", async () => {
    await h.sql(`DELETE FROM companies`);
    const t = await h.createTenant({ name: "MigOne" });
    await rewindToPre0094();
    await insertLegacy("AED", "EUR", 4, "manual"); // UI route wrote "1 EUR = 4 AED" inverted
    await insertLegacy("USD", "AED", 3.6725, "manual"); // already canonical
    await insertLegacy("GBP", "AED", 4.6, "fta");

    const dry = JSON.parse(
      execFileSync(
        process.execPath,
        [path.join(repoRoot, "scripts/qa/find-inverted-rates.mjs"), "--json"],
        {
          env: { ...process.env, DATABASE_URL: h.databaseUrl },
          encoding: "utf8",
        }
      )
    );
    expect(dry.migrated).toBe(false);
    expect(dry.inverted).toHaveLength(1);
    expect(dry.inverted[0]).toMatchObject({ pair: "AED/EUR", proposed: "EUR/AED" });
    expect(await h.sql(`SELECT 1 FROM exchange_rates WHERE base_currency = 'AED'`)).toHaveLength(1);

    await h.sql(migration);
    const after = await snapshot();
    expect(after).toEqual([
      {
        base_currency: "EUR",
        target_currency: "AED",
        rate: "4.000000",
        source: "manual",
        company_id: t.company.id,
        legacy_unscoped: false,
        legacy_inverted: true,
      },
      {
        base_currency: "GBP",
        target_currency: "AED",
        rate: "4.600000",
        source: "fta",
        company_id: null,
        legacy_unscoped: false,
        legacy_inverted: false,
      },
      {
        base_currency: "USD",
        target_currency: "AED",
        rate: "3.672500",
        source: "manual",
        company_id: t.company.id,
        legacy_unscoped: false,
        legacy_inverted: false,
      },
    ]);

    // Idempotent: a second run changes nothing.
    await h.sql(migration);
    expect(await snapshot()).toEqual(after);

    // The rewritten rate now converts the right way for the owning company.
    const conv = await t.as.get(
      `/api/companies/${t.company.id}/exchange-rates/convert?from=EUR&to=AED&amount=100&date=${DAY}&maxAgeDays=3650`
    );
    expect(conv.body.convertedAmountText).toBe("400.00");
  });

  it("R14-01: several companies — ownerless rows are quarantined (legacy_unscoped) and ignored", async () => {
    const a = await h.createTenant({ name: "MigA" });
    await h.createSecondTenant({ name: "MigB" });
    await rewindToPre0094();
    await insertLegacy("USD", "AED", 9.99, "manual"); // could be any tenant's — untrusted
    await insertLegacy("AED", "EUR", 4, "manual");
    await insertLegacy("EUR", "AED", 4.1, "manual"); // canonical twin of the inverted row
    await insertLegacy("GBP", "AED", 4.6, "fta");

    await h.sql(migration);
    const after = await snapshot();
    const byKey = Object.fromEntries(
      after.map((r) => [`${r.base_currency}/${r.target_currency}/${r.rate}`, r])
    );
    expect(byKey["USD/AED/9.990000"]).toMatchObject({ company_id: null, legacy_unscoped: true });
    expect(byKey["EUR/AED/4.100000"]).toMatchObject({
      legacy_unscoped: true,
      legacy_inverted: false,
    });
    // The inverted twin collides with the canonical row for that day: quarantined, not swapped.
    expect(byKey["AED/EUR/4.000000"]).toMatchObject({
      legacy_unscoped: true,
      legacy_inverted: true,
    });
    expect(byKey["GBP/AED/4.600000"]).toMatchObject({ company_id: null, legacy_unscoped: false });

    const look = await a.as.get(
      `/api/companies/${a.company.id}/exchange-rates/lookup?from=USD&to=AED&date=${DAY}`
    );
    // The quarantined 9.99 row is never used. E1: with no trusted USD/AED row the pair resolves
    // at the CBUAE peg (3.6725, source "peg"), not the untrusted legacy figure.
    expect(look.status, look.text).toBe(200);
    expect(look.body).toMatchObject({ rate: 3.6725, source: "peg" });
    expect(look.body.rate).not.toBe(9.99);
    const sys = await a.as.get(
      `/api/companies/${a.company.id}/exchange-rates/lookup?from=GBP&to=AED&date=${DAY}`
    );
    expect(sys.body).toMatchObject({ rate: 4.6, scope: "system" });

    await h.sql(migration);
    expect(await snapshot()).toEqual(after);
  });
});
