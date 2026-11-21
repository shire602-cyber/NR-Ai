import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  companyCredentialVariable,
  readCompanyCredentials,
  sealCompanyCredentials,
  type CompanyCredentialContext,
} from "../../server/services/einvoice/providers/company-credentials";
import {
  companyProviderHealth,
  getCompanyEInvoiceProvider,
} from "../../server/services/einvoice/providers/company-provider";

function bind(
  companyId: string,
  provider: CompanyCredentialContext["provider"],
  credentials: unknown,
  env: NodeJS.ProcessEnv
) {
  const context = { companyId, provider, environment: "sandbox" } as const;
  env[companyCredentialVariable(context)] = sealCompanyCredentials(context, credentials);
  return context;
}

describe("company e-invoicing credentials", () => {
  it("requires an explicit choice and only checks the chosen company's local configuration", async () => {
    const id = randomUUID();
    const env: NodeJS.ProcessEnv = {
      EINVOICE_PROVIDER: "acube",
      ACUBE_EMAIL: "global@example.test",
      ACUBE_PASSWORD: randomUUID(),
    };
    bind(id, "complyance", { apiKey: randomUUID() }, env);
    expect(await companyProviderHealth({ id, einvoicePartner: null }, env)).toEqual({
      chosenProvider: null,
      status: "not_selected",
      environment: null,
      provider: null,
    });
    expect(await companyProviderHealth({ id, einvoicePartner: "acube" }, env)).toEqual({
      chosenProvider: "acube",
      status: "not_configured",
      environment: "sandbox",
      provider: null,
    });
    expect(await companyProviderHealth({ id, einvoicePartner: "complyance" }, env)).toMatchObject({
      chosenProvider: "complyance",
      status: "configured",
      provider: { id: "complyance", environment: "sandbox" },
    });
  });

  it("rejects plaintext, cross-company and cross-environment bundles, and honors a mounted file", async () => {
    const id = randomUUID();
    const env: NodeJS.ProcessEnv = {};
    const apiKey = randomUUID();
    const context = bind(id, "complyance", { apiKey }, env);
    const name = companyCredentialVariable(context);
    const encrypted = env[name]!;
    expect(encrypted).not.toContain(apiKey);
    env[name] = JSON.stringify({ ...context, credentials: { apiKey } });
    expect(await readCompanyCredentials(context, env)).toBeNull();

    const foreign = { ...context, companyId: randomUUID() };
    const production = { ...context, environment: "production" } as const;
    env[companyCredentialVariable(foreign)] = encrypted;
    env[companyCredentialVariable(production)] = encrypted;
    expect(await readCompanyCredentials(foreign, env)).toBeNull();
    expect(await readCompanyCredentials(production, env)).toBeNull();

    const dir = await mkdtemp(join(tmpdir(), "einvoice-credentials-"));
    try {
      const path = join(dir, "bundle");
      await writeFile(path, encrypted, { mode: 0o600 });
      delete env[name];
      env[`${name}_FILE`] = path;
      expect(await readCompanyCredentials(context, env)).toEqual({
        ...context,
        credentials: { apiKey },
      });
      expect(
        await companyProviderHealth(
          { id, einvoicePartner: "complyance" },
          { ...env, COMPLYANCE_ENV: "production" }
        )
      ).toMatchObject({ status: "not_configured", environment: "production" });
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("authenticates both provider choices in the same process and refuses the wrong environment", async () => {
    const env: NodeJS.ProcessEnv = {};
    const acubeId = randomUUID();
    const complyanceId = randomUUID();
    const acubePassword = randomBytes(24).toString("base64url");
    const complyanceKey = randomBytes(24).toString("base64url");
    const acubeToken = randomUUID();
    bind(acubeId, "acube", { email: "company@example.test", password: acubePassword }, env);
    bind(complyanceId, "complyance", { apiKey: complyanceKey }, env);
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/login") {
        expect(JSON.parse(String(init?.body))).toMatchObject({ password: acubePassword });
        return Response.json({ token: acubeToken });
      }
      const authorization = new Headers(init?.headers).get("Authorization");
      if (url.hostname.endsWith("acubeapi.com")) {
        expect(authorization).toBe(`Bearer ${acubeToken}`);
        return Response.json({ invoiceId: "test-invoice", status: "valid" });
      }
      expect(authorization).toBe(`Bearer ${complyanceKey}`);
      return Response.json({
        data: {
          documentId: "test-invoice",
          documentNumber: "INV-001",
          environment: "sandbox",
          state: "delivery_success",
        },
      });
    });
    const acube = await getCompanyEInvoiceProvider(acubeId, { provider: "acube", env, fetch });
    const cmp = await getCompanyEInvoiceProvider(complyanceId, {
      provider: "complyance",
      env,
      fetch,
    });
    expect((await acube.getStatus("test-invoice")).providerMessageId).toBe("test-invoice");
    expect(
      (
        await cmp.getStatus("test-invoice", {
          knownCredentialScope: true,
          outboundIdentity: {
            documentNumber: "INV-001",
            supplierTin: null,
            supplierTrn: null,
            legalEntityId: null,
            sourceName: null,
          },
        })
      ).status
    ).toBe("submitted");
    await expect(
      getCompanyEInvoiceProvider(acubeId, {
        provider: "acube",
        environment: "production",
        env,
        fetch,
      })
    ).rejects.toMatchObject({ code: "EINVOICE_PROVIDER_NOT_CONFIGURED" });
    await expect(
      getCompanyEInvoiceProvider(acubeId, { provider: "complyance", env, fetch })
    ).rejects.toMatchObject({ code: "EINVOICE_PROVIDER_NOT_CONFIGURED" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("keeps cached A-Cube sessions separate even if companies use the same login email", async () => {
    const env: NodeJS.ProcessEnv = {};
    const firstCompany = randomUUID();
    const secondCompany = randomUUID();
    const email = "shared-address@example.test";
    const firstPassword = randomUUID();
    const secondPassword = randomUUID();
    const firstToken = randomUUID();
    const secondToken = randomUUID();
    bind(firstCompany, "acube", { email, password: firstPassword }, env);
    bind(secondCompany, "acube", { email, password: secondPassword }, env);
    const authorizations: Array<string | null> = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (new URL(String(input)).pathname === "/login") {
        const credentials = JSON.parse(String(init?.body)) as { password: string };
        return Response.json({
          token: credentials.password === firstPassword ? firstToken : secondToken,
        });
      }
      authorizations.push(new Headers(init?.headers).get("Authorization"));
      return Response.json({ invoiceId: "test-invoice", status: "valid" });
    });

    for (const companyId of [firstCompany, secondCompany, firstCompany]) {
      const provider = await getCompanyEInvoiceProvider(companyId, {
        provider: "acube",
        env,
        fetch,
      });
      await provider.getStatus("test-invoice");
    }
    expect(authorizations).toEqual(
      [firstToken, secondToken, firstToken].map((token) => `Bearer ${token}`)
    );
    expect(fetch).toHaveBeenCalledTimes(5);
  });
});
