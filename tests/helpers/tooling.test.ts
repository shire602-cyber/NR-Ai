/**
 * Regression tests for the W1-A platform/tooling fixes (run by `npm test`).
 * DB-backed behaviour lives in tests/db (npm run test:db).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const pkg = JSON.parse(read("package.json"));

describe("toolchain", () => {
  it("R20-01: npm run check raises the tsc heap itself and runs the guard runner", () => {
    expect(pkg.scripts.check).toMatch(/^cross-env NODE_OPTIONS=--max-old-space-size=\d{4,} tsc /);
    expect(pkg.scripts.check).toContain("node scripts/run-guards.mjs");
  });

  it("exposes the platform scripts", () => {
    expect(pkg.scripts["test:db"]).toBe("vitest run --config tests/db/vitest.config.ts");
    expect(pkg.scripts["audit:dead-code"]).toContain("knip");
    expect(pkg.scripts["perf:budget"]).toBe("node scripts/perf-budget.mjs");
    expect(pkg.scripts["bundle:budget"]).toBe("node scripts/check-bundle-budget.mjs");
  });

  it("run-guards.mjs runs guards that exist and skips missing ones", () => {
    const res = spawnSync(process.execPath, ["scripts/run-guards.mjs"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).toMatch(/run-guards: \d+ guard\(s\) passed/);
  });
});

describe("R20-04: frontend API coverage parses multi-line template literals", () => {
  it("resolves every client reference (strict)", () => {
    const res = spawnSync(
      process.execPath,
      ["scripts/check-frontend-api-coverage.mjs", "--strict"],
      {
        cwd: root,
        encoding: "utf8",
      }
    );
    expect(res.status, res.stdout).toBe(0);
    expect(res.stdout).not.toContain("Unresolved API references");
  });

  it("collapses ${...} expressions that span lines", async () => {
    const { templateLiteralApiPaths } =
      await import("../../scripts/check-frontend-api-coverage.mjs");
    const src =
      "apiRequest('POST', `/api/companies/${companyId}/evidence-center/issues/${encodeURIComponent(\n" +
      "  issueDialog.issue.id\n)}/actions`, {})";
    expect(templateLiteralApiPaths(src)).toEqual([
      "/api/companies/${x}/evidence-center/issues/${x}/actions",
    ]);
  });
});

describe("R20-02/R20-03: live integration scripts self-throttle and never silently skip", () => {
  const scripts = fs
    .readdirSync(path.join(root, "tests/integration"))
    .filter((f) => f.endsWith(".test.mjs"));

  it.each(scripts)("%s uses throttledFetch and has no skip/exit(0) paths", (file) => {
    const src = read(`tests/integration/${file}`);
    expect(src).toContain('from "./_http.mjs"');
    expect(src).not.toMatch(/await fetch\(/);
    expect(src).not.toMatch(/console\.log\("SKIP/);
    expect(src).not.toMatch(/process\.exit\(0\)/);
  });

  it("the helper honours Retry-After and the RL_* budgets", () => {
    const src = read("tests/integration/_http.mjs");
    expect(src).toContain("retry-after");
    for (const k of ["RL_API_MAX", "RL_READ_MAX", "RL_AUTH_MAX"]) expect(src).toContain(k);
  });
});

describe("R20-07/R20-12/R20-13: repo hygiene", () => {
  it("marketing sites live under sites/ and are excluded from tooling", () => {
    expect(fs.existsSync(path.join(root, "najma-raeda-site"))).toBe(false);
    expect(fs.existsSync(path.join(root, "najma-al-raeda-website"))).toBe(false);
    expect(fs.existsSync(path.join(root, "sites/najma-raeda-site"))).toBe(true);
    expect(read("eslint.config.js")).toContain('"sites/**"');
    expect(read(".prettierignore")).toMatch(/^sites\/$/m);
    expect(read("vitest.config.ts")).toContain('"sites/**"');
    expect(JSON.parse(read("knip.json")).ignore).toContain("sites/**");
    const tsconfig = read("tsconfig.json");
    expect(tsconfig).not.toMatch(/"sites/);
  });

  it("audit/teardown documents are archived with an index", () => {
    const rootFiles = fs.readdirSync(root);
    expect(rootFiles.filter((f) => /Teardown|Verdict|Audit|test-report/i.test(f))).toEqual([]);
    expect(rootFiles.filter((f) => /\.(docx|pdf)$/.test(f))).toEqual([]);
    expect(fs.existsSync(path.join(root, "teardown-evidence"))).toBe(false);
    expect(fs.existsSync(path.join(root, "artifacts"))).toBe(false);
    expect(fs.readdirSync(path.join(root, "docs")).filter((f) => f.startsWith("CODEX_"))).toEqual(
      []
    );
    expect(read("docs/archive/README.md")).toContain("Muhasib-Teardown-2026-08-07.md");
  });
});

describe("R20-15: CI gates", () => {
  const ci = read(".github/workflows/ci.yml");
  it.each([
    ["typecheck", "npm run check"],
    ["unit tests", "npm test"],
    ["db harness", "npm run test:db"],
    ["lint", "npm run lint"],
    ["build", "npm run build"],
    ["migration secrets", "npm run check:migrations"],
    ["dependency audit", "scripts/qa/audit-gate.mjs"],
    ["perf budget", "npm run perf:budget"],
    ["bundle budget", "npm run bundle:budget"],
  ])("runs %s", (_name, cmd) => {
    expect(ci).toContain(cmd);
  });

  it("runs the DB job against a Postgres 16 service", () => {
    expect(ci).toContain("image: postgres:16");
    expect(ci).toContain("TEST_DATABASE_ADMIN_URL");
  });

  it("coverage thresholds come from the committed ratchet file", () => {
    const ratchet = JSON.parse(read("tests/helpers/coverage-ratchet.json"));
    expect(ratchet.thresholds.statements).toBeGreaterThanOrEqual(12);
    expect(ratchet.plan).toEqual({ afterWave3: 25, afterWave4: 40, final: 50 });
    expect(read("vitest.config.ts")).toContain("coverage-ratchet.json");
  });

  it("perf and bundle baselines are committed", () => {
    const perf = JSON.parse(read("scripts/qa/perf-baseline.json"));
    expect(Object.keys(perf.p95Ms)).toHaveLength(7);
    const bundle = JSON.parse(read("scripts/qa/bundle-baseline.json"));
    expect(Object.keys(bundle.chunks).length).toBeGreaterThan(10);
  });
});

describe("R17-27: dependency audit exceptions are documented", () => {
  it("every accepted exception names a reason and exit plan", () => {
    const doc = read("docs/security/dependency-exceptions.md");
    const rows = [...doc.matchAll(/^\|\s*`([^`]+)`\s*\|\s*(critical|high)\s*\|(.*)$/gim)];
    // F3 upgraded zod to 4.x, which cleared the last accepted (zod) exception.
    expect(rows.map((r) => r[1])).toEqual([]);
    for (const r of rows)
      expect(r[3].split("|").filter((c) => c.trim()).length).toBeGreaterThanOrEqual(3);
    expect(pkg.dependencies.zod).toMatch(/^\^4\./);
  });
});

describe("R17-16: migration secret scan allow-list", () => {
  it("still allow-lists only the immutable historical migrations", () => {
    const sh = read("tools/check-migrations-no-secrets.sh");
    expect(sh).toContain("0028_fix_test_credentials");
    expect(read("migrations/0089_platform_foundation.sql")).toMatch(
      /'\$revoked\$' \|\| gen_random_uuid\(\)::text/
    );
  });
});
