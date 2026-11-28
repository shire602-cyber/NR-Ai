import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs helper without type declarations
import { countFindings, findingsExitCode } from "../../scripts/qa/fail-on-findings.mjs";

// The read-only QA finders exit 0 for a completed report by default. `--fail-on-findings` turns a
// non-empty actionable list into exit 1 so the release rehearsal gate fails on findings.

describe("findingsExitCode", () => {
  it("never fails without the flag, even with findings", () => {
    expect(findingsExitCode([], { a: [1, 2] }, "x")).toBe(0);
  });
  it("passes with the flag and no findings", () => {
    expect(findingsExitCode(["--fail-on-findings"], { a: [], b: [] }, "x")).toBe(0);
  });
  it("fails with the flag and at least one finding", () => {
    expect(countFindings({ a: [], b: [1] })).toBe(1);
    expect(findingsExitCode(["--json", "--fail-on-findings"], { a: [], b: [1] }, "x")).toBe(1);
  });
});

/** Runs a finder with `pg.Client` replaced by a stub whose `rowsFor(sql)` supplies the rows. */
function runScript(script: string, rowsFor: string, args: string[]) {
  const path = resolve("scripts/qa", script);
  const preload = `
    import { createRequire } from "node:module";
    const pg = createRequire(${JSON.stringify(path)})("pg");
    const rowsFor = ${rowsFor};
    pg.Client = class {
      async connect() {}
      async query(sql) { return { rows: rowsFor(String(sql)) }; }
      async end() {}
    };
  `;
  const result = spawnSync(
    process.execPath,
    ["--import", `data:text/javascript,${encodeURIComponent(preload)}`, path, ...args],
    {
      env: { ...process.env, DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused" },
      encoding: "utf8",
      timeout: 15_000,
    }
  );
  if (result.error) throw result.error;
  return result;
}

const FLAG = "--fail-on-findings";
const anyRow = `(sql) => (/^(BEGIN|ROLLBACK)/.test(sql) ? [] : [{ x: 1, id: "i" }])`;
const noRows = `() => []`;

describe.each([["find-sales-ledger-drift.mjs"], ["find-purchases-ledger-drift.mjs"]])(
  "%s",
  (script) => {
    it("keeps exit 0 with findings by default", () => {
      const r = runScript(script, anyRow, ["--json"]);
      expect(r.stderr).toBe("");
      expect(r.status, r.stderr).toBe(0);
    });
    it("exits 1 with findings under the flag and names the script on stderr", () => {
      const r = runScript(script, anyRow, ["--json", FLAG]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(script.replace(".mjs", ""));
      expect(r.stderr).toContain(FLAG);
      expect(() => JSON.parse(r.stdout)).not.toThrow();
    });
    it("exits 0 under the flag when nothing is found", () => {
      const r = runScript(script, noRows, ["--json", FLAG]);
      expect(r.status, r.stderr).toBe(0);
    });
  }
);

describe("find-inverted-rates.mjs", () => {
  const rows = (rate: Record<string, unknown>) =>
    `(sql) => {
      if (sql.includes("information_schema")) return [{ column_name: "legacy_unscoped" }];
      if (sql.includes("COUNT(*)")) return [{ n: 2 }];
      if (sql.includes("FROM exchange_rates"))
        return [${JSON.stringify({ date: "2026-01-01", rate: "3.67", ...rate })}];
      return [];
    }`;
  const inverted = rows({
    base_currency: "AED",
    target_currency: "USD",
    source: "manual",
    legacy_unscoped: false,
    legacy_inverted: false,
  });
  // Already handled by 0094: quarantined and rewritten rows are informational.
  const handled = rows({
    base_currency: "USD",
    target_currency: "AED",
    source: "manual",
    legacy_unscoped: true,
    legacy_inverted: true,
  });

  it("exits 0 by default with an inverted row", () => {
    expect(runScript("find-inverted-rates.mjs", inverted, ["--json"]).status).toBe(0);
  });
  it("exits 1 under the flag with an inverted row", () => {
    const r = runScript("find-inverted-rates.mjs", inverted, ["--json", FLAG]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("inverted=1");
  });
  it("exits 0 under the flag when only already-handled rows exist", () => {
    const r = runScript("find-inverted-rates.mjs", handled, ["--json", FLAG]);
    expect(r.status, r.stderr).toBe(0);
  });
});

describe("find-bad-closing-entries.mjs", () => {
  const rowsFor = (withFinding: boolean) => `(sql) => {
    if (sql.includes("FROM journal_entries je") && sql.includes("ORDER BY je.company_id"))
      return [{ id: "e1", company_id: "c1", entry_number: "JE-1", d: "2026-01-31",
        memo: "Closing entries for 2026-01-01 to 2026-01-31", source: "system" }];
    if (sql.includes("JOIN accounts a ON a.id = jl.account_id"))
      return [{ account_id: "a1", code: "4010", name_en: "Sales", type: "income",
        dr: "0", cr: ${withFinding ? '"10000"' : '"0"'} }];
    return [];
  }`;
  const company = ["--company", "00000000-0000-0000-0000-000000000001"];
  it("exits 0 by default and 1 under the flag when a closing entry exceeds its period", () => {
    expect(runScript("find-bad-closing-entries.mjs", rowsFor(true), ["--json"]).status).toBe(0);
    const r = runScript("find-bad-closing-entries.mjs", rowsFor(true), [
      "--json",
      FLAG,
      ...company,
    ]);
    expect(r.status, r.stderr).toBe(1);
    expect(JSON.parse(r.stdout).findings).toHaveLength(1);
  });
  it("exits 0 under the flag when closing entries match their periods", () => {
    const r = runScript("find-bad-closing-entries.mjs", rowsFor(false), ["--json", FLAG]);
    expect(r.status, r.stderr).toBe(0);
  });
  it("keeps exit 2 for a bad --company uuid", () => {
    expect(
      runScript("find-bad-closing-entries.mjs", noRows, [FLAG, "--company", "nope"]).status
    ).toBe(2);
  });
});

describe("repair-misposted-payments.ts", () => {
  // Source inspection: the script needs the app's drizzle pool and server modules (a real database)
  // to run, so the behaviour is covered by findingsExitCode above; this pins that the dry-run branch
  // applies it and that the --apply branch (the only writer) does not.
  const source = readFileSync(resolve("scripts/qa/repair-misposted-payments.ts"), "utf8");
  it("applies the findings exit in the read-only branch only", () => {
    const dryRun = source.slice(0, source.indexOf("repairMispostedPayments(findings"));
    expect(dryRun).toContain("findingsExitCode(args, { findings }");
    expect(source.slice(source.indexOf("repairMispostedPayments(findings"))).not.toContain(
      "findingsExitCode"
    );
  });
});
