import { createHash } from "node:crypto";
import type { Request } from "express";
import type { z } from "zod";
import {
  type bankAuthorizationReference,
  bankFeedCallbackBody,
} from "../../../shared/validators/banking";
import { createLogger } from "../../config/logger";
import { DomainError } from "../../errors";
import { readCsrfIdentifierCookie } from "../../middleware/csrf";
import { pendingCallbackExpiry, type CallbackResult } from "./index";
import { deleteReturnSession, readReturnSession, writeReturnSession } from "./return-session";

type Reference = z.output<typeof bankAuthorizationReference>;
type CallbackBody = z.output<typeof bankFeedCallbackBody>;
type Outcome = "cancelled" | "failed" | "expired";
type Receipt = { userId: string; companyId: string; result: CallbackResult };
type StoredHandoff = {
  value: { kind: "pending"; callback: CallbackBody } | { kind: "completed"; receipt: Receipt };
  expiresAt: string;
};
type LiveHandoff = { storeKey: string; expiresAt: string };

export type ReturnHandoff = (LiveHandoff & StoredHandoff["value"]) | { kind: Outcome };

const log = createLogger("statement-authorization");
const outcomeMaxAge = 10 * 60 * 1000;

function getStoreKey(req: Request, reference: Reference): string | undefined {
  // This HttpOnly cookie exists before the CSRF-protected staging request. A reload can
  // read the same tab's record without receiving any headers from that request.
  const browserId = readCsrfIdentifierCookie(req);
  if (!browserId) return;
  const identity = JSON.stringify([browserId, reference.returnId, reference.tabKey]);
  return `statement-return:${createHash("sha256").update(identity).digest("hex")}`;
}

export async function stageReturnHandoff(
  req: Request,
  reference: Reference,
  search: string
): Promise<void> {
  const storeKey = getStoreKey(req, reference);
  if (!storeKey) throw new DomainError("CSRF_INVALID", 403);
  if (await readReturnSession(req.sessionStore, storeKey)) return;

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
    const kind = cancelled ? "cancelled" : !error && callback.success ? "expired" : "failed";
    await writeReturnSession(req.sessionStore, storeKey, { kind }, new Date(now + outcomeMaxAge));
    return;
  }

  const record: StoredHandoff = {
    expiresAt: expiresAt.toISOString(),
    value: { kind: "pending", callback: callback.data },
  };
  await writeReturnSession(req.sessionStore, storeKey, record, expiresAt);
}

export async function readReturnHandoff(
  req: Request,
  reference: Reference
): Promise<ReturnHandoff> {
  const storeKey = getStoreKey(req, reference);
  if (!storeKey) return { kind: "expired" };
  const record = await readReturnSession<StoredHandoff | { kind: Outcome }>(
    req.sessionStore,
    storeKey
  );
  if (!record) return { kind: "expired" };
  if ("kind" in record) return record;
  return { ...record.value, storeKey, expiresAt: record.expiresAt };
}

export async function recordReturnReceipt(
  req: Request,
  handoff: LiveHandoff,
  receipt: Receipt
): Promise<void> {
  const record: StoredHandoff = {
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
    // The recorded IDs still recover the result if replacing the payload fails.
    log.warn("Could not replace authorization data with its receipt");
  }
}

export async function clearCompletedReturn(req: Request, handoff: LiveHandoff): Promise<void> {
  try {
    await deleteReturnSession(req.sessionStore, handoff.storeKey);
  } catch {
    log.warn("Could not clear authorization data");
    throw new DomainError("AUTHORIZATION_RETRY", 503);
  }
}
