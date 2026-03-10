/**
 * WhatsApp Web Service (Baileys)
 * ──────────────────────────────
 * Manages a WhatsApp Web connection using Baileys library.
 * Connects via WebSocket to WhatsApp servers using your personal number.
 *
 * Features:
 * - QR code authentication (scan once, session persists)
 * - Session persistence in PostgreSQL
 * - Auto-reconnect on disconnection
 * - Connection health monitoring
 * - Rate-limited message sending
 *
 * Usage:
 *   import { getWhatsAppClient, sendWhatsAppWebMessage } from './whatsappWeb';
 *   const client = getWhatsAppClient();
 *   await sendWhatsAppWebMessage('971501234567', 'Hello!');
 */

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  ConnectionState,
  proto,
  BaileysEventMap,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pino from 'pino';
import { createLogger } from '../config/logger';
import { storage } from '../storage';
import { EventEmitter } from 'events';

const log = createLogger('whatsapp-web');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.resolve(__dirname, '..', '..', '.whatsapp-auth');

// ── Types ───────────────────────────────────────────────────────

export type ConnectionStatus = 'disconnected' | 'connecting' | 'qr_ready' | 'connected';

export interface WhatsAppWebState {
  status: ConnectionStatus;
  qrCode: string | null;
  phoneNumber: string | null;
  pushName: string | null;
  messagesSentToday: number;
  dailyLimit: number;
  lastError: string | null;
}

// ── Singleton State ─────────────────────────────────────────────

let socket: WASocket | null = null;
let currentQR: string | null = null;
let connectionStatus: ConnectionStatus = 'disconnected';
let lastError: string | null = null;
let connectedPhoneNumber: string | null = null;
let connectedPushName: string | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 5000; // 5 seconds

// Event emitter for connection state changes
export const whatsappEvents = new EventEmitter();

// ── Core Functions ──────────────────────────────────────────────

/**
 * Initialize the WhatsApp Web connection.
 * Creates a Baileys socket, handles QR code generation,
 * and manages session persistence.
 */
