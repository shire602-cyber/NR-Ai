import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const mocks = vi.hoisted(() => ({
  markNotificationAsRead: vi.fn(),
  dismissNotification: vi.fn(),
}));

vi.mock("../../server/middleware/auth", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: "user-1", email: "user@example.com", isAdmin: false, userType: "customer" };
    next();
  },
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getNotificationsByUserId: vi.fn(async () => []),
    getUnreadNotificationCount: vi.fn(async () => 0),
    markNotificationAsRead: mocks.markNotificationAsRead,
    markAllNotificationsAsRead: vi.fn(async () => undefined),
    dismissNotification: mocks.dismissNotification,
    createNotification: vi.fn(),
    hasCompanyAccess: vi.fn(),
    getRegulatoryNews: vi.fn(async () => []),
  },
}));

import { registerNotificationRoutes } from "../../server/routes/notifications.routes";

function appWithRoutes() {
  const app = express();
  app.use(express.json());
  registerNotificationRoutes(app);
  return app;
}

async function patch(path: string): Promise<{ status: number; body: any }> {
  const server = appWithRoutes().listen(0);
  try {
    const addr = server.address();
    if (typeof addr === "string" || !addr) throw new Error("no address");
    const response = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
      method: "PATCH",
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("notification route ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scopes mark-read mutations to the authenticated user", async () => {
    mocks.markNotificationAsRead.mockResolvedValue(undefined);

    const response = await patch("/api/notifications/notification-2/read");

    expect(response.status).toBe(404);
    expect(mocks.markNotificationAsRead).toHaveBeenCalledWith("notification-2", "user-1");
  });

  it("scopes dismiss mutations to the authenticated user", async () => {
    mocks.dismissNotification.mockResolvedValue(undefined);

    const response = await patch("/api/notifications/notification-2/dismiss");

    expect(response.status).toBe(404);
    expect(mocks.dismissNotification).toHaveBeenCalledWith("notification-2", "user-1");
  });
});
