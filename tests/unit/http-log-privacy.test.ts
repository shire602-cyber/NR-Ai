import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("../../server/config/logger", () => ({ createLogger: () => log }));

import { cspReportHandler } from "../../server/middleware/csp";
import { requestLogger } from "../../server/middleware/requestLogger";
import { captureException } from "../../server/services/monitoring";

describe("HTTP log privacy", () => {
  it("records the route template and omits raw request data", () => {
    const req = {
      id: "trace-id",
      method: "GET",
      originalUrl: "/api/share/sample-link?email=sample@example.test",
      route: { path: "/api/share/:token" },
      ip: "203.0.113.1",
      user: { id: "sample-user" },
    } as Request;
    const response = Object.assign(new EventEmitter(), { statusCode: 200 });
    requestLogger(req, response as unknown as Response, vi.fn());
    response.emit("finish");

    expect(log.info).toHaveBeenCalledWith(
      {
        requestId: "trace-id",
        method: "GET",
        route: "/api/share/:token",
        statusCode: 200,
        duration: expect.stringMatching(/^\d+ms$/),
      },
      expect.stringMatching(/^GET 200 in \d+ms$/)
    );
  });

  it("logs only recognized CSP directives and correlation IDs", () => {
    const req = {
      id: "trace-id",
      body: {
        "csp-report": {
          "effective-directive": "style-src-elem",
          "document-uri": "https://example.test/share/sample-link",
          "blocked-uri": "https://example.test/path?email=sample@example.test",
          "source-file": "https://example.test/sample.js",
          "line-number": 12,
        },
      },
    } as Request;
    const res = { status: vi.fn().mockReturnThis(), end: vi.fn() } as unknown as Response;
    cspReportHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(log.warn).toHaveBeenCalledWith(
      { requestId: "trace-id", directive: "style-src-elem" },
      "CSP violation reported"
    );

    log.warn.mockClear();
    req.body = { "effective-directive": "unrecognized" };
    cspReportHandler(req, res);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("captures an exception without recording its message, stack or cause", () => {
    captureException(new TypeError("SQL bound data", { cause: new Error("provider body") }), {
      requestId: "trace-id",
      route: "/api/share/:token",
    });
    expect(log.error).toHaveBeenCalledWith(
      { requestId: "trace-id", route: "/api/share/:token", errorType: "TypeError", captured: true },
      "Captured exception"
    );
  });
});
