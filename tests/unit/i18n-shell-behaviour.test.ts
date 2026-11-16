import { readFileSync } from "node:fs";
import { readDashboardSource } from "./dashboardSource";
import { join } from "node:path";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repoRoot = process.cwd();
const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");

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
  it("R18-03: the tour persists a server-side dismissal once per user with a localStorage fallback", () => {
    const wizard = read("client/src/components/Onboarding.tsx");
    expect(wizard).toContain("{ tourDismissed: true }");
    expect(wizard).toContain("tourDismissedAt");
    expect(wizard).toContain("readLocalTourDismissed");
    expect(wizard).toContain("muhasib_tour_dismissed:");
    // never over the onboarding page itself
    expect(wizard).toContain('location.split("?")[0] === "/onboarding"');
    // recorded the moment it is shown, not only on an explicit skip
    expect(wizard).toMatch(/setHasAutoShown\(true\);[\s\S]*skipMutation\.mutate\(\)/);
  });

  it("R18-03: user_onboarding gains tour_dismissed_at in the Drizzle schema", () => {
    expect(read("shared/schema/platform.ts")).toContain('tourDismissedAt: timestamp("tour_dismissed_at")');
  });

  it("R18-08: the onboarding redirect is deterministic per-user state, not a session flag", () => {
    const app = read("client/src/App.tsx");
    expect(app).not.toContain("onboarding_redirect_seen");
    expect(app).not.toContain("sessionStorage.getItem(REDIRECT_FLAG)");
    expect(app).toContain('navigate("/onboarding")');
    // waits for in-flight company refetches so a just-finished wizard is not bounced back
    expect(app).toContain('useIsFetching({ queryKey: ["/api/companies"] })');
  });

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

// ── First invoice UX (R18-06, R18-07, R18-12, R18-13) ────────────────────────

describe("first-invoice experience", () => {
  const invoices = read("client/src/pages/Invoices.tsx");
  const dashboard = readDashboardSource();

  it("R18-06: the epoch-based INV-<ms> placeholder is gone and the field says it is assigned on save", () => {
    expect(invoices).not.toContain("INV-${Date.now()}");
    expect(invoices).toContain('t["invoices.numberAssignedOnSave"]');
    expect(invoices).toContain("readOnly={!editingInvoice}");
  });

  it("R18-07: a saved draft offers Issue now / Keep as draft and issues through the status endpoint", () => {
    expect(invoices).toContain('data-testid="dialog-invoice-draft-nudge"');
    expect(invoices).toContain('t["invoices.nudgeIssueNow"]');
    expect(invoices).toContain('t["invoices.nudgeKeepDraft"]');
    expect(invoices).toContain('{ id: target.id, status: "sent" }');
    expect(invoices).toContain("setDraftNudge({ id: created.id");
  });

  it("R18-13: the dashboard explains that drafts do not count as revenue", () => {
    expect(dashboard).toContain('data-testid="card-draft-not-revenue"');
    expect(dashboard).toContain('t["dashboard.draftNotRevenueTitle"]');
  });

  it("R18-12: the empty dashboard has a guided first-invoice entry that opens the New Invoice dialog", () => {
    expect(dashboard).toContain('data-testid="card-first-invoice-guide"');
    expect(dashboard).toContain('href="/invoices?new=1"');
    expect(invoices).toContain('.get("new") === "1"');
  });
});
