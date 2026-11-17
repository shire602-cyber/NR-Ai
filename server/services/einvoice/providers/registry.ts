/**
 * The accredited e-invoicing providers this build knows (E2).
 *
 * One line per provider. To drop a provider after the commercial decision, delete its line here
 * and its files (docs/einvoicing-providers.md lists them); nothing else imports a provider by name.
 *
 * Selection is explicit: EINVOICE_PROVIDER names one provider, and it is only exposed once its
 * credentials are configured. Credentials of a provider that is not selected are never used.
 */
import type { EInvoiceProviderModule, ProviderEnvironment } from "./types";
import { MOF_ASP_REGISTER_URL } from "./types";
import { ACUBE_PROVIDER_MODULE } from "./acube";
import { COMPLYANCE_PROVIDER_MODULE } from "./complyance";

const MODULES: readonly EInvoiceProviderModule[] = [
  ACUBE_PROVIDER_MODULE,
  COMPLYANCE_PROVIDER_MODULE,
];

/** Every provider compiled into this build (configured or not). */
export function registeredProviderIds(): string[] {
  return MODULES.map((m) => m.id);
}

/** A registered provider by its EINVOICE_PROVIDER id, configured or not. */
export function providerModule(id: string | null | undefined): EInvoiceProviderModule | null {
  const key = String(id ?? "")
    .trim()
    .toLowerCase();
  return MODULES.find((m) => m.id === key) ?? null;
}

/** The provider EINVOICE_PROVIDER selects, when it names a registered one. */
export function selectedProviderModule(
  env: NodeJS.ProcessEnv = process.env
): EInvoiceProviderModule | null {
  return providerModule(env.EINVOICE_PROVIDER);
}

/**
 * The providers a caller may use: only the selected one, and only once its credentials are set.
 * Zero or one entry; never a provider that is merely compiled in.
 */
export function configuredProviderModules(
  env: NodeJS.ProcessEnv = process.env
): EInvoiceProviderModule[] {
  const m = selectedProviderModule(env);
  return m && m.configured(env) ? [m] : [];
}

export function activeProviderModule(
  env: NodeJS.ProcessEnv = process.env
): EInvoiceProviderModule | null {
  return configuredProviderModules(env)[0] ?? null;
}

/** Is this provider the selected, configured one (for its own routes and jobs)? */
export function providerIsActive(id: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return activeProviderModule(env)?.id === id;
}

export interface PublicProviderInfo {
  id: string;
  displayName: string;
  legalName: string;
  accreditationNumber: string;
  registerUrl: string;
  website: string;
  emaraTaxListing: string;
  environment: ProviderEnvironment;
}

/** What the UI may show about the active provider (no secrets, no env values). */
export function publicProviderInfo(
  env: NodeJS.ProcessEnv = process.env
): PublicProviderInfo | null {
  const m = activeProviderModule(env);
  if (!m) return null;
  return {
    id: m.id,
    displayName: m.displayName,
    legalName: m.legalName,
    accreditationNumber: m.accreditationNumber,
    registerUrl: MOF_ASP_REGISTER_URL,
    website: m.website,
    emaraTaxListing: m.emaraTaxListing,
    environment: m.environment(env),
  };
}
