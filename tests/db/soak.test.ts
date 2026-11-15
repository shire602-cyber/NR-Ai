/**
 * Soak / stability test (R20-06, merged R02-15, R03-17, R13-17).
 *
 * Boots the REAL entrypoint (server/index.ts) in a child process against a fresh harness database, fires 300 mixed
 * requests at concurrency 20 — valid reads/writes plus malformed JSON,
 * oversized bodies, bad ids, garbage auth, prototype-pollution keys and
 * unknown routes — and asserts the process never exits, every request gets
 * an HTTP answer, and /health/live keeps answering. It then raises an
 * unhandled promise rejection inside the server and asserts it is logged
 * and not fatal.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HARNESS_DB_PREFIX, createDatabase, databaseUrl, dropDatabase, repoRoot } from "./pg-admin";

const enabled = process.env.HARNESS_MODE === "postgres";
const adminUrl = process.env.HARNESS_ADMIN_URL ?? "";
const dbName = `${HARNESS_DB_PREFIX}soak_${process.pid}_${randomBytes(3).toString("hex")}_${Date.now().toString(36)}`;

let child: ChildProcess | null = null;
let base = "";
let output = "";
let exited: { code: number | null; signal: string | null } | null = null;
// NODE_ENV=test makes server/index.ts serve the built SPA from dist/public.
// When no build exists yet, a placeholder is created for the run and removed
// afterwards. (Development mode is not used: it boots Vite, which cannot
// write its temp files once the server drops root privileges.)
const distPublic = path.join(repoRoot, "dist", "public");
let createdDist: string | null = null;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

async function waitForLive(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`server exited during boot: ${JSON.stringify(exited)}\n${output}`);
    try {
      const r = await fetch(`${base}/health/live`);
      if (r.status === 200) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not become live in ${timeoutMs} ms\n${output.slice(-4000)}`);
}

async function call(method: string, url: string, init: RequestInit = {}) {
  try {
    const r = await fetch(base + url, { method, redirect: "manual", ...init });
    const text = await r.text();
    let body: any = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: r.status, body };
  } catch (err: any) {
    return { status: -1, body: String(err?.cause?.code ?? err?.message ?? err) };
  }
}

describe.skipIf(!enabled)("soak: real server survives mixed and malformed traffic", () => {
  beforeAll(async () => {
    await createDatabase(adminUrl, dbName, process.env.HARNESS_TEMPLATE_DB);
    if (!fs.existsSync(distPublic)) {
      createdDist = fs.existsSync(path.dirname(distPublic)) ? distPublic : path.dirname(distPublic);
      fs.mkdirSync(distPublic, { recursive: true });
      fs.writeFileSync(path.join(distPublic, "index.html"), "<!doctype html><title>soak</title>");
    }
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    child = spawn(
      process.execPath,
      ["--import", "tsx", "--import", "./tests/db/soak-preload.mjs", "server/index.ts"],
      {
        cwd: repoRoot,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          DOTENV_CONFIG_PATH: path.join(repoRoot, "tests/db/.no-env"),
          DOTENV_CONFIG_QUIET: "true",
          NODE_ENV: "test",
          PORT: String(port),
          DATABASE_URL: databaseUrl(adminUrl, dbName),
          SESSION_SECRET: "soak-session-secret-at-least-32-characters!!",
          JWT_SECRET: "soak-jwt-secret-at-least-32-characters-long!!",
          FRONTEND_URL: base,
          LOG_LEVEL: "error",
          AUTO_MIGRATE_ON_BOOT: "false",
          RL_API_MAX: "1000000",
          RL_READ_MAX: "1000000",
          RL_AUTH_MAX: "1000000",
          RL_AI_MAX: "1000000",
          NODE_OPTIONS: "--max-old-space-size=2048",
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    child.stdout!.on("data", (d) => (output += d.toString()));
    child.stderr!.on("data", (d) => (output += d.toString()));
    child.on("exit", (code, signal) => (exited = { code, signal }));
    await waitForLive(120_000);
  }, 180_000);

  afterAll(async () => {
    if (child && !exited) {
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 1500));
      if (!exited) child.kill("SIGKILL");
    }
    await dropDatabase(adminUrl, dbName).catch(() => undefined);
    if (createdDist) fs.rmSync(createdDist, { recursive: true, force: true });
  }, 60_000);

  it("300 mixed requests at concurrency 20 never take the process down", async () => {
    const email = `soak_${randomBytes(4).toString("hex")}@harness.test`;
    const reg = await call("POST", "/api/auth/register", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Soak", email, password: "SoakPassw0rd!" }),
    });
    expect(reg.status, JSON.stringify(reg.body)).toBe(200);
    const token = reg.body.token as string;
    const cid = reg.body.company.id as string;
    const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const today = new Date().toISOString().slice(0, 10);
    const huge = "x".repeat(2 * 1024 * 1024);

    const scenarios: Array<() => Promise<{ status: number; body: any }>> = [
      () => call("GET", `/api/companies/${cid}/accounts`, { headers: auth }),
      () => call("GET", `/api/companies/${cid}/invoices`, { headers: auth }),
      () => call("GET", `/api/companies/${cid}/dashboard/stats`, { headers: auth }),
      () => call("GET", `/api/companies/${cid}/reports/trial-balance`, { headers: auth }),
      () =>
        call("POST", `/api/companies/${cid}/invoices`, {
          headers: auth,
          body: JSON.stringify({
            customerName: "Soak",
            date: today,
            lines: [{ description: "x", quantity: 1, unitPrice: 10, vatRate: 5 }],
          }),
        }),
      // Malformed JSON
      () => call("POST", `/api/companies/${cid}/invoices`, { headers: auth, body: '{"lines": [' }),
      // Oversized body on a 1 MB route
      () =>
        call("POST", `/api/companies/${cid}/journal`, {
          headers: auth,
          body: JSON.stringify({ d: huge }),
        }),
      // Wrong types / absurd numbers
      () =>
        call("POST", `/api/companies/${cid}/journal`, {
          headers: auth,
          body: JSON.stringify({ date: "not-a-date", lines: [{ accountId: 42, debit: "1e309" }] }),
        }),
      // Invalid UUIDs in the path
      () => call("GET", `/api/invoices/not-a-uuid`, { headers: auth }),
      () => call("GET", `/api/companies/'%20OR%201=1--/accounts`, { headers: auth }),
      // Garbage / missing auth
      () =>
        call("GET", `/api/companies/${cid}/accounts`, {
          headers: { Authorization: "Bearer garbage" },
        }),
      () => call("GET", `/api/companies/${cid}/accounts`),
      // Prototype pollution keys
      () =>
        call("PATCH", `/api/companies/${cid}`, {
          headers: auth,
          body: '{"__proto__":{"isAdmin":true},"constructor":{"prototype":{"x":1}}}',
        }),
      // Deeply nested JSON
      () =>
        call("POST", `/api/companies/${cid}/contacts`, {
          headers: auth,
          body: "[".repeat(5000) + "]".repeat(5000),
        }),
      // Unknown route and wrong method
      () => call("GET", `/api/does-not-exist/${randomBytes(2).toString("hex")}`, { headers: auth }),
      () => call("DELETE", `/api/companies/${cid}/reports/trial-balance`, { headers: auth }),
    ];

    const results: Array<{ status: number; body: any }> = [];
    let next = 0;
    const worker = async () => {
      while (next < 300) {
        const i = next++;
        results.push(await scenarios[i % scenarios.length]());
        if (i % 50 === 0) {
          const live = await call("GET", "/health/live");
          expect(live.status).toBe(200);
        }
      }
    };
    await Promise.all(Array.from({ length: 20 }, worker));

    expect(results.length).toBe(300);
    const noAnswer = results.filter((r) => r.status < 0);
    expect(noAnswer, "requests that got no HTTP response (reset/refused)").toEqual([]);
    expect(exited, `server exited: ${output.slice(-2000)}`).toBeNull();
    expect((await call("GET", "/health/live")).status).toBe(200);
    const fiveXX = results.filter((r) => r.status >= 500).length;
    console.log(
      `[soak] 300 requests: ${fiveXX} x 5xx, statuses=${JSON.stringify(
        results.reduce<Record<number, number>>(
          (m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m),
          {}
        )
      )}`
    );
  }, 300_000);

  it("an unhandled promise rejection is logged, not fatal", async () => {
    child!.kill("SIGUSR2");
    const deadline = Date.now() + 10_000;
    while (!output.includes("harness-unhandled-rejection-probe") && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(output).toContain("harness-unhandled-rejection-probe");
    await new Promise((r) => setTimeout(r, 1000));
    expect(exited).toBeNull();
    expect((await call("GET", "/health/live")).status).toBe(200);
  }, 60_000);
});
