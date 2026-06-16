import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  });

  it("does not promote the test account into admin or NR firm roles", () => {
    expect(scriptSource).not.toMatch(/from\s+["']pg["']/);
    expect(scriptSource).not.toMatch(/UPDATE\s+users/i);
    expect(scriptSource).not.toMatch(/firm_owner|firm_admin|is_admin/i);
    expect(scriptSource).toContain("no admin/firm role promotion");
  });

  it("crawls only public and SaaS customer routes as allowed routes", () => {
    const publicRoutes = extractStringArray(scriptSource, "PUBLIC_ROUTES");
    const customerRoutes = extractStringArray(scriptSource, "CUSTOMER_ROUTES");
    const allowedRoutes = [...publicRoutes, ...customerRoutes];

    expect(allowedRoutes).toEqual(expect.arrayContaining(["/demo", "/trust", "/help"]));
    expect(allowedRoutes).toEqual(
      expect.arrayContaining(["/invoices", "/receipts", "/bank-reconciliation", "/vat-filing"])
    );

    for (const forbidden of ["/whatsapp", "/document-chasing", "/admin", "/firm"]) {
      expect(allowedRoutes, `${forbidden} must not be an allowed customer route`).not.toContain(
        forbidden
      );
    }
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
