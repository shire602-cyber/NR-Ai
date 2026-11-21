import type { Company } from "../../../../shared/schema";
import { EInvoiceProviderError, type EInvoiceProvider } from "../../einvoice-provider";
import { providerInfo, providerModule, type PublicProviderInfo } from "./registry";
import { readCompanyCredentials, type CompanyCredentialContext } from "./company-credentials";
import type { EInvoiceProviderModule, ProviderEnvironment } from "./types";

type CompanySelection = Pick<Company, "id" | "einvoicePartner">;
type ProviderId = CompanyCredentialContext["provider"];

type CompanyProviderConfiguration = {
  module: EInvoiceProviderModule;
  env: NodeJS.ProcessEnv;
  environment: ProviderEnvironment;
  webhookSecret: string | null;
};

function asProviderId(id: string | null | undefined): ProviderId | null {
  return id === "acube" || id === "complyance" ? id : null;
}

export async function companyProviderConfiguration(
  companyId: string,
  id: string | null | undefined,
  options: { environment?: string | null; env?: NodeJS.ProcessEnv } = {}
): Promise<CompanyProviderConfiguration | null> {
  const provider = asProviderId(id);
  const module = providerModule(provider);
  if (!provider || !module) return null;
  const env = options.env ?? process.env;
  const environment = module.environment(env);
  // An environment change pauses existing work. Never send it to the newly selected endpoint.
  if (options.environment && options.environment !== environment) return null;
  const bundle = await readCompanyCredentials({ companyId, provider, environment }, env);
  if (!bundle) return null;
  const providerEnv = Object.fromEntries(module.envVars.map((key) => [key, env[key]]));
  if (bundle.provider === "acube") {
    return {
      module,
      environment,
      env: {
        ...providerEnv,
        ACUBE_ENV: environment,
        ACUBE_COMMON_URL: env.ACUBE_COMMON_URL,
        ACUBE_WEBHOOK_TOKEN: undefined,
        ACUBE_EMAIL: bundle.credentials.email,
        ACUBE_PASSWORD: bundle.credentials.password,
        ACUBE_CREDENTIAL_SCOPE: companyId,
      },
      webhookSecret: bundle.credentials.webhookToken ?? null,
    };
  }
  return {
    module,
    environment,
    env: {
      ...providerEnv,
      COMPLYANCE_ENV: environment,
      COMPLYANCE_API_KEY: bundle.credentials.apiKey,
      COMPLYANCE_WEBHOOK_SECRET: undefined,
    },
    webhookSecret: bundle.credentials.webhookSecret ?? null,
  };
}

export interface CompanyProviderHealth {
  chosenProvider: ProviderId | null;
  status: "not_selected" | "not_configured" | "configured";
  environment: ProviderEnvironment | null;
  provider: PublicProviderInfo | null;
}

/** Reports local configuration only. Opening the settings page never calls a provider. */
export async function companyProviderHealth(
  company: CompanySelection,
  env: NodeJS.ProcessEnv = process.env
): Promise<CompanyProviderHealth> {
  const chosenProvider = asProviderId(company.einvoicePartner);
  const config = await companyProviderConfiguration(company.id, chosenProvider, { env });
  return {
    chosenProvider,
    status: config ? "configured" : chosenProvider ? "not_configured" : "not_selected",
    environment: providerModule(chosenProvider)?.environment(env) ?? null,
    provider: config ? providerInfo(config.module, config.env) : null,
  };
}

/** Resolve the company selection, or a trusted provider/environment already pinned to existing work. */
export async function getCompanyEInvoiceProvider(
  companyId: string,
  options: {
    provider?: string | null;
    environment?: string | null;
    fetch?: typeof fetch;
    env?: NodeJS.ProcessEnv;
  } = {}
): Promise<EInvoiceProvider> {
  let provider = options.provider;
  if (provider == null) {
    const [{ db }, { companies }, { eq }] = await Promise.all([
      import("../../../db"),
      import("../../../../shared/schema"),
      import("drizzle-orm"),
    ]);
    const [company] = await db
      .select({ partner: companies.einvoicePartner })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);
    provider = company?.partner;
  }
  const config = await companyProviderConfiguration(companyId, provider, options);
  if (!config) {
    throw new EInvoiceProviderError(
      "EINVOICE_PROVIDER_NOT_CONFIGURED",
      "Choose an e-invoicing provider and configure its credentials for this company."
    );
  }
  return config.module.create(config.env, { fetch: options.fetch });
}
