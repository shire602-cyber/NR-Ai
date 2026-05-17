import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5432/test";
process.env.SESSION_SECRET ||= "test-session-secret-minimum-length";
process.env.JWT_SECRET ||= "test-jwt-secret-minimum-length";

vi.mock("../../server/storage", () => ({
  storage: {
    getUser: vi.fn(async () => ({
      id: "user-1",
      email: "user@example.com",
      isAdmin: false,
      userType: "customer",
      firmRole: null,
    })),
  },
}));

vi.mock("../../server/services/auth-tokens.service", () => ({
  isTokenBlacklisted: vi.fn(async () => false),
}));

import { authMiddleware, generateToken } from "../../server/middleware/auth";
import { accessCookieName } from "../../server/services/auth-cookies.service";
import { storage } from "../../server/storage";

function mockResponse() {
  const res: any = {
    statusCode: 200,
    body: null,
    status: vi.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: vi.fn((body: any) => {
      res.body = body;
      return res;
    }),
  };
  return res;
}

describe("cookie auth middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("authenticates access tokens from the httpOnly cookie path", async () => {
    const token = generateToken({ id: "user-1", email: "user@example.com", userType: "customer" });
    const req: any = {
      headers: {},
      cookies: { [accessCookieName()]: token },
      signedCookies: {},
    };
    const res = mockResponse();
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(storage.getUser).toHaveBeenCalledWith("user-1");
    expect(req.user).toMatchObject({ id: "user-1", userType: "customer" });
  });

  it("keeps bearer auth as a fallback for scripts", async () => {
    const token = generateToken({ id: "user-1", email: "user@example.com", userType: "customer" });
    const req: any = {
      headers: { authorization: `Bearer ${token}` },
      cookies: {},
      signedCookies: {},
    };
    const res = mockResponse();
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({ id: "user-1" });
  });
});
