import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const mocks = vi.hoisted(() => ({
  hasCompanyAccess: vi.fn(),
  updateReminderSetting: vi.fn(),
}));

vi.mock("../../server/middleware/auth", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: "user-1", email: "user@example.com", isAdmin: false, userType: "customer" };
    next();
  },
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getReminderSettingsByCompanyId: vi.fn(async () => []),
    createReminderSetting: vi.fn(),
    getReminderSetting: vi.fn(async () => ({
      id: "setting-1",
      companyId: "company-2",
      reminderType: "invoice_overdue",
      isEnabled: true,
    })),
    hasCompanyAccess: mocks.hasCompanyAccess,
    updateReminderSetting: mocks.updateReminderSetting,
    getReminderLogsByCompanyId: vi.fn(async () => []),
  },
}));

import { registerReminderRoutes } from "../../server/routes/reminders.routes";

function appWithRoutes() {
  const app = express();
  app.use(express.json());
  registerReminderRoutes(app);
  return app;
}

async function patchSetting(): Promise<{ status: number; body: any }> {
  const server = appWithRoutes().listen(0);
  try {
    const addr = server.address();
    if (typeof addr === "string" || !addr) throw new Error("no address");
    const response = await fetch(`http://127.0.0.1:${addr.port}/api/reminder-settings/setting-1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isEnabled: false }),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("reminder setting route ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not update settings for companies the user cannot access", async () => {
    mocks.hasCompanyAccess.mockResolvedValue(false);

    const response = await patchSetting();

    expect(response.status).toBe(403);
    expect(mocks.hasCompanyAccess).toHaveBeenCalledWith("user-1", "company-2");
    expect(mocks.updateReminderSetting).not.toHaveBeenCalled();
  });

  it("updates settings after company access is verified", async () => {
    mocks.hasCompanyAccess.mockResolvedValue(true);
    mocks.updateReminderSetting.mockResolvedValue({
      id: "setting-1",
      companyId: "company-2",
      reminderType: "invoice_overdue",
      isEnabled: false,
    });

    const response = await patchSetting();

    expect(response.status).toBe(200);
    expect(mocks.updateReminderSetting).toHaveBeenCalledWith("setting-1", {
      isEnabled: false,
    });
  });
});
