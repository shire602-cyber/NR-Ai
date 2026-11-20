/**
 * W2-C identity: token types, revocation on password reset/change, device
 * sessions (R17-04, R01-06, R01-13).
 */
import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();

async function login(t: Tenant, password = t.password) {
  const r = await h.anon.post("/api/auth/login", { email: t.email, password });
  expect(r.status, r.text).toBe(200);
  return r.body as { token: string; refreshToken: string };
}

const me = (token: string) => h.client(token).get("/api/auth/me");
const refresh = (refreshToken: string) => h.anon.post("/api/auth/refresh", { refreshToken });

describe("R17-04 refresh tokens are not access tokens", () => {
  it("R17-04: a refresh token presented as Bearer is rejected with TOKEN_TYPE_INVALID", async () => {
    const t = await h.createTenant({ name: "Rtype" });
    const { refreshToken } = await login(t);
    const r = await me(refreshToken);
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("TOKEN_TYPE_INVALID");
    const scoped = await h.client(refreshToken).get(`/api/companies/${t.company.id}/accounts`);
    expect(scoped.status).toBe(401);
    // ...and still rejected after the refresh token was rotated.
    const rotated = await refresh(refreshToken);
    expect(rotated.status).toBe(200);
    expect((await me(refreshToken)).status).toBe(401);
    expect((await me(rotated.body.token)).status).toBe(200);
  });

  it("R17-04: a signed JWT without type=access (legacy shape) is refused", async () => {
    const t = await h.createTenant({ name: "Rlegacy" });
    const legacy = jwt.sign({ userId: t.user.id, email: t.email }, process.env.JWT_SECRET!, {
      expiresIn: "1h",
    });
    const r = await me(legacy);
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("TOKEN_TYPE_INVALID");
  });
});

