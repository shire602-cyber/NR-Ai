import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const mocks = vi.hoisted(() => ({
  createUser: vi.fn(),
  createCompanyUser: vi.fn(),
  updateInvitation: vi.fn(),
  createActivityLog: vi.fn(),
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getInvitationByToken: vi.fn(async () => ({
      id: "invitation-1",
      email: "client@example.com",
      role: "client",
      userType: "client",
      companyId: "company-1",
      status: "pending",
      expiresAt: new Date(Date.now() + 60_000),
    })),
    getUserByEmail: vi.fn(async () => undefined),
    createUser: mocks.createUser,
    createCompanyUser: mocks.createCompanyUser,
    updateCompany: vi.fn(async () => ({ id: "company-1" })),
    updateInvitation: mocks.updateInvitation,
    createActivityLog: mocks.createActivityLog,
  },
}));

vi.mock("../../server/middleware/auth", () => ({
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  generateToken: vi.fn(() => "access-token"),
}));

vi.mock("../../server/services/auth-tokens.service", () => ({
  blacklistToken: vi.fn(),
  createRefreshSession: vi.fn(async () => ({
    token: "refresh-token",
    expiresAt: new Date(Date.now() + 60_000),
  })),
  rotateRefreshSession: vi.fn(),
  revokeRefreshSession: vi.fn(),
  createEmailVerificationToken: vi.fn(),
  consumeEmailVerificationToken: vi.fn(),
}));

vi.mock("../../server/services/auth-cookies.service", () => ({
  clearAuthCookies: vi.fn(),
  getAccessTokenFromRequest: vi.fn(),
  getRefreshTokenFromRequest: vi.fn(),
  sessionMetaFromRequest: vi.fn(() => ({})),
  setAuthCookies: vi.fn(),
}));

vi.mock("../../server/db", () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn() })),
    })),
  },
}));

import { registerAuthRoutes } from "../../server/routes/auth.routes";

function appWithRoutes() {
  const app = express();
  app.use(express.json());
  registerAuthRoutes(app);
  return app;
}

async function postAccept(app: express.Express): Promise<{ status: number; body: any }> {
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (typeof addr === "string" || !addr) throw new Error("no address");
    const response = await fetch(`http://127.0.0.1:${addr.port}/api/invitations/accept/token-1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Client User", password: "secure-pass-1" }),
    });
    const text = await response.text();
    const body =
      text && response.headers.get("content-type")?.includes("application/json")
        ? JSON.parse(text)
        : text;
    return { status: response.status, body };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("invitation acceptance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createUser.mockImplementation(async (input: any) => ({
      id: "user-1",
      email: input.email,
      name: input.name,
      passwordHash: input.passwordHash,
      isAdmin: input.isAdmin,
      userType: input.userType,
      firmRole: null,
    }));
    mocks.createCompanyUser.mockResolvedValue({ id: "company-user-1" });
    mocks.updateInvitation.mockResolvedValue({ id: "invitation-1" });
    mocks.createActivityLog.mockResolvedValue({ id: "activity-1" });
  });

  it("creates invited users with only a password hash, never the raw password field", async () => {
    const response = await postAccept(appWithRoutes());

    expect(response.status, String(response.body)).toBe(200);
    expect(mocks.createUser).toHaveBeenCalledTimes(1);
    const input = mocks.createUser.mock.calls[0][0];
    expect(input).not.toHaveProperty("password");
    expect(input.passwordHash).toMatch(/^\$2/);
    expect(input.passwordHash).not.toBe("secure-pass-1");
  });
});
