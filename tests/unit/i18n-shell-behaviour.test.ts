import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Security headers (R17-18, R18-05) ────────────────────────────────────────

describe("CSP and frame headers", () => {
  async function headersFor() {
    const { applySecurityMiddleware } = await import("../../server/middleware/security");
    const app = express();
    applySecurityMiddleware(app);
    app.get("/probe", (_req, res) => res.send("ok"));
    const server = app.listen(0);
    try {
      const addr = server.address();
      if (typeof addr === "string" || !addr) throw new Error("no address");
      const res = await fetch(`http://127.0.0.1:${addr.port}/probe`);
      return res.headers;
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it("R18-05: the report-only policy never carries upgrade-insecure-requests", async () => {
    const headers = await headersFor();
    const reportOnly = headers.get("content-security-policy-report-only") ?? "";
    expect(reportOnly).not.toBe("");
    expect(reportOnly).not.toContain("upgrade-insecure-requests");
  });

  it("R17-18: report-only keeps the enforced script/frame policy instead of helmet defaults", async () => {
    const headers = await headersFor();
    const enforced = headers.get("content-security-policy") ?? "";
    const reportOnly = headers.get("content-security-policy-report-only") ?? "";
    const directive = (policy: string, name: string) =>
      policy
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${name} `))
        ?.replace(/'nonce-[^']+'/, "'nonce-X'");
    expect(directive(reportOnly, "script-src")).toBe(directive(enforced, "script-src"));
    expect(directive(reportOnly, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(reportOnly, "connect-src")).toBe(directive(enforced, "connect-src"));
  });

  it("R17-18: X-Frame-Options agrees with frame-ancestors 'none'", async () => {
    const headers = await headersFor();
    expect(headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("x-frame-options")).toBe("DENY");
  });
});

// ── Anonymous bootstrap (R18-04) ─────────────────────────────────────────────

describe("anonymous bootstrap makes no authenticated API calls", () => {
  const store = new Map<string, string>();
  const fetchMock = vi.fn();

  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
    vi.stubGlobal("sessionStorage", {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    vi.stubGlobal("window", { dispatchEvent: () => true, addEventListener: () => undefined });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("R18-04: fetchCurrentUser and refreshSession do not touch the network without a sign-in hint", async () => {
    const { fetchCurrentUser, refreshSession } = await import("../../client/src/lib/auth");
    expect(await fetchCurrentUser()).toBeNull();
    expect(await refreshSession()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("R18-04: a signed-in browser (hint set) still probes /api/auth/me", async () => {
    const { fetchCurrentUser, setAuthHint } = await import("../../client/src/lib/auth");
    setAuthHint();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "u1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    expect(await fetchCurrentUser()).toEqual({ id: "u1" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/auth/me");
  });

  it("R18-04: a rejected session clears the hint so the next anonymous load is silent", async () => {
    const { fetchCurrentUser, hasAuthHint, setAuthHint } =
      await import("../../client/src/lib/auth");
    setAuthHint();
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("csrf-token")
        ? new Response(JSON.stringify({ csrfToken: "t" }), { status: 200 })
        : new Response("{}", { status: 401 })
    );
    expect(await fetchCurrentUser()).toBeNull();
    expect(hasAuthHint()).toBe(false);
  });

  it("R18-04: the default query function skips /api/companies for anonymous visitors without caching an empty success", async () => {
    const { getQueryFn } = await import("../../client/src/lib/queryClient");
    const ctx = { queryKey: ["/api/companies"] } as never;
    await expect(getQueryFn({ on401: "throw" })(ctx)).rejects.toMatchObject({ status: 401 });
    await expect(getQueryFn({ on401: "returnNull" })(ctx)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── Tour + onboarding redirect (R18-03, R18-08) ──────────────────────────────

describe("welcome tour and onboarding redirect", () => {
  describe("PATCH /api/onboarding", () => {
    const updateUserOnboarding = vi.fn(async (_userId: string, data: Record<string, unknown>) => ({
      id: "o1",
      ...data,
    }));

    beforeEach(() => {
      vi.resetModules();
      updateUserOnboarding.mockClear();
      vi.doMock("../../server/middleware/auth", () => ({
        authMiddleware: (req: any, _res: any, next: any) => {
          req.user = { id: "user-1" };
          next();
        },
      }));
      vi.doMock("../../server/storage", () => ({
        storage: {
          updateUserOnboarding,
          getUserOnboarding: vi.fn(),
          createUserOnboarding: vi.fn(),
        },
      }));
    });

    afterEach(() => {
      vi.doUnmock("../../server/middleware/auth");
      vi.doUnmock("../../server/storage");
    });

    async function patch(body: unknown) {
      const { registerOnboardingRoutes } = await import("../../server/routes/onboarding.routes");
      const app = express();
      app.use(express.json());
      registerOnboardingRoutes(app);
      const server = app.listen(0);
      try {
        const addr = server.address();
        if (typeof addr === "string" || !addr) throw new Error("no address");
        const res = await fetch(`http://127.0.0.1:${addr.port}/api/onboarding`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        return res.status;
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }

    it("R18-03: tourDismissed stamps tourDismissedAt, hides the tour and keeps step progress untouched", async () => {
      expect(await patch({ tourDismissed: true })).toBe(200);
      const [, data] = updateUserOnboarding.mock.calls[0];
      expect(data.showTour).toBe(false);
      expect(data.tourDismissedAt).toBeInstanceOf(Date);
      expect(data).not.toHaveProperty("tourDismissed");
      // a preference-only patch must not reset progress to step 0
      expect(data).not.toHaveProperty("currentStep");
      expect(data).not.toHaveProperty("isOnboardingComplete");
    });

    it("R18-03: step patches still recompute progress", async () => {
      expect(await patch({ hasCompletedWelcome: true, hasCreatedCompany: true })).toBe(200);
      const [, data] = updateUserOnboarding.mock.calls[0];
      expect(data.currentStep).toBe(2);
      expect(data.isOnboardingComplete).toBe(false);
    });
  });
});
