/**
 * UAE payment-service-provider adapters (W4-D, R16-14) — Telr and Network International
 * (N-Genius). These are skeletons behind the adapter interface: they always report
 * `requires_external` because merchant onboarding (contract, KYC, store id / outlet reference,
 * webhook key) has to be completed with the provider before a single test transaction can run.
 * Creating a checkout or accepting a webhook through them is refused with a clear 503.
 */
import { DomainError } from "../../errors";
import { WebhookSignatureError, type PaymentProviderAdapter } from "./types";

function requiresExternal(provider: string, action: { en: string; ar: string }): never {
  throw new DomainError(
    "PAYMENT_PROVIDER_REQUIRES_EXTERNAL",
    503,
    { provider, externalAction: action },
    `${provider} is not available: ${action.en}`
  );
}

const TELR_ACTION = {
  en: "Sign a Telr merchant agreement and set TELR_STORE_ID, TELR_AUTH_KEY and the webhook key.",
  ar: "وقّع اتفاقية تاجر مع Telr واضبط TELR_STORE_ID وTELR_AUTH_KEY ومفتاح الويب هوك.",
};

const NGENIUS_ACTION = {
  en: "Complete Network International (N-Genius) onboarding and set the outlet reference and API key.",
  ar: "أكمل التسجيل لدى Network International (N-Genius) واضبط مرجع المنفذ ومفتاح الواجهة البرمجية.",
};

export const telrAdapter: PaymentProviderAdapter = {
  id: "telr",
  label: { en: "Card payment (Telr)", ar: "الدفع بالبطاقة (Telr)" },
  status: () => "requires_external",
  async createCheckoutSession() {
    return requiresExternal("telr", TELR_ACTION);
  },
  verifyWebhook() {
    throw new WebhookSignatureError("Telr webhooks are not configured (requires external setup)");
  },
};

export const ngeniusAdapter: PaymentProviderAdapter = {
  id: "ngenius",
  label: { en: "Card payment (N-Genius)", ar: "الدفع بالبطاقة (N-Genius)" },
  status: () => "requires_external",
  async createCheckoutSession() {
    return requiresExternal("ngenius", NGENIUS_ACTION);
  },
  verifyWebhook() {
    throw new WebhookSignatureError(
      "N-Genius webhooks are not configured (requires external setup)"
    );
  },
};

export const UAE_GATEWAY_ACTIONS = { telr: TELR_ACTION, ngenius: NGENIUS_ACTION };
