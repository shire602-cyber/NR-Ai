import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { z } from "zod";
import { applySecurityMiddleware } from "../../server/middleware/security";
import {
  asyncHandler,
  globalErrorHandler,
  mapRequestTransportError,
  requestTransportErrorHandler,
} from "../../server/middleware/errorHandler";
import { DomainError, AppError } from "../../server/errors";
import { toFils } from "../../shared/money";

// R17-12: malformed JSON and disallowed origins must be 4xx, never 500.

function buildApp() {
  const app = express();
  applySecurityMiddleware(app);
  app.use(express.json({ limit: "1kb" }));
  app.use(requestTransportErrorHandler);
  app.post("/api/echo", (req, res) => res.json({ ok: true, body: req.body }));
  app.post(
    "/api/domain",
    asyncHandler(async () => {
      throw new DomainError("PERIOD_LOCKED", 409, { period: "2026-03" });
    })
  );
  app.post(
    "/api/money",
    asyncHandler(async (req) => {
      toFils(req.body.amount);
    })
  );
  app.post(
    "/api/zod",
    asyncHandler(async (req) => {
      z.object({ name: z.string() }).parse(req.body);
    })
  );
  app.use(globalErrorHandler);
  return app;
}

let server: Server;
let base: string;

beforeAll(async () => {
  server = buildApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json, text, headers: res.headers };
}

describe("R17-12 transport errors over HTTP", () => {
  it("R17-12: malformed JSON body → 400 INVALID_JSON (not 500)", async () => {
    const r = await call("/api/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad",
    });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("INVALID_JSON");
    expect(r.text).not.toMatch(/Unexpected token|SyntaxError|at JSON/);
  });

  it("R17-12: oversize body → 413 PAYLOAD_TOO_LARGE", async () => {
    const r = await call("/api/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: "a".repeat(5000) }),
    });
    expect(r.status).toBe(413);
    expect(r.json.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("R17-12: POST from a disallowed Origin → 403 ORIGIN_NOT_ALLOWED", async () => {
    const r = await call("/api/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
      body: "{}",
    });
    expect(r.status).toBe(403);
    expect(r.json.code).toBe("ORIGIN_NOT_ALLOWED");
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("R17-12: OPTIONS preflight from a disallowed Origin → 403", async () => {
    const r = await call("/api/echo", {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(r.status).toBe(403);
    expect(r.json.code).toBe("ORIGIN_NOT_ALLOWED");
  });

  it("allowed Origin and no Origin still work", async () => {
    const allowed = await call("/api/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:5000" },
      body: '{"a":1}',
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:5000");
    const none = await call("/api/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"a":1}',
    });
    expect(none.status).toBe(200);
  });

  it("DomainError renders its status and code", async () => {
    const r = await call("/api/domain", { method: "POST" });
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ code: "PERIOD_LOCKED", details: { period: "2026-03" } });
  });

  it("MoneyError from shared/money → 400 with its code", async () => {
    const r = await call("/api/money", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: "1.005" }),
    });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("MONEY_TOO_PRECISE");
  });

  it("ZodError thrown in a handler → 400 with fields", async () => {
    const r = await call("/api/zod", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("VALIDATION_ERROR");
    expect(r.json.fields).toHaveProperty("name");
  });
});

function mockRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status: vi.fn(function (this: typeof res, c: number) {
      res.statusCode = c;
      return res;
    }),
    json: vi.fn((b: unknown) => {
      res.body = b;
      return res;
    }),
  };
  return res;
}

function handle(err: Error) {
  const req = { method: "POST", url: "/x", headers: {} } as unknown as Request;
  const res = mockRes();
  globalErrorHandler(err, req, res as unknown as Response, vi.fn() as NextFunction);
  return res;
}

const pgError = (code: string, message: string) => Object.assign(new Error(message), { code });

describe("R17-12 Postgres error mapping (no SQL in responses)", () => {
  it.each([
    ["22P02", 400, "INVALID_IDENTIFIER", 'invalid input syntax for type uuid: "x"'],
    ["22007", 400, "INVALID_DATE", 'invalid input syntax for type date: "garbage"'],
    ["22008", 400, "INVALID_DATE", "date/time field value out of range"],
    ["22003", 400, "NUMERIC_OUT_OF_RANGE", "numeric field overflow"],
    ["23505", 409, "DUPLICATE_VALUE", 'duplicate key value violates unique constraint "x_uq"'],
    ["23503", 409, "REFERENCE_CONFLICT", 'insert or update on table "lines" violates foreign key'],
    ["23502", 400, "REQUIRED_FIELD_MISSING", 'null value in column "name" violates not-null'],
  ])("%s → %i %s", (code, status, stable, message) => {
    const res = handle(pgError(code, message));
    expect(res.statusCode).toBe(status);
    expect(res.body).toMatchObject({ code: stable });
    expect(JSON.stringify(res.body)).not.toContain(message);
  });

  it("maps a Drizzle-wrapped pg error via the cause chain", () => {
    const wrapped = new Error('Failed query: insert into "invoices" ...');
    (wrapped as Error & { cause?: unknown }).cause = pgError("22007", "bad date");
    const res = handle(wrapped);
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain("Failed query");
  });

  it("server-side pg errors (e.g. undefined column 42703) stay 500", () => {
    expect(handle(pgError("42703", 'column "x" does not exist')).statusCode).toBe(500);
  });

  it("AppError codes are not mistaken for SQLSTATEs", () => {
    const res = handle(new AppError({ message: "x", statusCode: 422, code: "22P02" }));
    expect(res.statusCode).toBe(422);
  });
});

describe("mapRequestTransportError", () => {
  it("ignores unrelated errors", () => {
    expect(mapRequestTransportError(new Error("boom"))).toBeNull();
    expect(mapRequestTransportError(null)).toBeNull();
  });
  it("maps generic exposed body-parser 4xx errors", () => {
    const err = Object.assign(new Error("aborted"), {
      type: "request.aborted",
      status: 400,
      expose: true,
    });
    expect(mapRequestTransportError(err)).toMatchObject({
      status: 400,
      body: { code: "BAD_REQUEST" },
    });
  });
});

describe("DomainError", () => {
  it("carries code, httpStatus and details", () => {
    const e = new DomainError("SERVICE_UNAVAILABLE", 503, { service: "x" });
    expect(e).toBeInstanceOf(AppError);
    expect(e.httpStatus).toBe(503);
    expect(e.toJSON()).toEqual({
      message: "Service unavailable",
      code: "SERVICE_UNAVAILABLE",
      details: { service: "x" },
    });
  });
});
