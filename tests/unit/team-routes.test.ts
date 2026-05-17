import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const mocks = vi.hoisted(() => ({
  getCompanyUsersByCompanyId: vi.fn(),
  updateCompanyUser: vi.fn(),
  deleteCompanyUser: vi.fn(),
}));

vi.mock("../../server/middleware/auth", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: "owner-1", email: "owner@example.com", isAdmin: false, userType: "customer" };
    next();
  },
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getUserRole: vi.fn(async () => ({
      id: "owner-membership",
      companyId: "company-1",
      userId: "owner-1",
      role: "owner",
    })),
    getUserByEmail: vi.fn(async () => ({ id: "invitee-1", email: "invitee@example.com" })),
    hasCompanyAccess: vi.fn(async () => false),
    createCompanyUser: vi.fn(),
    getCompanyUserWithUser: vi.fn(async () => []),
    getCompanyUsersByCompanyId: mocks.getCompanyUsersByCompanyId,
    updateCompanyUser: mocks.updateCompanyUser,
    deleteCompanyUser: mocks.deleteCompanyUser,
  },
}));

vi.mock("../../server/services/audit.service", () => ({
  recordAudit: vi.fn(async () => undefined),
}));

import { registerTeamRoutes } from "../../server/routes/team.routes";

function appWithRoutes() {
  const app = express();
  app.use(express.json());
  registerTeamRoutes(app);
  return app;
}

async function request(
  app: express.Express,
  method: "PUT" | "DELETE",
  memberId: string
): Promise<{ status: number; body: any }> {
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (typeof addr === "string" || !addr) throw new Error("no address");
    const response = await fetch(
      `http://127.0.0.1:${addr.port}/api/companies/company-1/team/${memberId}`,
      {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "PUT" ? JSON.stringify({ role: "accountant" }) : undefined,
      }
    );
    const body = response.status === 204 ? null : await response.json();
    return { status: response.status, body };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("team route tenant isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCompanyUsersByCompanyId.mockResolvedValue([
      {
        id: "member-owned",
        companyId: "company-1",
        userId: "member-user-1",
        role: "employee",
      },
    ]);
    mocks.updateCompanyUser.mockResolvedValue({
      id: "member-owned",
      companyId: "company-1",
      userId: "member-user-1",
      role: "accountant",
    });
    mocks.deleteCompanyUser.mockResolvedValue(undefined);
  });

  it("does not update a team membership outside the URL company", async () => {
    const response = await request(appWithRoutes(), "PUT", "member-foreign");

    expect(response.status).toBe(404);
    expect(mocks.updateCompanyUser).not.toHaveBeenCalled();
  });

  it("does not delete a team membership outside the URL company", async () => {
    const response = await request(appWithRoutes(), "DELETE", "member-foreign");

    expect(response.status).toBe(404);
    expect(mocks.deleteCompanyUser).not.toHaveBeenCalled();
  });

  it("updates a member after confirming the membership belongs to the URL company", async () => {
    const response = await request(appWithRoutes(), "PUT", "member-owned");

    expect(response.status).toBe(200);
    expect(mocks.updateCompanyUser).toHaveBeenCalledWith("member-owned", {
      role: "accountant",
    });
  });
});