export async function initWhatsAppWeb(): Promise<void> {
  if (socket) {
    log.warn('WhatsApp Web already initialized, skipping');
    return;
  }

  log.info('Initializing WhatsApp Web connection...');
  connectionStatus = 'connecting';
  whatsappEvents.emit('status', connectionStatus);

  try {
    // Ensure auth directory exists
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }

    // Load or create auth state
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    // Get latest Baileys version
    const { version } = await fetchLatestBaileysVersion();
    log.info({ version }, 'Using Baileys version');

    // Create socket connection
    const baileysLogger = pino({ level: 'silent' }); // Suppress verbose Baileys logs

    socket = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
      },
      printQRInTerminal: false, // We handle QR ourselves
      logger: baileysLogger,
      browser: ['Muhasib.ai', 'Chrome', '120.0.0'], // Identifies as browser
      generateHighQualityLinkPreview: false,
      syncFullHistory: false, // Don't sync old messages
    });

    // ── Event Handlers ──────────────────────────────────────

    // Connection state updates
    socket.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        // QR code received — user needs to scan
        currentQR = qr;
        connectionStatus = 'qr_ready';
        lastError = null;
        reconnectAttempts = 0;
        log.info('QR code ready for scanning');
        whatsappEvents.emit('qr', qr);
        whatsappEvents.emit('status', connectionStatus);

        // Update DB status
        try {
          await storage.updateWhatsappWebSession({
            status: 'qr_ready',
          });
        } catch (e) { /* ignore DB errors during connection */ }
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        connectionStatus = 'disconnected';
        currentQR = null;
        lastError = lastDisconnect?.error?.message || 'Connection closed';

        log.warn(
          { statusCode, shouldReconnect, error: lastError },
          'WhatsApp Web disconnected'
        );
        whatsappEvents.emit('status', connectionStatus);

        // Update DB status
        try {
          await storage.updateWhatsappWebSession({
            status: 'disconnected',
            lastDisconnectedAt: new Date(),
          });
        } catch (e) { /* ignore */ }

        socket = null;

        if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          log.info(
            { attempt: reconnectAttempts, maxAttempts: MAX_RECONNECT_ATTEMPTS },
            'Scheduling reconnection...'
          );
          setTimeout(() => {
            initWhatsAppWeb().catch(err => {
              log.error({ error: err.message }, 'Reconnection failed');
            });
          }, RECONNECT_DELAY_MS * reconnectAttempts);
        } else if (statusCode === DisconnectReason.loggedOut) {
          log.warn('Logged out of WhatsApp. Need to re-scan QR code.');
          // Clear auth state on logout
          try {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          } catch (e) { /* ignore */ }
        }
      }

      if (connection === 'open') {
        connectionStatus = 'connected';
        currentQR = null;
        lastError = null;
        reconnectAttempts = 0;

        // Extract phone number and name
        const me = socket?.user;
        connectedPhoneNumber = me?.id?.split(':')[0] || me?.id?.split('@')[0] || null;
        connectedPushName = me?.name || null;

        log.info(
          { phone: connectedPhoneNumber, name: connectedPushName },
          'WhatsApp Web connected successfully'
        );
        whatsappEvents.emit('status', connectionStatus);

        // Update DB status
        try {
          await storage.updateWhatsappWebSession({
            status: 'connected',
            phoneNumber: connectedPhoneNumber,
            pushName: connectedPushName,
            lastConnectedAt: new Date(),
          });
        } catch (e) { /* ignore */ }
      }
    });

    // Save credentials on update
    socket.ev.on('creds.update', saveCreds);

    // Handle incoming messages (for future use)
    socket.ev.on('messages.upsert', async (m) => {
      // Only process new messages, not history sync
      if (m.type !== 'notify') return;

      for (const msg of m.messages) {
        if (msg.key.fromMe) continue; // Skip our own messages

        const from = msg.key.remoteJid?.replace('@s.whatsapp.net', '') || '';
        const content = msg.message?.conversation
          || msg.message?.extendedTextMessage?.text
          || msg.message?.imageMessage?.caption
          || '';

        log.info({ from, hasContent: !!content }, 'Received WhatsApp message');

        // Try to resolve company from sender phone number
        try {
          const companies = await storage.getAllCompaniesWithContacts();
          const cleanedFrom = from.replace(/\D/g, '');
          const matchedCompany = companies.find((c) => {
            const companyPhone = (c.contactPhone || '').replace(/\D/g, '');
            return companyPhone && (
              cleanedFrom.endsWith(companyPhone) ||
              companyPhone.endsWith(cleanedFrom)
            );
          });

          if (matchedCompany) {
            await storage.createWhatsappMessage({
              companyId: matchedCompany.id,
              waMessageId: msg.key.id || `wa_${Date.now()}`,
              from,
              to: connectedPhoneNumber || 'self',
              messageType: msg.message?.imageMessage ? 'image'
                : msg.message?.documentMessage ? 'document'
                : 'text',
              content: content || null,
              direction: 'inbound',
              status: 'received',
            });
          } else {
            // Log unmatched messages without DB insert (companyId is NOT NULL)
            log.info({ from }, 'Received message from unrecognized number — skipping DB log');
          }
        } catch (e: any) {
          log.debug({ from, error: e.message }, 'Could not log inbound message');
        }
      }
    });

  } catch (error: any) {
    log.error({ error: error.message }, 'Failed to initialize WhatsApp Web');
    connectionStatus = 'disconnected';
    lastError = error.message;
    socket = null;
    whatsappEvents.emit('status', connectionStatus);
    throw error;
  }
}

/**
 * Send a text message via WhatsApp Web.
 * Returns success status and message ID.
 */
