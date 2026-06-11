/**
 * Application-layer encryption for secrets stored in database columns
 * (bank connection tokens, future API credentials).
 *
 * AES-256-GCM. The key comes from TOKEN_ENCRYPTION_KEY (32+ chars) when set,
 * otherwise it is derived from SESSION_SECRET via HKDF so encryption is
 * always on without new deployment configuration. Note: rotating the source
 * secret invalidates stored ciphertexts — for bank tokens that simply means
 * the user reconnects their bank.
 *
 * Format: enc:v1:<iv b64>:<tag b64>:<ciphertext b64>
 * decryptSecret passes legacy plaintext (no prefix) through unchanged, so
 * pre-existing rows keep working and get re-encrypted on next write.
 */
import crypto from 'node:crypto';

const PREFIX = 'enc:v1:';

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const source = process.env.TOKEN_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!source || source.length < 32) {
    throw new Error('secret-vault requires TOKEN_ENCRYPTION_KEY or SESSION_SECRET (>=32 chars)');
  }
  cachedKey = crypto.hkdfSync('sha256', source, Buffer.alloc(0), 'muhasib-secret-vault-v1', 32) as unknown as Buffer;
  cachedKey = Buffer.from(cachedKey);
  return cachedKey;
}

export function encryptSecret(plain: string | null | undefined): string | null {
  if (plain == null || plain === '') return plain ?? null;
  if (plain.startsWith(PREFIX)) return plain; // already encrypted
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decryptSecret(stored: string | null | undefined): string | null {
  if (stored == null || stored === '') return stored ?? null;
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext row
  const [ivB64, tagB64, dataB64] = stored.slice(PREFIX.length).split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('secret-vault: malformed ciphertext');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function isEncryptedSecret(stored: string | null | undefined): boolean {
  return typeof stored === 'string' && stored.startsWith(PREFIX);
}

/** Test hook: reset the cached key after env mutation. */
export function __resetSecretVaultForTests(): void {
  cachedKey = null;
}
