import { EMAIL_INTAKE_LIMIT, LARGE_JSON_LIMIT } from "../../server/http/body-limits";
import { assertUploadSize } from "../../server/http/upload-errors";
import { asyncHandler } from "../../server/middleware/errorHandler";
import { MAX_UPLOAD_BYTES } from "../../shared/upload-limits";
import ar from "../../client/src/locales/ar/serverErrors.json";
import en from "../../client/src/locales/en/serverErrors.json";
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
    for (const pathname of [
      "/api/companies/company-id/bank-statements/import",
      "/api/firm/vat-workpapers/workpaper-id/scan",
    ]) {
      app.post(
        pathname,
        asyncHandler(async (req, res) => {
          const bytes = Buffer.from(req.body.fileBase64, "base64").length;
          assertUploadSize(bytes);
          res.json({ bytes });
        })
      );
    }
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
  it("parses a signed email body at the 2 MB limit", async () => {
    const bytes = EMAIL_INTAKE_LIMIT;
    const response = await fetch(origin + "/api/webhooks/email-intake", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: Buffer.alloc(bytes),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ bytes });
  });

  it.each([
    ["en", en],
    ["ar", ar],
  ] as const)("rejects an oversized signed email body in %s", async (language, catalog) => {
    const response = await fetch(origin + "/api/webhooks/email-intake", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "Accept-Language": language },
      body: Buffer.alloc(EMAIL_INTAKE_LIMIT + 1),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      message: catalog["serverErrors.PAYLOAD_TOO_LARGE"],
    });
  });

  it.each([
    "/api/companies/company-id/bank-statements/import",
    "/api/firm/vat-workpapers/workpaper-id/scan",
  ])("allows base64 overhead and caps decoded bytes on %s", async (pathname) => {
    expect(LARGE_JSON_LIMIT).toBeLessThan(4_500_000);
    const upload = (size: number) =>
      fetch(origin + pathname, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept-Language": "ar",
          Authorization: "Bearer route-test",
        },
        body: JSON.stringify({ fileBase64: Buffer.alloc(size).toString("base64") }),
      });
    const atLimit = await upload(MAX_UPLOAD_BYTES);
    expect(atLimit.status).toBe(200);
    expect(await atLimit.json()).toEqual({ bytes: MAX_UPLOAD_BYTES });
    const oversized = await upload(MAX_UPLOAD_BYTES + 1);
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({
      code: "FILE_TOO_LARGE",
      message: ar["serverErrors.FILE_TOO_LARGE"],
    });
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
