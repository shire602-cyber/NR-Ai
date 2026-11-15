/**
 * W5-E MFA (R01-11, R17-19): TOTP enrolment with encrypted secret, login second step with a
 * short-lived pending token that API routes refuse, single-use TOTP and recovery codes,
 * per-company MFA policy enforcement, and step-up for sensitive actions.
 *
 * TOTP codes are generated for explicit time steps; `freezeTime` moves the server clock so
 * every verification uses a fresh (strictly increasing) step.
 */
import { afterEach, describe, expect, it } from "vitest";
import { generateSync } from "otplib";
import { freezeTime, useHarness, type Tenant } from "./harness";

const h = useHarness();

let restoreTime: (() => void) | null = null;
afterEach(() => {
  restoreTime?.();
  restoreTime = null;
});

/** Move the (server + test) clock to `base + steps * 30s` and return the TOTP for then. */
function codeAt(secret: string, base: number, steps: number): string {
  restoreTime?.();
  const at = base + steps * 30_000;
  restoreTime = freezeTime(at);
  return generateSync({ secret, epoch: Math.floor(at / 1000) });
}

async function enrol(t: Tenant, base: number): Promise<{ secret: string; recoveryCodes: string[] }> {
  const start = await t.as.post("/api/auth/mfa/enroll", {});
  expect(start.status, start.text).toBe(200);
  expect(start.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
  expect(start.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
  const secret = start.body.secret as string;
  const confirm = await t.as.post("/api/auth/mfa/enroll/confirm", { code: codeAt(secret, base, 0) });
  expect(confirm.status, confirm.text).toBe(200);
  return { secret, recoveryCodes: confirm.body.recoveryCodes };
}

describe("W5-E MFA enrolment", () => {
  it("[R01-11] enrol: wrong code refused, right code turns MFA on with 10 hashed recovery codes and an encrypted secret", async () => {
    const t = await h.createTenant({ name: "MfaEnrol" });
    const start = await t.as.post("/api/auth/mfa/enroll", {});
    expect(start.status).toBe(200);
    const bad = await t.as.post("/api/auth/mfa/enroll/confirm", { code: "000000" });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("MFA_CODE_INVALID");

    const base = Date.now();
    const ok = await t.as.post("/api/auth/mfa/enroll/confirm", {
      code: codeAt(start.body.secret, base, 0),
    });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.recoveryCodes).toHaveLength(10);

    const [row] = await h.sql(
      `SELECT mfa_enabled, mfa_secret_enc, mfa_pending_secret_enc FROM users WHERE id = $1`,
      [t.user.id]
    );
    expect(row.mfa_enabled).toBe(true);
    expect(row.mfa_secret_enc).toMatch(/^enc:v1:/);
    expect(row.mfa_secret_enc).not.toContain(start.body.secret);
    expect(row.mfa_pending_secret_enc).toBeNull();
    const codes = await h.sql(`SELECT code_hash FROM user_mfa_recovery_codes WHERE user_id = $1`, [
      t.user.id,
    ]);
    expect(codes).toHaveLength(10);
    expect(codes.map((c) => c.code_hash)).not.toContain(ok.body.recoveryCodes[0]);

    // The secret never leaves through generic user reads.
    const me = await t.as.get("/api/auth/me");
    expect(JSON.stringify(me.body)).not.toMatch(/mfa_secret|mfaSecret|enc:v1/);

    const events = await h.sql(`SELECT action FROM audit_logs WHERE user_id = $1`, [t.user.id]);
    expect(events.map((e) => e.action)).toContain("mfa.enrolled");
  });
});

describe("W5-E MFA login", () => {
  it("[R17-19] login requires the code; the pending token is refused by API routes; codes are single-use", async () => {
    const t = await h.createTenant({ name: "MfaLogin" });
    const base = Date.now();
    const { secret } = await enrol(t, base);

    const pw = await h.anon.post("/api/auth/login", { email: t.email, password: t.password });
    expect(pw.status).toBe(200);
    expect(pw.body.mfaRequired).toBe(true);
    expect(pw.body.token).toBeUndefined();
    expect(pw.headers.get("set-cookie") ?? "").not.toMatch(/muhasib-access=/);
    const mfaToken = pw.body.mfaToken as string;

    // The MFA-pending token is not an access token.
    const leak = await h.client(mfaToken).get(`/api/companies/${t.company.id}/accounts`);
    expect(leak.status).toBe(401);
    expect(leak.body.code).toBe("TOKEN_TYPE_INVALID");
    const me = await h.client(mfaToken).get("/api/auth/me");
    expect(me.status).toBe(401);

    const wrong = await h.anon.post("/api/auth/mfa/verify-login", { mfaToken, code: "123456" });
    expect(wrong.status).toBe(401);

    const code = codeAt(secret, base, 1);
    const ok = await h.anon.post("/api/auth/mfa/verify-login", { mfaToken, code });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.token).toBeTruthy();
    const accounts = await h.client(ok.body.token).get(`/api/companies/${t.company.id}/accounts`);
    expect(accounts.status).toBe(200);

    // Pending token is single-use; the same TOTP code cannot be replayed.
    const replayToken = await h.anon.post("/api/auth/mfa/verify-login", { mfaToken, code });
    expect(replayToken.status).toBe(401);
    expect(replayToken.body.code).toBe("MFA_TOKEN_INVALID");
    const pw2 = await h.anon.post("/api/auth/login", { email: t.email, password: t.password });
    const replayCode = await h.anon.post("/api/auth/mfa/verify-login", {
      mfaToken: pw2.body.mfaToken,
      code,
    });
    expect(replayCode.status).toBe(401);
    expect(replayCode.body.code).toBe("MFA_CODE_REUSED");

    const actions = (
      await h.sql(`SELECT action FROM audit_logs WHERE user_id = $1 ORDER BY seq`, [t.user.id])
    ).map((r) => r.action);
    expect(actions).toContain("auth.login_success");
    expect(actions).toContain("auth.mfa_challenge_failed");
  });

  it("[R01-11] a recovery code signs in exactly once", async () => {
    const t = await h.createTenant({ name: "MfaRecovery" });
    const { recoveryCodes } = await enrol(t, Date.now());
    const login = async () =>
      (await h.anon.post("/api/auth/login", { email: t.email, password: t.password })).body
        .mfaToken as string;

    const first = await h.anon.post("/api/auth/mfa/verify-login", {
      mfaToken: await login(),
      code: recoveryCodes[0].toUpperCase(),
    });
    expect(first.status, first.text).toBe(200);
    expect(first.body.recoveryCodesRemaining).toBe(9);

    const second = await h.anon.post("/api/auth/mfa/verify-login", {
      mfaToken: await login(),
      code: recoveryCodes[0],
    });
    expect(second.status).toBe(401);
    expect(second.body.code).toBe("MFA_CODE_INVALID");
  });

  it("[R01-11] disabling MFA needs the password and a valid code", async () => {
    const t = await h.createTenant({ name: "MfaDisable" });
    const base = Date.now();
    const { secret } = await enrol(t, base);
    const noPw = await t.as.post("/api/auth/mfa/disable", {
      password: "wrong-password",
      code: codeAt(secret, base, 1),
    });
    expect(noPw.status).toBe(400);
    expect(noPw.body.code).toBe("CURRENT_PASSWORD_INVALID");
    const noCode = await t.as.post("/api/auth/mfa/disable", { password: t.password, code: "000000" });
    expect(noCode.status).toBe(400);
    const ok = await t.as.post("/api/auth/mfa/disable", {
      password: t.password,
      code: codeAt(secret, base, 2),
    });
    expect(ok.status, ok.text).toBe(200);
    const [row] = await h.sql(`SELECT mfa_enabled, mfa_secret_enc FROM users WHERE id = $1`, [
      t.user.id,
    ]);
    expect(row).toEqual({ mfa_enabled: false, mfa_secret_enc: null });
  });
});

