/**
 * R20-10: NR firm-only surfaces (WhatsApp, document chasing) are enforced by the real app, not by
 * grepping route source. A plain customer tenant is refused (403) on every firm-gated API and the
 * SaaS integrations status payload carries no WhatsApp entry.
 */
import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();

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
