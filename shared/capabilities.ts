/**
 * Integration capability registry — the single honest answer to "does this
 * integration actually work in this deployment?".
 *
 * Status (frozen):
 *   live              configured with production credentials
 *   sandbox           configured against a test/sandbox endpoint (or a
 *                     non-durable local fallback) — must be labelled in UI
 *   requires_external cannot work until an external party acts (contract,
 *                     accreditation, API key issued to the business)
 *   disabled          optional feature, not configured
 *
 * Pure and isomorphic: computeCapabilities(env) takes an env record so it can
 * be unit-tested and evaluated on the server; the client receives the
 * serialisable `CapabilitySnapshot` (no secrets, only statuses and copy).
 * This module adds no routes.
 */

export type CapabilityStatus = "live" | "sandbox" | "requires_external" | "disabled";

export type CapabilityId =
  | "email"
  | "storage"
  | "ai"
  | "stripe_billing"
  | "invoice_payments"
  | "einvoicing_asp"
  | "shopify"
  | "stripe_payouts"
  | "google_sheets"
  | "push"
  | "sms"
  | "whatsapp"
  | "fx_rate_feed"
  | "news_feed"
  | "antivirus"
  | "captcha"
  | "saml";

export interface LocalizedText {
  en: string;
  ar: string;
}

export interface Capability {
  id: CapabilityId;
  status: CapabilityStatus;
  label: LocalizedText;
  /** What must happen externally for the capability to be live. */
  externalAction: LocalizedText;
  /** Env vars that configure it (names only, never values). */
  envVars: readonly string[];
}

export type CapabilitySnapshot = {
  generatedAt: string;
  capabilities: Capability[];
};

export type EnvLike = Readonly<Record<string, string | undefined>>;

interface CapabilityDef {
  id: CapabilityId;
  label: LocalizedText;
  externalAction: LocalizedText;
  envVars: readonly string[];
  /** Status when nothing is configured. */
  whenUnconfigured: Extract<CapabilityStatus, "disabled" | "requires_external">;
  /** Returns null when not configured, else live/sandbox. */
  detect: (env: EnvLike) => Extract<CapabilityStatus, "live" | "sandbox"> | null;
}

const set = (env: EnvLike, name: string): boolean => {
  const v = env[name];
  return typeof v === "string" && v.trim().length > 0;
};
const all = (env: EnvLike, names: readonly string[]) => names.every((n) => set(env, n));
const looksSandbox = (value: string | undefined): boolean =>
  typeof value === "string" && /sandbox|test|staging|uat|demo/i.test(value);
/** Comma-separated https URLs (malformed or non-https entries are ignored). */
export function httpsFeedUrls(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const url = part.trim();
    if (!url) continue;
    try {
      const u = new URL(url);
      if (u.protocol === "https:") out.push(u.toString());
    } catch {
      // ignored
    }
  }
  return out;
}
const flag = (env: EnvLike, name: string): boolean =>
  ["1", "true", "yes", "on"].includes((env[name] ?? "").trim().toLowerCase());

