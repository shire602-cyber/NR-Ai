import { apiRequest } from './queryClient';
import { formatPhoneForWhatsApp,openWhatsApp } from './whatsapp-templates';

const BRIDGE_REQUEST = 'NR_WHATSAPP_BRIDGE_REQUEST';
const BRIDGE_RESPONSE = 'NR_WHATSAPP_BRIDGE_RESPONSE';
const BRIDGE_EXTERNAL_REQUEST = 'NR_WHATSAPP_BRIDGE_EXTERNAL_REQUEST';
const KNOWN_EXTENSION_IDS = [
  'jlhkbnegpoefoodkdgfdolkolianihpm',
  'fignfifoniblkonapihmkfakmlgkbkcf',
];
export const MIN_SUPPORTED_WHATSAPP_BRIDGE_VERSION = '0.1.1';

type BridgeCommand = 'ping' | 'draft';

declare global {
  interface Window {
    chrome?: {
      runtime?: {
        sendMessage?: (
          extensionId: string,
          message: unknown,
          callback: (response?: BridgeExternalResponse) => void,
        ) => void;
        lastError?: {
          message?: string;
        };
      };
    };
  }
}

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

interface BridgeExternalResponse {
  ok: boolean;
  mode?: 'extension';
  payload?: any;
  error?: string;
}

let requestSeq = 0;

export function isSupportedWhatsAppBridgeVersion(version?: string | null): boolean {
  if (!version) return false;
  const parse = (value: string) => value.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const current = parse(version);
  const minimum = parse(MIN_SUPPORTED_WHATSAPP_BRIDGE_VERSION);
  for (let index = 0; index < Math.max(current.length, minimum.length); index += 1) {
    const currentPart = current[index] || 0;
    const minimumPart = minimum[index] || 0;
    if (currentPart > minimumPart) return true;
    if (currentPart < minimumPart) return false;
  }
  return true;
}

function askExternalBridge<T>(command: BridgeCommand, payload?: unknown, timeoutMs = 1000): Promise<T | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  const sendMessage = window.chrome?.runtime?.sendMessage;
  if (typeof sendMessage !== 'function') return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, timeoutMs);

    const done = (value: T | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(value);
    };

    const message = {
      type: BRIDGE_EXTERNAL_REQUEST,
      command,
      payload,
    };

    let pending = KNOWN_EXTENSION_IDS.length;
    for (const extensionId of KNOWN_EXTENSION_IDS) {
      try {
        sendMessage(extensionId, message, (response?: BridgeExternalResponse) => {
          const lastError = window.chrome?.runtime?.lastError;
          if (!response?.ok || lastError) {
            pending -= 1;
            if (pending <= 0) done(null);
            return;
          }
          done((response.payload ?? response) as T);
        });
      } catch {
        pending -= 1;
        if (pending <= 0) done(null);
      }
    }
  });
}

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
      if (event.origin !== window.location.origin) return;
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
  const result = await askExternalBridge<WhatsAppBridgePing>('ping', {}, timeoutMs)
    || await askBridge<WhatsAppBridgePing>('ping', {}, timeoutMs);
  if (!result?.available) return { available: false, reason: 'extension_not_detected' };
  if (!isSupportedWhatsAppBridgeVersion(result.version)) {
    return {
      ...result,
      available: false,
      reason: `extension_outdated_${result.version || 'unknown'}`,
    };
  }
  return result;
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

  const job = {
    ...payload,
    phone: normalized,
  };
  const result = await askExternalBridge<WhatsAppBridgeDraftResult>('draft', job, timeoutMs)
    || await askBridge<WhatsAppBridgeDraftResult>('draft', job, timeoutMs);

  if (result?.ok && isSupportedWhatsAppBridgeVersion(result.version)) return { ...result, mode: 'extension' };
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
    await updateWhatsAppBridgeJobStatus(bridgeJobId, 'drafted', 'drafted').catch(() => {});
  } else {
    await apiRequest('POST', '/api/integrations/whatsapp/log-message', { to: phone, message }).catch(() => {});
  }
  openWhatsApp(phone, message);
}