export async function sendWhatsAppWebMessage(
  phone: string,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!socket || connectionStatus !== 'connected') {
    return {
      success: false,
      error: `WhatsApp Web is not connected (status: ${connectionStatus})`,
    };
  }

  // Check daily limit
  try {
    const session = await storage.getWhatsappWebSession();
    if (session && session.messagesSentToday >= session.dailyMessageLimit) {
      return {
        success: false,
        error: `Daily message limit reached (${session.dailyMessageLimit}). Messages will resume tomorrow.`,
      };
    }
  } catch (e) { /* proceed if DB check fails */ }

  // Format phone number for WhatsApp
  const jid = formatJid(phone);
  if (!jid) {
    return { success: false, error: 'Invalid phone number format' };
  }

  try {
    const result = await socket.sendMessage(jid, { text: message });
    const messageId = result?.key?.id || `sent_${Date.now()}`;

    log.info({ phone, messageId }, 'WhatsApp message sent');

    // Increment daily counter
    try {
      await storage.incrementWhatsappMessageCount();
    } catch (e) { /* ignore */ }

    return { success: true, messageId };
  } catch (error: any) {
    log.error({ phone, error: error.message }, 'Failed to send WhatsApp message');
    return { success: false, error: error.message || 'Send failed' };
  }
}

/**
 * Send a document (PDF) via WhatsApp Web.
 */
export async function sendWhatsAppWebDocument(
  phone: string,
  documentBuffer: Buffer,
  fileName: string,
  caption?: string,
  mimeType: string = 'application/pdf'
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!socket || connectionStatus !== 'connected') {
    return {
      success: false,
      error: `WhatsApp Web is not connected (status: ${connectionStatus})`,
    };
  }

  const jid = formatJid(phone);
  if (!jid) {
    return { success: false, error: 'Invalid phone number format' };
  }

  try {
    const result = await socket.sendMessage(jid, {
      document: documentBuffer,
      mimetype: mimeType,
      fileName,
      caption,
    });

    const messageId = result?.key?.id || `sent_${Date.now()}`;
    log.info({ phone, fileName, messageId }, 'WhatsApp document sent');

    // Increment daily counter
    try {
      await storage.incrementWhatsappMessageCount();
    } catch (e) { /* ignore */ }

    return { success: true, messageId };
  } catch (error: any) {
    log.error({ phone, fileName, error: error.message }, 'Failed to send WhatsApp document');
    return { success: false, error: error.message || 'Send failed' };
  }
}

/**
 * Get the current WhatsApp Web connection state.
 */
export function getWhatsAppWebState(): WhatsAppWebState {
  return {
    status: connectionStatus,
    qrCode: currentQR,
    phoneNumber: connectedPhoneNumber,
    pushName: connectedPushName,
    messagesSentToday: 0, // Will be read from DB when needed
    dailyLimit: 100,
    lastError,
  };
}

/**
 * Disconnect WhatsApp Web.
 */
export async function disconnectWhatsAppWeb(): Promise<void> {
  if (socket) {
    log.info('Disconnecting WhatsApp Web...');
    // Use socket.end() instead of socket.logout() to preserve session.
    // logout() permanently invalidates the session, requiring QR re-scan.
    socket.end(undefined);
    socket = null;
    connectionStatus = 'disconnected';
    currentQR = null;
    connectedPhoneNumber = null;
    connectedPushName = null;
    whatsappEvents.emit('status', connectionStatus);

    try {
      await storage.updateWhatsappWebSession({
        status: 'disconnected',
        lastDisconnectedAt: new Date(),
      });
    } catch (e) { /* ignore */ }
  }
}

/**
 * Check if WhatsApp is connected and ready to send.
 */
export function isWhatsAppConnected(): boolean {
  return connectionStatus === 'connected' && socket !== null;
}

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Format a phone number into WhatsApp JID format.
 * Input: "971501234567" or "+971501234567"
 * Output: "971501234567@s.whatsapp.net"
 */
function formatJid(phone: string): string | null {
  // Remove all non-digit characters
  let cleaned = phone.replace(/\D/g, '');

  // Validate length
  if (cleaned.length < 7 || cleaned.length > 15) {
    return null;
  }

  // Don't allow numbers starting with 0 (local format)
  if (cleaned.startsWith('0')) {
    return null;
  }

  return `${cleaned}@s.whatsapp.net`;
}
