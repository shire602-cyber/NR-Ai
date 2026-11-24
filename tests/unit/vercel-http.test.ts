import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../server/app";
import { pingDb } from "../../server/db";
import { registerRoutes } from "../../server/routes";

vi.mock("../../server/db", () => ({ pool: {}, pingDb: vi.fn() }));
vi.mock("../../server/auth", () => ({}));
vi.mock("../../server/routes/admin-health.routes", () => ({
  createHealthHandler: () => vi.fn(),
}));
vi.mock("../../server/routes", () => ({ registerRoutes: vi.fn() }));

let server: Server;
let origin: string;

beforeAll(async () => {
  vi.mocked(registerRoutes).mockImplementationOnce(async (app) => {
    app.post("/api/webhooks/email-intake", (req, res) => {
      res.json({ bytes: Buffer.isBuffer(req.body) ? req.body.length : null });
    });
  });
  const app = await createApp({ vercel: true });
  app.get("*", (_req, res) => res.type("html").send("<html>SPA</html>"));
  server = createServer(app).listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(pingDb).mockReset();
});

describe("Vercel HTTP app", () => {
  it("parses a signed-email-sized raw body above the normal API ceiling", async () => {
    const bytes = 11 * 1024 * 1024;
    const response = await fetch(origin + "/api/webhooks/email-intake", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: Buffer.alloc(bytes),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ bytes });
  });

  it.each(["/api", "/api/missing?search=one", "/API/missing"])(
    "answers %s with an uncached API 404 before the document fallback",
    async (pathname) => {
      const response = await fetch(origin + pathname);
      expect(response.status).toBe(404);
      expect(response.headers.get("Vercel-CDN-Cache-Control")).toBe("no-store");
      expect(await response.json()).toMatchObject({ code: "ROUTE_NOT_FOUND" });
    }
  );

  it("reports the Vercel revision without running startup DB work", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "vercel-revision");
    vi.stubEnv("RAILWAY_GIT_COMMIT_SHA", "railway-revision");
    const response = await fetch(origin + "/api/version");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ commit: "vercel-revision" });
    expect(pingDb).not.toHaveBeenCalled();
    expect(registerRoutes).toHaveBeenCalledExactlyOnceWith(expect.any(Function), {
      retireBankingOnStartup: false,
    });
  });

  it("reports database readiness and avoids caching the result", async () => {
    vi.mocked(pingDb)
      .mockResolvedValueOnce({ ok: false, latencyMs: 7 })
      .mockResolvedValueOnce({ ok: true, latencyMs: 3 });
    for (const [status, database] of [
      [503, "error"],
      [200, "ok"],
    ] as const) {
      const response = await fetch(origin + "/health/ready");
      expect(response.status).toBe(status);
      expect(response.headers.get("CDN-Cache-Control")).toBe("no-store");
      expect(await response.json()).toMatchObject({ checks: { database } });
    }
  });
});