describe("W5-E company MFA policy and step-up", () => {
  it("[R01-11] policy 'all' blocks an un-enrolled member on that company; the owner must enrol first", async () => {
    const owner = await h.createTenant({ name: "PolicyOwner" });
    const member = await h.createSecondTenant({ name: "PolicyMember" });
    await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'viewer')`, [
      owner.company.id,
      member.user.id,
    ]);

    const early = await owner.as.put(`/api/companies/${owner.company.id}/security/policy`, {
      requireMfa: "all",
    });
    expect(early.status).toBe(409);
    expect(early.body.code).toBe("MFA_ENROLL_FIRST");

    const base = Date.now();
    const { secret } = await enrol(owner, base);
    // The owner's original token carries no MFA time: the policy change needs step-up.
    const noStepUp = await owner.as.put(`/api/companies/${owner.company.id}/security/policy`, {
      requireMfa: "all",
    });
    expect(noStepUp.status).toBe(403);
    expect(noStepUp.body.code).toBe("MFA_STEP_UP_REQUIRED");
    const stepUp = await owner.as.post("/api/auth/mfa/step-up", { code: codeAt(secret, base, 1) });
    expect(stepUp.status, stepUp.text).toBe(200);
    const fresh = h.client(stepUp.body.token);
    const set = await fresh.put(`/api/companies/${owner.company.id}/security/policy`, {
      requireMfa: "all",
    });
    expect(set.status, set.text).toBe(200);

    const blocked = await member.as.get(`/api/companies/${owner.company.id}/accounts`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("MFA_ENROLLMENT_REQUIRED");
    // Their own company (no policy) and account routes stay reachable so they can enrol.
    const own = await member.as.get(`/api/companies/${member.company.id}/accounts`);
    expect(own.status).toBe(200);
    const overview = await member.as.get("/api/auth/security/overview");
    expect(overview.status).toBe(200);
    expect(overview.body.mfaRequiredByCompanies).toEqual([owner.company.id]);
    const loginAgain = await h.anon.post("/api/auth/login", {
      email: member.email,
      password: member.password,
    });
    expect(loginAgain.body.mfaEnrollmentRequired).toBe(true);

    // The owner cannot turn MFA off while the policy covers them.
    const off = await fresh.post("/api/auth/mfa/disable", {
      password: owner.password,
      code: codeAt(secret, base, 2),
    });
    expect(off.status).toBe(409);
    expect(off.body.code).toBe("MFA_REQUIRED_BY_POLICY");

    const audit = await h.sql(
      `SELECT details FROM audit_logs WHERE company_id = $1 AND action = 'security.policy_changed'`,
      [owner.company.id]
    );
    expect(JSON.parse(audit[0].details)).toMatchObject({
      before: { requireMfa: "none" },
      after: { requireMfa: "all" },
    });
  });

  it("[R17-19] step-up: a team role change needs a recent MFA verification", async () => {
    const owner = await h.createTenant({ name: "StepUp" });
    const other = await h.createSecondTenant({ name: "StepUpMember" });
    const [cu] = await h.sql(
      `INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'viewer') RETURNING id`,
      [owner.company.id, other.user.id]
    );
    // Without MFA enabled the action is allowed (nothing to step up with).
    const before = await owner.as.put(`/api/companies/${owner.company.id}/team/${cu.id}`, {
      role: "bookkeeper",
    });
    expect(before.status, before.text).toBe(200);

    const base = Date.now();
    const { secret } = await enrol(owner, base);
    const denied = await owner.as.put(`/api/companies/${owner.company.id}/team/${cu.id}`, {
      role: "accountant",
    });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("MFA_STEP_UP_REQUIRED");

    const stepUp = await owner.as.post("/api/auth/mfa/step-up", { code: codeAt(secret, base, 1) });
    expect(stepUp.status).toBe(200);
    const allowed = await h
      .client(stepUp.body.token)
      .put(`/api/companies/${owner.company.id}/team/${cu.id}`, { role: "accountant" });
    expect(allowed.status, allowed.text).toBe(200);

    // The step-up window expires.
    codeAt(secret, base, 40); // 20 minutes later
    const expired = await h
      .client(stepUp.body.token)
      .put(`/api/companies/${owner.company.id}/team/${cu.id}`, { role: "viewer" });
    expect(expired.status).toBe(403);
    expect(expired.body.code).toBe("MFA_STEP_UP_REQUIRED");

    const events = await h.sql(
      `SELECT action FROM audit_logs WHERE company_id = $1 AND action = 'team.role_change'`,
      [owner.company.id]
    );
    expect(events).toHaveLength(2);
  });

  it("[R17-19] backup restore and API key creation are step-up protected", async () => {
    const owner = await h.createTenant({ name: "StepUpBackup", planId: "enterprise" });
    const base = Date.now();
    await enrol(owner, base);
    const key = await owner.as.post(`/api/companies/${owner.company.id}/api-keys`, { name: "k" });
    expect(key.status).toBe(403);
    expect(key.body.code).toBe("MFA_STEP_UP_REQUIRED");
    const restore = await owner.as.post(`/api/backups/00000000-0000-4000-8000-000000000000/restore`, {
      confirmRestore: true,
    });
    expect([403, 404]).toContain(restore.status);
    if (restore.status === 403) expect(restore.body.code).toBe("MFA_STEP_UP_REQUIRED");
  });
});
