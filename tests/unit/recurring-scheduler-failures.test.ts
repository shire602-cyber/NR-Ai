import { beforeEach, describe, expect, it, vi } from "vitest";

// A failing template must be skipped for this run, never stop the run and
// never deactivate the template.

const state = vi.hoisted(() => ({
  queue: [] as any[],
  failIds: new Set<string>(),
  updates: [] as any[],
  inserted: [] as any[],
  fetchThrows: false,
}));

vi.mock("../../server/db", () => {
  const tx = {
    update: () => ({
      set: (values: any) => ({
        where: async () => {
          state.updates.push(values);
        },
      }),
    }),
    insert: () => ({
      values: (values: any) => {
        const rows = [{ id: `inv-${state.inserted.length + 1}`, ...values }];
        if (values.invoiceId === undefined) state.inserted.push(rows[0]);
        return Object.assign(Promise.resolve(rows), { returning: async () => rows });
      },
    }),
  };
  return { db: { transaction: async (fn: any) => fn(tx) }, pool: {} };
});

vi.mock("../../server/storage", () => ({
  storage: {
    fetchAndLockNextDueRecurringInvoice: vi.fn(async (_tx: any, exclude: string[] = []) => {
      if (state.fetchThrows) throw new Error("connection reset");
      return state.queue.find((t) => !exclude.includes(t.id));
    }),
    getAccountsByCompanyId: vi.fn(async () => []),
    getCompanyUsersByCompanyId: vi.fn(async () => [{ userId: "u1", role: "owner" }]),
    createNotification: vi.fn(async () => ({})),
  },
}));
vi.mock("../../server/services/period-lock.service", () => ({ assertPeriodNotLocked: vi.fn(async () => {}) }));
vi.mock("../../server/services/invoice-numbering.service", () => ({
  allocateInvoiceNumber: vi.fn(async () => "INV-0001"),
}));
vi.mock("../../server/services/document-fx-rate", () => ({
  resolveDocumentExchangeRate: vi.fn(async (args: any) => {
    if (state.failIds.has(args.currency)) throw new Error("rate lookup failed");
    return { ok: true, rate: 1 };
  }),
}));
vi.mock("../../server/services/invoice-posting.service", () => ({
  postInvoiceRevenueJournal: vi.fn(async () => true),
}));
// Phase 8 D1: lines are written (and derived) by the shared sales-lines service; this test is about run control.
vi.mock("../../server/services/sales-lines.service", () => ({ replaceInvoiceLines: vi.fn(async () => ({})) }));
vi.mock("../../server/services/recurring-send.service", () => ({ sendGeneratedRecurringInvoice: vi.fn(async () => ({ status: "sent" })) }));
vi.mock("../../server/services/report-delivery-scheduler.service", () => ({ scanDueReportDeliveries: vi.fn() }));
vi.mock("../../server/services/auth-tokens.service", () => ({ purgeExpiredAuthTokens: vi.fn() }));
vi.mock("node-cron", () => ({ default: { schedule: vi.fn() } }));

import {
  generateDueRecurringInvoices,
  MAX_RECURRING_ITERATIONS,
} from "../../server/services/scheduler.service";

const template = (id: string, currency = "AED") => ({
  id,
  companyId: "c1",
  customerName: `Customer ${id}`,
  customerTrn: null,
  currency,
  frequency: "monthly",
  nextRunDate: new Date("2026-09-01T00:00:00Z"),
  endDate: null,
  isActive: true,
  linesJson: JSON.stringify([{ description: "svc", quantity: 1, unitPrice: 100, vatRate: 0.05 }]),
});

describe("recurring generation with failing templates", () => {
  beforeEach(() => {
    state.queue = [];
    state.failIds = new Set();
    state.updates = [];
    state.inserted = [];
    state.fetchThrows = false;
  });

  it("three failing templates at the head do not starve the healthy ones", async () => {
    state.failIds = new Set(["BAD"]);
    state.queue = [template("t1", "BAD"), template("t2", "BAD"), template("t3", "BAD"), template("t4"), template("t5")];
    const r = await generateDueRecurringInvoices();
    expect(r.generated).toBe(2);
    expect(state.inserted).toHaveLength(2);
  });

  it("a failing template is never deactivated", async () => {
    state.failIds = new Set(["BAD"]);
    state.queue = [template("t1", "BAD"), template("t2")];
    await generateDueRecurringInvoices();
    expect(state.updates.some((u) => u.isActive === false)).toBe(false);
  });

  it("stops at a hard iteration ceiling instead of looping forever", async () => {
    // an endless supply of distinct due templates that all fail
    state.failIds = new Set(["BAD"]);
    state.queue = Array.from({ length: MAX_RECURRING_ITERATIONS + 50 }, (_, i) => template(`t${i}`, "BAD"));
    const r = await generateDueRecurringInvoices();
    expect(r.generated).toBe(0);
    expect(MAX_RECURRING_ITERATIONS).toBeGreaterThanOrEqual(500);
  });

  it("an error before any template is claimed (queue query down) ends the run", async () => {
    state.fetchThrows = true;
    state.queue = [template("t1")];
    const r = await generateDueRecurringInvoices();
    expect(r.generated).toBe(0);
  });
});
