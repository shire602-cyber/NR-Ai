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
      "client/src/pages/Integrations.tsx",
      "client/src/pages/Invoices.tsx",
      // LandingPage.tsx was an unrouted alternative landing page and has been
      // deleted; MuhasibLanding.tsx is the live one.
      "client/src/pages/MuhasibLanding.tsx",
      "client/src/pages/PaymentChasing.tsx",
      "client/src/pages/Pricing.tsx",
      "client/src/pages/Reminders.tsx",
    ];

    for (const file of customerFacingFiles) {
      expect(readRepoFile(file), file).not.toMatch(
        /WhatsApp|whatsapp|wa\.me|SiWhatsapp|sendWhatsapp|whatsappTemplate/
      );
    }
  });

  it("keeps the legacy WhatsApp integration API firm-gated", () => {
    const routeSource = readRepoFile("server/routes/whatsapp.routes.ts");

    expect(routeSource).toContain('import { requireFirmRole } from "../middleware/rbac"');
    expect(routeSource).toContain(
      'app.use("/api/integrations/whatsapp", authMiddleware, requireFirmRole())'
    );
    expect(routeSource).toContain('app.use("/api/whatsapp", authMiddleware, requireFirmRole())');
  });

  it("keeps WhatsApp out of the SaaS integrations status payload", () => {
    const routeSource = readRepoFile("server/routes/integrations.routes.ts");

    expect(routeSource).not.toMatch(/whatsapp\s*:/i);
    expect(routeSource).not.toMatch(/WhatsApp/);
  });
});
