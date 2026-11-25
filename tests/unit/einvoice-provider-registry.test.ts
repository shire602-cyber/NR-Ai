/**
 * E2: the provider registry only exposes the provider EINVOICE_PROVIDER selects, and only once its
 * credentials are configured; another provider's credentials are never picked up.
 */
import { describe, expect, it } from "vitest";
import {
  activeProviderModule,
  configuredProviderModules,
  providerModule,
  publicProviderInfo,
  registeredProviderIds,
} from "../../server/services/einvoice/providers/registry";
import {
  EInvoiceProviderError,
  getEInvoiceProvider,
} from "../../server/services/einvoice-provider";

const ACUBE = { ACUBE_EMAIL: "a@example.test", ACUBE_PASSWORD: "pw" };
const COMPLYANCE = { COMPLYANCE_API_KEY: "key" };
const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;

describe("E2 provider registry", () => {
  it("knows both accredited providers, with their MoF accreditation numbers", () => {
    expect(registeredProviderIds().sort()).toEqual(["acube", "complyance"]);
    expect(providerModule("acube")?.accreditationNumber).toBe("188961");
    expect(providerModule("complyance")).toMatchObject({
      accreditationNumber: "112219",
      legalName: "Complyance Electronics L.L.C",
    });
  });

  it("exposes nothing when no provider is selected, even with credentials present", () => {
    expect(configuredProviderModules(env({ ...ACUBE, ...COMPLYANCE }))).toEqual([]);
    expect(publicProviderInfo(env({ ...ACUBE, ...COMPLYANCE }))).toBeNull();
  });

  it("exposes nothing when the selected provider lacks its credentials", () => {
    expect(configuredProviderModules(env({ EINVOICE_PROVIDER: "acube" }))).toEqual([]);
    // A-Cube's credentials do not make Complyance configured, nor the other way round.
    expect(configuredProviderModules(env({ EINVOICE_PROVIDER: "complyance", ...ACUBE }))).toEqual(
      []
    );
    expect(configuredProviderModules(env({ EINVOICE_PROVIDER: "acube", ...COMPLYANCE }))).toEqual(
      []
    );
  });

  it("exposes exactly the selected, configured provider", () => {
    expect(
      configuredProviderModules(env({ EINVOICE_PROVIDER: "acube", ...ACUBE, ...COMPLYANCE })).map(
        (m) => m.id
      )
    ).toEqual(["acube"]);
    expect(
      configuredProviderModules(
        env({ EINVOICE_PROVIDER: "Complyance", ...ACUBE, ...COMPLYANCE })
      ).map((m) => m.id)
    ).toEqual(["complyance"]);
    expect(activeProviderModule(env({ EINVOICE_PROVIDER: "complyance", ...COMPLYANCE }))?.id).toBe(
      "complyance"
    );
    expect(
      publicProviderInfo(
        env({ EINVOICE_PROVIDER: "complyance", ...COMPLYANCE, COMPLYANCE_ENV: "production" })
      )
    ).toEqual({
      id: "complyance",
      displayName: "Complyance",
      legalName: "Complyance Electronics L.L.C",
      accreditationNumber: "112219",
      registerUrl: expect.stringMatching(/^https:\/\/mof\.gov\.ae\//),
      website: "https://www.complyance.io",
      emaraTaxListing: expect.any(String),
      environment: "production",
    });
  });

  it("public info never carries a credential", () => {
    const info = JSON.stringify(publicProviderInfo(env({ EINVOICE_PROVIDER: "acube", ...ACUBE })));
    expect(info).not.toContain("pw");
    expect(info).not.toContain("a@example.test");
  });

  it("getEInvoiceProvider refuses a selected provider without credentials (503), names registered ids for typos", () => {
    expect(() => getEInvoiceProvider(env({ EINVOICE_PROVIDER: "complyance" }))).toThrow(
      EInvoiceProviderError
    );
    expect(() => getEInvoiceProvider(env({ EINVOICE_PROVIDER: "acme" }))).toThrow(
      /"acube" or "complyance"/
    );
    expect(getEInvoiceProvider(env({ EINVOICE_PROVIDER: "complyance", ...COMPLYANCE })).name).toBe(
      "complyance"
    );
    expect(getEInvoiceProvider(env({ EINVOICE_PROVIDER: "acube", ...ACUBE })).name).toBe("acube");
  });
});
