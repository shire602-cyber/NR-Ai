import type { Express, Request, RequestHandler, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerIntegrationStatusRoutes } from "../../server/routes/integration-status.routes";
import { getCapability, type CapabilityId } from "../../shared/capabilities";

describe("CSV bank reconciliation guidance", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    {
      id: "bank_feed_lean",
      provider: "Lean",
      env: { LEAN_APP_TOKEN: "demo-value", LEAN_API_BASE_URL: "https://bank.example" },
    },
    {
      id: "bank_feed_tarabut",
      provider: "Tarabut",
      env: {
        TARABUT_CLIENT_ID: "demo-value",
        TARABUT_CLIENT_SECRET: "demo-value",
        TARABUT_API_BASE_URL: "https://bank.example",
      },
    },
    {
      id: "bank_feed_wio",
      provider: "Wio",
      env: {
        WIO_CLIENT_ID: "demo-value",
        WIO_CLIENT_SECRET: "demo-value",
        WIO_API_BASE_URL: "https://bank.example",
      },
    },
  ] satisfies ReadonlyArray<{
    id: CapabilityId;
    provider: string;
    env: Record<string, string>;
  }>)("keeps $provider readiness for operator diagnostics", ({ id, provider, env }) => {
    expect(getCapability(id, {})).toEqual({
      id,
      status: "requires_external",
      label: {
        en: `${provider} adapter diagnostics`,
        ar: `تشخيص محوّل ${provider}`,
      },
      externalAction: {
        en: "Review adapter configuration in operator diagnostics.",
        ar: "راجع إعدادات المحوّل في تشخيصات التشغيل.",
      },
      envVars: Object.keys(env),
    });
    expect(getCapability(id, env).status).toBe("live");
  });

  it.each([false, true])(
    "reports CSV reconciliation as available when adapter configured is %s",
    async (configured) => {
      vi.stubEnv("LEAN_APP_TOKEN", configured ? "demo-value" : "");
      vi.stubEnv("LEAN_API_BASE_URL", "");
      vi.stubEnv("TARABUT_CLIENT_ID", "");
      vi.stubEnv("WIO_CLIENT_ID", "");
      vi.stubEnv("BANK_FEED_REDIRECT_URIS", "https://app.example.test/bank-feeds/callback");
      const get = vi.fn();
      registerIntegrationStatusRoutes({ get } as unknown as Express);
      const handler: RequestHandler = get.mock.calls[0][3];
      const response = { json: vi.fn() };
      const next = vi.fn();

      await handler({} as Request, response as unknown as Response, next);

      expect(get.mock.calls[0][0]).toBe("/api/admin/integration-status");
      expect(next).not.toHaveBeenCalled();
      expect(response.json).toHaveBeenCalledWith({
        integrations: expect.arrayContaining([
          {
            key: "bankStatementUpload",
            name: "Bank statement upload",
            configured: true,
            detail:
              "Upload a CSV exported from your bank, review suggested matches, and reconcile against your books",
            requiredEnv: [],
            unlocks: "Upload CSV bank statements for reconciliation",
          },
        ]),
        bankProviderDiagnostics: {
          statuses: [
            {
              id: "lean",
              configured,
              status: configured ? "sandbox" : "requires_external",
            },
            { id: "tarabut", configured: false, status: "requires_external" },
            { id: "wio", configured: false, status: "requires_external" },
          ],
          redirectUris: ["https://app.example.test/bank-feeds/callback"],
        },
      });
    }
  );
});
