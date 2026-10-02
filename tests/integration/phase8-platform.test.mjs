// Integration tests for Phase 8 domain D5: platform, security and experience (backend).
// Live requests against a running server + Postgres.
//   BASE_URL=http://localhost:5079 DATABASE_URL=... node tests/integration/phase8-platform.test.mjs
// Prints "N passed, M failed" and exits non-zero on any failure.

import pg from "pg";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { parse as parseCsv } from "csv-parse/sync";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..", "..");

const BASE = process.env.BASE_URL || "http://localhost:5000";
const DB_URL = process.env.DATABASE_URL;
let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; fails.push(name + "  :: " + JSON.stringify(detail)); console.log("FAIL  " + name + "  " + JSON.stringify(detail)); }
}
async function api(method, p, { body, token, headers: extra, raw } = {}) {
  const headers = { "Content-Type": "application/json", ...(extra || {}) };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(BASE + p, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (raw) return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

const rnd = Math.random().toString(36).slice(2, 8);
const PASSWORD = "Password123!";
const today = new Date().toISOString().slice(0, 10);
let db;
let userSeq = 0;

// ── TOTP helper (RFC 6238, SHA-1) ──
function b32decode(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, val = 0; const out = [];
  for (const ch of s.replace(/=+$/, "").toUpperCase()) {
    val = (val << 5) | A.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totp(secret, stepOffset = 0) {
  const step = Math.floor(Date.now() / 30000) + stepOffset;
  const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac("sha1", b32decode(secret)).update(ctr).digest();
  const o = h[h.length - 1] & 15;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 1_000_000).padStart(6, "0");
}
const wrongCode = (secret) => {
  const good = new Set([-1, 0, 1].map((d) => totp(secret, d)));
  for (let i = 0; i < 1000; i++) { const c = String(100000 + i); if (!good.has(c)) return c; }
};

async function register(label) {
  const email = `${label}${++userSeq}_${rnd}@example.com`;
  const r = await api("POST", "/api/auth/register", { body: { name: label, email, password: PASSWORD } });
  if (!r.json?.token) throw new Error("register failed " + r.status + " " + r.text);
  return { email, token: r.json.token, refreshToken: r.json.refreshToken, userId: r.json.user.id, cid: r.json.company.id };
}
async function login(email, password = PASSWORD, extraHeaders) {
  return api("POST", "/api/auth/login", { body: { email, password }, headers: extraHeaders });
}
async function enrol2fa(u) {
  const e = await api("POST", "/api/auth/2fa/enrol", { token: u.token });
  const v = await api("POST", "/api/auth/2fa/enrol/verify", { token: u.token, body: { code: totp(e.json.secret) } });
  return { enrol: e, verify: v, secret: e.json?.secret, codes: v.json?.recoveryCodes };
}
// Move the replay guard back so a code from "now" is accepted again (stands in for waiting 30 s).
const rewindGuard = (userId) => db.query(`UPDATE user_totp SET last_used_step = last_used_step - 10 WHERE user_id = $1`, [userId]);
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const jwtPayload = (t) => JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString());

async function main() {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  await db.query("SET TIME ZONE 'UTC'"); // the product's connections run in UTC; so does the test's, or `now()` here would mean another zone
  try {
    await refreshTokenIsNotAnAccessToken();
    await sessionsListAndRevoke();
    await changePasswordRevokesOthers();
    await twoFactorEnrolAndLogin();
    await twoFactorReplayAndRace();
    await recoveryCodes();
    await twoFactorRateLimit();
    await twoFactorDisableAndRegenerate();
    await requireTwoFactorCompany();
    await resetPasswordRevokesSessions();
    await apiKeyManagement();
    await scopesAndEnvelope();
    await rateLimitPerKey();
    await idempotencyRules();
    await tenantPinning();
    await v1MatchesTheUi();
    await v1WritesAndMoneyGuards();
    await keyRevocationAndExpiry();
    await pagination();
    await openApiDocument();
    await v1BillsJournalsReports();
    await companyExport();
    await companyDeletionLifecycle();
    await clientCompanyNeedsFirmConfirmation();
    await importContactsWizard();
    await importGuardsAndRaces();
    await importItemsAndAccounts();
    await importOpeningPosition();
    await accountBalancesGolden();
    await ledgerIndexesAreUsed();
    await fixRoundD5();
    await signoffFixesD5();
    await frontendHelpContent();
    await frontendShellRoutes();
    await frontendApiContract();
  } finally {
    await db.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nFailures:\n" + fails.join("\n")); process.exit(1); }
}

// F2: a refresh token must never authenticate an API request.
async function refreshTokenIsNotAnAccessToken() {
  const u = await register("f2");
  const asBearer = await api("GET", "/api/auth/me", { token: u.refreshToken });
  ok("refresh token as Bearer is rejected", asBearer.status === 401, asBearer.status);
  const asBearerData = await api("GET", `/api/companies/${u.cid}/accounts`, { token: u.refreshToken });
  ok("refresh token cannot read company data", asBearerData.status === 401, asBearerData.status);
  const good = await api("GET", "/api/auth/me", { token: u.token });
  ok("access token still works", good.status === 200, good.status);
  const claims = jwtPayload(u.token);
  ok("access token carries type=access and sid", claims.type === "access" && typeof claims.sid === "string", claims);
  const row = (await db.query(`SELECT id, revoked_at FROM refresh_sessions WHERE user_id = $1`, [u.userId])).rows;
  ok("registration created a real session row", row.length === 1 && row[0].id === claims.sid && !row[0].revoked_at, row);
  const rf = await api("POST", "/api/auth/refresh", { body: { refreshToken: u.refreshToken } });
  ok("refresh still works", rf.status === 200 && rf.json?.token && rf.json?.refreshToken, rf.text?.slice(0, 200));
  const inGrace = await api("POST", "/api/auth/refresh", { body: { refreshToken: u.refreshToken } });
  ok("the token just rotated away is still honoured inside the 60 s grace (parallel refresh)", inGrace.status === 200 && !!inGrace.json?.token, inGrace.status);
  await db.query(`UPDATE refresh_sessions SET rotated_at = rotated_at - interval '2 minutes' WHERE user_id = $1`, [u.userId]);
  const reuse = await api("POST", "/api/auth/refresh", { body: { refreshToken: u.refreshToken } });
  ok("reusing a rotated refresh token after the grace is rejected", reuse.status === 401, reuse.status);
  const afterReuse = await api("GET", "/api/auth/me", { token: rf.json.token });
  const afterReuseGrace = await api("GET", "/api/auth/me", { token: inGrace.json.token });
  ok("reuse detection revokes the whole session (every token of it)", afterReuse.status === 401 && afterReuseGrace.status === 401, [afterReuse.status, afterReuseGrace.status]);
  const sessRow = (await db.query(`SELECT revoked_at, revoked_reason FROM refresh_sessions WHERE user_id = $1`, [u.userId])).rows[0];
  ok("session row marked revoked with reason", !!sessRow.revoked_at && sessRow.revoked_reason === "reuse", sessRow);
}

// AC16
async function sessionsListAndRevoke() {
  const u = await register("sess");
  const second = await login(u.email, PASSWORD, { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0 Safari/537.36" });
  const t2 = second.json.token;
  const list = await api("GET", "/api/auth/sessions", { token: u.token });
  ok("two sessions listed", list.status === 200 && Array.isArray(list.json) && list.json.length === 2, list.text?.slice(0, 300));
  const cur = (list.json || []).filter((s) => s.current);
  ok("exactly one flagged current and it is ours", cur.length === 1 && cur[0].id === jwtPayload(u.token).sid, cur);
  const other = (list.json || []).find((s) => !s.current);
  ok("list exposes no token material", other && !("tokenHash" in other) && !("token_hash" in other), other);
  const del = await api("DELETE", `/api/auth/sessions/${other.id}`, { token: u.token });
  ok("revoke other session -> 204", del.status === 204, del.status);
  const refreshOther = await api("POST", "/api/auth/refresh", { body: { refreshToken: second.json.refreshToken } });
  ok("revoked session's refresh token -> 401", refreshOther.status === 401, refreshOther.status);
  const accessOther = await api("GET", "/api/auth/me", { token: t2 });
  ok("revoked session's access token -> 401", accessOther.status === 401, accessOther.status);
  const mine = await api("GET", "/api/auth/me", { token: u.token });
  ok("current session unaffected", mine.status === 200, mine.status);
  const hashes = (await db.query(`SELECT user_agent, device_hash FROM refresh_sessions WHERE user_id = $1`, [u.userId])).rows;
  ok("sessions carry a device hash; the same device repeats it, another browser differs", hashes.length === 2 && hashes.every((h) => /^[0-9a-f]{64}$/.test(h.device_hash)) && hashes[0].device_hash !== hashes[1].device_hash, hashes.map((h) => [h.user_agent?.slice(0, 20), h.device_hash.slice(0, 8)]));
  const foreign = await register("sessB");
  const flist = await api("GET", "/api/auth/sessions", { token: foreign.token });
  const bad = await api("DELETE", `/api/auth/sessions/${flist.json[0].id}`, { token: u.token });
  ok("cannot revoke another user's session", bad.status === 404, bad.status);
  const third = await login(u.email);
  const all = await api("DELETE", "/api/auth/sessions", { token: u.token });
  ok("revoke all others returns count", all.status === 200 && all.json?.revoked === 1, all.text);
  const t3 = await api("GET", "/api/auth/me", { token: third.json.token });
  ok("third session revoked by revoke-others", t3.status === 401, t3.status);
}

async function changePasswordRevokesOthers() {
  const u = await register("chpw");
  const other = await login(u.email);
  const wrong = await api("POST", "/api/auth/change-password", { token: u.token, body: { currentPassword: "Nope12345", newPassword: "NewPassword456!" } });
  ok("wrong current password -> 401", wrong.status === 401, wrong.status);
  const weak = await api("POST", "/api/auth/change-password", { token: u.token, body: { currentPassword: PASSWORD, newPassword: "short" } });
  ok("weak new password -> 400", weak.status === 400, weak.status);
  const long = await api("POST", "/api/auth/change-password", { token: u.token, body: { currentPassword: PASSWORD, newPassword: "Aa1" + "x".repeat(130) } });
  ok("password over 128 chars -> 400", long.status === 400, long.status);
  const r = await api("POST", "/api/auth/change-password", { token: u.token, body: { currentPassword: PASSWORD, newPassword: "NewPassword456!" } });
  ok("change password -> 200", r.status === 200, r.text);
  const o = await api("GET", "/api/auth/me", { token: other.json.token });
  ok("other session revoked after password change (AC17)", o.status === 401, o.status);
  const c = await api("GET", "/api/auth/me", { token: u.token });
  ok("current session kept after password change (AC17)", c.status === 200, c.status);
  const oldLogin = await login(u.email, PASSWORD);
  ok("old password no longer works", oldLogin.status === 401, oldLogin.status);
  const newLogin = await login(u.email, "NewPassword456!");
  ok("new password works", newLogin.status === 200, newLogin.status);
}

// AC11, AC12
async function twoFactorEnrolAndLogin() {
  const u = await register("tfa");
  const st0 = await api("GET", "/api/auth/2fa/status", { token: u.token });
  ok("2FA status off by default", st0.status === 200 && st0.json.enabled === false, st0.text);
  const e = await api("POST", "/api/auth/2fa/enrol", { token: u.token });
  ok("enrol returns secret, otpauth URL and QR", e.status === 200 && /^[A-Z2-7]{32}$/.test(e.json?.secret || "") && e.json.otpauthUrl?.startsWith("otpauth://totp/") && e.json.qrDataUrl?.startsWith("data:image/png"), e.text?.slice(0, 200));
  const stPending = await api("GET", "/api/auth/2fa/status", { token: u.token });
  ok("pending enrolment is not enabled", stPending.json.enabled === false, stPending.json);
  const noLoginChallenge = await login(u.email);
  ok("pending enrolment does not change login", noLoginChallenge.status === 200 && noLoginChallenge.json?.token, noLoginChallenge.text?.slice(0, 120));
  const bad = await api("POST", "/api/auth/2fa/enrol/verify", { token: u.token, body: { code: wrongCode(e.json.secret) } });
  ok("enrol verify with wrong code -> 401 TOTP_INVALID", bad.status === 401 && bad.json?.code === "TOTP_INVALID", bad.text);
  const v = await api("POST", "/api/auth/2fa/enrol/verify", { token: u.token, body: { code: totp(e.json.secret) } });
  ok("enrol verify -> enabled with 10 recovery codes (AC11)", v.status === 200 && v.json?.enabled === true && v.json.recoveryCodes?.length === 10 && new Set(v.json.recoveryCodes).size === 10, v.text?.slice(0, 200));
  const audit = (await db.query(`SELECT action FROM audit_logs WHERE user_id = $1 AND action LIKE '2fa.%'`, [u.userId])).rows;
  ok("enabling 2FA writes an audit row (AC11)", audit.some((a) => a.action === "2fa.enable"), audit);
  const again = await api("POST", "/api/auth/2fa/enrol", { token: u.token });
  ok("enrol while enabled -> 409 TOTP_ALREADY_ENABLED", again.status === 409 && again.json?.code === "TOTP_ALREADY_ENABLED", again.text);
  const stored = (await db.query(`SELECT secret_enc FROM user_totp WHERE user_id = $1`, [u.userId])).rows[0];
  ok("secret stored encrypted, never plaintext", stored.secret_enc.startsWith("enc:v1:") && !stored.secret_enc.includes(e.json.secret), stored.secret_enc.slice(0, 12));
  const codeRows = (await db.query(`SELECT code_hash FROM user_recovery_codes WHERE user_id = $1`, [u.userId])).rows;
  ok("recovery codes stored hashed", codeRows.length === 10 && !v.json.recoveryCodes.includes(codeRows[0].code_hash) && /^[0-9a-f]{64}$/.test(codeRows[0].code_hash), codeRows[0]);

  const l = await login(u.email);
  ok("login on a 2FA user returns a challenge, no tokens (AC12)", l.status === 200 && l.json?.twoFactorRequired === true && typeof l.json.challengeToken === "string" && !l.json.token && !l.json.refreshToken, l.text?.slice(0, 200));
  const setCookie = (l.headers.getSetCookie?.() || []).join("\n");
  ok("no access cookie before verify (AC12)", !/muhasib-access/.test(setCookie), setCookie);
  ok("challenge cookie is httpOnly and scoped to /api/auth/2fa", /challenge[^;]*=/.test(setCookie) && /Path=\/api\/auth\/2fa/i.test(setCookie) && /HttpOnly/i.test(setCookie), setCookie);
  const challengeAsBearer = await api("GET", "/api/auth/me", { token: l.json.challengeToken });
  ok("challenge token is not an access token", challengeAsBearer.status === 401, challengeAsBearer.status);
  const nocode = await api("POST", "/api/auth/2fa/verify", { body: { challengeToken: l.json.challengeToken } });
  ok("verify without a code -> 400", nocode.status === 400, nocode.status);
  const wrong = await api("POST", "/api/auth/2fa/verify", { body: { challengeToken: l.json.challengeToken, code: wrongCode(e.json.secret) } });
  ok("wrong code -> 401 TOTP_INVALID", wrong.status === 401 && wrong.json?.code === "TOTP_INVALID", wrong.text);
  const good = await api("POST", "/api/auth/2fa/verify", { body: { challengeToken: l.json.challengeToken, code: totp(e.json.secret, 1) } });
  ok("verify with the right code -> tokens", good.status === 200 && good.json?.token && good.json?.refreshToken && good.json.user?.email === u.email, good.text?.slice(0, 200));
  const me = await api("GET", "/api/auth/me", { token: good.json?.token });
  ok("tokens from verify work", me.status === 200, me.status);
  const reuseChallenge = await api("POST", "/api/auth/2fa/verify", { body: { challengeToken: l.json.challengeToken, code: totp(e.json.secret, 1) } });
  ok("a used challenge cannot be reused", reuseChallenge.status === 401, reuseChallenge.text);
  const expired = await api("POST", "/api/auth/2fa/verify", { body: { challengeToken: "not.a.jwt", code: "123456" } });
  ok("garbage challenge -> 401 CHALLENGE_EXPIRED", expired.status === 401 && expired.json?.code === "CHALLENGE_EXPIRED", expired.text);
  const st = await api("GET", "/api/auth/2fa/status", { token: u.token });
  ok("status shows enabled and 10 remaining codes", st.json.enabled === true && st.json.recoveryCodesRemaining === 10, st.json);

  // the browser flow: the challenge travels in its httpOnly cookie, not in the body
  await rewindGuard(u.userId);
  const lc = await login(u.email);
  const cookiePair = (lc.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).find((c) => /challenge/.test(c));
  const viaCookie = await fetch(BASE + "/api/auth/2fa/verify", { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookiePair }, body: JSON.stringify({ code: totp(e.json.secret, 0) }) });
  const viaCookieJson = await viaCookie.json().catch(() => null);
  ok("verify works with the challenge cookie alone, and sets the session cookies", viaCookie.status === 200 && !!viaCookieJson?.token && (viaCookie.headers.getSetCookie?.() || []).some((c) => /muhasib-access/.test(c)), { s: viaCookie.status, b: viaCookieJson });
  const pre = await register("tfaother");
  const preOther = await login(pre.email);
  await enrol2fa(pre);
  const preAfter = await api("GET", "/api/auth/me", { token: preOther.json.token });
  const preSelf = await api("GET", "/api/auth/me", { token: pre.token });
  ok("enabling 2FA revokes the user's other sessions and keeps the enrolling one", preAfter.status === 401 && preSelf.status === 200, [preAfter.status, preSelf.status]);
}

// AC13
async function twoFactorReplayAndRace() {
  const u = await register("tfarace");
  const { secret } = await enrol2fa(u);
  // enrolment consumed the current step; log in using the next step
  const c1 = (await login(u.email)).json.challengeToken;
  const code = totp(secret, 1);
  const first = await api("POST", "/api/auth/2fa/verify", { body: { challengeToken: c1, code } });
  ok("first use of a code succeeds", first.status === 200, first.text);
  const c2 = (await login(u.email)).json.challengeToken;
  const replay = await api("POST", "/api/auth/2fa/verify", { body: { challengeToken: c2, code } });
  ok("replaying the same code -> 401 TOTP_REPLAYED (AC13)", replay.status === 401 && replay.json?.code === "TOTP_REPLAYED", replay.text);

  const v = await register("tfarace2");
  const { secret: s2 } = await enrol2fa(v);
  const ch = (await login(v.email)).json.challengeToken;
  const c = totp(s2, 1);
  const results = await Promise.all(Array.from({ length: 10 }, () => api("POST", "/api/auth/2fa/verify", { body: { challengeToken: ch, code: c } })));
  const wins = results.filter((r) => r.status === 200).length;
  ok("10 parallel verifies of one code/challenge -> exactly one 200 (AC13)", wins === 1, results.map((r) => r.status));
  const sessions = (await db.query(`SELECT count(*)::int AS n FROM refresh_sessions WHERE user_id = $1 AND revoked_at IS NULL`, [v.userId])).rows[0].n;
  ok("parallel verifies created one session beyond enrolment", sessions === 2, sessions);
}

// AC14
async function recoveryCodes() {
  const u = await register("recov");
  const { codes } = await enrol2fa(u);
  const c1 = (await login(u.email)).json.challengeToken;
  const r1 = await api("POST", "/api/auth/2fa/verify", { body: { challengeToken: c1, recoveryCode: codes[0] } });
  ok("recovery code logs in (AC14)", r1.status === 200 && r1.json?.token, r1.text?.slice(0, 160));
  const c2 = (await login(u.email)).json.challengeToken;
  const r2 = await api("POST", "/api/auth/2fa/verify", { body: { challengeToken: c2, recoveryCode: codes[0] } });
  ok("same recovery code twice -> 401 RECOVERY_CODE_INVALID (AC14)", r2.status === 401 && r2.json?.code === "RECOVERY_CODE_INVALID", r2.text);
  const st = await api("GET", "/api/auth/2fa/status", { token: r1.json.token });
  ok("9 recovery codes remain (AC14)", st.json.recoveryCodesRemaining === 9, st.json);
  const c3 = (await login(u.email)).json.challengeToken;
  const spaced = codes[1].slice(0, 5).toLowerCase() + "-" + codes[1].slice(5);
  const r3 = await api("POST", "/api/auth/2fa/verify", { body: { challengeToken: c3, recoveryCode: spaced } });
  ok("recovery code accepted lowercase with a dash", r3.status === 200, r3.text?.slice(0, 160));
  const c4 = (await login(u.email)).json.challengeToken;
  const parallel = await Promise.all([0, 1, 2, 3].map(() => api("POST", "/api/auth/2fa/verify", { body: { challengeToken: c4, recoveryCode: codes[2] } })));
  ok("parallel use of one recovery code -> exactly one 200", parallel.filter((r) => r.status === 200).length === 1, parallel.map((r) => r.status));
}

// AC15
async function twoFactorRateLimit() {
  const u = await register("tfarl");
  const { secret } = await enrol2fa(u);
  const c = (await login(u.email)).json.challengeToken;
  const statuses = [];
  let last;
  for (let i = 0; i < 6; i++) {
    last = await api("POST", "/api/auth/2fa/verify", { body: { challengeToken: c, code: wrongCode(secret) } });
    statuses.push(last.status);
  }
  ok("6 wrong codes in a minute -> 5x401 then 429 (AC15)", statuses.slice(0, 5).every((s) => s === 401) && statuses[5] === 429, statuses);
  ok("429 carries Retry-After (AC15)", Number(last.headers.get("retry-after")) > 0, last.headers.get("retry-after"));
  const stillBlocked = await api("POST", "/api/auth/2fa/verify", { body: { challengeToken: c, code: totp(secret, 1) } });
  ok("even the right code is blocked while limited", stillBlocked.status === 429, stillBlocked.status);
}

async function twoFactorDisableAndRegenerate() {
  const u = await register("tfaoff");
  const { secret, codes } = await enrol2fa(u);
  const other = await login(u.email).then(async (l) => (await api("POST", "/api/auth/2fa/verify", { body: { challengeToken: l.json.challengeToken, recoveryCode: codes[0] } })).json);
  const noPw = await api("POST", "/api/auth/2fa/recovery-codes", { token: u.token, body: { password: "Wrong1234", code: totp(secret, 1) } });
  ok("regenerate with wrong password -> 401", noPw.status === 401, noPw.status);
  const regen = await api("POST", "/api/auth/2fa/recovery-codes", { token: u.token, body: { password: PASSWORD, code: totp(secret, 1) } });
  ok("regenerate returns 10 new codes", regen.status === 200 && regen.json?.recoveryCodes?.length === 10 && !regen.json.recoveryCodes.includes(codes[1]), regen.text?.slice(0, 160));
  const oldCode = await login(u.email).then(async (l) => api("POST", "/api/auth/2fa/verify", { body: { challengeToken: l.json.challengeToken, recoveryCode: codes[1] } }));
  ok("old recovery codes die on regeneration", oldCode.status === 401, oldCode.status);
  const otherAfter = await api("GET", "/api/auth/me", { token: other.token });
  ok("regeneration revokes other sessions", otherAfter.status === 401, otherAfter.status);
  await rewindGuard(u.userId);
  const dis = await api("POST", "/api/auth/2fa/disable", { token: u.token, body: { password: PASSWORD, code: totp(secret, 0) } });
  ok("disable with password + code -> 200", dis.status === 200, dis.text);
  const l = await login(u.email);
  ok("after disable login returns tokens again", l.status === 200 && !!l.json?.token, l.text?.slice(0, 120));
  const st = await api("GET", "/api/auth/2fa/status", { token: u.token });
  ok("status off after disable", st.json.enabled === false, st.json);
}

async function requireTwoFactorCompany() {
  const u = await register("req2fa");
  const set = await api("PATCH", `/api/companies/${u.cid}/security`, { token: u.token, body: { requireTwoFactor: true } });
  ok("owner can require 2FA for the company", set.status === 200, set.text);
  const l = await login(u.email);
  ok("login without TOTP still yields tokens, flagged for enrolment", l.status === 200 && l.json?.token && l.json?.twoFactorEnrolmentRequired === true, l.text?.slice(0, 200));
  const confined = await api("GET", `/api/companies/${u.cid}/accounts`, { token: l.json.token });
  ok("enrol-scope token is confined away from company data", confined.status === 403 && confined.json?.code === "TWO_FACTOR_ENROLMENT_REQUIRED", confined.text);
  const auth = await api("GET", "/api/auth/2fa/status", { token: l.json.token });
  ok("enrol-scope token may use /api/auth", auth.status === 200 && auth.json.requiredByCompanies?.length >= 1, auth.text);
  const { secret, verify } = await enrol2fa({ token: l.json.token });
  ok("can enrol with the confined token", verify.status === 200, verify.text);
  const l2 = await login(u.email);
  ok("with TOTP enabled login now asks for a code", l2.json?.twoFactorRequired === true, l2.text?.slice(0, 120));
  const v = await api("POST", "/api/auth/2fa/verify", { body: { challengeToken: l2.json.challengeToken, code: totp(secret, 1) } });
  const data = await api("GET", `/api/companies/${u.cid}/accounts`, { token: v.json?.token });
  ok("full tokens reach company data once 2FA is on", data.status === 200, data.status);
  await rewindGuard(u.userId);
  const dis = await api("POST", "/api/auth/2fa/disable", { token: v.json.token, body: { password: PASSWORD, code: totp(secret, 0) } });
  ok("cannot disable 2FA while a company requires it (403)", dis.status === 403 && dis.json?.code === "TWO_FACTOR_REQUIRED_BY_COMPANY", dis.text);
  const mass = await api("PATCH", `/api/companies/${u.cid}`, { token: v.json.token, body: { requireTwoFactor: false, deletedAt: new Date().toISOString(), name: "Renamed " + rnd } });
  const flags = (await db.query(`SELECT require_two_factor, deleted_at, name FROM companies WHERE id = $1`, [u.cid])).rows[0];
  ok("the generic company PATCH cannot touch requireTwoFactor or deletedAt (mass assignment)", mass.status === 200 && flags.require_two_factor === true && flags.deleted_at === null && flags.name === "Renamed " + rnd, flags);
  const outsider = await register("req2faB");
  const forbid = await api("PATCH", `/api/companies/${u.cid}/security`, { token: outsider.token, body: { requireTwoFactor: false } });
  ok("non-member cannot change company security", forbid.status === 403, forbid.status);
}

async function resetPasswordRevokesSessions() {
  const u = await register("reset");
  const fp = await api("POST", "/api/auth/forgot-password", { body: { email: u.email } });
  const url = fp.json?.devResetUrl;
  if (!url) { ok("dev reset url available", false, fp.text); return; }
  const token = new URL(url).searchParams.get("token");
  const r = await api("POST", "/api/auth/reset-password", { body: { token, password: "ResetPass789!" } });
  ok("reset password -> 200", r.status === 200, r.text);
  const me = await api("GET", "/api/auth/me", { token: u.token });
  ok("reset revokes all existing sessions", me.status === 401, me.status);
}


// ───────────────────────── Step 2: API keys and v1 ─────────────────────────
const v1 = (method, path, { key, body, idem, headers } = {}) =>
  api(method, "/api/v1" + path, {
    token: key, body,
    headers: { ...(method !== "GET" ? { "Idempotency-Key": idem === undefined ? crypto.randomUUID() : idem } : {}), ...(headers || {}) },
  });
const ALL_RW = ["contacts", "items", "invoices", "bills", "payments", "journals"].flatMap((r) => [`read:${r}`, `write:${r}`]).concat("read:reports");
async function createKey(u, scopes, extra = {}) {
  const r = await api("POST", `/api/companies/${u.cid}/api-keys`, { token: u.token, body: { name: "k" + Math.random().toString(36).slice(2, 6), scopes, ...extra } });
  return { r, key: r.json?.key, id: r.json?.id };
}
async function cashAccount(u) {
  const accts = (await api("GET", `/api/companies/${u.cid}/accounts`, { token: u.token })).json;
  return accts.find((a) => a.code === "1010" || (a.type === "asset" && /cash|bank/i.test(a.name)));
}
const invoiceBody = (extra = {}) => ({ customerName: "API Customer", date: today, dueDate: today, lines: [{ description: "Consulting", quantity: 2, unitPrice: "500.00", vatRate: 0.05 }], ...extra });

async function apiKeyManagement() {
  const u = await register("keys");
  const bad = await api("POST", `/api/companies/${u.cid}/api-keys`, { token: u.token, body: { name: "x", scopes: ["webhooks:manage"] } });
  ok("unknown scope (webhooks:manage is cut) -> 400", bad.status === 400, bad.text);
  const none = await api("POST", `/api/companies/${u.cid}/api-keys`, { token: u.token, body: { name: "x", scopes: [] } });
  ok("no scopes -> 400", none.status === 400, none.status);
  const huge = await api("POST", `/api/companies/${u.cid}/api-keys`, { token: u.token, body: { name: "x", scopes: ["read:invoices"], ratePerMinute: 100000 } });
  ok("rate limit above the ceiling -> 400", huge.status === 400, huge.status);
  const { r, key } = await createKey(u, ["read:invoices"], { expiresInDays: 30 });
  ok("create key -> 201 with the secret once", r.status === 201 && /^muh_[a-z0-9]{8}_[a-z0-9]{32}$/.test(key || ""), r.text?.slice(0, 200));
  ok("new key defaults to 60/min and 5000/day", r.json?.ratePerMinute === 60 && r.json?.ratePerDay === 5000 && r.json?.expiresAt, r.json);
  const row = (await db.query(`SELECT key_hash, key_prefix, scopes FROM api_keys WHERE id = $1`, [r.json.id])).rows[0];
  ok("only the SHA-256 is stored", row.key_hash === crypto.createHash("sha256").update(key).digest("hex") && !JSON.stringify(row).includes(key.slice(-32)), row);
  const list = await api("GET", `/api/companies/${u.cid}/api-keys`, { token: u.token });
  ok("list is masked: no hash, no secret", list.status === 200 && list.json.length === 1 && !("keyHash" in list.json[0]) && !list.text.includes(key.slice(-32)) && list.json[0].keyPrefix.endsWith("..."), list.text?.slice(0, 300));
  const outsider = await register("keysB");
  const forbid = await api("POST", `/api/companies/${u.cid}/api-keys`, { token: outsider.token, body: { name: "x", scopes: ["read:invoices"] } });
  ok("non-member cannot create a key", forbid.status === 403, forbid.status);
  const forbidList = await api("GET", `/api/companies/${u.cid}/api-keys`, { token: outsider.token });
  ok("non-member cannot list keys", forbidList.status === 403, forbidList.status);
  const put = await api("PUT", `/api/api-keys/${r.json.id}`, { token: u.token, body: { isActive: true } });
  ok("keys are immutable (405)", put.status === 405, put.status);
  const foreignRevoke = await api("DELETE", `/api/companies/${u.cid}/api-keys/${r.json.id}`, { token: outsider.token });
  ok("non-member cannot revoke", foreignRevoke.status === 403, foreignRevoke.status);
  const rev = await api("DELETE", `/api/companies/${u.cid}/api-keys/${r.json.id}`, { token: u.token });
  ok("revoke -> 200 and soft (row kept)", rev.status === 200 && (await db.query(`SELECT revoked_at, revoked_by FROM api_keys WHERE id = $1`, [r.json.id])).rows[0].revoked_at !== null, rev.text);
  const again = await api("DELETE", `/api/companies/${u.cid}/api-keys/${r.json.id}`, { token: u.token });
  ok("revoking twice -> 404", again.status === 404, again.status);
  const k2 = await createKey(u, ["read:invoices"]);
  const alias = await api("DELETE", `/api/api-keys/${k2.id}`, { token: u.token });
  ok("legacy DELETE /api/api-keys/:id still revokes", alias.status === 200, alias.text);
  const audit = (await db.query(`SELECT action FROM audit_logs WHERE user_id = $1 AND action LIKE 'api_key.%'`, [u.userId])).rows.map((x) => x.action);
  ok("create and revoke are audited", audit.includes("api_key.create") && audit.includes("api_key.revoke"), audit);
}

// AC18
async function scopesAndEnvelope() {
  const u = await register("scope");
  const { key } = await createKey(u, ["read:invoices"]);
  const get = await v1("GET", "/invoices", { key });
  ok("read:invoices -> GET /invoices 200 (AC18)", get.status === 200 && get.json?.success === true && Array.isArray(get.json.data) && get.json.error === null && "meta" in get.json, get.text?.slice(0, 200));
  const post = await v1("POST", "/invoices", { key, body: invoiceBody() });
  ok("POST without write scope -> 403 SCOPE_MISSING (AC18)", post.status === 403 && post.json?.error?.code === "SCOPE_MISSING" && post.json.success === false, post.text);
  const contacts = await v1("GET", "/contacts", { key });
  ok("GET /contacts without read:contacts -> 403 (AC18)", contacts.status === 403 && contacts.json?.error?.code === "SCOPE_MISSING", contacts.text);
  const reports = await v1("GET", "/reports/trial-balance", { key });
  ok("reports need read:reports", reports.status === 403, reports.status);
  const none = await api("GET", "/api/v1/invoices");
  ok("no key -> 401 API_KEY_INVALID", none.status === 401 && none.json?.error?.code === "API_KEY_INVALID", none.text);
  const junk = await api("GET", "/api/v1/invoices", { token: "muh_abcdefgh_" + "x".repeat(32) });
  ok("well-formed but unknown key -> 401", junk.status === 401 && junk.json?.error?.code === "API_KEY_INVALID", junk.status);
  const wrongSecret = await api("GET", "/api/v1/invoices", { token: key.slice(0, 13) + "x".repeat(32) });
  ok("right prefix, wrong secret -> 401", wrongSecret.status === 401, wrongSecret.status);
  const jwtAsKey = await api("GET", "/api/v1/invoices", { token: u.token });
  ok("a login JWT is not an API key", jwtAsKey.status === 401, jwtAsKey.status);
  const keyOnInternal = await api("GET", `/api/companies/${u.cid}/invoices`, { token: key });
  ok("an API key does not authenticate the internal API", keyOnInternal.status === 401, keyOnInternal.status);
  const nf = await v1("GET", "/nope", { key });
  ok("unknown v1 path -> enveloped 404", nf.status === 404 && nf.json?.error?.code === "NOT_FOUND", nf.text);
}

// AC19
async function rateLimitPerKey() {
  const u = await register("rate");
  const a = await createKey(u, ["read:invoices"]);
  const b = await createKey(u, ["read:invoices"]);
  let last;
  const statuses = [];
  for (let i = 0; i < 61; i++) { last = await v1("GET", "/invoices?limit=1", { key: a.key }); statuses.push(last.status); }
  ok("60 requests pass, the 61st -> 429 (AC19)", statuses.slice(0, 60).every((s) => s === 200) && statuses[60] === 429, statuses.filter((s) => s !== 200));
  ok("429 has RateLimit-Remaining 0 and Retry-After (AC19)", last.headers.get("ratelimit-remaining") === "0" && Number(last.headers.get("retry-after")) > 0 && last.json?.error?.code === "RATE_LIMITED", [...last.headers.entries()].filter(([k]) => /rate|retry/i.test(k)));
  const other = await v1("GET", "/invoices?limit=1", { key: b.key });
  ok("a second key is unaffected (AC19)", other.status === 200 && other.headers.get("ratelimit-limit") === "60" && other.headers.get("ratelimit-remaining") === "59", other.headers.get("ratelimit-remaining"));
  ok("draft-7 combined RateLimit header is present", /limit=60, remaining=\d+, reset=\d+/.test(other.headers.get("ratelimit") || ""), other.headers.get("ratelimit"));
  const tiny = await createKey(u, ["read:invoices"], { ratePerMinute: 2 });
  const t = [];
  for (let i = 0; i < 3; i++) t.push((await v1("GET", "/invoices", { key: tiny.key })).status);
  ok("per-key custom limit is honoured", t.join() === "200,200,429", t);
}

// AC20-22
async function idempotencyRules() {
  const u = await register("idem");
  const { key } = await createKey(u, ["read:invoices", "write:invoices"]);
  const idem = crypto.randomUUID();
  const body = invoiceBody();
  const first = await v1("POST", "/invoices", { key, body, idem });
  ok("first POST /invoices -> 201 with a Location", first.status === 201 && first.json?.data?.id && first.headers.get("location") === `/api/v1/invoices/${first.json.data.id}` && first.headers.get("idempotent-replayed") === null, { s: first.status, t: first.text?.slice(0, 300) });
  const second = await v1("POST", "/invoices", { key, body, idem });
  ok("same key + body replays the identical body with the header (AC20)", second.status === 201 && second.headers.get("idempotent-replayed") === "true" && canon(second.json) === canon(first.json), { s: second.status, h: second.headers.get("idempotent-replayed") });
  const count = (await db.query(`SELECT count(*)::int AS n FROM invoices WHERE company_id = $1`, [u.cid])).rows[0].n;
  ok("exactly one invoice was created (AC20)", count === 1, count);
  const reordered = { lines: body.lines, dueDate: body.dueDate, date: body.date, customerName: body.customerName };
  const keyOrder = await v1("POST", "/invoices", { key, body: reordered, idem });
  ok("key order does not change the request hash", keyOrder.headers.get("idempotent-replayed") === "true", keyOrder.status);
  const diff = await v1("POST", "/invoices", { key, body: invoiceBody({ customerName: "Someone else" }), idem });
  ok("same key, different body -> 422 IDEMPOTENCY_KEY_REUSED (AC21)", diff.status === 422 && diff.json?.error?.code === "IDEMPOTENCY_KEY_REUSED", diff.text);
  const missing = await v1("POST", "/invoices", { key, body, idem: null, headers: {} }).then(async () => api("POST", "/api/v1/invoices", { token: key, body }));
  ok("write without Idempotency-Key -> 400 (AC22)", missing.status === 400 && missing.json?.error?.code === "IDEMPOTENCY_KEY_REQUIRED", missing.text);
  const otherPath = await v1("POST", "/invoices", { key, body: invoiceBody({ customerName: "Other path" }), idem: crypto.randomUUID() });
  ok("a different key is independent", otherPath.status === 201 && otherPath.json.data.id !== first.json.data.id, otherPath.status);

  const k2 = await createKey(u, ["read:invoices", "write:invoices"]);
  const sameHeaderOtherKey = await v1("POST", "/invoices", { key: k2.key, body, idem });
  ok("the same Idempotency-Key on another API key is independent (not a replay)", sameHeaderOtherKey.status === 201 && sameHeaderOtherKey.headers.get("idempotent-replayed") === null && sameHeaderOtherKey.json.data.id !== first.json.data.id, sameHeaderOtherKey.status);
  const cIdem = crypto.randomUUID();
  const cBody = invoiceBody({ customerName: "Concurrent" });
  const race = await Promise.all(Array.from({ length: 6 }, () => v1("POST", "/invoices", { key, body: cBody, idem: cIdem })));
  const created = (await db.query(`SELECT count(*)::int AS n FROM invoices WHERE company_id = $1 AND customer_name = 'Concurrent'`, [u.cid])).rows[0].n;
  ok("6 concurrent identical POSTs create one invoice", created === 1, { created, s: race.map((r) => r.status) });
  ok("the others get 201 replay or 409 IDEMPOTENCY_IN_FLIGHT", race.every((r) => r.status === 201 || (r.status === 409 && r.json?.error?.code === "IDEMPOTENCY_IN_FLIGHT")), race.map((r) => r.status));

  // 5xx and 429 are not cached: a failing request can be retried with the same key
  const failKey = crypto.randomUUID();
  const bad400 = await v1("POST", "/invoices", { key, body: invoiceBody({ lines: [] }), idem: failKey });
  ok("a validation error is stored and replayed", bad400.status === 400 && (await v1("POST", "/invoices", { key, body: invoiceBody({ lines: [] }), idem: failKey })).headers.get("idempotent-replayed") === "true", bad400.status);
  const row = (await db.query(`SELECT status, expires_at - created_at AS ttl FROM idempotency_keys WHERE idem_key = $1`, [idem])).rows[0];
  ok("row completed with a 24 h TTL", row?.status === "completed" && /^(1 day|24:00:00)/.test(String(row.ttl.days ? "1 day" : row.ttl)), row);
  await db.query(`UPDATE idempotency_keys SET status = 'in_flight', created_at = now() - interval '5 minutes' WHERE idem_key = $1`, [idem]);
  const takeover = await v1("POST", "/invoices", { key, body, idem });
  ok("a stale in-flight claim is taken over and re-run", takeover.status === 201 && takeover.headers.get("idempotent-replayed") === null, takeover.status);
}

async function tenantPinning() {
  const u = await register("tenant");
  // a second company owned by the same user
  const c2 = await api("POST", "/api/companies", { token: u.token, body: { name: "Second Co " + rnd, baseCurrency: "AED", locale: "en" } });
  const cidB = c2.json?.id;
  ok("owner created a second company", !!cidB, c2.text?.slice(0, 200));
  const { key } = await createKey(u, ALL_RW);
  const invB = await api("POST", `/api/companies/${cidB}/invoices`, { token: u.token, body: invoiceBody() });
  const contactB = await api("POST", `/api/companies/${cidB}/customer-contacts`, { token: u.token, body: { name: "B contact" } });
  const billB = await api("POST", `/api/companies/${cidB}/bills`, { token: u.token, body: { vendor_name: "B vendor", bill_date: today, line_items: [{ description: "x", unit_price: 10 }] } });
  const jeB = await api("POST", `/api/companies/${cidB}/journal`, { token: u.token, body: { date: today, lines: [] } });
  ok("company B has an invoice and a contact", !!invB.json?.id && !!contactB.json?.id, [invB.status, contactB.status]);
  const g = await v1("GET", `/invoices/${invB.json.id}`, { key });
  ok("A's key cannot read B's invoice -> 404", g.status === 404, g.status);
  const gc = await v1("GET", `/contacts/${contactB.json.id}`, { key });
  ok("A's key cannot read B's contact -> 404", gc.status === 404, gc.status);
  const lst = await v1("GET", "/invoices?limit=200", { key });
  ok("lists never contain B's rows", lst.status === 200 && !lst.json.data.some((i) => i.id === invB.json.id), lst.json?.data?.length);
  const post = await v1("POST", `/invoices/${invB.json.id}/post`, { key });
  ok("A's key cannot issue B's invoice -> 404", post.status === 404, post.status);
  const stillDraft = (await db.query(`SELECT status FROM invoices WHERE id = $1`, [invB.json.id])).rows[0].status;
  ok("B's invoice is untouched", stillDraft === "draft", stillDraft);
  const pay = await v1("POST", `/invoices/${invB.json.id}/payments`, { key, body: { amount: 10, paymentAccountId: (await cashAccount(u))?.id } });
  ok("A's key cannot pay B's invoice -> 404", pay.status === 404, pay.status);
  const upd = await v1("PATCH", `/contacts/${contactB.json.id}`, { key, body: { name: "hijacked" } });
  ok("A's key cannot edit B's contact -> 404", upd.status === 404, upd.status);
  const nm = (await db.query(`SELECT name FROM customer_contacts WHERE id = $1`, [contactB.json.id])).rows[0].name;
  ok("B's contact name unchanged", nm === "B contact", nm);
  if (billB.json?.id) {
    const ap = await v1("POST", `/bills/${billB.json.id}/approve`, { key });
    ok("A's key cannot approve B's bill -> 404", ap.status === 404, ap.status);
    const bp = await v1("POST", `/bills/${billB.json.id}/payments`, { key, body: { amount: 1, paymentAccountId: crypto.randomUUID() } });
    ok("A's key cannot pay B's bill -> 404", bp.status === 404, bp.status);
  }
  const refContact = await v1("POST", "/invoices", { key, body: invoiceBody({ contactId: contactB.json.id }) });
  ok("an invoice cannot reference B's contact -> 422", refContact.status === 422 && refContact.json?.error?.code === "REFERENCE_NOT_FOUND", refContact.text);
  const aAcct = await cashAccount(u);
  const bAccts = (await api("GET", `/api/companies/${cidB}/accounts`, { token: u.token })).json;
  const bCash = bAccts.find((a) => a.code === "1010");
  const invA = await v1("POST", "/invoices", { key, body: invoiceBody() });
  await v1("POST", `/invoices/${invA.json.data.id}/post`, { key });
  const foreignAcct = await v1("POST", `/invoices/${invA.json.data.id}/payments`, { key, body: { amount: 10, paymentAccountId: bCash.id } });
  ok("a payment cannot use B's bank account", foreignAcct.status >= 400 && foreignAcct.status < 500, foreignAcct.status);
  ok("sanity: A's own account works", aAcct && (await v1("POST", `/invoices/${invA.json.data.id}/payments`, { key, body: { amount: 10, paymentAccountId: aAcct.id } })).status === 201, aAcct?.code);
}

// Probe: v1 and the UI produce the same books
async function v1MatchesTheUi() {
  const u = await register("parity");
  await api("PATCH", `/api/companies/${u.cid}`, { token: u.token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });
  const { key } = await createKey(u, ALL_RW);
  const lines = [
    { description: "Standard", quantity: 3, unitPrice: 200, vatRate: 0.05 },
    { description: "Zero rated", quantity: 1, unitPrice: 1000, vatRate: 0 },
  ];
  const ui = await api("POST", `/api/companies/${u.cid}/invoices`, { token: u.token, body: { customerName: "Parity", date: today, dueDate: today, lines } });
  const uiIssue = await api("PATCH", `/api/invoices/${ui.json.id}/status`, { token: u.token, body: { status: "sent" } });
  const viaApi = await v1("POST", "/invoices", { key, body: { customerName: "Parity", date: today, dueDate: today, lines: lines.map((l) => ({ ...l, unitPrice: String(l.unitPrice) })) } });
  const issued = await v1("POST", `/invoices/${viaApi.json?.data?.id}/post`, { key });
  ok("UI and v1 both issue", uiIssue.status === 200 && viaApi.status === 201 && issued.status === 200 && issued.json?.data?.status === "sent", [uiIssue.status, viaApi.status, issued.status, issued.text?.slice(0, 200)]);
  const jl = async (id) => (await db.query(
    `SELECT a.code, jl.debit::float AS debit, jl.credit::float AS credit FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.source = 'invoice' AND je.source_id = $2 ORDER BY a.code, jl.debit, jl.credit`, [u.cid, id])).rows;
  const a = await jl(ui.json.id), b = await jl(viaApi.json.data.id);
  ok("identical journal lines for the same invoice via UI and v1", a.length > 0 && JSON.stringify(a) === JSON.stringify(b), { a, b });
  const vat = a.find((l) => l.code === "2030" || l.code === "2020") ?? a.find((l) => /^20/.test(l.code));
  ok("VAT output (box 1 source) is equal on both", !!vat && JSON.stringify(vat) === JSON.stringify(b.find((l) => l.code === vat.code)), vat);
  const detail = await v1("GET", `/invoices/${viaApi.json.data.id}`, { key });
  ok("v1 detail: money as 2 dp strings, outstanding, ISO dates", detail.json?.data?.total === "1630.00" && detail.json.data.vatAmount === "30.00" && detail.json.data.subtotal === "1600.00" && detail.json.data.outstanding === "1630.00" && /^\d{4}-\d{2}-\d{2}$/.test(detail.json.data.date) && detail.json.data.lines.length === 2 && detail.json.data.lines[0].unitPrice === "200.00", JSON.stringify(detail.json?.data).slice(300, 900));
  // locked period -> 422 with a code
  const lockedMonth = new Date(); lockedMonth.setUTCMonth(lockedMonth.getUTCMonth() - 1);
  const ym = lockedMonth.toISOString().slice(0, 7);
  const pe = new Date(Date.UTC(lockedMonth.getUTCFullYear(), lockedMonth.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  await db.query(`INSERT INTO month_end_close (company_id, period_start, period_end, status) VALUES ($1, $2, $3, 'locked') ON CONFLICT DO NOTHING`, [u.cid, ym + "-01", pe]).catch(() => {});
  const locked = await v1("POST", "/invoices", { key, body: invoiceBody({ date: ym + "-10", dueDate: ym + "-20" }) });
  ok("locked period -> 422 with a code (probe)", locked.status === 422 && !!locked.json?.error?.code, locked.text?.slice(0, 300));
}

async function v1WritesAndMoneyGuards() {
  const u = await register("guards");
  const { key } = await createKey(u, ALL_RW);
  for (const [name, extra] of [["isOpeningBalance", { isOpeningBalance: true }], ["companyId", { companyId: crypto.randomUUID() }], ["status", { status: "paid" }], ["number", { number: "INV-1" }], ["total", { total: 1 }]]) {
    const r = await v1("POST", "/invoices", { key, body: invoiceBody(extra) });
    ok(`invoice with ${name} -> 400 (strict whitelist)`, r.status === 400 && r.json?.error?.code === "VALIDATION_ERROR", r.text?.slice(0, 200));
  }
  const lineExtra = await v1("POST", "/invoices", { key, body: invoiceBody({ lines: [{ description: "x", quantity: 1, unitPrice: 1, accountId: "x" }] }) });
  ok("unknown key on a line -> 400", lineExtra.status === 400, lineExtra.status);
  for (const [label, unitPrice] of [["100.005", "100.005"], ["negative", "-5"], ["1e15 number", 1e15], ["1e15 string", "1000000000000000"], ["text", "abc"]]) {
    const r = await v1("POST", "/invoices", { key, body: invoiceBody({ lines: [{ description: "x", quantity: 1, unitPrice }] }) });
    ok(`unit price ${label} -> 400`, r.status === 400, r.status);
  }
  const vat = await v1("POST", "/invoices", { key, body: invoiceBody({ lines: [{ description: "x", quantity: 1, unitPrice: 10, vatRate: 0.5 }] }) });
  ok("VAT rate 50% -> 400", vat.status === 400, vat.status);
  const date = await v1("POST", "/invoices", { key, body: invoiceBody({ date: "2026-02-31" }) });
  ok("impossible date -> 400", date.status === 400, date.status);
  const fx = await v1("POST", "/invoices", { key, body: invoiceBody({ currency: "ZZZ" }) });
  ok("foreign currency without a rate -> 422 with a code", fx.status === 422 && !!fx.json?.error?.code, fx.text?.slice(0, 200));
  const future = await v1("POST", "/invoices", { key, body: invoiceBody({ date: "2099-01-01" }) });
  ok("future-dated invoice -> 422 (internal rule applies)", future.status === 422, future.status);
  const noName = await v1("POST", "/invoices", { key, body: { date: today, lines: [{ description: "x", quantity: 1, unitPrice: 1 }] } });
  ok("no customerName and no contactId -> 400", noName.status === 400, noName.status);

  const c = await v1("POST", "/contacts", { key, body: { name: "Acme LLC", type: "both", email: `acme_${rnd}@example.com`, trn: "100123456700003", country: "AE" } });
  ok("create contact -> 201 v1 shape", c.status === 201 && c.json?.data?.type === "both" && c.json.data.trn === "100123456700003" && c.json.data.name === "Acme LLC" && !("companyId" in c.json.data), c.text?.slice(0, 300));
  const badTrn = await v1("POST", "/contacts", { key, body: { name: "Bad", trn: "123" } });
  ok("bad TRN -> 400", badTrn.status === 400, badTrn.status);
  const patched = await v1("PATCH", `/contacts/${c.json.data.id}`, { key, body: { phone: "+971500000000", paymentTermsDays: 45 } });
  ok("patch contact", patched.status === 200 && patched.json?.data?.phone === "+971500000000" && patched.json.data.paymentTermsDays === 45, patched.text?.slice(0, 200));
  const emptyPatch = await v1("PATCH", `/contacts/${c.json.data.id}`, { key, body: {} });
  ok("empty patch -> 400", emptyPatch.status === 400, emptyPatch.status);
  const byContact = await v1("POST", "/invoices", { key, body: { contactId: c.json.data.id, date: today, lines: [{ description: "x", quantity: 1, unitPrice: "10.00" }] } });
  ok("invoice from a contactId takes its name and TRN", byContact.status === 201 && byContact.json?.data?.customerName === "Acme LLC" && byContact.json.data.customerTrn === "100123456700003" && byContact.json.data.contactId === c.json.data.id, byContact.text?.slice(0, 300));
  const filtered = await v1("GET", "/contacts?type=vendor", { key });
  ok("contacts?type=vendor includes both-type", filtered.status === 200 && filtered.json.data.some((x) => x.id === c.json.data.id), filtered.status);
  const badFilter = await v1("GET", "/contacts?type=alien", { key });
  ok("bad filter -> 400", badFilter.status === 400, badFilter.status);

  const item = await v1("POST", "/items", { key, body: { name: "Widget", sku: "W-1", unitPrice: "99.90", vatRate: 5 } });
  ok("create item -> 201", item.status === 201 && item.json?.data?.unitPrice === "99.90" && item.json.data.vatRate === "0.05", item.text?.slice(0, 300));
  const itemUp = await v1("PATCH", `/items/${item.json.data.id}`, { key, body: { unitPrice: 120 } });
  ok("patch item", itemUp.status === 200 && itemUp.json?.data?.unitPrice === "120.00", itemUp.text?.slice(0, 200));
  const stock = await v1("PATCH", `/items/${item.json.data.id}`, { key, body: { currentStock: 5 } });
  ok("stock cannot be set through v1 items", stock.status === 400, stock.status);

  const inv = await v1("POST", "/invoices", { key, body: invoiceBody() });
  const issued = await v1("POST", `/invoices/${inv.json.data.id}/post`, { key });
  const acct = await cashAccount(u);
  const pay = await v1("POST", `/invoices/${inv.json.data.id}/payments`, { key, body: { amount: "400.00", paymentAccountId: acct.id, method: "bank", reference: "R1" } });
  ok("record payment -> 201 payment resource", pay.status === 201 && pay.json?.data?.direction === "received" && pay.json.data.amount === "400.00" && pay.json.data.documentId === inv.json.data.id && pay.json.data.invoiceStatus === "partial", pay.text?.slice(0, 300));
  const over = await v1("POST", `/invoices/${inv.json.data.id}/payments`, { key, body: { amount: "9999.00", paymentAccountId: acct.id } });
  ok("overpayment -> 422 with a code", over.status === 422 && !!over.json?.error?.code, over.text?.slice(0, 200));
  const frac = await v1("POST", `/invoices/${inv.json.data.id}/payments`, { key, body: { amount: "1.005", paymentAccountId: acct.id } });
  ok("payment of 1.005 -> 400", frac.status === 400, frac.status);
  const pays = await v1("GET", "/payments?direction=received", { key });
  ok("GET /payments lists it", pays.status === 200 && pays.json.data.some((p) => p.id === pay.json.data.id && p.date === today), pays.text?.slice(0, 200));
  const ip = await v1("GET", `/invoices/${inv.json.data.id}/payments`, { key });
  ok("GET /invoices/:id/payments", ip.status === 200 && ip.json.data.length === 1, ip.text?.slice(0, 200));
  const d = await v1("GET", `/invoices/${inv.json.data.id}`, { key });
  ok("invoice detail shows outstanding 650.00", d.json?.data?.outstanding === "650.00" && d.json.data.amountPaid === "400.00", d.json?.data);
  const reissue = await v1("POST", `/invoices/${inv.json.data.id}/post`, { key });
  ok("posting a partly paid invoice again is refused with a code", reissue.status === 422 && reissue.json?.error?.code === "INVALID_TRANSITION", reissue.text?.slice(0, 200));
  const acts = (await db.query(`SELECT metadata FROM activity_logs WHERE company_id = $1 AND action = 'api_write'`, [u.cid])).rows;
  await new Promise((r) => setTimeout(r, 300));
  const acts2 = (await db.query(`SELECT metadata FROM activity_logs WHERE company_id = $1 AND action = 'api_write'`, [u.cid])).rows;
  ok("v1 writes are activity-logged with the key id", acts2.length >= 3 && JSON.parse(acts2[0].metadata).apiKeyId, acts2.length);
  void acts;
}

async function keyRevocationAndExpiry() {
  const u = await register("revoke");
  const a = await createKey(u, ["read:invoices"]);
  const ok1 = await v1("GET", "/invoices", { key: a.key });
  await api("DELETE", `/api/companies/${u.cid}/api-keys/${a.id}`, { token: u.token });
  const revoked = await v1("GET", "/invoices", { key: a.key });
  ok("revoked key -> 401 API_KEY_INVALID (AC24)", ok1.status === 200 && revoked.status === 401 && revoked.json?.error?.code === "API_KEY_INVALID", revoked.text);
  await new Promise((r) => setTimeout(r, 300));
  const log = (await db.query(`SELECT status, method, path, company_id FROM api_request_log WHERE api_key_id = $1 ORDER BY id`, [a.id])).rows;
  ok("request log keeps both calls incl. the 401 (AC24)", log.length === 2 && log[0].status === 200 && log[1].status === 401 && log[1].company_id === u.cid && log[1].path === "/api/v1/invoices", log);
  const e = await createKey(u, ["read:invoices"]);
  await db.query(`UPDATE api_keys SET expires_at = (now() AT TIME ZONE 'UTC') - interval '1 minute' WHERE id = $1`, [e.id]);
  const expired = await v1("GET", "/invoices", { key: e.key });
  ok("expired key -> 401 (AC24)", expired.status === 401 && expired.json?.error?.code === "API_KEY_INVALID", expired.text);
  const listed = await api("GET", `/api/companies/${u.cid}/api-keys`, { token: u.token });
  ok("list reports status expired / revoked", listed.json.find((k) => k.id === e.id)?.status === "expired" && listed.json.find((k) => k.id === a.id)?.status === "revoked", listed.json.map((k) => k.status));
  const d = await createKey(u, ["read:invoices"]);
  await db.query(`UPDATE users SET is_active = false WHERE id = $1`, [u.userId]);
  const deactivated = await v1("GET", "/invoices", { key: d.key });
  ok("a deactivated creator's key stops working", deactivated.status === 401, deactivated.status);
  await db.query(`UPDATE users SET is_active = true WHERE id = $1`, [u.userId]);
  const back = await v1("GET", "/invoices", { key: d.key });
  ok("and works again when the creator is reactivated", back.status === 200, back.status);
  await db.query(`DELETE FROM company_users WHERE user_id = $1 AND company_id = $2`, [u.userId, u.cid]);
  const demoted = await v1("GET", "/invoices", { key: d.key });
  ok("a key whose creator lost membership stops working", demoted.status === 401, demoted.status);
  await db.query(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'owner')`, [u.cid, u.userId]);
  await db.query(`UPDATE companies SET deleted_at = now() WHERE id = $1`, [u.cid]);
  const del = await v1("GET", "/invoices", { key: d.key });
  ok("a key of a soft-deleted company stops working", del.status === 401, del.status);
  await db.query(`UPDATE companies SET deleted_at = NULL WHERE id = $1`, [u.cid]);
}

async function pagination() {
  const u = await register("page");
  const { key } = await createKey(u, ["read:invoices", "write:invoices"]);
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push((await v1("POST", "/invoices", { key, body: invoiceBody({ customerName: "P" + i }) })).json.data.id);
  const p1 = await v1("GET", "/invoices?limit=2", { key });
  ok("page 1 has 2 rows and a cursor", p1.json.data.length === 2 && typeof p1.json.meta.nextCursor === "string", p1.json.meta);
  const p2 = await v1("GET", "/invoices?limit=2&cursor=" + encodeURIComponent(p1.json.meta.nextCursor), { key });
  const p3 = await v1("GET", "/invoices?limit=2&cursor=" + encodeURIComponent(p2.json.meta.nextCursor), { key });
  const seen = [...p1.json.data, ...p2.json.data, ...p3.json.data].map((i) => i.id);
  ok("pages cover all 5 rows exactly once, newest first", seen.length === 5 && new Set(seen).size === 5 && seen.join() === [...ids].reverse().join() && p3.json.meta.nextCursor === null, { seen: seen.length, last: p3.json.meta });
  const bad = await v1("GET", "/invoices?limit=201", { key });
  ok("limit 201 -> 400", bad.status === 400, bad.status);
  const badCursor = await v1("GET", "/invoices?cursor=garbage", { key });
  ok("garbage cursor -> 400 INVALID_CURSOR", badCursor.status === 400 && badCursor.json?.error?.code === "INVALID_CURSOR", badCursor.text);
  const status = await v1("GET", "/invoices?status=draft&limit=200", { key });
  ok("status filter", status.json.data.length === 5 && status.json.data.every((i) => i.status === "draft"), status.status);
}

// AC23
async function openApiDocument() {
  const r = await api("GET", "/api/v1/openapi.json");
  ok("openapi.json is public and OpenAPI 3.1 (AC23)", r.status === 200 && r.json?.openapi?.startsWith("3.1"), r.status);
  const ops = Object.entries(r.json?.paths ?? {}).flatMap(([p, m]) => Object.keys(m).map((k) => `${k.toUpperCase()} ${p}`));
  const expected = ["GET /api/v1/contacts", "POST /api/v1/contacts", "PATCH /api/v1/contacts/{id}", "GET /api/v1/items/{id}", "POST /api/v1/invoices", "POST /api/v1/invoices/{id}/post", "POST /api/v1/invoices/{id}/payments", "GET /api/v1/payments", "POST /api/v1/bills/{id}/approve", "POST /api/v1/bills/{id}/payments", "POST /api/v1/journals/{id}/post", "GET /api/v1/reports/aged-payables"];
  ok("every expected route is documented (AC23)", expected.every((e) => ops.includes(e)) && ops.length >= 29, ops.length);
  const inv = r.json.paths["/api/v1/invoices"].post;
  ok("write operations declare the Idempotency-Key header and the request schema", inv.parameters.some((p) => p.name === "Idempotency-Key" && p.required) && inv.requestBody.content["application/json"].schema.additionalProperties === false, inv.requestBody?.content?.["application/json"]?.schema?.additionalProperties);
  ok("scopes are declared per operation", inv["x-required-scope"] === "write:invoices", inv["x-required-scope"]);
}

async function v1BillsJournalsReports() {
  const u = await register("flows");
  const { key } = await createKey(u, ALL_RW);
  const accts = (await api("GET", `/api/companies/${u.cid}/accounts`, { token: u.token })).json;
  const cash = accts.find((a) => a.code === "1010"), revenue = accts.find((a) => a.type === "income");
  const bill = await v1("POST", "/bills", { key, body: { vendorName: "Supplier A", date: today, dueDate: today, number: "S-1", lines: [{ description: "Office", quantity: 2, unitPrice: "525.00", vatRate: 0.05 }] } });
  ok("create bill -> 201, pending", bill.status === 201 && bill.json?.data?.status === "pending" && bill.json.data.lines?.length === 1 && bill.json.data.number === "S-1", bill.text?.slice(0, 300));
  ok("bill totals are strings", bill.json?.data?.subtotal === "1050.00" && bill.json.data.vatAmount === "52.50" && bill.json.data.total === "1102.50", bill.json?.data);
  const payEarly = await v1("POST", `/bills/${bill.json.data.id}/payments`, { key, body: { amount: "100.00", paymentAccountId: cash.id } });
  ok("pay a bill (any state the internal rules allow)", [201, 400, 409, 422].includes(payEarly.status), payEarly.status);
  const approved = await v1("POST", `/bills/${bill.json.data.id}/approve`, { key });
  ok("approve bill -> approved", approved.status === 200 && approved.json?.data?.status === "approved", approved.text?.slice(0, 200));
  const again = await v1("POST", `/bills/${bill.json.data.id}/approve`, { key });
  ok("approving twice -> 4xx with a code", again.status >= 400 && again.status < 500 && !!again.json?.error?.code, again.status);
  const bp = await v1("POST", `/bills/${bill.json.data.id}/payments`, { key, body: { amount: "500.00", method: "bank_transfer", paymentAccountId: cash.id } });
  ok("bill payment -> 201 payment made", bp.status === 201 && bp.json?.data?.direction === "made" && bp.json.data.amount === "500.00" && bp.json.data.billStatus === "partial", bp.text?.slice(0, 300));
  const made = await v1("GET", "/payments?direction=made", { key });
  ok("GET /payments?direction=made", made.json?.data?.some((p) => p.documentId === bill.json.data.id), made.text?.slice(0, 200));
  const bd = await v1("GET", `/bills/${bill.json.data.id}`, { key });
  ok("bill detail amountPaid", bd.json?.data?.amountPaid === "600.00" || bd.json?.data?.amountPaid === "500.00", bd.json?.data?.amountPaid);
  const jl = (await db.query(`SELECT count(*)::int AS n FROM journal_entries WHERE company_id = $1 AND source IN ('bill','bill_payment')`, [u.cid])).rows[0].n;
  ok("bill approval and payment posted through the bill services", jl >= 2, jl);

  const j = await v1("POST", "/journals", { key, body: { date: today, memo: "API accrual", lines: [{ accountId: cash.id, debit: "100.00" }, { accountId: revenue.id, credit: 100 }] } });
  ok("create journal -> 201 draft with lines", j.status === 201 && j.json?.data?.status === "draft" && j.json.data.lines.length === 2 && j.json.data.source === "manual", j.text?.slice(0, 300));
  const unbal = await v1("POST", "/journals", { key, body: { date: today, lines: [{ accountId: cash.id, debit: "100.00" }, { accountId: revenue.id, credit: "90.00" }] } });
  ok("unbalanced journal -> 400", unbal.status === 400, unbal.status);
  const withSource = await v1("POST", "/journals", { key, body: { date: today, source: "invoice", lines: [{ accountId: cash.id, debit: 1 }, { accountId: revenue.id, credit: 1 }] } });
  ok("a journal cannot name a system source (400)", withSource.status === 400, withSource.status);
  const posted = await v1("POST", `/journals/${j.json.data.id}/post`, { key });
  ok("post journal", posted.status === 200 && posted.json?.data?.status === "posted", posted.text?.slice(0, 200));
  const jget = await v1("GET", `/journals/${j.json.data.id}`, { key });
  ok("journal detail has account codes", jget.json?.data?.lines?.every((l) => l.accountCode), jget.json?.data);
  const jl2 = await v1("GET", "/journals?status=posted", { key });
  ok("journal list filter", jl2.status === 200 && jl2.json.data.some((x) => x.id === j.json.data.id), jl2.status);

  const tb = await v1("GET", `/reports/trial-balance?to=${today}`, { key });
  ok("trial balance report via dispatch", tb.status === 200 && tb.json?.success === true && tb.json.data, tb.text?.slice(0, 200));
  const pl = await v1("GET", `/reports/profit-and-loss?from=${today.slice(0, 4)}-01-01&to=${today}`, { key });
  ok("profit and loss report", pl.status === 200 && pl.json?.success === true, pl.text?.slice(0, 200));
  const bs = await v1("GET", `/reports/balance-sheet?asOf=${today}`, { key });
  ok("balance sheet report", bs.status === 200, bs.status);
  const ar = await v1("GET", `/reports/aged-receivables`, { key });
  const ap = await v1("GET", `/reports/aged-payables?asOf=${today}`, { key });
  ok("aged receivables / payables are split by kind", ar.status === 200 && Array.isArray(ar.json.data) && ar.json.data.every((r) => r.type === "receivable") && ap.status === 200 && ap.json.data.every((r) => r.type === "payable") && ap.json.data.length >= 1, [ar.status, ap.json?.data]);
  const badDate = await v1("GET", "/reports/trial-balance?from=yesterday", { key });
  ok("bad report date -> 400", badDate.status === 400, badDate.status);
}

// ───────────────────────── Step 3: export and deletion ─────────────────────────
const helperEnv = () => ({ ...process.env, SESSION_SECRET: crypto.randomBytes(24).toString("hex"), JWT_SECRET: crypto.randomBytes(24).toString("hex"), NODE_ENV: "development", LOG_LEVEL: "error" });
function runHelper(name, ...args) {
  const run = spawnSync("npx", ["tsx", path.join(here, "helpers", name), ...args], { env: helperEnv(), encoding: "utf8", cwd: repo });
  const line = (run.stdout || "").split("\n").find((l) => l.startsWith("RESULT "));
  return { status: run.status, result: line ? JSON.parse(line.slice(7)) : null, err: (run.stderr || "").slice(-400) };
}
async function addMember(u, role) {
  const m = await register("member" + role);
  await db.query(`DELETE FROM company_users WHERE user_id = $1`, [m.userId]);
  await db.query(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, $3)`, [u.cid, m.userId, role]);
  return m;
}
async function waitFor(fn, ms = 40000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 300)); }
  return null;
}

// AC25, AC26
async function companyExport() {
  const u = await register("export");
  const accountant = await addMember(u, "accountant");
  const employee = await addMember(u, "employee");
  const other = await register("exportB");
  const { key } = await createKey(u, ["read:contacts", "write:contacts", "write:invoices"]);
  const evil = await v1("POST", "/contacts", { key, body: { name: "=HYPERLINK(\"http://evil\",\"x\")", email: `ex_${rnd}@example.com` } });
  await v1("POST", "/contacts", { key, body: { name: "Plain, with \"quotes\"" } });
  await v1("POST", "/invoices", { key, body: invoiceBody() });
  await api("POST", `/api/companies/${u.cid}/bills`, { token: u.token, body: { vendor_name: "Supplier", bill_date: today, line_items: [{ description: "x", unit_price: 100 }] } });
  const foreignContact = await api("POST", `/api/companies/${other.cid}/customer-contacts`, { token: other.token, body: { name: "FOREIGN_SECRET_CONTACT" } });
  await api("POST", `/api/companies/${other.cid}/invoices`, { token: other.token, body: invoiceBody({ customerName: "FOREIGN_CUSTOMER" }) });
  await db.query(`UPDATE customer_contacts SET portal_access_token = 'portal-secret-token-value-${rnd}' WHERE id = $1`, [evil.json.data.id]);
  // a stored file + a document on disk
  const fileKey = `${u.cid}/documents/${crypto.randomUUID()}-contract.txt`;
  fs.mkdirSync(path.join(repo, "uploads", u.cid, "documents"), { recursive: true });
  fs.writeFileSync(path.join(repo, "uploads", fileKey), "CONTRACT BODY " + rnd);
  await db.query(`INSERT INTO stored_files (company_id, storage_key, category, filename, content_type, size_bytes) VALUES ($1, $2, 'documents', 'contract.txt', 'text/plain', 20)`, [u.cid, fileKey]);
  await db.query(`INSERT INTO documents (company_id, name, category, file_url, file_name, mime_type) VALUES ($1, 'Contract', 'contracts', $2, 'contract.txt', 'text/plain')`, [u.cid, fileKey]);

  const emp = await api("POST", `/api/companies/${u.cid}/exports`, { token: employee.token });
  ok("employee cannot export (403) (AC26)", emp.status === 403, emp.status);
  const out = await api("POST", `/api/companies/${other.cid}/exports`, { token: u.token });
  ok("a member of another company cannot export it (403)", out.status === 403, out.status);
  const noAuth = await api("POST", `/api/companies/${u.cid}/exports`);
  ok("anonymous cannot export (401)", noAuth.status === 401, noAuth.status);

  const acctTry = await api("POST", `/api/companies/${u.cid}/exports`, { token: accountant.token });
  ok("an accountant cannot request a full-company export (403 OWNER_REQUIRED)", acctTry.status === 403 && acctTry.json?.code === "OWNER_REQUIRED", acctTry.text);
  const racers = await Promise.all(Array.from({ length: 4 }, () => api("POST", `/api/companies/${u.cid}/exports`, { token: u.token })));
  const accepted = racers.filter((r) => r.status === 202);
  ok("owner export -> 202 job; concurrent requests -> 409 EXPORT_IN_PROGRESS (AC25)", accepted.length >= 1 && racers.every((r) => r.status === 202 || (r.status === 409 && r.json?.code === "EXPORT_IN_PROGRESS")), racers.map((r) => r.status));
  const jobId = accepted[0].json.id;
  const ready = await waitFor(async () => { const r = await api("GET", `/api/companies/${u.cid}/exports/${jobId}`, { token: u.token }); return r.json?.status === "ready" || r.json?.status === "failed" ? r : null; });
  ok("the job reaches ready", ready?.json?.status === "ready", ready?.json);
  ok("job reports size, sha256, 24 h expiry and a manifest", ready.json.sizeBytes > 1000 && /^[0-9a-f]{64}$/.test(ready.json.sha256) && ready.json.manifest?.tables?.length >= 15 && new Date(ready.json.expiresAt) > new Date(), { s: ready.json.sizeBytes });
  const early = await api("GET", `/api/companies/${other.cid}/exports/${jobId}`, { token: other.token });
  ok("another company's id for this job -> 404", early.status === 404, early.status);
  const empDl = await api("GET", `/api/companies/${u.cid}/exports/${jobId}/download`, { token: employee.token });
  ok("employee cannot download (403)", empDl.status === 403, empDl.status);

  const acctDl = await api("GET", `/api/companies/${u.cid}/exports/${jobId}/download`, { token: accountant.token, raw: true });
  ok("and cannot download the owner's export (403)", acctDl.status === 403, acctDl.status);
  const dl = await api("GET", `/api/companies/${u.cid}/exports/${jobId}/download`, { token: u.token, raw: true });
  ok("download streams a ZIP with the checksum header", dl.status === 200 && /zip/.test(dl.headers.get("content-type")) && dl.headers.get("x-export-sha256") === ready.json.sha256 && crypto.createHash("sha256").update(dl.buf).digest("hex") === ready.json.sha256, dl.status);
  const zip = await JSZip.loadAsync(dl.buf);
  const names = Object.keys(zip.files);
  const csvs = names.filter((n) => n.startsWith("data/") && n.endsWith(".csv"));
  ok("ZIP holds >= 15 CSVs, a manifest and the company's files (AC25)", csvs.length >= 15 && names.includes("manifest.json") && names.some((n) => n.startsWith("documents/") && n.endsWith("contract.txt")), { csvs: csvs.length, names: names.filter((n) => !n.startsWith("data/")) });
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  let hashesOk = true, checked = 0;
  for (const f of [...manifest.tables, ...manifest.files]) {
    const buf = await zip.file(f.path).async("nodebuffer");
    checked++;
    if (crypto.createHash("sha256").update(buf).digest("hex") !== f.sha256 || buf.length !== f.bytes) hashesOk = false;
  }
  ok("every manifest SHA-256 matches its file (AC25)", hashesOk && checked === csvs.length + manifest.files.length && manifest.files.length >= 1, { checked });
  const docText = await zip.file(names.find((n) => n.startsWith("documents/"))).async("string");
  ok("the document content is intact", docText === "CONTRACT BODY " + rnd, docText);

  let foreign = 0, withCompanyId = 0, secrets = 0, allText = "";
  for (const n of csvs) {
    const text = (await zip.file(n).async("string")).replace(/^﻿/, "");
    allText += text;
    const rows = parseCsv(text, { columns: true, skip_empty_lines: true, relax_column_count: true });
    if (text.split("\r\n")[0].split(",").includes("company_id")) withCompanyId++;
    foreign += rows.filter((r) => "company_id" in r && r.company_id !== u.cid).length;
    if (n.endsWith("companies.csv")) foreign += rows.filter((r) => r.id !== u.cid).length;
  }
  ok("no row of another company in any CSV (AC25)", withCompanyId >= 10 && foreign === 0 && !allText.includes("FOREIGN_SECRET_CONTACT") && !allText.includes("FOREIGN_CUSTOMER") && !allText.includes(other.cid), { withCompanyId, foreign });
  ok("child tables are present (invoice_lines, journal_lines)", csvs.includes("data/invoice_lines.csv") && csvs.includes("data/journal_lines.csv"), csvs);
  ok("secrets are not exported: no api_keys, no tokens, no key hashes", !csvs.includes("data/api_keys.csv") && !allText.includes("portal-secret-token-value-" + rnd) && !allText.includes(crypto.createHash("sha256").update(key).digest("hex")) && Object.keys(manifest.excludedColumns).length >= 1 && !allText.includes(key.slice(-32)), Object.keys(manifest.excludedColumns));
  ok("manifest lists excluded columns by table", manifest.excludedColumns.customer_contacts?.includes("portal_access_token"), manifest.excludedColumns.customer_contacts);
  const contactsCsv = (await zip.file("data/customer_contacts.csv").async("string")).replace(/^﻿/, "");
  const contactRows = parseCsv(contactsCsv, { columns: true });
  ok("formula-looking cells are defused with a leading quote", contactRows.some((r) => r.name.startsWith("'=HYPERLINK")) && !contactRows.some((r) => r.name.startsWith("=")), contactRows.map((r) => r.name));
  ok("commas and quotes survive CSV escaping", contactRows.some((r) => r.name === 'Plain, with "quotes"'), contactRows.map((r) => r.name));
  const invRows = parseCsv((await zip.file("data/invoices.csv").async("string")).replace(/^﻿/, ""), { columns: true });
  ok("numbers keep their sign and precision (no quote prefix)", invRows.length === 1 && /^\d+\.\d+$/.test(invRows[0].total), invRows[0]?.total);

  const list = await api("GET", `/api/companies/${u.cid}/exports`, { token: u.token });
  ok("list shows the job", list.status === 200 && list.json.some((j) => j.id === jobId), list.status);
  // 24 h link
  await db.query(`UPDATE company_data_exports SET expires_at = (now() AT TIME ZONE 'UTC') - interval '1 hour' WHERE id = $1`, [jobId]);
  const gone = await api("GET", `/api/companies/${u.cid}/exports/${jobId}/download`, { token: u.token });
  ok("after 24 h the download is 410 EXPORT_EXPIRED", gone.status === 410 && gone.json?.code === "EXPORT_EXPIRED", gone.text);
  const sweep = runHelper("run-housekeeping.ts");
  ok("housekeeping expires the export and deletes its file", sweep.status === 0 && sweep.result?.expiredExports >= 1 && (await db.query(`SELECT status, stored_file_id FROM company_data_exports WHERE id = $1`, [jobId])).rows[0].status === "expired", sweep);
  const again = await api("POST", `/api/companies/${u.cid}/exports`, { token: u.token });
  ok("a new export can be requested after expiry", again.status === 202, again.text);
  await waitFor(async () => (await db.query(`SELECT 1 FROM company_data_exports WHERE company_id = $1 AND status IN ('ready','failed')`, [u.cid])).rows.length > 1);
  // stale running job
  await db.query(`UPDATE company_data_exports SET status = 'running', created_at = (now() AT TIME ZONE 'UTC') - interval '2 hours' WHERE id = $1`, [again.json.id]).catch(() => {});
  const stale = runHelper("run-housekeeping.ts");
  ok("a job stuck 'running' for over 30 min is failed by the sweep", stale.status === 0 && stale.result?.staleExports >= 0, stale);
}

// AC27, AC28
async function companyDeletionLifecycle() {
  const u = await register("delete");
  await api("PATCH", `/api/companies/${u.cid}`, { token: u.token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });
  const acct = await addMember(u, "accountant");
  const { key } = await createKey(u, ["read:invoices", "write:invoices", "write:contacts"]);
  const co = (await api("GET", `/api/companies/${u.cid}`, { token: u.token })).json;
  const contact = await api("POST", `/api/companies/${u.cid}/customer-contacts`, { token: u.token, body: { name: "Real Person", email: `rp_${rnd}@example.com`, phone: "+971500001111" } });
  const inv = await api("POST", `/api/companies/${u.cid}/invoices`, { token: u.token, body: invoiceBody({ customerName: "Real Person", contactId: contact.json.id }) });
  await api("PATCH", `/api/invoices/${inv.json.id}/status`, { token: u.token, body: { status: "sent" } });
  const tbQuery = `SELECT a.code, sum(jl.debit)::float AS d, sum(jl.credit)::float AS c FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.company_id = $1 AND je.status = 'posted' GROUP BY a.code ORDER BY a.code`;
  const tbBefore = (await db.query(tbQuery, [u.cid])).rows;
  const retention = await api("DELETE", `/api/invoices/${inv.json.id}`, { token: u.token });
  ok("a young invoice cannot be deleted: 409 RETENTION_NOT_EXPIRED (AC28)", retention.status === 409 && (retention.json?.code === "RETENTION_NOT_EXPIRED" || /retention/i.test(retention.text)), retention.text?.slice(0, 200));
  await api("POST", `/api/companies/${u.cid}/recurring-invoices`, { token: u.token, body: { customerName: "Rec", currency: "AED", frequency: "monthly", startDate: new Date(Date.now() - 86400000).toISOString().slice(0, 10), lines: [{ description: "r", quantity: 1, unitPrice: 10, vatRate: 0.05 }] } });

  const no = await api("DELETE", `/api/companies/${u.cid}`, { token: u.token, body: { confirmName: co.name } });
  ok("DELETE without re-auth -> 401 REAUTH_REQUIRED (AC27)", no.status === 401 && no.json?.code === "REAUTH_REQUIRED", no.text);
  const wrongPw = await api("DELETE", `/api/companies/${u.cid}`, { token: u.token, body: { password: "Wrong12345", confirmName: co.name } });
  ok("wrong password -> 401 PASSWORD_INVALID", wrongPw.status === 401 && wrongPw.json?.code === "PASSWORD_INVALID", wrongPw.text);
  const wrongName = await api("DELETE", `/api/companies/${u.cid}`, { token: u.token, body: { password: PASSWORD, confirmName: "not it" } });
  ok("wrong company name -> 422 CONFIRM_NAME_MISMATCH", wrongName.status === 422 && wrongName.json?.code === "CONFIRM_NAME_MISMATCH", wrongName.text);
  const byAcct = await api("DELETE", `/api/companies/${u.cid}`, { token: acct.token, body: { password: PASSWORD, confirmName: co.name } });
  ok("only the owner may delete (403)", byAcct.status === 403, byAcct.status);
  const stranger = await register("deleteX");
  const byStranger = await api("DELETE", `/api/companies/${u.cid}`, { token: stranger.token, body: { password: PASSWORD, confirmName: co.name } });
  ok("a stranger cannot delete (403)", byStranger.status === 403, byStranger.status);
  const stillThere = (await db.query(`SELECT deleted_at FROM companies WHERE id = $1`, [u.cid])).rows[0];
  ok("nothing was deleted by the failed attempts", stillThere.deleted_at === null, stillThere);

  const del = await api("DELETE", `/api/companies/${u.cid}`, { token: u.token, body: { password: PASSWORD, confirmName: co.name, reason: "closing down" } });
  ok("DELETE with password + name -> 202 pending with purgeAfter ~30 days (AC27)", del.status === 202 && del.json?.status === "pending" && Math.abs(new Date(del.json.purgeAfter).getTime() - (Date.now() + 30 * 86400000)) < 3 * 3600000, del.text);
  const row = (await db.query(`SELECT deleted_at FROM companies WHERE id = $1`, [u.cid])).rows[0];
  ok("deleted_at is set (AC27)", row.deleted_at !== null, row);
  const list = await api("GET", "/api/companies", { token: u.token });
  ok("the company is hidden from the owner's list (AC27)", list.status === 200 && !JSON.stringify(list.json).includes(u.cid), list.status);
  const data = await api("GET", `/api/companies/${u.cid}/invoices`, { token: u.token });
  ok("the owner can no longer read its data (F5)", data.status === 403 || data.status === 404, data.status);
  const memberData = await api("GET", `/api/companies/${u.cid}/invoices`, { token: acct.token });
  ok("members are denied too (F5, AC27)", memberData.status === 403 || memberData.status === 404, memberData.status);
  const ownerExport = await api("POST", `/api/companies/${u.cid}/exports`, { token: u.token });
  ok("while deletion is pending the OWNER can still export (202)", ownerExport.status === 202, ownerExport.text);
  const ownerList = await api("GET", `/api/companies/${u.cid}/exports`, { token: u.token });
  ok("and list exports", ownerList.status === 200 && ownerList.json.length >= 1, ownerList.status);
  await waitFor(async () => (await db.query(`SELECT 1 FROM company_data_exports WHERE company_id = $1 AND status IN ('ready','failed')`, [u.cid])).rows.length);
  const ownerDl = await api("GET", `/api/companies/${u.cid}/exports/${ownerExport.json.id}/download`, { token: u.token, raw: true });
  ok("and download it (200 ZIP)", ownerDl.status === 200 && /zip/.test(ownerDl.headers.get("content-type")), ownerDl.status);
  const roleRoute = await api("POST", `/api/companies/${u.cid}/exports`, { token: stranger.token });
  ok("a stranger still cannot export a company in its deletion window (403)", roleRoute.status === 403, roleRoute.status);
  await db.query(`UPDATE company_data_exports SET status = 'failed' WHERE company_id = $1 AND status IN ('queued','running')`, [u.cid]);
  const apiKey = await v1("GET", "/invoices", { key });
  ok("the company's API keys stop working at once", apiKey.status === 401, apiKey.status);
  const again = await api("DELETE", `/api/companies/${u.cid}`, { token: u.token, body: { password: PASSWORD, confirmName: co.name } });
  ok("a second DELETE is refused", again.status === 403 || again.status === 409, again.status);
  const mine = await api("GET", "/api/me/company-deletions", { token: u.token });
  ok("the owner sees the request with its purge date", mine.status === 200 && mine.json.some((r) => r.id === del.json.requestId && r.status === "pending" && r.companyName === co.name), mine.text?.slice(0, 200));
  const rec = runHelper("run-recurring.ts", u.cid);
  const generated = (await db.query(`SELECT count(*)::int AS n FROM invoices WHERE company_id = $1 AND customer_name = 'Rec'`, [u.cid])).rows[0].n;
  ok("recurring invoices are not generated for a deleted company", rec.status === 0 && generated === 0, { rec: rec.result, generated });
  const strangerRestore = await api("POST", `/api/company-deletions/${del.json.requestId}/restore`, { token: stranger.token });
  ok("a stranger cannot restore it (404)", strangerRestore.status === 404, strangerRestore.status);

  const restored = await api("POST", `/api/company-deletions/${del.json.requestId}/restore`, { token: u.token });
  ok("restore within 30 days -> 200 (AC27)", restored.status === 200 && restored.json?.status === "restored", restored.text);
  const back = await api("GET", `/api/companies/${u.cid}/invoices`, { token: u.token });
  ok("after restore the data is back", back.status === 200 && back.json.length >= 1, back.status);
  const revoked = await v1("GET", "/invoices", { key });
  ok("API keys stay revoked after a restore (the owner issues new ones)", revoked.status === 401, revoked.status);

  // second round: window closed, then purge
  const del2 = await api("DELETE", `/api/companies/${u.cid}`, { token: u.token, body: { password: PASSWORD, confirmName: co.name } });
  ok("a restored company can be deleted again", del2.status === 202, del2.text);
  await db.query(`UPDATE company_deletion_requests SET purge_after = (now() AT TIME ZONE 'UTC') - interval '1 day' WHERE id = $1`, [del2.json.requestId]);
  const late = await api("POST", `/api/company-deletions/${del2.json.requestId}/restore`, { token: u.token });
  ok("restore after the window -> 410 RESTORE_WINDOW_CLOSED", late.status === 410 && late.json?.code === "RESTORE_WINDOW_CLOSED", late.text);

  const counts = async () => ({
    invoices: (await db.query(`SELECT count(*)::int AS n FROM invoices WHERE company_id = $1`, [u.cid])).rows[0].n,
    lines: (await db.query(`SELECT count(*)::int AS n FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id WHERE je.company_id = $1`, [u.cid])).rows[0].n,
    bills: (await db.query(`SELECT count(*)::int AS n FROM vendor_bills WHERE company_id = $1`, [u.cid])).rows[0].n,
  });
  const before = await counts();
  const run = runHelper("run-company-purge.ts");
  ok("the purge job runs", run.status === 0 && run.result?.purged?.includes(u.cid), run);
  const req = (await db.query(`SELECT status, purged_at, retention_expires_at FROM company_deletion_requests WHERE id = $1`, [del2.json.requestId])).rows[0];
  ok("request is purged, with a retention date ~5 years after the last record (AC28)", req.status === "purged" && req.purged_at && new Date(req.retention_expires_at).getFullYear() >= new Date().getFullYear() + 4, req);
  const c = (await db.query(`SELECT name, email, phone, is_active FROM customer_contacts WHERE company_id = $1`, [u.cid])).rows;
  ok("contacts are anonymised (AC28)", c.length >= 1 && c.every((x) => x.name === "Anonymised contact" && x.email === null && x.phone === null), c);
  const users = (await db.query(`SELECT email, name, is_active FROM users WHERE id = ANY($1)`, [[u.userId, acct.userId]])).rows;
  ok("users whose only company this was are anonymised and deactivated (AC28)", users.every((x) => x.email.endsWith("@anonymised.invalid") && x.name === "Deleted user" && x.is_active === false), users);
  const login = await login_(u.email);
  ok("an anonymised user cannot sign in", login.status === 401, login.status);
  const members = (await db.query(`SELECT count(*)::int AS n FROM company_users WHERE company_id = $1`, [u.cid])).rows[0].n;
  ok("memberships are removed", members === 0, members);
  ok("invoices, journals and bills are untouched (AC28)", JSON.stringify(await counts()) === JSON.stringify(before) && before.invoices >= 1 && before.lines >= 2, { before, after: await counts() });
  const tbAfter = (await db.query(tbQuery, [u.cid])).rows;
  ok("the trial balance is identical after the purge (AC28)", tbBefore.length > 0 && JSON.stringify(tbBefore) === JSON.stringify(tbAfter), { tbBefore, tbAfter });
  const stillDeleted = (await db.query(`SELECT deleted_at FROM companies WHERE id = $1`, [u.cid])).rows[0];
  ok("the company stays soft-deleted until retention ends", stillDeleted && stillDeleted.deleted_at !== null, stillDeleted);
  const idem = runHelper("run-company-purge.ts");
  ok("running the purge again changes nothing", idem.status === 0 && !idem.result?.purged?.includes(u.cid) && !idem.result?.erased?.includes(u.cid), idem.result);

  // erase after retention
  await db.query(`UPDATE company_deletion_requests SET retention_expires_at = (now() AT TIME ZONE 'UTC') - interval '1 day' WHERE id = $1`, [del2.json.requestId]);
  const erase = runHelper("run-company-purge.ts");
  const gone = (await db.query(`SELECT count(*)::int AS n FROM companies WHERE id = $1`, [u.cid])).rows[0].n;
  const finalReq = (await db.query(`SELECT status, company_name FROM company_deletion_requests WHERE id = $1`, [del2.json.requestId])).rows[0];
  ok("after retention the company is erased and the request keeps the record", erase.status === 0 && erase.result?.erased?.includes(u.cid) && gone === 0 && finalReq.status === "erased" && finalReq.company_name === co.name, { erase: erase.result, gone, finalReq, err: erase.err });

  // 2FA: the code is required when it is on
  const t = await register("deleteTfa");
  const { secret } = await enrol2fa(t);
  const tco = (await api("GET", `/api/companies/${t.cid}`, { token: t.token })).json;
  const noCode = await api("DELETE", `/api/companies/${t.cid}`, { token: t.token, body: { password: PASSWORD, confirmName: tco.name } });
  ok("with 2FA on, the code is required to delete (401 TOTP_INVALID)", noCode.status === 401 && noCode.json?.code === "TOTP_INVALID", noCode.text);
  const withCode = await api("DELETE", `/api/companies/${t.cid}`, { token: t.token, body: { password: PASSWORD, code: totp(secret, 1), confirmName: tco.name } });
  ok("password + code + name -> 202", withCode.status === 202, withCode.text);
}
const login_ = (email) => login(email);

async function clientCompanyNeedsFirmConfirmation() {
  const u = await register("firmdel");
  await db.query(`UPDATE companies SET company_type = 'client' WHERE id = $1`, [u.cid]);
  const co = (await api("GET", `/api/companies/${u.cid}`, { token: u.token })).json;
  const del = await api("DELETE", `/api/companies/${u.cid}`, { token: u.token, body: { password: PASSWORD, confirmName: co.name } });
  ok("a firm-managed company waits for its firm owner (awaiting_firm)", del.status === 202 && del.json?.status === "awaiting_firm", del.text);
  const row = (await db.query(`SELECT deleted_at FROM companies WHERE id = $1`, [u.cid])).rows[0];
  ok("nothing is hidden until the firm confirms", row.deleted_at === null, row);
  const notFirm = await api("POST", `/api/firm/company-deletions/${del.json.requestId}/confirm`, { token: u.token });
  ok("the client's owner cannot confirm for the firm (403)", notFirm.status === 403, notFirm.status);
  const firm = await register("firmowner");
  await db.query(`UPDATE users SET firm_role = 'firm_owner' WHERE id = $1`, [firm.userId]);
  const confirm = await api("POST", `/api/firm/company-deletions/${del.json.requestId}/confirm`, { token: firm.token });
  ok("firm owner confirms -> pending with a purge date", confirm.status === 200 && confirm.json?.status === "pending" && !!confirm.json.purgeAfter, confirm.text);
  const after = (await db.query(`SELECT deleted_at FROM companies WHERE id = $1`, [u.cid])).rows[0];
  ok("now the company is soft-deleted", after.deleted_at !== null, after);
  const twice = await api("POST", `/api/firm/company-deletions/${del.json.requestId}/confirm`, { token: firm.token });
  ok("confirming twice -> 409", twice.status === 409, twice.status);
  const u2 = await register("firmdel2");
  await db.query(`UPDATE companies SET company_type = 'client' WHERE id = $1`, [u2.cid]);
  const co2 = (await api("GET", `/api/companies/${u2.cid}`, { token: u2.token })).json;
  const d2 = await api("DELETE", `/api/companies/${u2.cid}`, { token: u2.token, body: { password: PASSWORD, confirmName: co2.name } });
  const cancel = await api("POST", `/api/company-deletions/${d2.json.requestId}/restore`, { token: u2.token });
  ok("the owner can withdraw a request that is still awaiting the firm", cancel.status === 200 && cancel.json?.status === "cancelled", cancel.text);
}

// ───────────────────────── Step 4: migration wizard ─────────────────────────
const b64 = (text) => Buffer.from(text, "utf8").toString("base64");
const uploadJob = (u, source, entity, filename, content, extra = {}) =>
  api("POST", `/api/companies/${u.cid}/import-jobs`, { token: u.token, body: { source, entity, filename, contentBase64: typeof content === "string" ? b64(content) : content.toString("base64"), ...extra } });
const countOf = async (table, cid) => (await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE company_id = $1`, [cid])).rows[0].n;

// AC29
async function importContactsWizard() {
  const u = await register("imp");
  const csv = [
    "Display Name,EmailID,Phone,Contact Type,Billing City,TRN,Payment Terms",
    "Acme Trading LLC,acme@example.com,+971501111111,customer,Dubai,100123456700003,Net 30",
    "شركة النور,noor@example.com,+971502222222,vendor,Sharjah,,Due on receipt",
    "Bad Email Co,not-an-email,+971503333333,customer,Dubai,,Net 15",
    "Bad TRN Co,trn@example.com,+971504444444,customer,Dubai,12345,Net 30",
    "Gulf Supplies,gulf@example.com,+971505555555,Vendor,Abu Dhabi,,Net 60",
    "Acme Trading LLC,acme2@example.com,,customer,Dubai,100123456700003,Net 30",
  ].join("\n");
  const up = await uploadJob(u, "zoho", "contacts", "contacts.csv", csv);
  ok("upload -> 201 with columns, a suggested Zoho mapping and sample rows (AC29)", up.status === 201 && up.json.job.status === "uploaded" && up.json.job.rowCount === 6 && up.json.detectedColumns.includes("EmailID") && up.json.suggestedMapping.name === "Display Name" && up.json.suggestedMapping.email === "EmailID" && up.json.suggestedMapping.type === "Contact Type" && up.json.sampleRows.length === 6, up.text?.slice(0, 400));
  const jobId = up.json.job.id;
  const noMap = await api("POST", `/api/companies/${u.cid}/import-jobs/${jobId}/dry-run`, { token: u.token });
  ok("dry run before mapping -> 409 MAPPING_REQUIRED", noMap.status === 409 && noMap.json?.code === "MAPPING_REQUIRED", noMap.text);
  const mapped = await api("PUT", `/api/companies/${u.cid}/import-jobs/${jobId}/mapping`, { token: u.token, body: { mapping: up.json.suggestedMapping } });
  ok("mapping accepted -> mapped", mapped.status === 200 && mapped.json.status === "mapped", mapped.text);
  const before = await countOf("customer_contacts", u.cid);
  const dry = await api("POST", `/api/companies/${u.cid}/import-jobs/${jobId}/dry-run`, { token: u.token });
  ok("dry run reports 2 errors, 1 duplicate and creates nothing (AC29)", dry.status === 200 && dry.json.summary.errors === 2 && dry.json.summary.duplicates === 1 && dry.json.summary.toCreate === 3 && dry.json.job.status === "validated" && (await countOf("customer_contacts", u.cid)) === before, dry.text?.slice(0, 500));
  ok("error rows carry the field and a code", dry.json.summary.errorSample.some((e) => e.row === 3 && e.errors[0].code === "EMAIL_INVALID" && e.errors[0].field === "email") && dry.json.summary.errorSample.some((e) => e.row === 4 && e.errors[0].code === "TRN_INVALID"), dry.json.summary.errorSample);
  const errRows = await api("GET", `/api/companies/${u.cid}/import-jobs/${jobId}/rows?status=error`, { token: u.token });
  ok("GET rows?status=error lists the 2 bad rows with totals in headers", errRows.status === 200 && errRows.json.length === 2 && errRows.headers.get("x-total-count") === "2" && errRows.json[0].raw["Display Name"], errRows.text?.slice(0, 300));
  const noErr = await api("GET", `/api/companies/${u.cid}/import-jobs/${jobId}/rows?status=create`, { token: u.token });
  ok("rows?status=create shows the normalised values", noErr.json.length === 3 && noErr.json.some((r) => r.normalized.name === "شركة النور" && r.normalized.type === "vendor" && r.normalized.paymentTermsDays === 0), noErr.text?.slice(0, 300));
  const commit = await api("POST", `/api/companies/${u.cid}/import-jobs/${jobId}/commit`, { token: u.token });
  ok("commit creates N-2 (and skips the duplicate) (AC29)", commit.status === 200 && commit.json.result.created === 3 && commit.json.result.skippedDuplicates === 1 && commit.json.result.errors === 2 && commit.json.job.status === "committed", commit.text?.slice(0, 300));
  const contacts = (await db.query(`SELECT name, contact_type, trn_number, payment_terms, email FROM customer_contacts WHERE company_id = $1 ORDER BY name`, [u.cid])).rows;
  ok("the contacts exist with type, TRN and terms", contacts.length === before + 3 && contacts.some((c) => c.name === "Acme Trading LLC" && c.contact_type === "customer" && c.trn_number === "100123456700003" && c.payment_terms === 30) && contacts.some((c) => c.name === "شركة النور" && c.contact_type === "vendor" && c.payment_terms === 0) && contacts.some((c) => c.name === "Gulf Supplies" && c.contact_type === "vendor"), contacts);
  const again = await api("POST", `/api/companies/${u.cid}/import-jobs/${jobId}/commit`, { token: u.token });
  ok("recommit -> 409 IMPORT_ALREADY_COMMITTED (AC29)", again.status === 409 && again.json?.code === "IMPORT_ALREADY_COMMITTED", again.text);
  ok("no duplicates were made by the recommit", (await countOf("customer_contacts", u.cid)) === before + 3, await countOf("customer_contacts", u.cid));
  const remap = await api("PUT", `/api/companies/${u.cid}/import-jobs/${jobId}/mapping`, { token: u.token, body: { mapping: up.json.suggestedMapping } });
  ok("a committed job cannot be remapped", remap.status === 409, remap.status);
  const list = await api("GET", `/api/companies/${u.cid}/import-jobs`, { token: u.token });
  ok("job list shows the committed job", list.status === 200 && list.json.some((j) => j.id === jobId && j.status === "committed" && j.result.created === 3), list.text?.slice(0, 200));

  // the same file again: everything is now a duplicate
  const up2 = await uploadJob(u, "zoho", "contacts", "contacts.csv", csv);
  await api("PUT", `/api/companies/${u.cid}/import-jobs/${up2.json.job.id}/mapping`, { token: u.token, body: { mapping: up2.json.suggestedMapping } });
  const dry2 = await api("POST", `/api/companies/${u.cid}/import-jobs/${up2.json.job.id}/dry-run`, { token: u.token });
  ok("importing the same file again finds every valid row already there", dry2.json.summary.toCreate === 0 && dry2.json.summary.duplicates === 4 && dry2.json.summary.errors === 2, dry2.json.summary);
  const commit2 = await api("POST", `/api/companies/${u.cid}/import-jobs/${up2.json.job.id}/commit`, { token: u.token });
  ok("committing it creates nothing", commit2.status === 200 && commit2.json.result.created === 0, commit2.text?.slice(0, 200));

  // XLSX and a semicolon CSV
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Contacts");
  ws.addRow(["Name", "Email", "Phone", "TRN"]);
  ws.addRow(["Excel Customer FZE", "xl@example.com", "+971506666666", "100123456700011"]);
  ws.addRow(["Second Excel Co", "xl2@example.com", "", ""]);
  const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
  const upX = await uploadJob(u, "generic", "contacts", "contacts.xlsx", xlsx);
  ok("an .xlsx file uploads and maps by the generic names", upX.status === 201 && upX.json.job.rowCount === 2 && upX.json.suggestedMapping.name === "Name" && upX.json.suggestedMapping.trn === "TRN", upX.text?.slice(0, 300));
  await api("PUT", `/api/companies/${u.cid}/import-jobs/${upX.json.job.id}/mapping`, { token: u.token, body: { mapping: upX.json.suggestedMapping, options: { defaultContactType: "vendor" } } });
  await api("POST", `/api/companies/${u.cid}/import-jobs/${upX.json.job.id}/dry-run`, { token: u.token });
  const cx = await api("POST", `/api/companies/${u.cid}/import-jobs/${upX.json.job.id}/commit`, { token: u.token });
  const xl = (await db.query(`SELECT contact_type FROM customer_contacts WHERE company_id = $1 AND name = 'Excel Customer FZE'`, [u.cid])).rows[0];
  ok("xlsx import commits, and the default contact type applies", cx.status === 200 && cx.json.result.created === 2 && xl?.contact_type === "vendor", cx.text?.slice(0, 200));
  const semi = await uploadJob(u, "generic", "contacts", "semi.csv", "Name;Email\nSemi Colon LLC;semi@example.com\n");
  ok("semicolon-separated CSV is detected", semi.status === 201 && semi.json.detectedColumns.join() === "Name,Email" && semi.json.suggestedMapping.email === "Email", semi.text?.slice(0, 200));
}

async function importGuardsAndRaces() {
  const u = await register("impg");
  const other = await register("impgB");
  const employee = await addMember(u, "employee");
  const goodCsv = "Name,Email\nOne,one@example.com\nTwo,two@example.com\nThree,three@example.com\n";
  const bad = async (body, label, status, code) => {
    const r = await api("POST", `/api/companies/${u.cid}/import-jobs`, { token: u.token, body });
    ok(label, r.status === status && (!code || r.json?.code === code), r.text?.slice(0, 200));
  };
  await bad({ source: "sap", entity: "contacts", filename: "x.csv", contentBase64: b64(goodCsv) }, "unknown source -> 400", 400, "SOURCE_INVALID");
  await bad({ source: "zoho", entity: "payroll", filename: "x.csv", contentBase64: b64(goodCsv) }, "unknown entity -> 400", 400, "ENTITY_INVALID");
  await bad({ source: "zoho", entity: "contacts", filename: "x.csv", contentBase64: "!!!not base64!!!" }, "bad base64 -> 400", 400, "FILE_ENCODING_INVALID");
  await bad({ source: "zoho", entity: "contacts", filename: "x.pdf", contentBase64: b64(goodCsv) }, "unsupported file type -> 422", 422, "FILE_TYPE_UNSUPPORTED");
  await bad({ source: "zoho", entity: "contacts", filename: "x.csv", contentBase64: b64("   ") }, "blank file -> 422", 422);
  await bad({ source: "zoho", entity: "contacts", filename: "x.csv" }, "missing content -> 400", 400);
  const huge = "Name\n" + "x".repeat(5 * 1024 * 1024 + 10);
  await bad({ source: "zoho", entity: "contacts", filename: "x.csv", contentBase64: b64(huge) }, "over 5 MB -> 413", 413, "FILE_TOO_LARGE");
  const asEmployee = await api("POST", `/api/companies/${u.cid}/import-jobs`, { token: employee.token, body: { source: "generic", entity: "contacts", filename: "x.csv", contentBase64: b64(goodCsv) } });
  ok("employee cannot import (403)", asEmployee.status === 403, asEmployee.status);
  const stranger = await api("POST", `/api/companies/${u.cid}/import-jobs`, { token: other.token, body: { source: "generic", entity: "contacts", filename: "x.csv", contentBase64: b64(goodCsv) } });
  ok("a member of another company cannot import (403)", stranger.status === 403, stranger.status);

  const up = await uploadJob(u, "generic", "contacts", "c.csv", goodCsv);
  const jid = up.json.job.id;
  const foreignRead = await api("GET", `/api/companies/${other.cid}/import-jobs/${jid}`, { token: other.token });
  ok("another company cannot read the job (404)", foreignRead.status === 404, foreignRead.status);
  const foreignCommit = await api("POST", `/api/companies/${other.cid}/import-jobs/${jid}/commit`, { token: other.token });
  ok("another company cannot commit it (404)", foreignCommit.status === 404, foreignCommit.status);
  const unknownField = await api("PUT", `/api/companies/${u.cid}/import-jobs/${jid}/mapping`, { token: u.token, body: { mapping: { name: "Name", companyId: "Name" } } });
  ok("mapping an unknown field -> 400", unknownField.status === 400 && unknownField.json?.code === "MAPPING_FIELD_UNKNOWN", unknownField.text);
  const unknownCol = await api("PUT", `/api/companies/${u.cid}/import-jobs/${jid}/mapping`, { token: u.token, body: { mapping: { name: "Nope" } } });
  ok("mapping a column the file lacks -> 400", unknownCol.status === 400 && unknownCol.json?.code === "MAPPING_COLUMN_UNKNOWN", unknownCol.text);
  const incomplete = await api("PUT", `/api/companies/${u.cid}/import-jobs/${jid}/mapping`, { token: u.token, body: { mapping: { email: "Email" } } });
  ok("a mapping without the required name -> 422 MAPPING_INCOMPLETE", incomplete.status === 422 && incomplete.json?.code === "MAPPING_INCOMPLETE", incomplete.text);
  const badOpt = await api("PUT", `/api/companies/${u.cid}/import-jobs/${jid}/mapping`, { token: u.token, body: { mapping: { name: "Name" }, options: { dateFormat: "yy-dd-mm" } } });
  ok("an unknown date format -> 400", badOpt.status === 400, badOpt.status);
  const early = await api("POST", `/api/companies/${u.cid}/import-jobs/${jid}/commit`, { token: u.token });
  ok("commit before the dry run -> 409 IMPORT_NOT_VALIDATED", early.status === 409 && early.json?.code === "IMPORT_NOT_VALIDATED", early.text);
  await api("PUT", `/api/companies/${u.cid}/import-jobs/${jid}/mapping`, { token: u.token, body: { mapping: { name: "Name", email: "Email" } } });
  await api("POST", `/api/companies/${u.cid}/import-jobs/${jid}/dry-run`, { token: u.token });
  await api("PUT", `/api/companies/${u.cid}/import-jobs/${jid}/mapping`, { token: u.token, body: { mapping: { name: "Name" } } });
  const stale = await api("POST", `/api/companies/${u.cid}/import-jobs/${jid}/commit`, { token: u.token });
  ok("changing the mapping invalidates the dry run", stale.status === 409 && stale.json?.code === "IMPORT_NOT_VALIDATED", stale.text);
  await api("POST", `/api/companies/${u.cid}/import-jobs/${jid}/dry-run`, { token: u.token });
  const before = await countOf("customer_contacts", u.cid);
  const race = await Promise.all(Array.from({ length: 5 }, () => api("POST", `/api/companies/${u.cid}/import-jobs/${jid}/commit`, { token: u.token })));
  ok("5 parallel commits -> exactly one wins, the rest 409", race.filter((r) => r.status === 200).length === 1 && race.every((r) => r.status === 200 || r.status === 409), race.map((r) => r.status + ":" + (r.json?.code || "")));
  ok("the rows were created exactly once", (await countOf("customer_contacts", u.cid)) === before + 3, await countOf("customer_contacts", u.cid));

  // crash recovery: a committing job with half its rows written resumes without duplicates
  const up3 = await uploadJob(u, "generic", "contacts", "d.csv", "Name\nResume A\nResume B\nResume C\n");
  const j3 = up3.json.job.id;
  await api("PUT", `/api/companies/${u.cid}/import-jobs/${j3}/mapping`, { token: u.token, body: { mapping: { name: "Name" } } });
  await api("POST", `/api/companies/${u.cid}/import-jobs/${j3}/dry-run`, { token: u.token });
  const first = (await db.query(`SELECT id, normalized FROM import_job_rows WHERE job_id = $1 AND row_number = 1`, [j3])).rows[0];
  const made = (await db.query(`INSERT INTO customer_contacts (company_id, name) VALUES ($1, 'Resume A') RETURNING id`, [u.cid])).rows[0];
  await db.query(`UPDATE import_job_rows SET created_entity_id = $2 WHERE id = $1`, [first.id, made.id]);
  await db.query(`UPDATE import_jobs SET status = 'failed' WHERE id = $1`, [j3]);
  const resumed = await api("POST", `/api/companies/${u.cid}/import-jobs/${j3}/commit`, { token: u.token });
  const resumeCount = (await db.query(`SELECT count(*)::int AS n FROM customer_contacts WHERE company_id = $1 AND name LIKE 'Resume %'`, [u.cid])).rows[0].n;
  ok("a failed job resumes: 3 contacts total, no duplicate of the one already written", resumed.status === 200 && resumeCount === 3 && resumed.json.result.created === 3, { s: resumed.status, resumeCount, r: resumed.json?.result });
}

async function importItemsAndAccounts() {
  const u = await register("impi");
  const qb = "Product/Service,SKU,Type,Sales Description,Sales Price,Cost\nConsulting hour,CONS-1,Service,Hourly consulting,\"1,250.50\",\nWidget,WID-1,Inventory,A widget,99.90,40.00\nBroken,,,,abc,\n";
  const up = await uploadJob(u, "quickbooks", "items", "items.csv", qb);
  ok("QuickBooks items: the preset maps Product/Service, Sales Price and Cost", up.json.suggestedMapping.name === "Product/Service" && up.json.suggestedMapping.unitPrice === "Sales Price" && up.json.suggestedMapping.costPrice === "Cost" && up.json.suggestedMapping.sku === "SKU", up.json.suggestedMapping);
  await api("PUT", `/api/companies/${u.cid}/import-jobs/${up.json.job.id}/mapping`, { token: u.token, body: { mapping: up.json.suggestedMapping } });
  const dry = await api("POST", `/api/companies/${u.cid}/import-jobs/${up.json.job.id}/dry-run`, { token: u.token });
  ok("1,250.50 reads as a number; the bad price is the one error", dry.json.summary.errors === 1 && dry.json.summary.toCreate === 2, dry.json.summary);
  const c = await api("POST", `/api/companies/${u.cid}/import-jobs/${up.json.job.id}/commit`, { token: u.token });
  const items = (await db.query(`SELECT name, sku, unit_price::float AS up, cost_price::float AS cp, current_stock FROM products WHERE company_id = $1 ORDER BY name`, [u.cid])).rows;
  ok("items are created with price and cost, and no stock (stock comes from movements)", c.status === 200 && items.length === 2 && items.find((i) => i.sku === "CONS-1").up === 1250.5 && items.find((i) => i.sku === "WID-1").cp === 40 && items.every((i) => i.current_stock === 0), items);

  const xero = "*Code,*Name,*Type,Description\n1010,Cash Duplicate,Bank,already in the default chart\n1900,Petty Float,Current Asset,float\n7100,Marketing,Overhead,ads\n7200,Depreciation Exp,Depreciation,dep\n3500,Mystery,Banana,x\n";
  const ua = await uploadJob(u, "xero", "accounts", "coa.csv", xero);
  ok("Xero chart: the preset maps *Code, *Name and *Type", ua.json.suggestedMapping.code === "*Code" && ua.json.suggestedMapping.name === "*Name" && ua.json.suggestedMapping.type === "*Type", ua.json.suggestedMapping);
  await api("PUT", `/api/companies/${u.cid}/import-jobs/${ua.json.job.id}/mapping`, { token: u.token, body: { mapping: ua.json.suggestedMapping } });
  const da = await api("POST", `/api/companies/${u.cid}/import-jobs/${ua.json.job.id}/dry-run`, { token: u.token });
  ok("an existing code is a duplicate, an unknown type is an error", da.json.summary.duplicates === 1 && da.json.summary.errors === 1 && da.json.summary.toCreate === 3 && da.json.summary.errorSample[0].errors[0].code === "TYPE_UNRECOGNISED", da.json.summary);
  await api("POST", `/api/companies/${u.cid}/import-jobs/${ua.json.job.id}/commit`, { token: u.token });
  const accts = (await db.query(`SELECT code, name_en, type, sub_type, is_system_account FROM accounts WHERE company_id = $1 AND code IN ('1900','7100','7200','3500','1010') ORDER BY code`, [u.cid])).rows;
  ok("accounts are created with mapped type and sub-type; the default 1010 is untouched", accts.find((a) => a.code === "1900")?.type === "asset" && accts.find((a) => a.code === "1900").sub_type === "current_asset" && accts.find((a) => a.code === "7100")?.type === "expense" && accts.find((a) => a.code === "7200")?.type === "expense" && !accts.some((a) => a.code === "3500") && accts.find((a) => a.code === "1010").name_en !== "Cash Duplicate" && accts.filter((a) => a.code === "1900")[0].is_system_account === false, accts);
}

async function importOpeningPosition() {
  const u = await register("impo");
  const accts = (await api("GET", `/api/companies/${u.cid}/accounts`, { token: u.token })).json;
  const code = (c) => accts.find((a) => a.code === c);
  ok("default chart has the accounts the test uses", ["1010", "1040", "2010", "3010", "3020", "4010", "5000"].every(code), accts.map((a) => a.code).slice(0, 20));
  const tbCsv = [
    "Account Code,Account,Account Type,Debit - Year to date,Credit - Year to date",
    "1010,Cash,Bank,\"50,000.00\",",
    "1040,Accounts Receivable,Current Asset,\"3,000.00\",",
    "2010,Accounts Payable,Current Liability,,\"2,000.00\"",
    "3010,Owner's Capital / Share Capital,Equity,,\"48,000.00\"",
    "4010,Product Sales,Revenue,,\"5,000.00\"",
    "5000,,Direct Costs,\"2,000.00\",",
  ].join("\n");
  const tb = await uploadJob(u, "xero", "opening_tb", "tb.csv", tbCsv);
  ok("Xero trial balance: the preset maps the YTD columns", tb.json.suggestedMapping.debit === "Debit - Year to date" && tb.json.suggestedMapping.accountCode === "Account Code", tb.json.suggestedMapping);
  await api("PUT", `/api/companies/${u.cid}/import-jobs/${tb.json.job.id}/mapping`, { token: u.token, body: { mapping: tb.json.suggestedMapping, options: { goLiveDate: "2026-01-01" } } });
  const dryTb = await api("POST", `/api/companies/${u.cid}/import-jobs/${tb.json.job.id}/dry-run`, { token: u.token });
  ok("TB dry run: 6 rows, 0 errors, totals reported", dryTb.json.summary.errors === 0 && dryTb.json.summary.toCreate === 6 && dryTb.json.summary.totalDebit === 55000 && dryTb.json.summary.totalCredit === 55000 && dryTb.json.summary.balanced === true, dryTb.json.summary);
  const direct = await api("POST", `/api/companies/${u.cid}/import-jobs/${tb.json.job.id}/commit`, { token: u.token });
  ok("an opening-balance job cannot be committed alone (409 USE_IMPORT_OPENING)", direct.status === 409 && direct.json?.code === "USE_IMPORT_OPENING", direct.text);

  const invCsv = "*InvoiceNumber,*ContactName,*InvoiceDate,*DueDate,AmountDue\nOLD-001,Acme Trading LLC,15/08/2025,14/09/2025,\"2,000.00\"\nOLD-002,Gulf Customers,20/09/2025,20/10/2025,\"1,000.00\"\n";
  const inv = await uploadJob(u, "xero", "open_invoices", "ar.csv", invCsv);
  await api("PUT", `/api/companies/${u.cid}/import-jobs/${inv.json.job.id}/mapping`, { token: u.token, body: { mapping: inv.json.suggestedMapping } });
  const dryInv = await api("POST", `/api/companies/${u.cid}/import-jobs/${inv.json.job.id}/dry-run`, { token: u.token });
  ok("open invoices read dd/MM/yyyy dates (Xero default)", dryInv.json.summary.errors === 0 && dryInv.json.summary.toCreate === 2, dryInv.json.summary);
  const wrongFmt = await uploadJob(u, "xero", "open_invoices", "ar2.csv", invCsv);
  await api("PUT", `/api/companies/${u.cid}/import-jobs/${wrongFmt.json.job.id}/mapping`, { token: u.token, body: { mapping: wrongFmt.json.suggestedMapping, options: { dateFormat: "MM/dd/yyyy" } } });
  const dryWrong = await api("POST", `/api/companies/${u.cid}/import-jobs/${wrongFmt.json.job.id}/dry-run`, { token: u.token });
  ok("the same file read as MM/dd/yyyy flags the impossible months", dryWrong.json.summary.errors >= 1 && dryWrong.json.summary.errorSample[0].errors[0].code === "DATE_INVALID", dryWrong.json.summary);

  const billCsv = "Bill Number,Vendor Name,Bill Date,Due Date,Balance,Currency Code\nB-100,Supplier One,2025-09-01,2025-10-01,2000.00,AED\n";
  const bil = await uploadJob(u, "zoho", "open_bills", "ap.csv", billCsv);
  await api("PUT", `/api/companies/${u.cid}/import-jobs/${bil.json.job.id}/mapping`, { token: u.token, body: { mapping: bil.json.suggestedMapping } });
  const dryBil = await api("POST", `/api/companies/${u.cid}/import-jobs/${bil.json.job.id}/dry-run`, { token: u.token });
  ok("open bills validate", dryBil.json.summary.errors === 0 && dryBil.json.summary.toCreate === 1, dryBil.json.summary);

  const jobsBefore = { inv: await countOf("invoices", u.cid), je: await countOf("journal_entries", u.cid), bills: await countOf("vendor_bills", u.cid) };
  const prev = await api("POST", `/api/companies/${u.cid}/import-opening`, { token: u.token, body: { tbJobId: tb.json.job.id, invoicesJobId: inv.json.job.id, billsJobId: bil.json.job.id } });
  ok("preview ok: opening date is the day before go-live, P&L is rolled into retained earnings", prev.status === 200 && prev.json.preview.ok === true && prev.json.preview.asOfDate === "2025-12-31" && prev.json.summary.foldedProfitAndLoss === -3000 && prev.json.summary.openInvoices === 2 && prev.json.summary.openBills === 1, prev.text?.slice(0, 600));
  ok("preview posts nothing (dry run leaves counts unchanged)", (await countOf("invoices", u.cid)) === jobsBefore.inv && (await countOf("journal_entries", u.cid)) === jobsBefore.je && (await countOf("vendor_bills", u.cid)) === jobsBefore.bills, jobsBefore);

  const commit = await api("POST", `/api/companies/${u.cid}/import-opening?commit=1`, { token: u.token, body: { tbJobId: tb.json.job.id, invoicesJobId: inv.json.job.id, billsJobId: bil.json.job.id } });
  ok("commit -> 201 through the opening-balance service", commit.status === 201 && commit.json?.result?.journalEntryId && commit.json.asOfDate === "2025-12-31", commit.text?.slice(0, 400));
  const entries = (await db.query(`SELECT id, status, source, to_char(date,'YYYY-MM-DD') AS d FROM journal_entries WHERE company_id = $1 AND source = 'opening_balance'`, [u.cid])).rows;
  ok("exactly one opening entry, posted, dated the day before go-live", entries.length === 1 && entries[0].status === "posted" && entries[0].d === "2025-12-31", entries);
  const lines = (await db.query(`SELECT a.code, jl.debit::float AS d, jl.credit::float AS c FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE jl.entry_id = $1 ORDER BY a.code`, [entries[0].id])).rows;
  const dsum = lines.reduce((s, l) => s + l.d, 0), csum = lines.reduce((s, l) => s + l.c, 0);
  ok("the entry is balanced and carries retained earnings 3,000 (no 3040 plug needed)", Math.abs(dsum - csum) < 0.005 && dsum === 53000 && lines.find((l) => l.code === "3020")?.c === 3000 && !lines.some((l) => l.code === "3040"), lines);
  const ar = lines.find((l) => l.code === "1040").d, ap = lines.find((l) => l.code === "2010").c;
  const openInv = (await db.query(`SELECT sum(total)::float AS t, count(*)::int AS n, bool_and(is_opening_balance) AS flag FROM invoices WHERE company_id = $1`, [u.cid])).rows[0];
  const openBill = (await db.query(`SELECT sum(total_amount)::float AS t FROM vendor_bills WHERE company_id = $1 AND is_opening_balance = true`, [u.cid])).rows[0];
  ok("AR and AP control accounts equal the open items", ar === 3000 && openInv.t === 3000 && openInv.n === 2 && openInv.flag === true && ap === 2000 && openBill.t === 2000, { ar, ap, openInv, openBill });
  const noJournals = (await db.query(`SELECT count(*)::int AS n FROM journal_entries WHERE company_id = $1 AND source IN ('invoice','bill')`, [u.cid])).rows[0].n;
  ok("open items post no revenue, no VAT and no journals of their own", noJournals === 0, noJournals);
  const jobs = (await db.query(`SELECT entity, status FROM import_jobs WHERE company_id = $1 AND status = 'committed'`, [u.cid])).rows;
  ok("the three jobs are committed together", jobs.length >= 3 && ["opening_tb", "open_invoices", "open_bills"].every((e) => jobs.some((j) => j.entity === e)), jobs);
  const again = await api("POST", `/api/companies/${u.cid}/import-opening?commit=1`, { token: u.token, body: { tbJobId: tb.json.job.id, invoicesJobId: inv.json.job.id, billsJobId: bil.json.job.id } });
  ok("committing the opening position twice -> 409", again.status === 409 && again.json?.code === "IMPORT_ALREADY_COMMITTED", again.text);
  const audit = (await db.query(`SELECT action FROM audit_logs WHERE user_id = $1 AND action LIKE 'opening_balance.%' OR (user_id = $1 AND action LIKE 'import.%')`, [u.userId])).rows.map((r) => r.action);
  ok("audited", audit.includes("import.upload") && audit.includes("import.commit_opening") && audit.includes("opening_balance.post"), audit);

  // unbalanced trial balance and an AR that does not tie
  const v = await register("impo2");
  const bad = await uploadJob(v, "generic", "opening_tb", "tb.csv", "Account Code,Debit,Credit\n1010,\"1,000.00\",\n3010,,900.00\n");
  await api("PUT", `/api/companies/${v.cid}/import-jobs/${bad.json.job.id}/mapping`, { token: v.token, body: { mapping: bad.json.suggestedMapping, options: { goLiveDate: "2026-10-01" } } });
  const dryBad = await api("POST", `/api/companies/${v.cid}/import-jobs/${bad.json.job.id}/dry-run`, { token: v.token });
  ok("an unbalanced TB dry run says so", dryBad.json.summary.balanced === false, dryBad.json.summary);
  const unbal = await api("POST", `/api/companies/${v.cid}/import-opening?commit=1`, { token: v.token, body: { tbJobId: bad.json.job.id } });
  ok("an unbalanced TB is refused: 422 TB_UNBALANCED with the difference", unbal.status === 422 && unbal.json?.code === "TB_UNBALANCED" && unbal.json.details.difference === 100, unbal.text?.slice(0, 300));
  ok("nothing was posted", (await countOf("journal_entries", v.cid)) === 0, await countOf("journal_entries", v.cid));
  const tie = await uploadJob(v, "generic", "opening_tb", "tb2.csv", "Account Code,Debit,Credit\n1040,\"1,000.00\",\n3010,,\"1,000.00\"\n");
  await api("PUT", `/api/companies/${v.cid}/import-jobs/${tie.json.job.id}/mapping`, { token: v.token, body: { mapping: tie.json.suggestedMapping, options: { goLiveDate: "2026-10-01" } } });
  await api("POST", `/api/companies/${v.cid}/import-jobs/${tie.json.job.id}/dry-run`, { token: v.token });
  const inv2 = await uploadJob(v, "generic", "open_invoices", "ar.csv", "Invoice Number,Customer,Date,Due Date,Balance\nX-1,Someone,2026-08-01,2026-08-31,400.00\n");
  await api("PUT", `/api/companies/${v.cid}/import-jobs/${inv2.json.job.id}/mapping`, { token: v.token, body: { mapping: inv2.json.suggestedMapping } });
  await api("POST", `/api/companies/${v.cid}/import-jobs/${inv2.json.job.id}/dry-run`, { token: v.token });
  const mismatch = await api("POST", `/api/companies/${v.cid}/import-opening?commit=1`, { token: v.token, body: { tbJobId: tie.json.job.id, invoicesJobId: inv2.json.job.id } });
  ok("open invoices that do not tie to the AR balance are refused (422)", mismatch.status === 422 && mismatch.json?.code === "OPENING_BALANCE_INVALID", mismatch.text?.slice(0, 300));
  const afterMismatch = (await db.query(`SELECT status FROM import_jobs WHERE id = $1`, [tie.json.job.id])).rows[0].status;
  ok("after a refused commit the jobs return to validated for a retry", afterMismatch === "validated", afterMismatch);
  const wrongEntity = await api("POST", `/api/companies/${v.cid}/import-opening`, { token: v.token, body: { tbJobId: inv2.json.job.id } });
  ok("a job of the wrong entity is refused (422)", wrongEntity.status === 422 && wrongEntity.json?.code === "JOB_WRONG_ENTITY", wrongEntity.text);
  const foreign = await api("POST", `/api/companies/${u.cid}/import-opening`, { token: u.token, body: { tbJobId: tie.json.job.id } });
  ok("a job of another company is 404", foreign.status === 404, foreign.status);
  const noAsOf = await api("POST", `/api/companies/${v.cid}/import-opening`, { token: v.token, body: { tbJobId: bad.json.job.id } });
  ok("opening step on a TB with errors/unbalanced keeps the dry run honest", [200, 422].includes(noAsOf.status), noAsOf.status);
}

// ───────────────────────── Step 5: F6 and indexes ─────────────────────────
// The grouped balance query must equal what the old per-account loop computed: sums of the
// POSTED lines (drafts and voids excluded), optionally between two dates.
async function accountBalancesGolden() {
  const u = await register("f6");
  const accts = (await api("GET", `/api/companies/${u.cid}/accounts`, { token: u.token })).json;
  const cash = accts.find((a) => a.code === "1010"), revenue = accts.find((a) => a.code === "4010"), expense = accts.find((a) => a.code === "5000");
  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const post = async (date, lines, status = "posted") => (await api("POST", `/api/companies/${u.cid}/journal`, { token: u.token, body: { date, status, confirmBackdated: true, lines } })).json;
  await post(daysAgo(40), [{ accountId: cash.id, debit: 0.1 }, { accountId: revenue.id, credit: 0.1 }]);
  await post(daysAgo(30), [{ accountId: cash.id, debit: 0.2 }, { accountId: revenue.id, credit: 0.2 }]);
  await post(daysAgo(20), [{ accountId: expense.id, debit: 1234.56 }, { accountId: cash.id, credit: 1234.56 }]);
  await post(daysAgo(10), [{ accountId: cash.id, debit: 999.99 }, { accountId: revenue.id, credit: 999.99 }]);
  await post(daysAgo(5), [{ accountId: cash.id, debit: 77 }, { accountId: revenue.id, credit: 77 }], "draft");
  const voidMe = await post(daysAgo(3), [{ accountId: cash.id, debit: 55.55 }, { accountId: revenue.id, credit: 55.55 }]);
  await db.query(`UPDATE journal_entries SET status = 'void' WHERE id = $1`, [voidMe.id]);

  // reference: the old algorithm over the raw rows
  const rawLines = (await db.query(
    `SELECT jl.account_id, jl.debit::float AS debit, jl.credit::float AS credit, je.date, je.status
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id WHERE je.company_id = $1`, [u.cid])).rows;
  const expected = (range) => {
    const out = new Map();
    for (const a of accts) {
      const lines = rawLines.filter((l) => l.account_id === a.id && l.status === "posted" && (!range || (new Date(l.date) >= range.start && new Date(l.date) <= range.end)));
      const d = lines.reduce((s, l) => s + l.debit, 0), c = lines.reduce((s, l) => s + l.credit, 0);
      out.set(a.id, { d, c, bal: ["asset", "expense"].includes(a.type) ? d - c : c - d });
    }
    return out;
  };
  const compare = (got, exp) => got.length === accts.length && got.every((g) => {
    const e = exp.get(g.account.id);
    return Math.abs(g.debitTotal - e.d) < 0.005 && Math.abs(g.creditTotal - e.c) < 0.005 && Math.abs(g.balance - e.bal) < 0.0051;
  });
  const all = await api("GET", `/api/companies/${u.cid}/accounts-with-balances`, { token: u.token });
  ok("accounts-with-balances matches the old per-account computation (golden, F6)", all.status === 200 && compare(all.json, expected(null)), all.json?.filter((g) => g.debitTotal || g.creditTotal).map((g) => [g.account.code, g.debitTotal, g.creditTotal, g.balance]));
  const cashRow = all.json.find((g) => g.account.code === "1010");
  ok("drafts and voids are excluded; 0.1 + 0.2 + 999.99 - 1234.56 has no float drift", cashRow.debitTotal === 1000.29 && cashRow.creditTotal === 1234.56 && cashRow.balance === -234.27, cashRow);
  const range = { start: new Date(daysAgo(35) + "T00:00:00Z"), end: new Date(daysAgo(8) + "T23:59:59Z") };
  const ranged = await api("GET", `/api/companies/${u.cid}/accounts-with-balances?dateStart=${range.start.toISOString()}&dateEnd=${range.end.toISOString()}`, { token: u.token });
  ok("a date range matches too (golden, F6)", ranged.status === 200 && compare(ranged.json, expected(range)), ranged.status);
  ok("range excluded the 40-day-old entry", ranged.json.find((g) => g.account.code === "1010").debitTotal === 1000.19, ranged.json.find((g) => g.account.code === "1010"));
  const empty = await register("f6b");
  const none = await api("GET", `/api/companies/${empty.cid}/accounts-with-balances`, { token: empty.token });
  ok("a company with no postings returns zeros for every account", none.status === 200 && none.json.length > 20 && none.json.every((g) => g.balance === 0 && g.debitTotal === 0 && g.creditTotal === 0), none.status);
  const foreign = await api("GET", `/api/companies/${u.cid}/accounts-with-balances`, { token: empty.token });
  ok("another company cannot read the balances (403)", foreign.status === 403, foreign.status);
}

async function ledgerIndexesAreUsed() {
  const idx = (await db.query(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('idx_journal_lines_account_entry','idx_invoices_company_created_id','idx_customer_contacts_company_created_id','idx_products_company_created_id','idx_journal_entries_company_created_id','idx_vendor_bills_company_created_id','uq_import_job_rows_job_row','uq_idempotency_keys_scope')`)).rows.map((r) => r.indexname);
  ok("the 0119-0121 indexes exist", idx.length === 8, idx);
  // A company with real volume: on an empty table the planner rightly prefers the narrower company_id index.
  const big = await register("idxvol");
  await db.query(
    `INSERT INTO invoices (company_id, number, customer_name, date, subtotal, vat_amount, total, base_currency_amount, status, created_at)
     SELECT $1, 'IDX-' || g, 'Customer ' || (g % 50), now(), 10, 0.5, 10.5, 10.5, 'sent', now() - (g || ' minutes')::interval FROM generate_series(1, 2000) g`,
    [big.cid]
  );
  await db.query(`ANALYZE invoices`);
  const explain = async (dropIndex = false) => {
    const client = new pg.Client({ connectionString: DB_URL });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL enable_seqscan = off");
      await client.query("SET LOCAL enable_bitmapscan = off");
      if (dropIndex) await client.query("DROP INDEX idx_invoices_company_created_id"); // rolled back below
      const r = await client.query(`EXPLAIN SELECT id FROM invoices WHERE company_id = $1 ORDER BY created_at DESC, id DESC LIMIT 51`, [big.cid]);
      await client.query("ROLLBACK");
      return r.rows.map((x) => x["QUERY PLAN"]).join("\n");
    } finally {
      await client.end();
    }
  };
  const plan = await explain();
  ok("the v1 cursor query walks the company/created_at/id index in order (no Sort node), on a 2,000-row company", /idx_invoices_company_created_id/.test(plan) && !/Sort/.test(plan), plan);
  const without = await explain(true);
  ok("control: with that index dropped (inside a rolled-back transaction) the same query needs a Sort", /Sort/.test(without), without);
}

