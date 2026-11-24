import { MAX_UPLOAD_BYTES } from "../../shared/upload-limits";

/** JSON uploads allow room for base64, data URLs, and request metadata. */
export const LARGE_JSON_ROUTES: readonly RegExp[] = [
  /^\/api\/ocr\/process$/,
  /^\/api\/ai\/autopilot\/process$/,
  /^\/api\/companies\/[^/]+\/documents$/,
  /^\/api\/documents\/[^/]+\/versions$/,
  /^\/api\/client-portal\/documents$/,
  /^\/api\/portal\/[^/]+\/documents$/,
  /^\/api\/firm\/bulk\/ocr$/,
  /^\/api\/companies\/[^/]+\/receipts$/,
  /^\/api\/companies\/[^/]+\/bank-statements\/(import|preview)$/,
  /^\/api\/companies\/[^/]+\/bank-connections\/[^/]+\/import$/,
  /^\/api\/journal\/[^/]+\/attachments$/,
  /^\/api\/invoices\/[^/]+\/attachments$/,
  /^\/api\/companies\/[^/]+\/logo$/,
  /^\/api\/companies\/[^/]+\/customer-contacts\/import-preview$/,
  /^\/api\/corporate-tax\/returns\/[^/]+\/import-file$/,
  /^\/api\/firm\/vat-workpapers\/[^/]+\/(scan|import-file)$/,
  /^\/api\/firm\/clients\/import$/,
  /^\/api\/admin\/import\/preview$/,
  // WQ2: purchase documents (bill attachment, bill capture, expense-claim receipt).
  /^\/api\/bills\/[^/]+\/attachment$/,
  /^\/api\/companies\/[^/]+\/bills\/capture$/,
  /^\/api\/companies\/[^/]+\/expense-claims\/receipts$/,
];

export const LARGE_JSON_LIMIT = 3 * 1024 * 1024;
export const SMALL_JSON_LIMIT = "1mb";
export const EXPORT_JSON_LIMIT = MAX_UPLOAD_BYTES;
export const EXPORT_JSON_PATH = /^\/api\/(?:export\/excel|ocr\/export-excel)\/?$/i;
export const EMAIL_INTAKE_LIMIT = MAX_UPLOAD_BYTES;
export const EMAIL_INTAKE_PATH = /^\/api\/webhooks\/email-intake\/?$/i;

export function usesLargeJson(path: string): boolean {
  const normalized = path.toLowerCase().replace(/\/$/, "");
  return LARGE_JSON_ROUTES.some((rx) => rx.test(normalized));
}

/**
 * Webhooks verified over the EXACT raw bytes (HMAC / signature schemes): they get
 * express.raw() and are skipped by the JSON parser. Shared by server/index.ts and the DB
 * test harness so the two cannot drift.
 *
 * - W4-D: payment-gateway and email-delivery webhooks.
 * - E1/E2: A-Cube (HTTP Message Signatures + content-digest) and Complyance (HMAC).
 * - Stripe billing: `stripe.webhooks.constructEvent` needs the raw body; a parsed JSON
 *   object can never verify, so every subscription event was refused with 400.
 */
export const RAW_WEBHOOK_PREFIXES: readonly string[] = [
  "/api/webhooks/invoice-payments",
  "/api/webhooks/email-events",
  "/api/webhooks/einvoice/acube",
  "/api/webhooks/einvoice/complyance",
  "/api/webhooks/stripe",
];
