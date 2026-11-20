/**
 * R20-10: NR firm-only surfaces (WhatsApp, document chasing) are enforced by the real app, not by
 * grepping route source. A plain customer tenant is refused (403) on every firm-gated API and the
 * SaaS integrations status payload carries no WhatsApp entry.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();

afterEach(() => vi.unstubAllEnvs());

describe("R20-10 NR-only surfaces are firm-gated", () => {
  it("refuses a customer on the legacy WhatsApp integration APIs", async () => {
    const a = await h.createTenant({ name: "WaGateA" });
    for (const path of [
      "/api/integrations/whatsapp/messages",
      "/api/whatsapp/messages",
      "/api/whatsapp/anything",
    ]) {
      const res = await a.as.get(path);
      expect(res.status, path).toBe(403);
    }
  });

  it("[PR72] checks the trial of the company whose WhatsApp history staff read", async () => {
    vi.stubEnv("BILLING_ENFORCEMENT", "true");
    const staff = await h.createTenant({
      name: "WaStaff",
      firmRole: "firm_owner",
      planId: "starter",
    });
    const other = await h.createSecondTenant({ planId: "starter" });
    await h.sql("INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'viewer')", [
      other.company.id,
      staff.user.id,
    ]);
    for (const { company } of [staff, other]) {
      await h.sql(
        `INSERT INTO whatsapp_messages (company_id, wa_message_id, from_number, message_type, content)
         VALUES ($1, $2, 'personal', 'text', 'Test history')`,
        [company.id, `history-${company.id}`]
      );
    }

    // The legacy route picks the first direct company without promising which comes first.
    const path = "/api/integrations/whatsapp/messages";
    const history = await staff.as.get(path);
    expect(history.status, history.text).toBe(200);
    expect(history.body).toHaveLength(1);
    const [{ companyId }] = history.body;
    expect([staff.company.id, other.company.id]).toContain(companyId);

    await h.sql(
      `UPDATE subscriptions SET plan_id = 'free', trial_ends_at = now() - interval '1 day'
        WHERE company_id = $1`,
      [companyId]
    );

    const locked = await staff.as.get(path);
    expect(locked.status, locked.text).toBe(402);
    expect(locked.body).toMatchObject({ code: "PLAN_REQUIRED", companyId });
  });

  it("refuses a customer on document requirement and chasing APIs of their own company", async () => {
    const a = await h.createTenant({ name: "DocGateA" });
    for (const sub of ["document-requirements", "document-chases"]) {
      const res = await a.as.get(`/api/companies/${a.company.id}/${sub}`);
      expect(res.status, sub).toBe(403);
    }
  });

  it("keeps WhatsApp out of the SaaS integrations status payload", async () => {
    const a = await h.createTenant({ name: "WaStatusA" });
    const res = await a.as.get("/api/integrations/status");
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain("whatsapp");
  });
});