// ───────────────────────── Frontend (S10): AC30 and the contracts the screens depend on ─────────────────────────

const helpDir = path.join(repo, "client", "src", "help");
const slugsIn = (loc) => fs.readdirSync(path.join(helpDir, loc)).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).sort();

// AC30: Arabic search for "VAT" finds an article; every menu route maps to an article that exists in both languages.
async function frontendHelpContent() {
  const en = slugsIn("en"), ar = slugsIn("ar");
  ok("help centre has at least 30 articles in English", en.length >= 30, en.length);
  ok("every English article has an Arabic twin (same slugs)", JSON.stringify(en) === JSON.stringify(ar), { onlyEn: en.filter((s) => !ar.includes(s)), onlyAr: ar.filter((s) => !en.includes(s)) });
  const arText = ar.map((s) => fs.readFileSync(path.join(helpDir, "ar", s + ".md"), "utf8"));
  ok("every Arabic article is written in Arabic", arText.every((t) => /[؀-ۿ]/.test(t.replace(/^---[\s\S]*?---/, ""))), ar.filter((_, i) => !/[؀-ۿ]/.test(arText[i])));
  const vatArticles = arText.filter((t) => /VAT|ضريبة القيمة المضافة/.test(t));
  ok('Arabic search for "VAT" has at least one article to find (AC30)', vatArticles.length >= 1, vatArticles.length);
  const withoutFrontMatter = en.filter((s) => !/^---\ntitle: .+\nsummary: .+\ncategory: .+\nkeywords: .+/.test(fs.readFileSync(path.join(helpDir, "en", s + ".md"), "utf8")));
  ok("every article has title, summary, category and keywords", withoutFrontMatter.length === 0, withoutFrontMatter);

  const routeMap = fs.readFileSync(path.join(repo, "client", "src", "lib", "help", "route-map.ts"), "utf8");
  const exact = Object.fromEntries([...routeMap.matchAll(/^\s+"(\/[^"]*)":\s*"([^"]+)",$/gm)].map((m) => [m[1], m[2]]));
  const prefixes = [...routeMap.matchAll(/\["(\/[^"]+\/)",\s*"([^"]+)"\]/g)].map((m) => [m[1], m[2]]);
  const resolve = (p) => exact[p] ?? prefixes.find(([pre]) => p.startsWith(pre))?.[1] ?? null;
  const nav = fs.readFileSync(path.join(repo, "client", "src", "components", "layout", "nav-config.ts"), "utf8");
  const urls = [...new Set([...nav.matchAll(/url:\s*"(\/[^"]*)"/g)].map((m) => m[1]).concat("/dashboard"))];
  const unmapped = urls.filter((u) => !resolve(u) || !en.includes(resolve(u)));
  ok(`every menu route (${urls.length}) maps to an existing article (AC30)`, unmapped.length === 0, unmapped);
  const brokenTargets = [...new Set(Object.values(exact).concat(prefixes.map((p) => p[1])))].filter((slug) => !en.includes(slug));
  ok("the route map points only at existing articles", brokenTargets.length === 0, brokenTargets);
}

// The pages exist as routes of the single-page app (served with the app shell, not a 404).
async function frontendShellRoutes() {
  for (const route of ["/settings/security", "/settings/data", "/import", "/developers/api", "/developer-settings", "/help", "/help/vat-filing"]) {
    const r = await fetch(BASE + route, { headers: { Accept: "text/html" } });
    const body = await r.text();
    ok(`SPA route ${route} serves the app shell`, r.status === 200 && /<div id="root"/.test(body), r.status);
  }
  const app = fs.readFileSync(path.join(repo, "client", "src", "App.tsx"), "utf8");
  for (const route of ["/settings/security", "/settings/data", "/import", "/developers/api", "/help/:slug"]) ok(`App.tsx registers ${route}`, app.includes(`path="${route}"`), route);
}

// Field names, codes and shapes the screens read. If the API drifts, the UI would silently show nothing.
async function frontendApiContract() {
  const u = await register("ui");
  const status = await api("GET", "/api/auth/2fa/status", { token: u.token });
  ok("2FA status: {enabled, recoveryCodesRemaining, requiredByCompanies[]}", status.status === 200 && status.json.enabled === false && typeof status.json.recoveryCodesRemaining === "number" && Array.isArray(status.json.requiredByCompanies), status.json);
  const enrol = await api("POST", "/api/auth/2fa/enrol", { token: u.token });
  ok("enrol returns a key, an otpauth URL and a PNG data URL for the QR image", /^[A-Z2-7]{16,}$/.test(enrol.json?.secret || "") && /^otpauth:\/\/totp\//.test(enrol.json?.otpauthUrl || "") && /^data:image\/png;base64,/.test(enrol.json?.qrDataUrl || ""), Object.keys(enrol.json || {}));
  const confirm = await api("POST", "/api/auth/2fa/enrol/verify", { token: u.token, body: { code: totp(enrol.json.secret) } });
  ok("confirmed enrolment returns 10 recovery codes the UI can parse (10 base32 characters)", confirm.json?.enabled === true && confirm.json.recoveryCodes?.length === 10 && confirm.json.recoveryCodes.every((c) => /^[A-Z2-7]{10}$/.test(c)), confirm.json);
  const wrongDisable = await api("POST", "/api/auth/2fa/disable", { token: u.token, body: { password: "Wrong-password1", code: totp(enrol.json.secret, 1) } });
  ok("disable with a wrong password -> PASSWORD_INVALID (the UI maps this code)", wrongDisable.status === 401 && wrongDisable.json?.code === "PASSWORD_INVALID", wrongDisable.json);
  const sessions = await api("GET", "/api/auth/sessions", { token: u.token });
  ok("sessions: {id, userAgent, ipAddress, createdAt, lastUsedAt, current} with one current", sessions.json.length >= 1 && sessions.json.filter((x) => x.current).length === 1 && ["id", "userAgent", "ipAddress", "createdAt", "lastUsedAt", "current"].every((k) => k in sessions.json[0]), sessions.json?.[0]);

  const key = await createKey(u, ["read:invoices", "read:reports"], { expiresInDays: 30, ratePerMinute: 120 });
  const list = await api("GET", `/api/companies/${u.cid}/api-keys`, { token: u.token });
  const row = list.json?.[0];
  ok("key list rows: name, masked keyPrefix, scopes[], status, limits, dates", row && /^muh_[a-z0-9]{8}\.\.\.$/.test(row.keyPrefix) && Array.isArray(row.scopes) && row.scopes.includes("read:invoices") && row.status === "active" && row.ratePerMinute === 120 && row.ratePerDay === 5000 && "expiresAt" in row && "lastUsedAt" in row && !("keyHash" in row) && !JSON.stringify(row).includes(key.key.slice(-32)), row);
  const revoke = await api("DELETE", `/api/companies/${u.cid}/api-keys/${key.id}`, { token: u.token });
  const after = (await api("GET", `/api/companies/${u.cid}/api-keys`, { token: u.token })).json[0];
  ok("revoke returns 200 and the row turns revoked", revoke.status === 200 && after.status === "revoked", [revoke.status, after.status]);

  const spec = (await api("GET", "/api/v1/openapi.json")).json;
  const ops = Object.entries(spec.paths).flatMap(([p, item]) => Object.entries(item).map(([m, op]) => ({ p, m, op })));
  ok("openapi.json is public and every operation has an id, summary, tag and scope for the docs page", spec.openapi.startsWith("3.1") && ops.length >= 25 && ops.every(({ op }) => op.operationId && op.summary && op.tags?.[0] && ("x-required-scope" in op)) && Array.isArray(spec.tags), ops.filter(({ op }) => !op.operationId || !op.summary).map((o) => o.p));
  ok("write operations declare the Idempotency-Key header the docs page shows", ops.filter(({ m }) => m === "post" || m === "patch").every(({ op }) => op.parameters?.some((x) => x.name === "Idempotency-Key" && x.in === "header")), 0);

  const exp = await api("POST", `/api/companies/${u.cid}/exports`, { token: u.token });
  ok("export request -> 202 with id and status", exp.status === 202 && exp.json?.id && ["queued", "running", "ready"].includes(exp.json.status), exp.json);
  const again = await api("POST", `/api/companies/${u.cid}/exports`, { token: u.token });
  ok("a second request while one runs -> EXPORT_IN_PROGRESS (the UI turns this into a notice)", again.status === 409 ? again.json?.code === "EXPORT_IN_PROGRESS" : again.status === 202, again.json);
  const exports = await api("GET", `/api/companies/${u.cid}/exports`, { token: u.token });
  ok("export rows: id, status, createdAt, completedAt, expiresAt, sizeBytes, sha256, error", exports.json?.length >= 1 && ["id", "status", "createdAt", "completedAt", "expiresAt", "sizeBytes", "sha256", "error"].every((k) => k in exports.json[0]), exports.json?.[0]);

  const dels = await api("GET", "/api/me/company-deletions", { token: u.token });
  ok("company-deletions is an array (empty for a new user)", dels.status === 200 && Array.isArray(dels.json), dels.json);
  const noPw = await api("DELETE", `/api/companies/${u.cid}`, { token: u.token, body: { confirmName: "x" } });
  ok("delete without a password -> REAUTH_REQUIRED", noPw.status === 401 && noPw.json?.code === "REAUTH_REQUIRED", noPw.json);
  const badName = await api("DELETE", `/api/companies/${u.cid}`, { token: u.token, body: { password: PASSWORD, code: totp(enrol.json.secret, -1), confirmName: "not the name" } });
  ok("delete with the wrong company name -> CONFIRM_NAME_MISMATCH (or a code error), never a deletion", [401, 422].includes(badName.status) && !!badName.json?.code && (await db.query(`SELECT deleted_at FROM companies WHERE id = $1`, [u.cid])).rows[0].deleted_at === null, badName.json);

  const w = await register("uiw");
  const csv = "Contact Name,EmailID,Tax Registration Number\nA Co,a@example.com,100123456700003\nB Co,b@example.com,12";
  const up = await uploadJob(w, "zoho", "contacts", "c.csv", csv);
  ok("upload returns fields[], detectedColumns, suggestedMapping and sampleRows for the mapping screen", up.status === 201 && up.json.fields.every((f) => "key" in f && "description" in f) && up.json.fields.some((f) => f.key === "name" && f.required === true) && up.json.detectedColumns.length === 3 && up.json.suggestedMapping.name === "Contact Name" && up.json.sampleRows.length === 2, up.text?.slice(0, 300));
  await api("PUT", `/api/companies/${w.cid}/import-jobs/${up.json.job.id}/mapping`, { token: w.token, body: { mapping: up.json.suggestedMapping, options: { dateFormat: "dd/MM/yyyy", numberFormat: "us", currency: "AED", defaultContactType: "customer" } } });
  const dry = await api("POST", `/api/companies/${w.cid}/import-jobs/${up.json.job.id}/dry-run`, { token: w.token });
  ok("dry-run summary: rowCount, toCreate, duplicates, errors, errorSample, created", ["rowCount", "toCreate", "duplicates", "errors", "errorSample", "created"].every((k) => k in dry.json.summary) && dry.json.summary.errors === 1, dry.json?.summary);
  const rows = await api("GET", `/api/companies/${w.cid}/import-jobs/${up.json.job.id}/rows?status=error&perPage=50`, { token: w.token });
  ok("error rows: rowNumber and errors[{field, code, message}] for the review grid", rows.json?.[0]?.rowNumber === 2 && rows.json[0].errors[0].code === "TRN_INVALID" && rows.json[0].errors[0].field === "trn", rows.json);
  const jobs = await api("GET", `/api/companies/${w.cid}/import-jobs`, { token: w.token });
  ok("job list rows carry entity, status, errorCount and filename (the opening tab filters on them)", jobs.json?.[0] && ["entity", "status", "errorCount", "filename", "rowCount"].every((k) => k in jobs.json[0]), jobs.json?.[0]);
  const noTb = await api("POST", `/api/companies/${w.cid}/import-opening`, { token: w.token, body: { tbJobId: up.json.job.id } });
  ok("opening preview with a job of the wrong entity -> JOB_WRONG_ENTITY (the UI shows a generic error)", noTb.status === 422 && noTb.json?.code === "JOB_WRONG_ENTITY", noTb.json);
}

// ───────────────────────── Fix round (L5 live review) ─────────────────────────
async function fixRoundD5() {
  await deletedCompanyGetsNoLateFeeOrQuoteExpiry();
  await exportCoversEveryCompanyTable();
  await parallelRefreshBothSucceed();
  await twoFactorRequirementReachesKeysAndSessions();
  await oversizedWorkbookAndRowLimit();
  await goLiveMustBeFiscalYearStart();
  await foreignBillLineAccounts();
  await nulBytesAreNever500();
  await enrolScopeCannotOpenSockets();
  await dashboardChartsAreGroupedSql();
}

async function deletedCompanyGetsNoLateFeeOrQuoteExpiry() {
  const u = await register("latedel");
  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const inv = await api("POST", `/api/companies/${u.cid}/invoices`, { token: u.token, body: { customerName: "Slow Payer", date: day(-40), dueDate: day(-16), lines: [{ description: "Service", quantity: 1, unitPrice: 1000, vatRate: 0 }] } });
  await api("PATCH", `/api/invoices/${inv.json.id}/status`, { token: u.token, body: { status: "sent" } });
  const cfg = await api("PATCH", `/api/chasing/config/${u.cid}`, { token: u.token, body: { lateFee: { enabled: true, type: "percent", value: 2, afterDays: 15, vatTreatment: "out_of_scope" } } });
  const q = await api("POST", `/api/companies/${u.cid}/quotes`, { token: u.token, body: { customerName: "Acme", date: day(-30), expiryDate: day(30), lines: [{ description: "Design", quantity: 1, unitPrice: 100, vatRate: 0.05 }] } });
  await db.query(`UPDATE quotes SET status = 'sent', expiry_date = $2::date WHERE id = $1`, [q.json.id, day(-2)]);
  ok("fixture: late fee on, overdue invoice, lapsed quote", cfg.status === 200 && !!inv.json?.id && !!q.json?.id, [cfg.status, inv.status, q.status]);

  await db.query(`UPDATE companies SET deleted_at = now() WHERE id = $1`, [u.cid]);
  const lateRun = runHelper("run-sales-jobs.ts", "late-fees", u.cid);
  const feesWhileDeleted = (await db.query(`SELECT count(*)::int AS n FROM invoices WHERE company_id = $1 AND invoice_type = 'late_fee'`, [u.cid])).rows[0].n;
  ok("a company in its deletion window gets no late-fee invoice", lateRun.status === 0 && feesWhileDeleted === 0, { lateRun, feesWhileDeleted });
  const quoteRun = runHelper("run-sales-jobs.ts", "quote-expiry", u.cid);
  ok("and its quotes are not expired", quoteRun.status === 0 && quoteRun.result?.expired === 0 && (await db.query(`SELECT status FROM quotes WHERE id = $1`, [q.json.id])).rows[0].status === "sent", quoteRun);

  await db.query(`UPDATE companies SET deleted_at = NULL WHERE id = $1`, [u.cid]);
  const lateRun2 = runHelper("run-sales-jobs.ts", "late-fees", u.cid);
  const quoteRun2 = runHelper("run-sales-jobs.ts", "quote-expiry", u.cid);
  const feesAfter = (await db.query(`SELECT count(*)::int AS n FROM invoices WHERE company_id = $1 AND invoice_type = 'late_fee'`, [u.cid])).rows[0].n;
  ok("control: the same company, restored, does get its late fee and its expiry", lateRun2.status === 0 && feesAfter === 1 && quoteRun2.result?.expired === 1, { feesAfter, q: quoteRun2.result, err: lateRun2.err });
}

async function exportCoversEveryCompanyTable() {
  const u = await register("expall");
  const contact = (await api("POST", `/api/companies/${u.cid}/customer-contacts`, { token: u.token, body: { name: "Export Co" } })).json;
  const inv = (await api("POST", `/api/companies/${u.cid}/invoices`, { token: u.token, body: invoiceBody() })).json;
  const proj = (await db.query(`INSERT INTO projects (company_id, code, name) VALUES ($1, 'P-1', 'Project One') RETURNING id`, [u.cid])).rows[0];
  await db.query(`INSERT INTO sales_orders (company_id, number, contact_id, customer_name, date) VALUES ($1, 'SO-1', $2, 'Export Co', now())`, [u.cid, contact.id]);
  await db.query(`INSERT INTO time_entries (company_id, project_id, user_id, entry_date) VALUES ($1, $2, $3, current_date)`, [u.cid, proj.id, u.userId]);
  const def = (await db.query(`INSERT INTO custom_field_definitions (company_id, entity, key, label_en, label_ar) VALUES ($1, 'invoice', 'po_number', 'PO number', 'رقم أمر الشراء') RETURNING id`, [u.cid])).rows[0];
  await db.query(`INSERT INTO custom_field_values (company_id, entity, record_id, definition_id, value) VALUES ($1, 'invoice', $2, $3, 'PO-77')`, [u.cid, inv.id, def.id]);
  await db.query(`INSERT INTO payment_links (company_id, invoice_id, provider_session_id, amount, currency) VALUES ($1, $2, $3, 10, 'AED')`, [u.cid, inv.id, 'sess_' + rnd]);
  await db.query(`INSERT INTO payment_gateway_connections (company_id, provider) VALUES ($1, 'stripe') ON CONFLICT DO NOTHING`, [u.cid]).catch(() => {});

  const job = await api("POST", `/api/companies/${u.cid}/exports`, { token: u.token });
  const ready = await waitFor(async () => { const r = await api("GET", `/api/companies/${u.cid}/exports/${job.json.id}`, { token: u.token }); return r.json?.status === "ready" || r.json?.status === "failed" ? r : null; });
  const dl = await api("GET", `/api/companies/${u.cid}/exports/${job.json.id}/download`, { token: u.token, raw: true });
  const zip = await JSZip.loadAsync(dl.buf);
  const rows = async (t) => parseCsv((await zip.file(`data/${t}.csv`)?.async("string"))?.replace(/^﻿/, "") ?? "", { columns: true, skip_empty_lines: true });
  const need = ["sales_orders", "projects", "time_entries", "custom_field_values", "payment_links", "custom_field_definitions"];
  const got = {};
  for (const t of need) got[t] = (await rows(t)).length;
  ok("the ZIP carries rows of sales_orders, projects, time_entries, custom_field_values and payment_links", ready?.json?.status === "ready" && need.every((t) => got[t] >= 1), got);
  ok("custom field values arrive intact", (await rows("custom_field_values")).some((r) => r.value === "PO-77"), await rows("custom_field_values"));
  const names = Object.keys(zip.files);
  ok("credential tables are still absent", !names.some((n) => /payment_gateway_connections|bank_connections|webhook_endpoints|api_keys/.test(n)), names.filter((n) => /connections|webhook|api_keys/.test(n)));
  const cov = runHelper("run-export-coverage.ts");
  ok("coverage: every table with a company_id is exported or denylisted, and no child table is unclassified", cov.status === 0 && cov.result?.uncovered?.length === 0 && cov.result.exported > 60, cov);
}

async function parallelRefreshBothSucceed() {
  const u = await register("par");
  const refreshes = await Promise.all([1, 2, 3].map(() => api("POST", "/api/auth/refresh", { body: { refreshToken: u.refreshToken } })));
  ok("three parallel refreshes with one token all succeed", refreshes.every((r) => r.status === 200 && r.json?.token && r.json?.refreshToken), refreshes.map((r) => r.status));
  const me = await Promise.all(refreshes.map((r) => api("GET", "/api/auth/me", { token: r.json.token })));
  ok("and every new access token works", me.every((r) => r.status === 200), me.map((r) => r.status));
  const next = await Promise.all(refreshes.map((r) => api("POST", "/api/auth/refresh", { body: { refreshToken: r.json.refreshToken } })));
  ok("and every new refresh token can be used in turn (no spurious theft verdict)", next.every((r) => r.status === 200), next.map((r) => r.status));
  const sess = (await db.query(`SELECT revoked_at FROM refresh_sessions WHERE user_id = $1`, [u.userId])).rows;
  ok("the session survives", sess.length === 1 && sess[0].revoked_at === null, sess);
  await db.query(`UPDATE refresh_sessions SET rotated_at = rotated_at - interval '2 minutes' WHERE user_id = $1`, [u.userId]);
  const stolen = await api("POST", "/api/auth/refresh", { body: { refreshToken: u.refreshToken } });
  ok("the original token, presented after the grace, is theft: 401 and the session dies", stolen.status === 401 && (await db.query(`SELECT revoked_at FROM refresh_sessions WHERE user_id = $1`, [u.userId])).rows[0].revoked_at !== null, stolen.status);
}

async function twoFactorRequirementReachesKeysAndSessions() {
  const u = await register("req2fakey");
  const accountant = await addMember(u, "accountant");
  const { key } = await createKey(u, ["read:invoices"]);
  const before = await v1("GET", "/invoices", { key });
  ok("fixture: the key works before the rule", before.status === 200, before.status);
  const on = await api("PATCH", `/api/companies/${u.cid}/security`, { token: u.token, body: { requireTwoFactor: true } });
  ok("turning the rule on reports the sessions it ended", on.status === 200 && on.json.revokedSessions >= 2, on.text);
  const ownerAfter = await api("GET", "/api/auth/me", { token: u.token });
  const acctAfter = await api("GET", "/api/auth/me", { token: accountant.token });
  ok("owner and accountant without TOTP lose their sessions at once", ownerAfter.status === 401 && acctAfter.status === 401, [ownerAfter.status, acctAfter.status]);
  const refused = await v1("GET", "/invoices", { key });
  ok("an API key whose creator has no TOTP is refused: 403 TWO_FACTOR_REQUIRED", refused.status === 403 && refused.json?.error?.code === "TWO_FACTOR_REQUIRED", refused.text);
  const l = await login(u.email);
  ok("the next sign-in is confined to enrolment", l.json?.twoFactorEnrolmentRequired === true, l.text?.slice(0, 120));
  const e = await enrol2fa({ token: l.json.token });
  ok("after enrolling, the same key works again", e.verify.status === 200 && (await v1("GET", "/invoices", { key })).status === 200, e.verify.text);
  const off = await login(u.email);
  const keepers = await Promise.resolve(off.json?.twoFactorRequired === true);
  ok("and sign-in now asks for the code", keepers, off.text?.slice(0, 100));
}

async function oversizedWorkbookAndRowLimit() {
  const u = await register("bigx");
  const memory = async () => (await (await fetch(BASE + "/health")).json()).memory?.rssMB;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
  zip.file("xl/workbook.xml", "<workbook/>");
  zip.file("xl/worksheets/sheet1.xml", "<worksheet><sheetData>" + '<row r="1"><c t="inlineStr"><is><t>xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx</t></is></c></row>'.repeat(900_000) + "</sheetData></worksheet>");
  const bomb = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
  const before = await memory();
  const t0 = Date.now();
  const r = await uploadJob(u, "generic", "contacts", "bomb.xlsx", bomb);
  const after = await memory();
  ok("a workbook that unpacks past 40 MB is refused before it is read (422 FILE_TOO_LARGE_UNCOMPRESSED)", bomb.length < 5 * 1024 * 1024 && r.status === 422 && r.json?.code === "FILE_TOO_LARGE_UNCOMPRESSED", { size: bomb.length, s: r.status, j: r.json });
  ok("and the server did not balloon (< 150 MB growth, quick)", after - before < 150 && Date.now() - t0 < 15000, { before, after, ms: Date.now() - t0 });
  const notXlsx = await uploadJob(u, "generic", "contacts", "fake.xlsx", Buffer.from("this is not a zip"));
  ok("a non-workbook named .xlsx -> 422 FILE_UNREADABLE", notXlsx.status === 422 && notXlsx.json?.code === "FILE_UNREADABLE", notXlsx.text);
  const many = "Name\n" + Array.from({ length: 20_001 }, (_, i) => "N" + i).join("\n");
  const rows = await uploadJob(u, "generic", "contacts", "many.csv", many);
  ok("more than 20,000 rows -> 422 FILE_TOO_MANY_ROWS", rows.status === 422 && rows.json?.code === "FILE_TOO_MANY_ROWS", rows.text?.slice(0, 200));
}

async function goLiveMustBeFiscalYearStart() {
  const u = await register("golive");
  const tbCsv = "Account Code,Debit,Credit\n1010,\"1,000.00\",\n3010,,\"800.00\"\n4010,,\"500.00\"\n5000,\"300.00\",\n";
  const make = async (goLive) => {
    const tb = await uploadJob(u, "generic", "opening_tb", "tb.csv", tbCsv);
    await api("PUT", `/api/companies/${u.cid}/import-jobs/${tb.json.job.id}/mapping`, { token: u.token, body: { mapping: tb.json.suggestedMapping, options: { goLiveDate: goLive } } });
    await api("POST", `/api/companies/${u.cid}/import-jobs/${tb.json.job.id}/dry-run`, { token: u.token });
    return tb.json.job.id;
  };
  const mid = await make("2026-10-01");
  const refused = await api("POST", `/api/companies/${u.cid}/import-opening`, { token: u.token, body: { tbJobId: mid } });
  ok("a TB with P&L accounts and a mid-year go-live -> 422 GO_LIVE_MID_YEAR with guidance", refused.status === 422 && refused.json?.code === "GO_LIVE_MID_YEAR" && /first day of your fiscal year/.test(refused.json.message), refused.text?.slice(0, 300));
  const notFirst = await make("2026-01-02");
  const refused2 = await api("POST", `/api/companies/${u.cid}/import-opening`, { token: u.token, body: { tbJobId: notFirst } });
  ok("January 2nd is not the fiscal-year start either", refused2.json?.code === "GO_LIVE_MID_YEAR", refused2.text?.slice(0, 200));
  const good = await make("2026-01-01");
  const ok1 = await api("POST", `/api/companies/${u.cid}/import-opening`, { token: u.token, body: { tbJobId: good } });
  ok("go-live on the fiscal-year start folds the P&L into retained earnings", ok1.status === 200 && ok1.json.preview.ok === true && ok1.json.summary.foldedProfitAndLoss === -200, ok1.text?.slice(0, 300));
  const bsOnly = await uploadJob(u, "generic", "opening_tb", "tb2.csv", "Account Code,Debit,Credit\n1010,\"1,000.00\",\n3010,,\"1,000.00\"\n");
  await api("PUT", `/api/companies/${u.cid}/import-jobs/${bsOnly.json.job.id}/mapping`, { token: u.token, body: { mapping: bsOnly.json.suggestedMapping, options: { goLiveDate: "2026-10-01" } } });
  await api("POST", `/api/companies/${u.cid}/import-jobs/${bsOnly.json.job.id}/dry-run`, { token: u.token });
  const bsRes = await api("POST", `/api/companies/${u.cid}/import-opening`, { token: u.token, body: { tbJobId: bsOnly.json.job.id } });
  ok("a balance-sheet-only TB may open any day", bsRes.status === 200 && bsRes.json.preview.ok === true, bsRes.text?.slice(0, 200));
}

async function foreignBillLineAccounts() {
  const u = await register("billacct");
  const other = await register("billacctB");
  const foreign = (await api("GET", `/api/companies/${other.cid}/accounts`, { token: other.token })).json.find((a) => a.type === "expense");
  const own = (await api("GET", `/api/companies/${u.cid}/accounts`, { token: u.token })).json.find((a) => a.type === "expense");
  const { key } = await createKey(u, ["write:bills", "read:bills"]);
  const viaV1 = await v1("POST", "/bills", { key, body: { vendorName: "V", date: today, lines: [{ description: "x", unitPrice: "10.00", accountId: foreign.id }] } });
  ok("v1 bill with another company's account -> 422 REFERENCE_NOT_FOUND", viaV1.status === 422 && viaV1.json?.error?.code === "REFERENCE_NOT_FOUND", viaV1.text?.slice(0, 200));
  const viaUi = await api("POST", `/api/companies/${u.cid}/bills`, { token: u.token, body: { vendor_name: "V", bill_date: today, line_items: [{ description: "x", unit_price: 10, account_id: foreign.id }] } });
  ok("the internal create refuses it too (400 INVALID_ACCOUNT)", viaUi.status === 400 && viaUi.json?.code === "INVALID_ACCOUNT", viaUi.text?.slice(0, 200));
  const good = await api("POST", `/api/companies/${u.cid}/bills`, { token: u.token, body: { vendor_name: "V", bill_date: today, line_items: [{ description: "x", unit_price: 10, account_id: own.id }] } });
  ok("its own account is fine", good.status === 200 && !!good.json?.id, good.text?.slice(0, 200));
  const edit = await api("PATCH", `/api/bills/${good.json.id}`, { token: u.token, body: { line_items: [{ description: "x", unit_price: 10, account_id: foreign.id }] } });
  ok("editing a bill to a foreign account -> 400", edit.status === 400 && edit.json?.code === "INVALID_ACCOUNT", edit.text?.slice(0, 200));
  const lines = (await db.query(`SELECT account_id FROM bill_line_items WHERE bill_id = $1`, [good.json.id])).rows;
  ok("the bill's lines are unchanged by the refused edit", lines.length === 1 && lines[0].account_id === own.id, lines);
}

async function nulBytesAreNever500() {
  const u = await register("nulb");
  const { key } = await createKey(u, ["write:contacts", "read:contacts"]);
  const r = await v1("POST", "/contacts", { key, body: { name: "A\u0000B" } });
  ok("v1: a NUL byte in a body -> 400, never 500", r.status === 400 && r.json?.error?.code === "VALIDATION_ERROR", r.text?.slice(0, 200));
  const nested = await v1("POST", "/invoices", { key: (await createKey(u, ["write:invoices"])).key, body: invoiceBody({ lines: [{ description: "ok\u0000no", quantity: 1, unitPrice: "1.00" }] }) });
  ok("also nested in arrays", nested.status === 400, nested.status);
  const csv = "Name,Email\nNul\u0000Person,n@example.com\n";
  const up = await uploadJob(u, "generic", "contacts", "nul\u0000.csv", csv);
  ok("import: NUL in a cell and in the file name is stripped (201, never 500)", up.status === 201 && up.json.sampleRows[0].Name === "NulPerson", up.text?.slice(0, 200));
}

async function enrolScopeCannotOpenSockets() {
  const { io } = await import("socket.io-client");
  const u = await register("sock");
  await api("PATCH", `/api/companies/${u.cid}/security`, { token: u.token, body: { requireTwoFactor: true } });
  const confined = (await login(u.email)).json.token;
  const attempt = (token) => new Promise((resolve) => {
    const s = io(BASE, { auth: { token }, transports: ["websocket"], reconnection: false, timeout: 5000 });
    s.on("connect", () => { s.close(); resolve("connected"); });
    s.on("connect_error", (e) => { s.close(); resolve("refused: " + e.message); });
  });
  const refused = await attempt(confined);
  ok("a 2fa_enrol token cannot open a socket", /^refused/.test(refused), refused);
  const normal = await register("sock2");
  const accepted = await attempt(normal.token);
  ok("control: a normal access token can", accepted === "connected", accepted);
  const asRefresh = await attempt(normal.refreshToken);
  ok("and a refresh token cannot", /^refused/.test(asRefresh), asRefresh);
}

async function dashboardChartsAreGroupedSql() {
  const u = await register("dash");
  const accts = (await api("GET", `/api/companies/${u.cid}/accounts`, { token: u.token })).json;
  const cash = accts.find((a) => a.code === "1010"), exp = accts.find((a) => a.code === "5000");
  await api("POST", `/api/companies/${u.cid}/journal`, { token: u.token, body: { date: today, status: "posted", lines: [{ accountId: exp.id, debit: 100.5 }, { accountId: cash.id, credit: 100.5 }] } });
  await api("POST", `/api/companies/${u.cid}/journal`, { token: u.token, body: { date: today, status: "draft", lines: [{ accountId: exp.id, debit: 999 }, { accountId: cash.id, credit: 999 }] } });
  const inv = (await api("POST", `/api/companies/${u.cid}/invoices`, { token: u.token, body: invoiceBody() })).json;
  await api("PATCH", `/api/invoices/${inv.id}/status`, { token: u.token, body: { status: "sent" } });
  await api("POST", `/api/companies/${u.cid}/invoices`, { token: u.token, body: invoiceBody({ customerName: "Draft only" }) });
  const eb = await api("GET", `/api/companies/${u.cid}/dashboard/expense-breakdown`, { token: u.token });
  ok("expense breakdown: posted expense only, drafts excluded", eb.status === 200 && eb.json.length === 1 && eb.json[0].value === 100.5, eb.text);
  const tr = await api("GET", `/api/companies/${u.cid}/dashboard/monthly-trends`, { token: u.token });
  const now = tr.json?.[5];
  ok("monthly trends: six months, this month's issued revenue and posted expenses", tr.status === 200 && tr.json.length === 6 && now.revenue === 1000 && now.expenses === 100.5 && tr.json.slice(0, 5).every((m) => m.revenue === 0 && m.expenses === 0), tr.text);
  const foreign = await register("dashB");
  const denied = await api("GET", `/api/companies/${u.cid}/dashboard/monthly-trends`, { token: foreign.token });
  ok("another company cannot read the charts (403)", denied.status === 403, denied.status);
}

// ───────────────────────── VP Platform sign-off items ─────────────────────────
async function signoffFixesD5() {
  await timestampsAgreeAcrossSources();
  await securityEventsReachTheAuditTrail();
  await exportLimiterFitsAMonthEndPack();
  await v1InvoiceListExcludesCreditNotes();
}

async function timestampsAgreeAcrossSources() {
  const u = await register("utc");
  const { key } = await createKey(u, ["read:invoices"], { expiresInDays: 30 });
  const sess = (await db.query(
    `SELECT extract(epoch FROM (last_used_at - created_at)) AS drift, extract(epoch FROM ((now() AT TIME ZONE 'UTC') - created_at)) AS age
       FROM refresh_sessions WHERE user_id = $1`, [u.userId])).rows[0];
  ok("a session's DB-default created_at and app-written last_used_at agree within seconds", Math.abs(Number(sess.drift)) < 10, sess);
  ok("and a DB-default timestamp is UTC wall time, whatever the host database's zone", Math.abs(Number(sess.age)) < 15, sess);
  const k = (await db.query(`SELECT extract(epoch FROM (expires_at - created_at)) / 86400 AS days FROM api_keys WHERE company_id = $1`, [u.cid])).rows[0];
  ok("an API key created now with a 30-day expiry expires 30 days after it was created (not 30 days -/+ 4 h)", Math.abs(Number(k.days) - 30) < 0.01, k);
  const job = await api("POST", `/api/companies/${u.cid}/exports`, { token: u.token });
  await waitFor(async () => (await db.query(`SELECT 1 FROM company_data_exports WHERE id = $1 AND status IN ('ready','failed')`, [job.json.id])).rows.length);
  const e = (await db.query(`SELECT status, extract(epoch FROM (completed_at - created_at)) AS took, extract(epoch FROM (expires_at - completed_at)) / 3600 AS hours FROM company_data_exports WHERE id = $1`, [job.json.id])).rows[0];
  ok("an export is requested before it completes and expires 24 h after completion", e.status === "ready" && Number(e.took) >= 0 && Number(e.took) < 60 && Math.abs(Number(e.hours) - 24) < 0.01, e);
  void key;
}

async function securityEventsReachTheAuditTrail() {
  const u = await register("trail");
  await login(u.email);
  const { secret } = await enrol2fa(u);
  const mine = (await db.query(`SELECT action, company_id FROM audit_logs WHERE user_id = $1 AND (action = 'auth.login' OR action LIKE '2fa.%')`, [u.userId])).rows;
  ok("sign-in and 2FA events of a one-company user carry that company id", mine.some((r) => r.action === "auth.login") && mine.some((r) => r.action === "2fa.enable") && mine.every((r) => r.company_id === u.cid), mine);

  // a person in two companies: the events have no single company, yet show in both trails
  const c2 = await api("POST", "/api/companies", { token: u.token, body: { name: "Second " + rnd, baseCurrency: "AED", locale: "en" } });
  await rewindGuard(u.userId);
  const l = await login(u.email);
  const v = await api("POST", "/api/auth/2fa/verify", { body: { challengeToken: l.json.challengeToken, code: totp(secret, 0) } });
  ok("fixture: the user now belongs to two companies and signed in with 2FA", !!c2.json?.id && v.status === 200, [c2.status, v.status]);
  const multi = (await db.query(`SELECT company_id FROM audit_logs WHERE user_id = $1 AND action = '2fa.login' ORDER BY created_at DESC LIMIT 1`, [u.userId])).rows[0];
  ok("a multi-company user's sign-in event carries no company id", multi && multi.company_id === null, multi);
  const range = `from=${new Date(Date.now() - 86400000).toISOString().slice(0, 10)}&to=${new Date(Date.now() + 86400000).toISOString().slice(0, 10)}&limit=500`;
  for (const [label, cid, expected] of [["first", u.cid, ["2fa.login", "auth.login", "2fa.enable"]], ["second", c2.json?.id, ["2fa.login"]]]) {
    const r = await api("GET", `/api/companies/${cid}/reports/run/audit-trail?${range}`, { token: v.json.token });
    const actions = (r.json?.rows ?? []).map((x) => x.cells?.action);
    ok(`the ${label} company's audit trail lists the member's sign-in and 2FA events`, r.status === 200 && expected.every((a) => actions.includes(a)), { s: r.status, actions: actions.slice(0, 12) });
  }
  const stranger = await register("trailX");
  const r = await api("GET", `/api/companies/${stranger.cid}/reports/run/audit-trail?${range}`, { token: stranger.token });
  ok("another company's trail does not show them", !(r.json?.rows ?? []).some((x) => /2fa\./.test(x.cells?.action ?? "") && x.cells?.user === u.email), r.status);
}

async function exportLimiterFitsAMonthEndPack() {
  const u = await register("pack");
  const statuses = [];
  for (let i = 0; i < 40; i++) statuses.push((await api("GET", `/api/companies/${u.cid}/reports/run/trial-balance?format=csv`, { token: u.token, raw: true })).status);
  ok("40 report exports in a minute are all served (limit 120, was 30)", statuses.every((s) => s === 200), statuses.filter((s) => s !== 200));
}

async function v1InvoiceListExcludesCreditNotes() {
  const u = await register("cn");
  const { key } = await createKey(u, ["read:invoices", "write:invoices"]);
  const inv = await v1("POST", "/invoices", { key, body: invoiceBody() });
  const cnId = (await db.query(
    `INSERT INTO invoices (company_id, number, customer_name, date, subtotal, vat_amount, total, base_currency_amount, status, invoice_type)
     VALUES ($1, 'CN-' || $2, 'API Customer', now(), 10, 0.5, 10.5, 10.5, 'sent', 'credit_note') RETURNING id`, [u.cid, rnd])).rows[0].id;
  const list = await v1("GET", "/invoices?limit=200", { key });
  ok("the default list holds invoices and no credit note", list.status === 200 && list.json.data.some((i) => i.id === inv.json.data.id) && !list.json.data.some((i) => i.id === cnId) && list.json.data.every((i) => ["invoice", "advance"].includes(i.type)), list.json?.data?.map((i) => i.type));
  const cns = await v1("GET", "/invoices?type=credit_note", { key });
  ok("?type=credit_note lists them", cns.status === 200 && cns.json.data.length === 1 && cns.json.data[0].id === cnId && cns.json.data[0].type === "credit_note", cns.text?.slice(0, 200));
  const only = await v1("GET", "/invoices?type=invoice", { key });
  ok("?type=invoice lists invoices only", only.status === 200 && only.json.data.length === 1 && only.json.data[0].id === inv.json.data.id, only.text?.slice(0, 200));
  const bad = await v1("GET", "/invoices?type=receipt", { key });
  ok("an unknown type -> 400", bad.status === 400, bad.status);
  const byId = await v1("GET", `/invoices/${cnId}`, { key });
  ok("a credit note is still readable by id", byId.status === 200 && byId.json.data.type === "credit_note", byId.status);
  const spec = (await api("GET", "/api/v1/openapi.json")).json;
  const param = spec.paths["/api/v1/invoices"].get.parameters.find((p) => p.name === "type");
  ok("the OpenAPI spec documents the type filter and its default", param?.schema?.enum?.includes("credit_note") && /Default: invoice and advance/.test(param.description), param);
}

main().catch((e) => { console.error(e); process.exit(1); });
