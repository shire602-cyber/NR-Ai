import express, { type RequestHandler } from "express";
import { expect, it, vi } from "vitest";
import { registerChasingRoutes } from "../../server/routes/chasing.routes";

vi.mock("../../server/middleware/auth", () => {
  const authMiddleware: RequestHandler = (req, _res, next) => {
    req.user = {
      id: "user",
      email: "user@example.test",
      isAdmin: false,
      userType: "customer",
      firmRole: null,
    };
    next();
  };
  const requireCustomer: RequestHandler = (_req, _res, next) => next();
  return { authMiddleware, requireCustomer };
});
vi.mock("../../server/services/invoice-balances", () => ({
  getInvoiceBalances: async () => new Map(),
}));
vi.mock("../../server/services/audit.service", () => ({ recordAudit: async () => undefined }));
vi.mock("../../server/storage", () => ({
  storage: {
    hasCompanyAccess: async () => true,
    getCompany: async () => ({ name: "Company" }),
    getChaseConfig: async () => ({ doNotChaseContactIds: '["configured"]' }),
    getDoNotChaseContactIds: async () => ["opted-out"],
    getInvoicesByCompanyId: async () => [
      ...Array.from({ length: 201 }, (_, i) => invoice(`blocked-${i}`, "opted-out")),
      invoice("configured-out", "configured"),
      invoice("eligible", "eligible"),
      invoice("late-opt-out", "late-opt-out"),
    ],
    getCustomerContact: async (id: string) => ({ id, doNotChase: id === "late-opt-out" }),
    getChaseTemplate: async () => ({ body: "Reminder" }),
    tryClaimChaseSlot: async () => true,
    createPaymentChase: async () => ({ id: "chase" }),
  },
}));

function invoice(id: string, contactId: string) {
  return {
    id,
    number: id,
    contactId,
    customerName: "Customer",
    currency: "AED",
    total: 100,
    status: "sent",
    dueDate: new Date(Date.now() - 5 * 86_400_000),
  };
}

it("excludes configured and recorded opt-outs before the cap and reports a late opt-out", async () => {
  const app = express();
  app.use(express.json());
  registerChasingRoutes(app);
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing server address");
    const url = `http://127.0.0.1:${address.port}/api/chasing`;
    const queue = await fetch(`${url}/queue/company`);
    expect(queue.status).toBe(200);
    expect((await queue.json()).queue).toMatchObject([
      { invoice: { id: "eligible" } },
      { invoice: { id: "late-opt-out" } },
    ]);

    const bulk = await fetch(`${url}/bulk-send/company`, { method: "POST" });
    expect(bulk.status).toBe(200);
    expect(await bulk.json()).toMatchObject({
      eligibleTotal: 2,
      truncated: false,
      results: [
        { invoiceId: "eligible", status: "sent" },
        { invoiceId: "late-opt-out", status: "skipped_do_not_chase" },
      ],
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
