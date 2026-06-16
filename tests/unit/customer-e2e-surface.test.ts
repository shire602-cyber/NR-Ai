import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function extractStringArray(source: string, name: string): string[] {
  const match = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  expect(match, `missing ${name}`).not.toBeNull();
  return [...match![1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

describe("customer launch E2E surface", () => {
  const scriptSource = readRepoFile("tests/e2e/customer-launch-crawl.mjs");

  it("is registered as a dedicated npm command", () => {
    const packageJson = JSON.parse(readRepoFile("package.json"));

    expect(packageJson.scripts["e2e:customer"]).toBe("node tests/e2e/customer-launch-crawl.mjs");
    expect(packageJson.scripts["e2e:customer:public"]).toBe(
      "cross-env CUSTOMER_E2E_PUBLIC_ONLY=true node tests/e2e/customer-launch-crawl.mjs"
    );
  });

  it("does not promote the test account into admin or NR firm roles", () => {
    expect(scriptSource).not.toMatch(/from\s+["']pg["']/);
    expect(scriptSource).not.toMatch(/UPDATE\s+users/i);
    expect(scriptSource).not.toMatch(/firm_owner|firm_admin|is_admin/i);
    expect(scriptSource).toContain("no admin/firm role promotion");
  });

  it("refuses remote mutation unless explicitly approved and supports public-only mode", () => {
    expect(scriptSource).toContain("CUSTOMER_E2E_PUBLIC_ONLY");
    expect(scriptSource).toContain("CUSTOMER_E2E_ALLOW_REMOTE_MUTATION");
    expect(scriptSource).toContain("CUSTOMER_E2E_CLEANUP_ADMIN_EMAIL");
    expect(scriptSource).toContain("CUSTOMER_E2E_CLEANUP_ADMIN_PASS");
    expect(scriptSource).toContain("function assertFullModeMayMutate()");
    expect(scriptSource).toContain(
      "Refusing to run full customer E2E against a non-local BASE_URL"
    );
    expect(scriptSource).toContain(
      "This script registers a customer and creates accounting records"
    );
    expect(scriptSource).toContain("All public customer-launch checks passed.");
  });

  it("keeps remote customer E2E cleanup explicit and auditable", () => {
    expect(scriptSource).toContain("customer-launch-last-run.json");
    expect(scriptSource).toContain("async function writeRunArtifact(runState)");
    expect(scriptSource).toContain("async function cleanupCreatedCustomer(runState)");
    expect(scriptSource).toContain("CUSTOMER_E2E_CLEANUP_DELETE_USER");
    expect(scriptSource).toContain("/api/admin/clients/${runState.companyId}");
    expect(scriptSource).toContain("/api/admin/users/${runState.userId}");
    expect(scriptSource).toContain("CUSTOMER_E2E_CLEANUP_ADMIN_EMAIL/PASS not set");
  });

  it("does not fail public-route QA on expected anonymous refresh misses", () => {
    expect(scriptSource).toContain("function isExpectedAnonymousAuthFailure(response)");
    expect(scriptSource).toContain('response.url().includes("/api/auth/refresh")');
    expect(scriptSource).toContain("status === 400 || status === 401");
    expect(scriptSource).toContain("if (isExpectedAnonymousAuthFailure(r)) return;");
  });

  it("fails before browser launch when full mode points at a remote URL without approval", () => {
    const result = spawnSync(
      process.execPath,
      [join(repoRoot, "tests/e2e/customer-launch-crawl.mjs")],
      {
        env: {
          ...process.env,
          BASE_URL: "https://example.com",
          CUSTOMER_E2E_PUBLIC_ONLY: "false",
          CUSTOMER_E2E_ALLOW_REMOTE_MUTATION: "false",
        },
        encoding: "utf8",
      }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Refusing to run full customer E2E against a non-local BASE_URL"
    );
    expect(result.stderr).toContain("registers a customer and creates accounting records");
  });

  it("crawls only public and SaaS customer routes as allowed routes", () => {
    const publicRoutes = extractStringArray(scriptSource, "PUBLIC_ROUTES");
    const customerRoutes = extractStringArray(scriptSource, "CUSTOMER_ROUTES");
    const mobileRoutes = extractStringArray(scriptSource, "MOBILE_ROUTES");
    const allowedRoutes = [...publicRoutes, ...customerRoutes];

    expect(allowedRoutes).toEqual(expect.arrayContaining(["/demo", "/trust", "/help"]));
    expect(allowedRoutes).toEqual(
      expect.arrayContaining(["/invoices", "/receipts", "/bank-reconciliation", "/vat-filing"])
    );
    expect(mobileRoutes).toEqual([
      "/invoices",
      "/receipts",
      "/bank-reconciliation",
      "/reports",
      "/vat-filing",
    ]);

    for (const forbidden of ["/whatsapp", "/document-chasing", "/admin", "/firm"]) {
      expect(allowedRoutes, `${forbidden} must not be an allowed customer route`).not.toContain(
        forbidden
      );
      expect(mobileRoutes, `${forbidden} must not be a mobile customer route`).not.toContain(
        forbidden
      );
    }
  });

  it("checks customer mobile routes for document-level horizontal overflow", () => {
    expect(scriptSource).toContain("async function crawlMobileRoute(route)");
    expect(scriptSource).toContain("page.setViewportSize({ width: 390, height: 844 })");
    expect(scriptSource).toContain("scrollWidth > clientWidth + 8");
    expect(scriptSource).toContain("mobile overflow");
  });

  it("actively probes NR-only and admin surfaces as forbidden for customers", () => {
    const forbiddenRoutes = extractStringArray(scriptSource, "FORBIDDEN_ROUTES");
    const forbiddenApis = extractStringArray(scriptSource, "FORBIDDEN_API_STATUS_PATHS");

    expect(forbiddenRoutes).toEqual(
      expect.arrayContaining([
        "/whatsapp",
        "/document-chasing",
        "/firm/document-chasing",
        "/firm/comms",
        "/admin",
      ])
    );
    expect(forbiddenApis).toEqual(
      expect.arrayContaining([
        "/api/integrations/whatsapp/status",
        "/api/whatsapp/status",
        "/api/firm/clients",
        "/api/admin/integration-status",
      ])
    );
    expect(scriptSource).toContain("/api/companies/${companyId}/document-requirements");
    expect(scriptSource).toContain("/api/companies/${companyId}/document-chases/queue");
  });
});
