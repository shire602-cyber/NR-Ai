import { apiRequest } from './queryClient';
import { formatPhoneForWhatsApp, openWhatsApp } from './whatsapp-templates';

const BRIDGE_REQUEST = 'NR_WHATSAPP_BRIDGE_REQUEST';
const BRIDGE_RESPONSE = 'NR_WHATSAPP_BRIDGE_RESPONSE';

type BridgeCommand = 'ping' | 'draft';

export interface WhatsAppBridgePing {
  available: boolean;
  extensionId?: string;
  version?: string;
  reason?: string;
}

export interface WhatsAppBridgeJobPayload {
  jobId: string;
  phone: string;
  message: string;
  recipientName?: string | null;
  attachmentUrl?: string | null;
  attachmentLabel?: string | null;
}

export interface WhatsAppBridgeDraftResult {
  ok: boolean;
  mode: 'extension' | 'fallback';
  message?: string;
  extensionId?: string;
  version?: string;
}

interface BridgeEnvelope {
  type: typeof BRIDGE_REQUEST;
  requestId: string;
  command: BridgeCommand;
  payload?: unknown;
}

interface BridgeResponse {
  type: typeof BRIDGE_RESPONSE;
  requestId: string;
  ok: boolean;
  payload?: any;
  error?: string;
}

let requestSeq = 0;

function askBridge<T>(command: BridgeCommand, payload?: unknown, timeoutMs = 1000): Promise<T | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);

  const requestId = `nr_${Date.now()}_${requestSeq++}`;

  return new Promise((resolve) => {
    let done = false;
    const timer = window.setTimeout(() => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      resolve(null);
    }, timeoutMs);

    function onMessage(event: MessageEvent<BridgeResponse>) {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.type !== BRIDGE_RESPONSE || data.requestId !== requestId) return;

      done = true;
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      if (!data.ok) {
        resolve(null);
        return;
      }
      resolve((data.payload ?? null) as T | null);
    }

    window.addEventListener('message', onMessage);
    const envelope: BridgeEnvelope = { type: BRIDGE_REQUEST, requestId, command, payload };
    window.postMessage(envelope, window.location.origin);
  });
}

export async function pingWhatsAppBridge(timeoutMs = 700): Promise<WhatsAppBridgePing> {
  const result = await askBridge<WhatsAppBridgePing>('ping', {}, timeoutMs);
  return result?.available ? result : { available: false, reason: 'extension_not_detected' };
}

export async function registerWhatsAppBridgeSession(
  ping: WhatsAppBridgePing,
  companyId?: string,
): Promise<void> {
  if (!ping.available || !ping.extensionId) return;
  await apiRequest('POST', '/api/integrations/whatsapp/bridge/sessions', {
    companyId,
    extensionId: ping.extensionId,
    extensionVersion: ping.version || null,
    userAgent: window.navigator.userAgent,
  });
}

export async function draftWithWhatsAppBridge(
  payload: WhatsAppBridgeJobPayload,
  timeoutMs = 2500,
): Promise<WhatsAppBridgeDraftResult> {
  const normalized = formatPhoneForWhatsApp(payload.phone);
  if (!normalized) {
    return { ok: false, mode: 'fallback', message: 'Invalid WhatsApp phone number' };
  }

  const result = await askBridge<WhatsAppBridgeDraftResult>('draft', {
    ...payload,
    phone: normalized,
  }, timeoutMs);

  if (result?.ok) return { ...result, mode: 'extension' };
  return { ok: false, mode: 'fallback', message: 'extension_not_detected' };
}

export async function updateWhatsAppBridgeJobStatus(
  jobId: string,
  status: 'drafted' | 'sent_unverified' | 'failed' | 'cancelled' | 'expired',
  deliveryStatus?: 'drafted' | 'sent_unverified' | 'failed' | 'logged',
  errorMessage?: string,
): Promise<void> {
  await apiRequest('PATCH', `/api/integrations/whatsapp/bridge/jobs/${jobId}/status`, {
    status,
    deliveryStatus,
    errorMessage,
  });
}

export async function openWhatsAppWithLoggedFallback(
  phone: string,
  message: string,
  bridgeJobId?: string,
): Promise<void> {
  if (bridgeJobId) {
    await updateWhatsAppBridgeJobStatus(bridgeJobId, 'cancelled', 'logged').catch(() => {});
  } else {
    await apiRequest('POST', '/api/integrations/whatsapp/log-message', { to: phone, message }).catch(() => {});
  }
  openWhatsApp(phone, message);
}
