/**
 * E2 (J3-r2 / J4-r2): the access record the UI gates with names the user and whether they are
 * the company's only member (maker-checker), and the customer Evidence Center names no
 * messaging channel (WhatsApp is NR firm-management only).
 */
import { describe, expect, it } from "vitest";
import arCatalog from "../../client/src/locales/ar/components.json";
import enCatalog from "../../client/src/locales/en/components.json";
import { useHarness } from "./harness";

const h = useHarness();

describe("E2 team/me for approval gating", () => {
  it("reports userId and soleMember, which turns false once a second member joins", async () => {
    const t = await h.createTenant({ name: "E2Me" });
    const url = `/api/companies/${t.company.id}/team/me`;
    const solo = await t.as.get(url);
    expect(solo.status, solo.text).toBe(200);
    expect(solo.body).toMatchObject({ userId: t.user.id, soleMember: true, role: "owner" });
    const m = await h.createSecondTenant({ name: "E2MeAcc" });
    await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, $3)`, [
      t.company.id,
      m.user.id,
      "accountant",
    ]);
    expect((await t.as.get(url)).body.soleMember).toBe(false);
    expect((await m.as.get(url)).body).toMatchObject({ userId: m.user.id, role: "accountant" });
  });
});

describe("E2 (J4-r2) Evidence Center customer copy", () => {
  it("does not mention WhatsApp in English or Arabic", async () => {
    const t = await h.createTenant({ name: "E2Evidence" });
    const res = await t.as.get(`/api/companies/${t.company.id}/evidence-center`);
    expect(res.status, res.text).toBe(200);
    expect(res.text).not.toMatch(/whatsapp/i);
    const keys: string[] = [];
    for (const w of res.body.workflows ?? []) {
      for (const ref of w.copy?.bullets ?? []) if (ref?.key) keys.push(ref.key);
    }
    expect(keys.length).toBeGreaterThan(0);
    const en = enCatalog as Record<string, string>;
    const ar = arCatalog as Record<string, string>;
    for (const k of keys) {
      expect(en[`components.srv.${k}`], k).toBeTruthy();
      expect(en[`components.srv.${k}`], k).not.toMatch(/whatsapp/i);
      expect(ar[`components.srv.${k}`] ?? "", k).not.toMatch(/واتساب/);
    }
  });
});
