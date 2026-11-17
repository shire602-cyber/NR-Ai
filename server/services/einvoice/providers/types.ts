/**
 * Provider-neutral description of an accredited e-invoicing service provider (E2).
 *
 * Muhasib is built against two MoF-accredited ASPs (A-Cube, Complyance) and will switch on the
 * one it signs with. Each provider is one module (its adapter, its webhook route, its fixtures and
 * its docs) that exports one of these descriptors; `registry.ts` lists them. Removing one is more
 * than deleting its files: a short list of touch points outside them also names it (route
 * registration, webhook raw-body prefix and CSRF exemption, env detection, error-code lists, the
 * settings-card entry, marketing copy, locale keys). docs/einvoicing-providers.md lists every one,
 * and tests/unit/einvoice-provider-discard.test.ts fails when that list goes out of date.
 */
import type { EInvoiceProvider } from "../../einvoice-provider";

export type ProviderEnvironment = "sandbox" | "production";

export interface EInvoiceProviderModule {
  /** The EINVOICE_PROVIDER value that selects it, also stored as `provider` on our rows. */
  readonly id: string;
  /** Short brand name for UI copy ("A-Cube", "Complyance"). */
  readonly displayName: string;
  /** Legal name exactly as on the Ministry of Finance ASP register. */
  readonly legalName: string;
  /** Accreditation number from the MoF register. */
  readonly accreditationNumber: string;
  readonly website: string;
  /** How the taxpayer finds this ASP in EmaraTax (needs confirming in each sandbox). */
  readonly emaraTaxListing: string;
  /** Environment variables the provider reads (names only; values are secrets). */
  readonly envVars: readonly string[];
  configured(env?: NodeJS.ProcessEnv): boolean;
  environment(env?: NodeJS.ProcessEnv): ProviderEnvironment;
  /** Message for 503 EINVOICE_PROVIDER_NOT_CONFIGURED when selected but not configured. */
  readonly notConfiguredMessage: string;
  create(env: NodeJS.ProcessEnv, deps: { fetch?: typeof fetch }): EInvoiceProvider;
}

/** The MoF register of accredited e-invoicing service providers (source of every number). */
export const MOF_ASP_REGISTER_URL =
  "https://mof.gov.ae/en/about-us/initiatives/einvoicing/einvoicing-accredited-service-providers-asps/";
