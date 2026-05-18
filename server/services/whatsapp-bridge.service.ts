import { z } from 'zod';

export const WHATSAPP_BRIDGE_PROVIDER = 'whatsapp_web_extension' as const;

export const WHATSAPP_BRIDGE_JOB_KINDS = [
  'direct_message',
  'invoice',
  'document_request',
  'payment_chase',
  'vat_submission_proof',
  'broadcast',
  'custom',
] as const;

export const WHATSAPP_BRIDGE_JOB_STATUSES = [
  'queued',
  'drafted',
  'sent_unverified',
  'failed',
  'cancelled',
  'expired',
] as const;

export const WHATSAPP_BRIDGE_DELIVERY_STATUSES = [
  'logged',
  'drafted',
  'sent_unverified',
  'failed',
] as const;

export const createBridgeJobSchema = z.object({
  companyId: z.string().uuid().optional(),
  to: z.string().min(1).max(64),
  recipientName: z.string().max(200).optional().nullable(),
  message: z.string().min(1).max(5000),
  kind: z.enum(WHATSAPP_BRIDGE_JOB_KINDS).default('direct_message'),
  sourceType: z.string().max(80).optional().nullable(),
  sourceId: z.string().uuid().optional().nullable(),
  attachmentUrl: z.string().url().optional().nullable().or(z.literal('')),
  attachmentLabel: z.string().max(200).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const bridgeStatusUpdateSchema = z.object({
  status: z.enum(WHATSAPP_BRIDGE_JOB_STATUSES),
  deliveryStatus: z.enum(WHATSAPP_BRIDGE_DELIVERY_STATUSES).optional(),
  errorMessage: z.string().max(1000).optional().nullable(),
  note: z.string().max(1000).optional().nullable(),
});

export const createBridgeSessionSchema = z.object({
  companyId: z.string().uuid().optional(),
  extensionId: z.string().min(3).max(128),
  extensionVersion: z.string().max(40).optional().nullable(),
  userAgent: z.string().max(500).optional().nullable(),
});

export type CreateBridgeJobInput = z.infer<typeof createBridgeJobSchema>;
export type BridgeStatusUpdateInput = z.infer<typeof bridgeStatusUpdateSchema>;
export type CreateBridgeSessionInput = z.infer<typeof createBridgeSessionSchema>;

export function normalizeWhatsAppBridgePhone(raw: string): string {
  let cleaned = (raw || '').replace(/[^\d]/g, '');
  if (!cleaned) return '';

  if (cleaned.length === 10 && cleaned.startsWith('05')) {
    cleaned = `971${cleaned.slice(1)}`;
  } else if (cleaned.length === 9 && cleaned.startsWith('5')) {
    cleaned = `971${cleaned}`;
  } else if (cleaned.startsWith('00')) {
    cleaned = cleaned.slice(2);
  } else if (cleaned.startsWith('0')) {
    cleaned = cleaned.slice(1);
  }

  if (cleaned.length < 8 || cleaned.length > 15) return '';
  return cleaned;
}

export function buildWhatsAppWebDraftUrl(phone: string, message: string): string {
  const normalized = normalizeWhatsAppBridgePhone(phone);
  if (!normalized) {
    throw new Error('Invalid WhatsApp phone number');
  }

  const encoded = encodeURIComponent(message);
  return `https://web.whatsapp.com/send?phone=${normalized}&text=${encoded}&app_absent=0`;
}

export function cleanBridgeJobMetadata(input: CreateBridgeJobInput): Record<string, unknown> {
  const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {};
  return {
    ...metadata,
    sourceType: input.sourceType || null,
    sourceId: input.sourceId || null,
    attachmentUrl: input.attachmentUrl || null,
    attachmentLabel: input.attachmentLabel || null,
    provider: WHATSAPP_BRIDGE_PROVIDER,
    deliveryTruth: 'human_confirmed_in_whatsapp_web',
  };
}
