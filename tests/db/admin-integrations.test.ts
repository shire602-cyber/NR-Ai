/**
 * STEP1 F6: Admin > Integrations reads real status from the server and the Google Sheets test is
 * a real, admin-only call (it was a hard-coded "Connected" badge and a button that did nothing).
 */
import { describe, expect, it, vi } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();

describe("STEP1 F6 admin integrations", () => {
  it("shows Banking configured for built-in CSV import independently of adapter credentials", async () => {
    const admin = await h.createTenant({ name: "BankingStatusAdmin", isAdmin: true });
    const banking = async () => {
      const response = await admin.as.get("/api/admin/integration-status");
      expect(response.status, response.text).toBe(200);
      return response.body.integrations.find((item: { key: string }) => item.key === "openBanking");
    };
    try {
      vi.stubEnv("LEAN_APP_TOKEN", undefined);
      const before = await banking();
      expect(before).toMatchObject({ name: "Banking", configured: true, requiredEnv: [] });
      expect(before.unlocks).toContain("CSV");
      vi.stubEnv("LEAN_APP_TOKEN", "sandbox-fixture");
      expect(await banking()).toEqual(before);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("[F6-status] an admin reads configured/not configured; a customer is refused", async () => {
    const admin = await h.createTenant({ name: "IntegrationsAdmin", isAdmin: true });
    const customer = await h.createTenant({ name: "IntegrationsCustomer" });

    const status = await admin.as.get("/api/admin/integrations/status");
    expect(status.status, status.text).toBe(200);
    expect(status.body).toEqual({
      stripe: { configured: expect.any(Boolean) },
      openai: { configured: expect.any(Boolean) },
      googleSheets: { configured: false }, // no Google credentials in the test environment
    });
    // No secret value is ever returned.
    expect(status.text).not.toMatch(/sk[-_]/);

    expect((await customer.as.get("/api/admin/integrations/status")).status).toBe(403);
    expect((await customer.as.post("/api/admin/integrations/google-sheets/test", {})).status).toBe(
      403
    );
  });

  it("[F6-documents] the admin documents page's upload body stores bytes that View/Download read back", async () => {
    const t = await h.createTenant({ name: "AdminDocsCo" });
    const pdf = Buffer.from("%PDF-1.4\n% admin uploaded licence\n%%EOF\n");
    // Exactly the body AdminDocuments sends (empty optional fields as null).
    const up = await t.as.post(`/api/companies/${t.company.id}/documents`, {
      name: "Trade licence",
      nameAr: null,
      category: "trade_license",
      description: null,
      expiryDate: null,
      reminderDays: 30,
      fileName: "licence.pdf",
      mimeType: "application/pdf",
      fileData: `data:application/pdf;base64,${pdf.toString("base64")}`,
    });
    expect(up.status, up.text).toBe(201);
    const dl = await t.as.get(`/api/documents/${up.body.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.text).toContain("admin uploaded licence");
  });

  it("[F6-stats] the overview counts real companies and AI calls (was 'Active companies 0')", async () => {
    const admin = await h.createTenant({ name: "StatsAdmin", isAdmin: true });
    await h.sql(
      `INSERT INTO ai_usage_events (company_id, task, provider, model) VALUES ($1, 'categorize', 'openai', 'gpt')`,
      [admin.company.id]
    );
    const r = await admin.as.get("/api/admin/stats");
    expect(r.status, r.text).toBe(200);
    expect(r.body.totalCompanies).toBeGreaterThanOrEqual(1);
    expect(r.body.totalCompanies).toBe(r.body.totalClients);
    expect(r.body.aiCreditsUsed).toBe(1);
  });

  it("[S3-active] 'Active companies' counts populated companies, not deleted or switched-off ones", async () => {
    const admin = await h.createTenant({ name: "ActiveAdmin", isAdmin: true });
    const before = (await admin.as.get("/api/admin/stats")).body;
    const second = await h.createTenant({ name: "ActiveSecond" });
    const third = await h.createTenant({ name: "ActiveThird" });
    const after = (await admin.as.get("/api/admin/stats")).body;
    expect(after.activeCompanies).toBe(before.activeCompanies + 2);
    expect(after.activeCompanies).toBeGreaterThan(0);
    await h.sql(`UPDATE companies SET is_active = false WHERE id = $1`, [second.company.id]);
    await h.sql(`UPDATE companies SET deleted_at = now() WHERE id = $1`, [third.company.id]);
    const last = (await admin.as.get("/api/admin/stats")).body;
    expect(last.activeCompanies).toBe(before.activeCompanies);
    expect(last.totalCompanies).toBe(before.totalCompanies + 1); // switched off, still listed
  });

  it("[F6-sheets-test] without credentials the test answers not_configured (no Google call)", async () => {
    const admin = await h.createTenant({ name: "IntegrationsAdmin2", isAdmin: true });
    const r = await admin.as.post("/api/admin/integrations/google-sheets/test", {});
    expect(r.status, r.text).toBe(200);
    expect(r.body).toEqual({ ok: false, code: "not_configured" });
    const bad = await admin.as.post("/api/admin/integrations/google-sheets/test", { x: 1 });
    expect(bad.status).toBe(400);
  });
});
