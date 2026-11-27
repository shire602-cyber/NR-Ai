import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { AppError, globalErrorHandler, asyncHandler } from "../../server/middleware/errorHandler";
import { ZodError } from "zod";

// Mock logger
const logWarn = vi.hoisted(() => vi.fn());
vi.mock("../../server/config/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: logWarn,
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

vi.mock("../../server/config/env", () => ({
  isProduction: () => false,
  getEnv: () => ({
    NODE_ENV: "test",
    JWT_SECRET: "test-jwt-secret-at-least-32-characters-long-unique",
  }),
}));

function createMockRes(): Response {
  const res: Partial<Response> = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as Response;
}

function createMockReq(overrides: Partial<Request> = {}): Request {
  return {
    method: "GET",
    url: "/test",
    headers: {},
    ...overrides,
  } as Request;
}

describe("Error Handler Middleware", () => {
  describe("AppError", () => {
    it("should create an error with status code", () => {
      const error = new AppError("Not Found", 404);
      expect(error.message).toBe("Not Found");
      expect(error.statusCode).toBe(404);
      expect(error.isOperational).toBe(true);
    });

    it("should support non-operational errors", () => {
      const error = new AppError("Internal", 500, false);
      expect(error.isOperational).toBe(false);
    });
  });

  describe("globalErrorHandler", () => {
    it("should handle AppError correctly", () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = vi.fn() as NextFunction;
      const error = new AppError("Not Found", 404);

      globalErrorHandler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Not Found", code: expect.any(String) })
      );
    });

    it("should handle ZodError with validation details", () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = vi.fn() as NextFunction;

      const zodError = new ZodError([
        {
          code: "invalid_type",
          expected: "string",
          received: "undefined",
          path: ["email"],
          message: "Required",
        },
      ]);

      globalErrorHandler(zodError, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Validation error",
          code: "VALIDATION_ERROR",
          details: expect.objectContaining({
            errors: expect.any(Object),
          }),
        })
      );
    });

    it("should handle unknown errors with 500", () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = vi.fn() as NextFunction;
      const error = new Error("Something broke");

      globalErrorHandler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it("maps a raw pg 22P02 (invalid uuid) to 400, not 500", () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = vi.fn() as NextFunction;
      const pgError = Object.assign(new Error('invalid input syntax for type uuid: "not-a-uuid"'), {
        code: "22P02",
      });

      globalErrorHandler(pgError, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "INVALID_IDENTIFIER" })
      );
    });

    it("maps a pg 23505 unique violation to 409, not 500", () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = vi.fn() as NextFunction;
      const pgError = Object.assign(
        new Error('duplicate key value violates unique constraint "cost_centers_company_code_uq"'),
        { code: "23505" }
      );

      globalErrorHandler(pgError, req, res, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "DUPLICATE_VALUE" }));
    });

    it("logs PostgreSQL metadata with a sanitized route and redacts sensitive values", () => {
      const invitationToken = "a1".repeat(32);
      const querySecret = "private-query-secret";
      const route = "/api/portal-invitations/:legacyToken/record";
      const originalUrl = `/api/portal-invitations/${invitationToken}/record?key=${querySecret}`;
      const req = createMockReq({
        id: "req-1",
        method: "POST",
        route: { path: route },
        url: originalUrl,
        originalUrl,
      });
      const res = createMockRes();
      const next = vi.fn() as NextFunction;
      const pgError = Object.assign(new Error("duplicate key"), {
        code: "23505",
        constraint: "uniq_audit_logs_chain_seq",
        table: "audit_logs",
        detail: "Key (chain_key, seq)=(abc, 7) already exists.",
      });
      const wrapped = Object.assign(new Error("Failed query"), { cause: pgError });
      logWarn.mockClear();

      globalErrorHandler(wrapped, req, res, next);

      expect(logWarn).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "req-1",
          pgCode: "23505",
          constraint: "uniq_audit_logs_chain_seq",
          table: "audit_logs",
          route,
        }),
        expect.any(String)
      );
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        code: "DUPLICATE_VALUE",
        message: "A record with this value already exists",
        requestId: "req-1",
      });
      for (const output of [
        JSON.stringify(logWarn.mock.calls),
        JSON.stringify(vi.mocked(res.json).mock.calls),
      ]) {
        expect(output).not.toMatch(/"(?:detail|originalUrl)"\s*:/);
        expect(output).not.toContain(pgError.detail);
        expect(output).not.toContain(querySecret);
        expect(output).not.toContain(invitationToken);
        expect(output).not.toContain(originalUrl);
      }
    });

    it("maps a Drizzle-wrapped 22P02 (code in cause chain) to 400", () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = vi.fn() as NextFunction;
      const wrapped = new Error("Failed query: SELECT ...");
      (wrapped as Error & { cause?: unknown }).cause = Object.assign(
        new Error('invalid input syntax for type uuid: "not-a-uuid"'),
        { code: "22P02" }
      );

      globalErrorHandler(wrapped, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "INVALID_IDENTIFIER" })
      );
    });
  });

  describe("asyncHandler", () => {
    it("should pass resolved value through", async () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = vi.fn() as NextFunction;

      const handler = asyncHandler(async (_req, res) => {
        res.json({ ok: true });
      });

      await handler(req, res, next);
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    it("should catch rejected promises and call next", async () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = vi.fn() as NextFunction;
      const error = new Error("Async failure");

      const handler = asyncHandler(async () => {
        throw error;
      });

      await handler(req, res, next);
      expect(next).toHaveBeenCalledWith(error);
    });
  });
});
