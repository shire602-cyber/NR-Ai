import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  commonRoutes,
  customerOnlyRoutes,
  isAdminOnlyRoute,
  isCustomerOnlyRoute,
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
    expect(isAdminOnlyRoute("/firm/document-chasing")).toBe(true);
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
    expect(routeSource.match(/requireFirmRole\(\)/g)?.length).toBe(8);

    for (const path of [
      "/api/companies/:companyId/document-requirements",
      "/api/companies/:companyId/document-requirements/:id",
      "/api/companies/:companyId/document-chases/queue",
      "/api/companies/:companyId/document-chases/history/:requirementId",
      "/api/companies/:companyId/document-chases/send/:requirementId",
      "/api/companies/:companyId/document-chases/bulk-send",
      "/api/companies/:companyId/document-chases/effectiveness",
    ]) {
      const pathIndex = routeSource.indexOf(`"${path}"`);
      expect(pathIndex, path).toBeGreaterThanOrEqual(0);
      const routeBlock = routeSource.slice(
        pathIndex,
        routeSource.indexOf("asyncHandler", pathIndex)
      );
      expect(routeBlock, path).toContain("authMiddleware");
      expect(routeBlock, path).toContain("requireFirmRole()");
    }
  });
});
