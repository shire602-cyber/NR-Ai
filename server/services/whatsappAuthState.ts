/**
 * PostgreSQL-backed Auth State for Baileys
 * ─────────────────────────────────────────
 * Replaces useMultiFileAuthState with durable DB storage.
 * Auth credentials and signal protocol keys survive deploys
 * on ephemeral infrastructure (Railway, Docker, Render).
 *
 * Implements the Baileys AuthenticationState interface:
 * - creds: stored as JSON in whatsapp_web_sessions.auth_state
 * - keys: stored in whatsapp_auth_keys table (type + id -> data)
 * - saveCreds: persists creds to DB on every update
 */

import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';
import type {
  AuthenticationCreds,
  AuthenticationState,
  SignalDataTypeMap,
  SignalDataSet,
  SignalKeyStore,
} from '@whiskeysockets/baileys';
import { createLogger } from '../config/logger';
import { db } from '../db';
import { whatsappWebSessions, whatsappAuthKeys, type WhatsappAuthKey } from '@shared/schema';
import { eq, and } from 'drizzle-orm';

const log = createLogger('whatsapp-auth-db');

/**
 * Create a PostgreSQL-backed auth state provider for Baileys.
 *
 * @param sessionName - The session name (default: 'default')
 * @returns { state, saveCreds } compatible with Baileys socket options
 */
export async function usePostgresAuthState(
  sessionName: string = 'default'
): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  sessionId: string;
}> {
  // ── Ensure session row exists ──────────────────────────────────
  let [session] = await db
    .select()
    .from(whatsappWebSessions)
    .where(eq(whatsappWebSessions.sessionName, sessionName))
    .limit(1);

  if (!session) {
    [session] = await db
      .insert(whatsappWebSessions)
      .values({ sessionName })
      .returning();
    log.info({ sessionName }, 'Created new WhatsApp session record');
  }

  const sessionId = session.id;

  // ── Load or initialize credentials ────────────────────────────
  let creds: AuthenticationCreds;

  if (session.authState) {
    try {
      creds = JSON.parse(session.authState, BufferJSON.reviver);
      log.info({ sessionId }, 'Loaded existing auth credentials from DB');
    } catch (err: any) {
      log.warn(
        { sessionId, error: err.message },
        'Failed to parse stored auth state, initializing fresh credentials'
      );
      creds = initAuthCreds();
    }
  } else {
    creds = initAuthCreds();
    log.info({ sessionId }, 'Initialized fresh auth credentials');
  }

  // ── Save credentials to DB ────────────────────────────────────
  const saveCreds = async (): Promise<void> => {
    try {
      const serialized = JSON.stringify(creds, BufferJSON.replacer);
      await db
        .update(whatsappWebSessions)
        .set({
          authState: serialized,
          updatedAt: new Date(),
        })
        .where(eq(whatsappWebSessions.id, sessionId));
    } catch (err: any) {
      log.error({ sessionId, error: err.message }, 'Failed to save credentials to DB');
    }
  };

  // ── Signal key store (get/set) ────────────────────────────────
  const keys: SignalKeyStore = {
    get: async <T extends keyof SignalDataTypeMap>(
      type: T,
      ids: string[]
    ): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
      const result: { [id: string]: SignalDataTypeMap[T] } = {};

      if (ids.length === 0) return result;

      try {
        const rows = await db
          .select()
          .from(whatsappAuthKeys)
          .where(
            and(
              eq(whatsappAuthKeys.sessionId, sessionId),
              eq(whatsappAuthKeys.keyType, type)
            )
          );

        // Filter to requested IDs and deserialize
        const rowMap = new Map<string, WhatsappAuthKey>();
        for (const row of rows) {
          rowMap.set(row.keyId, row);
        }

        for (const id of ids) {
          const row = rowMap.get(id);
          if (row) {
            try {
              result[id] = JSON.parse(row.keyData, BufferJSON.reviver);
            } catch {
              // Skip corrupted key data
            }
          }
        }
      } catch (err: any) {
        log.error(
          { sessionId, type, error: err.message },
          'Failed to read signal keys from DB'
        );
      }

      return result;
    },

    set: async (data: SignalDataSet): Promise<void> => {
      try {
        for (const type of Object.keys(data) as Array<keyof SignalDataSet>) {
          const typeData = data[type];
          if (!typeData) continue;

          for (const [id, value] of Object.entries(typeData)) {
            if (value === null || value === undefined) {
              // Delete the key
              await db
                .delete(whatsappAuthKeys)
                .where(
                  and(
                    eq(whatsappAuthKeys.sessionId, sessionId),
                    eq(whatsappAuthKeys.keyType, type),
                    eq(whatsappAuthKeys.keyId, id)
                  )
                );
            } else {
              // Upsert the key
              const serialized = JSON.stringify(value, BufferJSON.replacer);

              // Try update first, then insert if no rows affected
              const updated = await db
                .update(whatsappAuthKeys)
                .set({
                  keyData: serialized,
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(whatsappAuthKeys.sessionId, sessionId),
                    eq(whatsappAuthKeys.keyType, type),
                    eq(whatsappAuthKeys.keyId, id)
                  )
                )
                .returning();

              if (updated.length === 0) {
                await db.insert(whatsappAuthKeys).values({
                  sessionId,
                  keyType: type,
                  keyId: id,
                  keyData: serialized,
                });
              }
            }
          }
        }
      } catch (err: any) {
        log.error(
          { sessionId, error: err.message },
          'Failed to write signal keys to DB'
        );
      }
    },
  };

  return {
    state: { creds, keys },
    saveCreds,
    sessionId,
  };
}

/**
 * Clear all auth state for a session (on logout).
 * Removes credentials and all signal keys.
 */
export async function clearPostgresAuthState(sessionId: string): Promise<void> {
  try {
    // Delete all signal keys for this session
    await db
      .delete(whatsappAuthKeys)
      .where(eq(whatsappAuthKeys.sessionId, sessionId));

    // Clear the auth_state column
    await db
      .update(whatsappWebSessions)
      .set({
        authState: null,
        updatedAt: new Date(),
      })
      .where(eq(whatsappWebSessions.id, sessionId));

    log.info({ sessionId }, 'Cleared auth state from DB');
  } catch (err: any) {
    log.error({ sessionId, error: err.message }, 'Failed to clear auth state from DB');
  }
}
