import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  commonRoutes,
  customerOnlyRoutes,
  isCustomerOnlyRoute,
  isFirmOnlyRoute,
} from "../../client/src/lib/route-config";

const repoRoot = process.cwd();

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("Document chasing surface boundary", () => {
  it("does not expose a generic SaaS/customer document-chasing route", () => {
    expect(customerOnlyRoutes).not.toContain("/document-chasing");
    expect(commonRoutes).not.toContain("/document-chasing");
    expect(isCustomerOnlyRoute("/document-chasing")).toBe(false);
    expect(isFirmOnlyRoute("/firm/document-chasing")).toBe(true);
  });

  it("keeps document-chasing UI navigation inside the NR firm namespace", () => {
    const appSource = readRepoFile("client/src/App.tsx");
    expect(appSource).not.toMatch(/<Route\s+path=["']\/document-chasing["']/);
    expect(appSource).toMatch(/<Route\s+path=["']\/firm\/document-chasing["']/);

    const sidebarSource = readRepoFile("client/src/components/layout/AppSidebar.tsx");
    expect(sidebarSource).not.toContain('url: "/document-chasing"');
    expect(sidebarSource).toContain('url: "/firm/document-chasing"');
  });

  it("firm-gates backend document requirement and chasing APIs", () => {
    const routeSource = readRepoFile("server/routes/document-chasing.routes.ts");

    expect(routeSource).toContain('import { requireFirmRole } from "../middleware/rbac"');
    expect(routeSource).toContain(
      'app.use("/api/companies/:companyId/document-requirements", authMiddleware, requireFirmRole())'
    );
    expect(routeSource).toContain(
      'app.use("/api/companies/:companyId/document-chases", authMiddleware, requireFirmRole())'
    );
  });
});
