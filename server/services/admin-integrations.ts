/**
 * Admin > Integrations: which platform credentials are configured. Secrets are never entered or
 * stored through the UI (they live in the server environment); the page only shows whether each
 * integration has credentials, and Google Sheets can be tested on demand.
 */
export interface AdminIntegrationStatus {
  stripe: { configured: boolean };
  openai: { configured: boolean };
  googleSheets: { configured: boolean };
}

const present = (v: string | undefined) => !!v && v.trim().length > 0;

export function adminIntegrationStatus(
  env: Record<string, string | undefined> = process.env
): AdminIntegrationStatus {
  return {
    stripe: { configured: present(env.STRIPE_SECRET_KEY) },
    openai: { configured: present(env.OPENAI_API_KEY) },
    googleSheets: {
      configured:
        (present(env.GOOGLE_SERVICE_ACCOUNT_EMAIL) &&
          present(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)) ||
        (present(env.GOOGLE_CLIENT_ID) &&
          present(env.GOOGLE_CLIENT_SECRET) &&
          present(env.GOOGLE_REFRESH_TOKEN)),
    },
  };
}
