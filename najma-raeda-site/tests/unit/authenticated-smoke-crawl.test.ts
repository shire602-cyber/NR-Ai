import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("authenticated smoke route crawl", () => {
  const scriptPath = join(repoRoot, "tests/e2e/authenticated-smoke-crawl.mjs");
  const scriptSource = readRepoFile("tests/e2e/authenticated-smoke-crawl.mjs");

  it("is registered as a dedicated production route smoke command", () => {
    const packageJson = JSON.parse(readRepoFile("package.json"));

    expect(packageJson.scripts["smoke:prod:routes"]).toBe(
      "node tests/e2e/authenticated-smoke-crawl.mjs"
    );
  });

  it("requires existing smoke credentials before launching the browser", () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      env: {
        ...process.env,
        SMOKE_BASE_URL: "https://example.com",
        SMOKE_EMAIL: "",
        SMOKE_PASSWORD: "",
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Missing required authenticated crawl env");
    expect(result.stderr).toContain("SMOKE_EMAIL");
    expect(result.stderr).toContain("SMOKE_PASSWORD");
  });

  it("uses login-only authentication and avoids production data creation flows", () => {
    expect(scriptSource).toContain("SMOKE_EMAIL");
    expect(scriptSource).toContain("SMOKE_PASSWORD");
    expect(scriptSource).toContain('const LOGIN_PATH = "/api/auth/login"');
    expect(scriptSource).toContain("page.request.post(`${BASE}${LOGIN_PATH}`");
    expect(scriptSource).not.toContain("/api/auth/register");
    expect(scriptSource).not.toContain("CUSTOMER_E2E_ALLOW_REMOTE_MUTATION");
    expect(scriptSource).not.toContain("journal");
    expect(scriptSource).not.toContain("invoiceNumber");
    expect(scriptSource).not.toContain("bank-connections");
  });

  it("supports firm, customer, all, and explicit route scopes", () => {
    expect(scriptSource).toContain("AUTH_CRAWL_PROFILE");
    expect(scriptSource).toContain("AUTH_CRAWL_ROUTES");
    expect(scriptSource).toContain('if (PROFILE === "customer")');
    expect(scriptSource).toContain('if (PROFILE === "all")');
    expect(scriptSource).toContain("AUTH_CRAWL_PROFILE must be firm, customer, or all");
  });

  it("records failure artifacts for route-crawl review", () => {
    expect(scriptSource).toContain("authenticated-smoke-crawl-last-run.json");
    expect(scriptSource).toContain("page.screenshot");
    expect(scriptSource).toContain("routeErrors");
    expect(scriptSource).toContain("apiFailures");
  });
});
