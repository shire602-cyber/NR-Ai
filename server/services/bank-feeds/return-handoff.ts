import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { z } from "zod";
import {
  bankAuthorizationReference,
  bankFeedCallbackBody,
} from "../../../shared/validators/banking";
import { authCookieBaseOptions } from "../../config/cookies";
import { createLogger } from "../../config/logger";
import { pendingCallbackExpiry, type CallbackResult } from "./index";
import { deleteReturnSession, readReturnSession, writeReturnSession } from "./return-session";

type Reference = z.output<typeof bankAuthorizationReference>;
type CallbackBody = z.output<typeof bankFeedCallbackBody>;
type Outcome = "cancelled" | "failed" | "expired";
type Receipt = { userId: string; companyId: string; result: CallbackResult };
type StoredHandoff = {
  reference: Reference;
  expiresAt: string;
  value: { kind: "pending"; callback: CallbackBody } | { kind: "completed"; receipt: Receipt };
};
type PendingHandoff = { storeKey: string; reference: Reference; expiresAt: string };

export type ReturnHandoff = (PendingHandoff & StoredHandoff["value"]) | { kind: Outcome };

const log = createLogger("statement-authorization");
const cookiePath = "/api/bank-connections/callback/resume";
const cookieName = (id: string) =>
  `${authCookieBaseOptions().secure ? "__Secure-" : ""}statement-return-${id}`;
const cookieOptions = () => ({ ...authCookieBaseOptions(), path: cookiePath });
const outcomeMaxAge = 10 * 60 * 1000;
const storeKeyFor = (handle: string) =>
  `statement-return:${createHash("sha256").update(handle).digest("hex")}`;

function setReturnCookie(res: Response, id: string, value: string, maxAge: number): void {
  res.cookie(cookieName(id), value, { ...cookieOptions(), signed: true, maxAge });
}

export async function stageReturnHandoff(
  req: Request,
  res: Response,
  search: string,
  tabKey: string
): Promise<string> {
  const returnId = randomUUID();
  const params = new URLSearchParams(search);
  const error = params.get("error");
  const callback = bankFeedCallbackBody.safeParse({
    code: params.get("code") || params.get("entity_id"),
    state: params.get("state"),
  });
  const cancelled =
    error === "access_denied" || /^(?:cancelled|canceled)$/i.test(params.get("status") ?? "");
  const expiresAt =
    !cancelled && !error && callback.success && (await pendingCallbackExpiry(callback.data.state));
  const now = Date.now();
  if (!callback.success || !expiresAt || expiresAt.getTime() <= now) {
    const outcome = cancelled ? "cancelled" : !error && callback.success ? "expired" : "failed";
    setReturnCookie(res, returnId, `${outcome}:${tabKey}`, outcomeMaxAge);
    return returnId;
  }

  const handle = randomBytes(32).toString("base64url");
  const record: StoredHandoff = {
    reference: { returnId, tabKey },
    expiresAt: expiresAt.toISOString(),
    value: { kind: "pending", callback: callback.data },
  };
  await writeReturnSession(req.sessionStore, storeKeyFor(handle), record, expiresAt);
  setReturnCookie(res, returnId, handle, expiresAt.getTime() - now);
  return returnId;
}

export async function readReturnHandoff(
  req: Request,
  reference: Reference
): Promise<ReturnHandoff> {
  const handle: unknown = req.signedCookies?.[cookieName(reference.returnId)];
  for (const kind of ["cancelled", "failed", "expired"] as const) {
    if (handle === `${kind}:${reference.tabKey}`) return { kind };
  }
  if (typeof handle !== "string" || !/^[\w-]{43}$/.test(handle)) return { kind: "expired" };
  const storeKey = storeKeyFor(handle);
  const record = await readReturnSession<StoredHandoff>(req.sessionStore, storeKey);
  if (!record) return { kind: "expired" };
  if (
    record.reference.returnId !== reference.returnId ||
    record.reference.tabKey !== reference.tabKey
  ) {
    return { kind: "failed" };
  }
  return { ...record.value, storeKey, reference, expiresAt: record.expiresAt };
}

export async function recordReturnReceipt(
  req: Request,
  handoff: PendingHandoff,
  receipt: Receipt
): Promise<void> {
  const record: StoredHandoff = {
    reference: handoff.reference,
    expiresAt: handoff.expiresAt,
    value: { kind: "completed", receipt },
  };
  try {
    await writeReturnSession(
      req.sessionStore,
      handoff.storeKey,
      record,
      new Date(handoff.expiresAt)
    );
  } catch {
    // The recorded connection IDs still recover the result if replacing the payload fails.
    log.warn("Could not replace authorization data with its receipt");
  }
}

export async function clearCompletedReturn(
  req: Request,
  res: Response,
  handoff: PendingHandoff
): Promise<void> {
  await deleteReturnSession(req.sessionStore, handoff.storeKey);
  res.clearCookie(cookieName(handoff.reference.returnId), cookieOptions());
}