const DEFS: readonly CapabilityDef[] = [
  {
    id: "email",
    label: { en: "Transactional email", ar: "البريد الإلكتروني للمعاملات" },
    externalAction: {
      en: "Configure an SMTP server or a Resend API key with a verified sending domain.",
      ar: "قم بإعداد خادم SMTP أو مفتاح Resend مع نطاق إرسال موثّق.",
    },
    envVars: ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "RESEND_API_KEY"],
    whenUnconfigured: "disabled",
    detect: (env) => (set(env, "RESEND_API_KEY") || set(env, "SMTP_HOST") ? "live" : null),
  },
  {
    id: "storage",
    label: { en: "Durable file storage", ar: "تخزين الملفات الدائم" },
    externalAction: {
      en: "Provision an S3-compatible bucket (or Vercel Blob) for receipts and documents.",
      ar: "قم بتوفير حاوية متوافقة مع S3 (أو Vercel Blob) للإيصالات والمستندات.",
    },
    envVars: ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "BLOB_READ_WRITE_TOKEN"],
    whenUnconfigured: "requires_external",
    detect: (env) => {
      if (set(env, "S3_BUCKET") || set(env, "BLOB_READ_WRITE_TOKEN")) return "live";
      // A persistent mounted volume works but is single-instance; label it.
      if (set(env, "RAILWAY_VOLUME_MOUNT_PATH") || flag(env, "UPLOADS_PERSISTENT"))
        return "sandbox";
      return null;
    },
  },
  {
    id: "ai",
    label: { en: "AI assistant & OCR", ar: "المساعد الذكي والتعرف الضوئي" },
    externalAction: {
      en: "Add an OpenAI or Anthropic API key under a data-processing agreement.",
      ar: "أضف مفتاح OpenAI أو Anthropic بموجب اتفاقية معالجة بيانات.",
    },
    envVars: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
    whenUnconfigured: "disabled",
    detect: (env) => (set(env, "OPENAI_API_KEY") || set(env, "ANTHROPIC_API_KEY") ? "live" : null),
  },
  {
    id: "stripe_billing",
    label: { en: "Subscription billing (Stripe)", ar: "فوترة الاشتراكات (Stripe)" },
    externalAction: {
      en: "Activate a Stripe account, create price IDs and register the webhook secret.",
      ar: "فعّل حساب Stripe وأنشئ معرّفات الأسعار وسجّل سر الويب هوك.",
    },
    envVars: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    whenUnconfigured: "requires_external",
    detect: (env) => {
      if (!all(env, ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"])) return null;
      return (env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live_") ? "live" : "sandbox";
    },
  },
  {
    id: "invoice_payments",
    label: { en: "Online invoice payments", ar: "الدفع الإلكتروني للفواتير" },
    externalAction: {
      en: "Complete payment-gateway merchant onboarding (Stripe or a UAE PSP) for card collection.",
      ar: "أكمل تسجيل التاجر لدى بوابة الدفع (Stripe أو مزود محلي) لتحصيل البطاقات.",
    },
    envVars: ["STRIPE_SECRET_KEY", "INVOICE_PAYMENTS_ENABLED"],
    whenUnconfigured: "requires_external",
    detect: (env) => {
      if (!set(env, "STRIPE_SECRET_KEY") || !flag(env, "INVOICE_PAYMENTS_ENABLED")) return null;
      return (env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live_") ? "live" : "sandbox";
    },
  },
  {
    id: "einvoicing_asp",
    label: {
      en: "UAE e-invoicing (Accredited Service Provider)",
      ar: "الفوترة الإلكترونية (مزود خدمة معتمد)",
    },
    externalAction: {
      en: "Contract an MoF-accredited ASP (Peppol PINT AE) and obtain production credentials.",
      ar: "تعاقد مع مزود خدمة معتمد من وزارة المالية (Peppol PINT AE) واحصل على بيانات اعتماد إنتاجية.",
    },
    envVars: [
      "EINVOICE_ASP_API_KEY",
      "EINVOICE_ASP_BASE_URL",
      "EINVOICE_ASP_ENV",
      "EINVOICE_PROVIDER",
      "ACUBE_ENV",
      "ACUBE_EMAIL",
      "ACUBE_PASSWORD",
      "COMPLYANCE_ENV",
      "COMPLYANCE_API_KEY",
    ],
    whenUnconfigured: "requires_external",
    // E1: A-Cube (EINVOICE_PROVIDER=acube) is live with production credentials, else sandbox.
    // E2: Complyance (EINVOICE_PROVIDER=complyance) likewise with COMPLYANCE_ENV=production.
    detect: (env) =>
      (env.EINVOICE_PROVIDER ?? "").toLowerCase() === "complyance"
        ? env.COMPLYANCE_API_KEY
          ? (env.COMPLYANCE_ENV ?? "").toLowerCase() === "production"
            ? "live"
            : "sandbox"
          : null
        : (env.EINVOICE_PROVIDER ?? "").toLowerCase() === "acube"
          ? all(env, ["ACUBE_EMAIL", "ACUBE_PASSWORD"])
            ? (env.ACUBE_ENV ?? "").toLowerCase() === "production"
              ? "live"
              : "sandbox"
            : null
          : all(env, ["EINVOICE_ASP_API_KEY", "EINVOICE_ASP_BASE_URL"])
            ? (env.EINVOICE_ASP_ENV ?? "").toLowerCase() === "production" &&
              !looksSandbox(env.EINVOICE_ASP_BASE_URL)
              ? "live"
              : "sandbox"
            : null,
  },
  {
    id: "shopify",
    label: { en: "Shopify sales sync", ar: "مزامنة مبيعات Shopify" },
    externalAction: {
      en: "Register a Shopify app and set its API key and secret.",
      ar: "سجّل تطبيق Shopify واضبط مفتاح وسر الواجهة البرمجية.",
    },
    envVars: ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET"],
    whenUnconfigured: "disabled",
    detect: (env) => (all(env, ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET"]) ? "live" : null),
  },
  {
    id: "stripe_payouts",
    label: { en: "Stripe payouts import", ar: "استيراد مدفوعات Stripe" },
    externalAction: {
      en: "Register a Stripe Connect platform and set its client ID.",
      ar: "سجّل منصة Stripe Connect واضبط معرّف العميل.",
    },
    envVars: ["STRIPE_CONNECT_CLIENT_ID", "STRIPE_SECRET_KEY"],
    whenUnconfigured: "disabled",
    detect: (env) => {
      if (!all(env, ["STRIPE_CONNECT_CLIENT_ID", "STRIPE_SECRET_KEY"])) return null;
      return (env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live_") ? "live" : "sandbox";
    },
  },
  {
    id: "google_sheets",
    label: { en: "Google Sheets export", ar: "التصدير إلى Google Sheets" },
    externalAction: {
      en: "Create a Google Cloud service account or OAuth client with the Sheets API enabled.",
      ar: "أنشئ حساب خدمة أو عميل OAuth في Google Cloud مع تفعيل واجهة Sheets.",
    },
    envVars: [
      "GOOGLE_SERVICE_ACCOUNT_EMAIL",
      "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GOOGLE_REFRESH_TOKEN",
    ],
    whenUnconfigured: "disabled",
    detect: (env) =>
      all(env, ["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"]) ||
      all(env, ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"])
        ? "live"
        : null,
  },
  {
    id: "push",
    label: { en: "Web push notifications", ar: "إشعارات المتصفح" },
    externalAction: {
      en: "Generate VAPID keys and set the subject contact.",
      ar: "أنشئ مفاتيح VAPID واضبط جهة الاتصال.",
    },
    envVars: ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"],
    // S5: push cannot work until a VAPID key pair is generated and configured, which is an
    // operator action outside the app, so it is requires_external rather than disabled.
    whenUnconfigured: "requires_external",
    detect: (env) => (all(env, ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"]) ? "live" : null),
  },
  {
    id: "sms",
    label: { en: "SMS notifications", ar: "الرسائل النصية" },
    externalAction: {
      en: "Contract an SMS provider with a TDRA-registered sender ID.",
      ar: "تعاقد مع مزود رسائل نصية باسم مرسل مسجّل لدى هيئة تنظيم الاتصالات.",
    },
    envVars: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "SMS_SENDER_ID"],
    whenUnconfigured: "requires_external",
    detect: (env) => (all(env, ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"]) ? "live" : null),
  },
  {
    id: "whatsapp",
    label: { en: "WhatsApp Business messaging", ar: "مراسلة واتساب للأعمال" },
    externalAction: {
      en: "Verify a Meta WhatsApp Business account and approved message templates. Until then messages open as manual wa.me links.",
      ar: "وثّق حساب واتساب للأعمال لدى Meta واعتمد قوالب الرسائل. حتى ذلك الحين تُفتح الرسائل كروابط wa.me يدوية.",
    },
    envVars: ["WHATSAPP_CLOUD_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"],
    whenUnconfigured: "requires_external",
    detect: (env) =>
      all(env, ["WHATSAPP_CLOUD_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"]) ? "live" : null,
  },
  {
    id: "fx_rate_feed",
    label: { en: "Exchange-rate feed", ar: "تغذية أسعار الصرف" },
    externalAction: {
      en: "Set FX_RATE_FEED (cbuae, ecb or both) and the provider URLs (FX_RATE_FEED_CBUAE_URL, FX_RATE_FEED_ECB_URL) agreed with the rate provider.",
      ar: "اضبط FX_RATE_FEED (cbuae أو ecb أو كلاهما) وروابط المزود (FX_RATE_FEED_CBUAE_URL و FX_RATE_FEED_ECB_URL) المتفق عليها مع مزود الأسعار.",
    },
    envVars: ["FX_RATE_FEED", "FX_RATE_FEED_CBUAE_URL", "FX_RATE_FEED_ECB_URL", "FX_RATE_API_KEY"],
    // W5-C (R14-14): the adapters exist; a live feed needs the provider arrangement.
    whenUnconfigured: "requires_external",
    detect: (env) => (set(env, "FX_RATE_FEED") ? "live" : null),
  },
  {
    id: "news_feed",
    label: { en: "Regulatory news feed", ar: "تغذية الأخبار التنظيمية" },
    externalAction: {
      en: "Set NEWS_FEED_URLS to the https RSS/Atom feed URLs of the FTA, the Ministry of Finance or a news publisher you are licensed to republish.",
      ar: "اضبط NEWS_FEED_URLS على روابط RSS/Atom (https) للهيئة الاتحادية للضرائب أو وزارة المالية أو ناشر أخبار مرخّص لإعادة نشر محتواه.",
    },
    envVars: ["NEWS_FEED_URLS"],
    // S5 (W3-E residual): same rule as server/services/news-ingest.service.ts configuredFeedUrls:
    // live only with at least one valid https feed URL; nothing is fabricated without one.
    whenUnconfigured: "requires_external",
    detect: (env) => (httpsFeedUrls(env.NEWS_FEED_URLS).length > 0 ? "live" : null),
  },
  {
    id: "antivirus",
    label: { en: "Upload malware scanning", ar: "فحص المرفقات من البرمجيات الخبيثة" },
    externalAction: {
      en: "Run a ClamAV daemon (or scanning API) reachable from the app.",
      ar: "شغّل خدمة ClamAV (أو واجهة فحص) يمكن للتطبيق الوصول إليها.",
    },
    envVars: ["CLAMAV_HOST", "CLAMAV_PORT"],
    whenUnconfigured: "disabled",
    detect: (env) => (set(env, "CLAMAV_HOST") ? "live" : null),
  },
  {
    id: "captcha",
    label: { en: "Bot protection (CAPTCHA)", ar: "الحماية من الروبوتات (CAPTCHA)" },
    externalAction: {
      en: "Create a Cloudflare Turnstile site and set TURNSTILE_SECRET_KEY and TURNSTILE_SITE_KEY.",
      ar: "أنشئ موقعاً في Cloudflare Turnstile واضبط المفتاحين TURNSTILE_SECRET_KEY وTURNSTILE_SITE_KEY.",
    },
    // W5-E: only Turnstile has a server-side verifier (server/services/security/captcha.ts).
    envVars: ["TURNSTILE_SECRET_KEY", "TURNSTILE_SITE_KEY"],
    whenUnconfigured: "requires_external",
    detect: (env) => (set(env, "TURNSTILE_SECRET_KEY") ? "live" : null),
  },
  {
    id: "saml",
    label: { en: "Enterprise SSO (SAML)", ar: "الدخول الموحد للمؤسسات (SAML)" },
    externalAction: {
      en: "Exchange IdP metadata (entry point + signing certificate) with the customer.",
      ar: "تبادل بيانات مزود الهوية (نقطة الدخول وشهادة التوقيع) مع العميل.",
    },
    envVars: ["SAML_ENTRY_POINT", "SAML_IDP_CERT", "SAML_ISSUER"],
    whenUnconfigured: "disabled",
    detect: (env) => (all(env, ["SAML_ENTRY_POINT", "SAML_IDP_CERT"]) ? "live" : null),
  },
];

export const CAPABILITY_IDS: readonly CapabilityId[] = DEFS.map((d) => d.id);

/** Compute every capability's status from an env record. Pure. */
export function computeCapabilities(env: EnvLike): Capability[] {
  return DEFS.map((d) => ({
    id: d.id,
    status: d.detect(env) ?? d.whenUnconfigured,
    label: d.label,
    externalAction: d.externalAction,
    envVars: d.envVars,
  }));
}

function processEnv(): EnvLike {
  const g = globalThis as { process?: { env?: EnvLike } };
  return g.process?.env ?? {};
}

/** Server-side: capabilities for the running process. */
export function getCapabilities(env: EnvLike = processEnv()): Capability[] {
  return computeCapabilities(env);
}

export function getCapability(id: CapabilityId, env: EnvLike = processEnv()): Capability {
  const found = computeCapabilities(env).find((c) => c.id === id);
  if (!found) throw new Error(`Unknown capability "${id}"`);
  return found;
}

/** True only for "live" — sandbox must never be presented as production. */
export function isCapabilityLive(id: CapabilityId, env: EnvLike = processEnv()): boolean {
  return getCapability(id, env).status === "live";
}

/** JSON-safe snapshot for the client (statuses + copy; no env values). */
export function getCapabilitySnapshot(
  env: EnvLike = processEnv(),
  now = new Date()
): CapabilitySnapshot {
  return {
    generatedAt: now.toISOString(),
    capabilities: computeCapabilities(env).map((c) => ({ ...c, envVars: [...c.envVars] })),
  };
}
