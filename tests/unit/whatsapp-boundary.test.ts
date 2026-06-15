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

describe("WhatsApp surface boundary", () => {
  it("does not expose a generic customer WhatsApp route", () => {
    expect(customerOnlyRoutes).not.toContain("/whatsapp");
    expect(commonRoutes).not.toContain("/whatsapp");
    expect(isCustomerOnlyRoute("/whatsapp")).toBe(false);
    expect(isAdminOnlyRoute("/whatsapp")).toBe(false);
  });

  it("keeps WhatsApp out of SaaS/customer-facing pages", () => {
    const customerFacingFiles = [
      "client/src/App.tsx",
      "client/src/components/layout/AppSidebar.tsx",
      "client/src/pages/Admin.tsx",
      "client/src/pages/ClientDashboard.tsx",
      "client/src/pages/CustomerContacts.tsx",
      "client/src/pages/DocumentChasing.tsx",
      "client/src/pages/Integrations.tsx",
      "client/src/pages/Invoices.tsx",
      "client/src/pages/LandingPage.tsx",
      "client/src/pages/PaymentChasing.tsx",
      "client/src/pages/Pricing.tsx",
      "client/src/pages/Reminders.tsx",
      "client/src/pages/Reports.tsx",
    ];

    for (const file of customerFacingFiles) {
      expect(readRepoFile(file), file).not.toMatch(
        /WhatsApp|whatsapp|wa\.me|SiWhatsapp|sendWhatsapp|whatsappTemplate/
      );
    }
  });

  it("keeps SaaS report-pack scheduling email-only", () => {
    const reportPackSource = readRepoFile("server/services/report-pack-schedules.service.ts");

    expect(reportPackSource).toContain('export const reportPackChannels = ["email"] as const');
    expect(reportPackSource).not.toMatch(/WhatsApp|whatsapp|manual_whatsapp/);
  });

  it("keeps the legacy WhatsApp integration API firm-gated", () => {
    const routeSource = readRepoFile("server/routes/whatsapp.routes.ts");
    expect(routeSource).toContain("import { requireFirmRole } from '../middleware/rbac'");
    expect(routeSource.match(/requireFirmRole\(\)/g)?.length).toBe(6);
  });
});
