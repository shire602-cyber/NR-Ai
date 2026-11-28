/**
 * F9: admin-only and other write routes that used to pick fields off req.body now validate with
 * strictBody (valid -> success, unknown key -> 400, bad type -> 400).
 */
import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();

describe("[F9] PUT /api/admin/settings", () => {
  it("accepts a valid key/value, upserts, coerces scalars, rejects unknown keys and bad types", async () => {
    const admin = await h.createTenant({ name: "SetAdmin", isAdmin: true });
    const created = await admin.as.put(`/api/admin/settings`, {
      key: "f9.flag",
      value: "on",
    });
    expect(created.status, created.text).toBe(200);
    expect(created.body.key).toBe("f9.flag");
    expect(created.body.value).toBe("on");

    const updated = await admin.as.put(`/api/admin/settings`, { key: "f9.flag", value: true });
    expect(updated.status, updated.text).toBe(200);
    expect(updated.body.value).toBe("true");

    const unknown = await admin.as.put(`/api/admin/settings`, {
      key: "f9.flag",
      value: "x",
      category: "evil",
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.fields.category).toBeTruthy();

    const badType = await admin.as.put(`/api/admin/settings`, { key: "f9.flag", value: { a: 1 } });
    expect(badType.status).toBe(400);
    const missing = await admin.as.put(`/api/admin/settings`, { key: "f9.flag" });
    expect(missing.status).toBe(400);
  });
});

describe("[F9] POST /api/admin/clients", () => {
  it("creates a client with the same response shape, rejects unknown keys and bad types", async () => {
    const admin = await h.createTenant({ name: "ClientAdmin", isAdmin: true });
    const ok = await admin.as.post(`/api/admin/clients`, {
      name: "F9 Client LLC",
      baseCurrency: "AED",
      industry: "Retail",
    });
    expect(ok.status, ok.text).toBe(201);
    expect(ok.body.name).toBe("F9 Client LLC");
    expect(ok.body.companyType).toBe("client");
    expect(ok.body.id).toBeTruthy();

    const unknown = await admin.as.post(`/api/admin/clients`, {
      name: "F9 Other LLC",
      isActive: false,
      id: "00000000-0000-0000-0000-000000000001",
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe("VALIDATION_ERROR");

    const badType = await admin.as.post(`/api/admin/clients`, { name: 12345 });
    expect(badType.status).toBe(400);
    const noName = await admin.as.post(`/api/admin/clients`, { industry: "Retail" });
    expect(noName.status).toBe(400);
  });
});

describe("[F9] other admin writes", () => {
  it("rejects unknown keys on invitations, notes, user patch and import preview", async () => {
    const admin = await h.createTenant({ name: "MiscAdmin", isAdmin: true });
    const inv = await admin.as.post(`/api/admin/invitations`, {
      email: "f9-invitee@example.com",
      status: "accepted",
    });
    expect(inv.status).toBe(400);
    const invOk = await admin.as.post(`/api/admin/invitations`, {
      email: "f9-invitee@example.com",
    });
    expect(invOk.status, invOk.text).toBe(201);
    // [CI-C1] the list route is a GET: it must not run the create-body validator (was 400).
    const list = await admin.as.get(`/api/admin/invitations`);
    expect(list.status, list.text).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);

    const note = await admin.as.post(`/api/admin/clients/${admin.company.id}/notes`, {
      content: "hello",
      authorId: "x",
    });
    expect(note.status).toBe(400);
    const noteOk = await admin.as.post(`/api/admin/clients/${admin.company.id}/notes`, {
      content: "hello",
    });
    expect(noteOk.status, noteOk.text).toBe(201);

    const user = await admin.as.patch(`/api/admin/users/${admin.user.id}`, {
      isAdmin: "yes",
    });
    expect(user.status).toBe(400);

    const prev = await admin.as.post(`/api/admin/import/preview`, { fileData: 5 });
    expect(prev.status).toBe(400);
  });
});

describe("[F9] customer-facing write routes", () => {
  it("onboarding PATCH rejects unknown keys and accept valid bodies", async () => {
    const t = await h.createTenant({ name: "OnbF9" });
    const bad = await t.as.patch(`/api/onboarding`, { userId: "x", hasViewedReports: true });
    expect(bad.status).toBe(400);
    const wrongType = await t.as.patch(`/api/onboarding`, { hasViewedReports: "yes" });
    expect(wrongType.status).toBe(400);
    const ok = await t.as.patch(`/api/onboarding`, { hasViewedReports: true });
    expect(ok.status, ok.text).toBe(200);
  });
});
