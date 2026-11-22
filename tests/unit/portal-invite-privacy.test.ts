import express from "express";
import type { AddressInfo } from "node:net";
import { expect, it, vi } from "vitest";
import { cspReportHandler } from "../../server/middleware/csp";
import {
  asyncHandler,
  globalErrorHandler,
  notFoundHandler,
} from "../../server/middleware/errorHandler";
import { buildLimiter } from "../../server/middleware/rateLimit";
import { requestLogger } from "../../server/middleware/requestLogger";
import { applySecurityMiddleware } from "../../server/middleware/security";
import { registerClientErrorRoutes } from "../../server/routes/client-errors.routes";

const logs = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("../../server/config/logger", () => ({ createLogger: () => logs }));

it("keeps invite credentials out of request logs, throttling, error reports and CSP reports", async () => {
  const token = "a1".repeat(32);
  const link = `https://example.test/portal/join#t=${token}`;
  const invitePath = "/api/portal-invitations";
  const app = express();
  applySecurityMiddleware(app);
  app.use(express.json());
  app.use(requestLogger);
  registerClientErrorRoutes(app);
  app.post("/api/test-report", cspReportHandler);
  app.post(
    `${invitePath}/lookup`,
    asyncHandler(async (req) => {
      throw new Error(`A downstream error echoed ${req.body.token} and ${link}`);
    })
  );
  app.get(
    `${invitePath}/:legacyToken/limited`,
    buildLimiter({ windowMs: 60_000, max: 1, message: "Slow down" }),
    (_req, res) => {
      res.sendStatus(204);
    }
  );
  app.use(notFoundHandler);
  app.use(globalErrorHandler);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const failed = await fetch(`${base}${invitePath}/lookup?copy=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": link },
      body: JSON.stringify({ token }),
    });
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toContain(token);
    const legacy = await fetch(`${base}${invitePath}/${token}?value=javascript:bad`);
    expect(legacy.status).toBe(404);
    expect(await legacy.text()).not.toContain(token);
    expect((await fetch(`${base}${invitePath}/${token}/limited`)).status).toBe(204);
    expect((await fetch(`${base}${invitePath}/${token}/limited`)).status).toBe(429);
    const encoded = [...token].map((c) => `%${c.charCodeAt(0).toString(16)}`).join("");
    const report = await fetch(`${base}/api/client-errors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: link,
        message: `An error echoed ${token}`,
        stack: `encoded ${encoded}`,
      }),
    });
    expect(report.status).toBe(204);
    expect(logs.error).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/portal/join",
        message: "An error echoed [redacted]",
        stack: "encoded [redacted]",
      }),
      "Client-side error reported"
    );
    expect(
      (
        await fetch(`${base}/api/test-report`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ "csp-report": { "document-uri": link, "blocked-uri": link } }),
        })
      ).status
    ).toBe(204);

    expect(logs.error).toHaveBeenCalledWith(
      expect.objectContaining({ captured: true, route: invitePath }),
      expect.any(String)
    );
    expect(logs.warn).toHaveBeenCalledWith(
      expect.objectContaining({ path: invitePath }),
      "Rate limit exceeded"
    );
    expect(logs.warn).toHaveBeenCalledWith(
      expect.objectContaining({ url: invitePath }),
      "Suspicious request detected"
    );
    expect(logs.warn).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/portal/join" }),
      "CSP violation reported"
    );
    const output = JSON.stringify(Object.values(logs).flatMap((level) => level.mock.calls));
    expect(output).not.toContain(token);
    expect(output).not.toContain(encoded);
    expect(output).not.toContain("#t=");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