describe("R01-06 password reset and change revoke outstanding tokens", () => {
  it("invalidates old mailbox reset links on email change and accepts a link issued to the replacement", async () => {
    const t = await h.createTenant();
    const admin = await h.createTenant({ isAdmin: true });
    const endpoint = `/api/admin/users/${t.user.id}`;
    async function requestReset(email: string) {
      const result = await h.anon.post("/api/auth/forgot-password", { email });
      expect(result.status).toBe(200);
      return new URL(result.body.devResetUrl).searchParams.get("token");
    }
    const oldToken = await requestReset(t.email);
    const replacement = `replacement-${t.email}`;
    expect((await admin.as.patch(endpoint, { email: replacement })).status).toBe(200);
    expect(
      await h.sql("SELECT id FROM password_reset_tokens WHERE user_id = $1", [t.user.id])
    ).toHaveLength(0);

    const password = "Replacement9Password!";
    const stale = await h.anon.post("/api/auth/reset-password", { token: oldToken, password });
    expect(stale.body.code).toBe("RESET_TOKEN_INVALID");
    await login({ ...t, email: replacement });

    const newToken = await requestReset(replacement);
    expect(
      (await h.anon.post("/api/auth/reset-password", { token: newToken, password })).status
    ).toBe(200);
    await login({ ...t, email: replacement }, password);
  });

  it("R01-06: old access and refresh tokens fail after a password reset", async () => {
    const t = await h.createTenant({ name: "Reset" });
    const old = await login(t);
    expect((await me(old.token)).status).toBe(200);

    const forgot = await h.anon.post("/api/auth/forgot-password", { email: t.email });
    expect(forgot.status).toBe(200);
    const resetToken = new URL(forgot.body.devResetUrl).searchParams.get("token")!;
    const newPassword = "Brand9NewSecret!";
    const reset = await h.anon.post("/api/auth/reset-password", {
      token: resetToken,
      password: newPassword,
    });
    expect(reset.status, reset.text).toBe(200);

    expect((await me(old.token)).status).toBe(401);
    expect((await me(t.token)).status).toBe(401);
    expect((await refresh(old.refreshToken)).status).toBe(401);
    // The new password works and yields usable tokens.
    const fresh = await login(t, newPassword);
    expect((await me(fresh.token)).status).toBe(200);
  });

  it("R01-06/R01-13: change-password revokes every other token and keeps this device signed in", async () => {
    const t = await h.createTenant({ name: "Change" });
    const other = await login(t);
    const wrong = await h.client(t.token).post("/api/auth/change-password", {
      currentPassword: "Wrong-password-1",
      newPassword: "Another9Secret!",
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe("CURRENT_PASSWORD_INVALID");

    const changed = await h.client(t.token).post("/api/auth/change-password", {
      currentPassword: t.password,
      newPassword: "Another9Secret!",
    });
    expect(changed.status, changed.text).toBe(200);
    expect(changed.body.token).toBeTruthy();

    expect((await me(t.token)).status).toBe(401);
    expect((await me(other.token)).status).toBe(401);
    expect((await refresh(other.refreshToken)).status).toBe(401);
    expect((await me(changed.body.token)).status).toBe(200);
    expect((await refresh(changed.body.refreshToken)).status).toBe(200);
  });

  it("R01-08: change-password applies the common-password policy", async () => {
    const t = await h.createTenant({ name: "ChangeWeak" });
    const r = await h.client(t.token).post("/api/auth/change-password", {
      currentPassword: t.password,
      newPassword: "Password1",
    });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("VALIDATION_ERROR");
  });
});

describe("R01-13 device sessions", () => {
  it("R01-13: lists sessions, revokes one device, and rejects another user's session id", async () => {
    const t = await h.createTenant({ name: "Sess" });
    const phone = await login(t);
    const list = await h.client(t.token).get("/api/auth/sessions");
    expect(list.status).toBe(200);
    const sessions = list.body.sessions as Array<{ id: string; current: boolean }>;
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);

    const phoneSid = (jwt.decode(phone.token) as { sid: string }).sid;
    const other = await h.createSecondTenant({ name: "SessOther" });
    const foreign = await h.client(other.token).delete(`/api/auth/sessions/${phoneSid}`);
    expect(foreign.status).toBe(404);
    expect((await me(phone.token)).status).toBe(200);

    const revoke = await h.client(t.token).delete(`/api/auth/sessions/${phoneSid}`);
    expect(revoke.status).toBe(200);
    expect((await me(phone.token)).status).toBe(401);
    expect((await refresh(phone.refreshToken)).status).toBe(401);
    expect((await me(t.token)).status).toBe(200);
  });

  it("R01-13: logout-all signs out every device", async () => {
    const t = await h.createTenant({ name: "LogoutAll" });
    const a = await login(t);
    const b = await login(t);
    const r = await h.client(a.token).post("/api/auth/logout-all", {});
    expect(r.status).toBe(200);
    for (const tok of [a.token, b.token, t.token]) expect((await me(tok)).status).toBe(401);
    expect((await refresh(b.refreshToken)).status).toBe(401);
  });

  it("R01-13: reusing a rotated refresh token revokes the session (theft detection)", async () => {
    const t = await h.createTenant({ name: "Reuse" });
    const first = await login(t);
    const second = await refresh(first.refreshToken);
    expect(second.status).toBe(200);
    const replay = await refresh(first.refreshToken);
    expect(replay.status).toBe(401);
    // The thief's replay kills the legitimate rotated pair too.
    expect((await me(second.body.token)).status).toBe(401);
    expect((await refresh(second.body.refreshToken)).status).toBe(401);
  });

  it("logout revokes the presented session", async () => {
    const t = await h.createTenant({ name: "Logout" });
    const s = await login(t);
    const r = await h.client(s.token).post("/api/auth/logout", { refreshToken: s.refreshToken });
    expect(r.status).toBe(200);
    expect((await me(s.token)).status).toBe(401);
    expect((await refresh(s.refreshToken)).status).toBe(401);
  });
});
