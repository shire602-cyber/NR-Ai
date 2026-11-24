import type { CompanyCredentialContext } from "./company-credentials";

type ProviderId = CompanyCredentialContext["provider"];

/** Provider callbacks are registered against the app's public HTTPS origin. */
export function providerCallbackOrigin(provider: ProviderId): string | null {
  const configured =
    process.env[`${provider.toUpperCase()}_WEBHOOK_BASE_URL`] || process.env.AUTH_PUBLIC_URL;
  if (!configured) return null;
  try {
    const url = new URL(configured);
    return url.protocol === "https:" &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

export function providerCallbackUrl(
  provider: ProviderId,
  environment: string,
  companyId: string
): string | null {
  const origin = providerCallbackOrigin(provider);
  return origin ? `${origin}/api/webhooks/einvoice/${provider}/${environment}/${companyId}` : null;
}
