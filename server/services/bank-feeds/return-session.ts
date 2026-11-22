import type { SessionData, Store } from "express-session";
import { decryptSecret, encryptSecret } from "../secret-vault";

declare module "express-session" {
  interface SessionData {
    statementReturn?: { sealed: string; expiresAt: number };
  }
}

export async function readReturnSession<T>(store: Store, key: string): Promise<T | undefined> {
  const record = await new Promise<SessionData | null | undefined>((resolve, reject) => {
    store.get(key, (err, value) => (err ? reject(err) : resolve(value)));
  });
  const pending = record?.statementReturn;
  if (!pending || pending.expiresAt <= Date.now()) return;
  return JSON.parse(decryptSecret(pending.sealed) ?? "") as T;
}

export async function writeReturnSession(
  store: Store,
  key: string,
  value: unknown,
  expiresAt: Date
): Promise<void> {
  const maxAge = expiresAt.getTime() - Date.now();
  const record: SessionData = {
    cookie: { expires: expiresAt, originalMaxAge: maxAge },
    statementReturn: {
      sealed: encryptSecret(JSON.stringify(value))!,
      expiresAt: expiresAt.getTime(),
    },
  };
  await new Promise<void>((resolve, reject) => {
    store.set(key, record, (err) => (err ? reject(err) : resolve()));
  });
}

export async function deleteReturnSession(store: Store, key: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    store.destroy(key, (err) => (err ? reject(err) : resolve()));
  });
}
