import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";

const capture = vi.hoisted(() => vi.fn());
vi.mock("../../server/services/monitoring", () => ({ captureException: capture }));
vi.mock("../../server/config/logger", () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { registerClientErrorRoutes } from "../../server/routes/client-errors.routes";

async function post(body: unknown) {
  const app = express();
  app.use(express.json());
  registerClientErrorRoutes(app);
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (typeof addr === "string" || !addr) throw new Error("no address");
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/client-errors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.status;
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

describe("POST /api/client-errors", () => {
  beforeEach(() => capture.mockClear());

  it("forwards a client crash to captureException once, tagged as client-side, without the query string", async () => {
    const status = await post({
      message: "Cannot read properties of undefined",
      stack: "TypeError: x\n at Foo (https://app.example/assets/a.js:1:1)",
      url: "https://app.example/invoices?token=secret123",
      boundary: "App",
    });
    expect(status).toBe(204);
    expect(capture).toHaveBeenCalledTimes(1);
    const [err, ctx] = capture.mock.calls[0];
    expect((err as Error).message).toContain("Cannot read properties");
    expect(ctx.source).toBe("client");
    expect(JSON.stringify(ctx)).not.toContain("secret123");
  });

  it("rejects an invalid payload without forwarding", async () => {
    expect(await post({ nope: true })).toBe(400);
    expect(capture).not.toHaveBeenCalled();
  });
});
