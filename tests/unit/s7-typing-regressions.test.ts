/**
 * S7 (lint & type hygiene): regressions for the places where removing `any`
 * changed or pinned runtime behaviour.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { PgTimestamp } from "drizzle-orm/pg-core";

const sheets = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
}));
const created = vi.hoisted(() => ({ receipts: [] as Array<Record<string, unknown>> }));

vi.mock("../../server/middleware/auth", () => ({
  authMiddleware: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { user: { id: string } }).user = { id: "user-1" };
    next();
  },
  requireCompanyAccess: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireCustomer: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../server/integrations/googleSheets", () => ({
  isGoogleSheetsConnected: vi.fn(async () => true),
  importExpensesFromSheet: vi.fn(async () => sheets.rows),
}));
vi.mock("../../server/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../server/db")>();
  const transaction = async (run: (tx: unknown) => Promise<unknown>) => run({ transaction });
  return { ...real, db: { ...real.db, transaction } };
});
vi.mock("../../server/services/period-lock.service", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../server/services/period-lock.service")>();
  return { ...real, lockPeriodPolicy: vi.fn(), assertPeriodNotLocked: vi.fn() };
});
vi.mock("../../server/storage", () => ({
  storage: {
    createReceipt: vi.fn(async (input: Record<string, unknown>) => {
      // The receipts.date column is a timestamp: Drizzle maps it with toISOString().
      new PgTimestamp(
        { name: "date", columnType: "PgTimestamp" } as never,
        { withTimezone: false } as never
      ).mapToDriverValue(input.date as Date);
      created.receipts.push(input);
      return { id: `r-${created.receipts.length}`, ...input };
    }),
    createIntegrationSync: vi.fn(async () => ({})),
  },
}));

import {
  errorCode,
  errorMessage,
  errorProperty,
  errorStatus,
  errorStatusCode,
} from "../../server/errors";
import { resolveSelectedId } from "../../client/src/lib/selection";
import { registerIntegrationRoutes } from "../../server/routes/integrations.routes";

afterEach(() => {
  sheets.rows = [];
  created.receipts = [];
});

describe("S7 errors.ts helpers read unknown thrown values like `(err as any).x` did", () => {
  it("reads message, code, status and statusCode from errors and plain objects", () => {
    const err = Object.assign(new Error("boom"), { code: "AI_QUOTA_EXCEEDED", status: 429 });
    expect(errorMessage(err)).toBe("boom");
    expect(errorCode(err)).toBe("AI_QUOTA_EXCEEDED");
    expect(errorStatus(err)).toBe(429);
    expect(errorStatusCode({ statusCode: 503 })).toBe(503);
    expect(errorMessage({ message: "plain" })).toBe("plain");
    expect(errorProperty({ detail: { used: 1 } }, "detail")).toEqual({ used: 1 });
  });

  it("returns undefined for primitives, null and mistyped fields instead of throwing", () => {
    expect(errorMessage(null)).toBeUndefined();
    expect(errorMessage("text")).toBeUndefined();
    expect(errorCode({ code: 42 })).toBeUndefined();
    expect(errorStatus({ status: "429" })).toBeUndefined();
    expect(errorProperty(undefined, "detail")).toBeUndefined();
  });
});

describe("S7 resolveSelectedId replaces the select-first-workpaper effects", () => {
  const items = [{ id: "a" }, { id: "b" }];
  it("keeps a valid pick, falls back to the first item, and keeps the pick while empty", () => {
    expect(resolveSelectedId("b", items)).toBe("b");
    expect(resolveSelectedId(null, items)).toBe("a");
    expect(resolveSelectedId("stale", items)).toBe("a");
    expect(resolveSelectedId("b", [])).toBe("b");
    expect(resolveSelectedId(null, [])).toBeNull();
  });
});

describe("S7 Google Sheets expense import passes a Date to the timestamp column", () => {
  it("imports YYYY-MM-DD sheet rows instead of failing every row on toISOString", async () => {
    sheets.rows = [
      {
        date: "2026-10-31",
        merchant: "ENOC",
        description: "",
        category: "Fuel",
        amount: 100,
        vatAmount: 5,
        paymentMethod: "",
        status: "pending",
      },
    ];
    const app = express();
    app.use(express.json());
    registerIntegrationRoutes(app);
    const server = app.listen(0);
    try {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no address");
      const res = await fetch(
        `http://127.0.0.1:${addr.port}/api/integrations/google-sheets/import/expenses`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            companyId: "11111111-1111-4111-8111-111111111111",
            sheetUrl: "https://docs.google.com/spreadsheets/d/abc123/edit",
          }),
        }
      );
      expect(res.status).toBe(200);
      expect((await res.json()).recordCount).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    expect(created.receipts).toHaveLength(1);
    expect(created.receipts[0].date).toBeInstanceOf(Date);
    expect((created.receipts[0].date as Date).toISOString().slice(0, 10)).toBe("2026-10-31");
  });
});
