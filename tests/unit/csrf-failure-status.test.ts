import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";

vi.mock("../../server/config/env", () => ({
  getEnv: () => ({ NODE_ENV: "test", SESSION_SECRET: "s".repeat(32) }),
  isProduction: () => false,
}));
vi.mock("../../server/config/logger", () => ({ createLogger: () => ({ warn: vi.fn() }) }));

import { csrfFailureStatus, hasAuthCredentials } from "../../server/middleware/csrf";

function req(path: string, headers: Record<string, string> = {}, extra: object = {}): Request {
  return { path, headers, cookies: {}, ...extra } as unknown as Request;
}

describe("csrfFailureStatus", () => {
  it("returns 401 for a credential-less write to a protected route", () => {
    expect(csrfFailureStatus(req("/api/companies/1/journal"))).toBe(401);
  });
  it("returns 403 when an Authorization header is present", () => {
    expect(csrfFailureStatus(req("/api/companies/1/journal", { authorization: "Basic x" }))).toBe(403);
  });
  it("returns 403 when the access-token cookie is present", () => {
    expect(csrfFailureStatus(req("/api/x", { cookie: "a=1; muhasib-access=tok" }))).toBe(403);
  });
  it("returns 403 when the refresh cookie or session cookie is present", () => {
    expect(csrfFailureStatus(req("/api/x", { cookie: "muhasib-refresh=tok" }))).toBe(403);
    expect(csrfFailureStatus(req("/api/x", { cookie: "connect.sid=s%3Aabc" }))).toBe(403);
  });
  it("returns 403 when passport already resolved a user", () => {
    expect(csrfFailureStatus(req("/api/x", {}, { user: { id: "u1" } }))).toBe(403);
  });
  it("keeps 403 for public CSRF-protected forms", () => {
    expect(csrfFailureStatus(req("/api/waitlist"))).toBe(403);
    expect(csrfFailureStatus(req("/api/invitations/accept/abc"))).toBe(403);
  });
  it("ignores unrelated cookies", () => {
    expect(hasAuthCredentials(req("/api/x", { cookie: "x-csrf-id=1; theme=dark" }))).toBe(false);
  });
});
