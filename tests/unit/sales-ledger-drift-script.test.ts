import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const script = resolve("scripts/qa/find-sales-ledger-drift.mjs");

function runSalesCheck(failNegativeReceivable: boolean, args: string[] = []) {
  const preload = `
    import { createRequire } from "node:module";
    const pg = createRequire(${JSON.stringify(script)})("pg");
    pg.Client = class {
      async connect() {}
      async query(sql) {
        if (${failNegativeReceivable} && sql.includes("FROM customer_credits")) {
          throw Object.assign(new Error('relation "customer_credits" does not exist'), {
            code: "42P01",
          });
        }
        return { rows: [] };
      }
      async end() {}
    };
  `;
  const result = spawnSync(
    process.execPath,
    ["--import", `data:text/javascript,${encodeURIComponent(preload)}`, script, ...args],
    {
      env: { ...process.env, DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused" },
      encoding: "utf8",
      timeout: 10_000,
    }
  );
  if (result.error) throw result.error;
  return result;
}

it("fails the sales QA gate when the negativeReceivable query fails", () => {
  const result = runSalesCheck(true);

  expect(result.status, result.stdout + result.stderr).toBe(1);
  expect(result.stderr).toContain('negativeReceivable failed: relation "customer_credits"');
  expect(result.stdout).toBe("");
});

it("exits successfully and reports all sales QA checks when the queries succeed", () => {
  const result = runSalesCheck(false, ["--json"]);

  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({
    ambiguousZeroRated: [],
    zeroRatedOn4010: [],
    phantomVoidBalance: [],
    creditNotesOn4010: [],
    negativeReceivable: [],
  });
});
