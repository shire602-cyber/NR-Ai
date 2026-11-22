import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import type { SessionData } from "express-session";
import type { z } from "zod";
import { bankFeedCallbackBody } from "../../../shared/validators/banking";
import { authCookieBaseOptions } from "../../config/cookies";
import { createLogger } from "../../config/logger";
import { decryptSecret, encryptSecret } from "../secret-vault";
import { pendingCallbackExpiry } from "./index";

declare module "express-session" {
  interface SessionData {
    statementReturn?: { sealed: string; expiresAt: number };
  }
}

type CallbackBody = z.output<typeof bankFeedCallbackBody>;
type Outcome = "cancelled" | "failed";

export type ReturnHandoff =
  | { kind: "pending"; callback: CallbackBody; storeKey: string }
  | { kind: "empty" | Outcome };

const log = createLogger("statement-authorization");
const cookiePath = "/api/bank-connections/callback/resume";
const cookieName = () => `${authCookieBaseOptions().secure ? "__Secure-" : ""}statement-return`;
const cookieOptions = () => ({ ...authCookieBaseOptions(), path: cookiePath });
const outcomeMaxAge = 10 * 60 * 1000;
const storeKeyFor = (handle: string) =>
  `statement-return:${createHash("sha256").update(handle).digest("hex")}`;

function setReturnCookie(res: Response, value: string, maxAge: number): void {
  res.cookie(cookieName(), value, { ...cookieOptions(), signed: true, maxAge });
}

/** Store a separately expiring record in the shared server session store before sign-in. */
export async function stageReturnHandoff(
  req: Request,
  res: Response,
  search: string
): Promise<void> {
  const params = new URLSearchParams(search);
  const error = params.get("error");
  if (error === "access_denied" || /^(?:cancelled|canceled)$/i.test(params.get("status") ?? "")) {
    setReturnCookie(res, "cancelled", outcomeMaxAge);
    return;
  }

  const callback = bankFeedCallbackBody.safeParse({
    code: params.get("code") || params.get("entity_id"),
    state: params.get("state"),
  });
  const expiresAt =
    !error && callback.success && (await pendingCallbackExpiry(callback.data.state));
  const now = Date.now();
  if (!callback.success || !expiresAt || expiresAt.getTime() <= now) {
    setReturnCookie(res, "failed", outcomeMaxAge);
    return;
  }

  const handle = randomBytes(32).toString("base64url");
  const maxAge = expiresAt.getTime() - now;
  const record: SessionData = {
    cookie: { expires: expiresAt, originalMaxAge: maxAge },
    statementReturn: {
      sealed: encryptSecret(JSON.stringify(callback.data))!,
      expiresAt: expiresAt.getTime(),
    },
  };

  await new Promise<void>((resolve, reject) => {
    req.sessionStore.set(storeKeyFor(handle), record, (err) => (err ? reject(err) : resolve()));
  });
  setReturnCookie(res, handle, maxAge);
}

export async function readReturnHandoff(req: Request): Promise<ReturnHandoff> {
  const handle: unknown = req.signedCookies?.[cookieName()];
  if (handle === undefined) return { kind: "empty" };
  if (handle === "cancelled" || handle === "failed") return { kind: handle };
  if (typeof handle !== "string" || !/^[\w-]{43}$/.test(handle)) return { kind: "failed" };

  const storeKey = storeKeyFor(handle);
  const record = await new Promise<SessionData | null | undefined>((resolve, reject) => {
    req.sessionStore.get(storeKey, (err, value) => (err ? reject(err) : resolve(value)));
  });
  const pending = record?.statementReturn;
  if (!pending || pending.expiresAt <= Date.now()) return { kind: "failed" };

  try {
    const callback = bankFeedCallbackBody.parse(JSON.parse(decryptSecret(pending.sealed) ?? ""));
    return { kind: "pending", callback, storeKey };
  } catch {
    return { kind: "failed" };
  }
}

export function clearReturnCookie(res: Response): void {
  res.clearCookie(cookieName(), cookieOptions());
}

export async function clearReturnHandoff(
  req: Request,
  res: Response,
  storeKey: string
): Promise<void> {
  clearReturnCookie(res);
  await new Promise<void>((resolve) => {
    req.sessionStore.destroy(storeKey, (err) => {
      if (err) log.warn("Could not clear expired or processed authorization data");
      resolve();
    });
  });
}
