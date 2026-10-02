// Stripe Connect webhook handling (Phase 8 D1), called from POST /api/webhooks/stripe for events that carry
// `event.account` (a connected account). Same discipline as the billing handler: the event id is CLAIMED first
// (stripe_events), a failure releases the claim so the provider's retry is processed, handlers set state rather than
// increment. Money is posted only when our own records agree with the signed event (see verify.ts).

import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { paymentLinks } from "../../../shared/schema";
import { storage } from "../../storage";
import { createLogger } from "../../config/logger";
import { findActiveConnectionByAccount, markRevokedByAccount } from "./connection.service";
import { getGatewayProvider } from "./index";
import { processRefund } from "./refund.service";
import { settleCheckoutSession } from "./settle.service";

const log = createLogger("gateway-webhook");

export interface ConnectEventLike {
  id: string;
  type: string;
  account?: string | null;
  data: { object: any };
}

export const CONNECT_EVENT_TYPES = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.expired",
  "charge.refunded",
  "account.application.deauthorized",
] as const;

export async function handleConnectEvent(event: ConnectEventLike): Promise<{ handled: boolean }> {
  const first = await storage.claimStripeEvent(event.id, event.type);
  if (!first) {
    log.info({ eventId: event.id }, "Duplicate Connect event, skipping");
    return { handled: false };
  }
  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object;
        const [link] = session?.id
          ? await db.select().from(paymentLinks).where(eq(paymentLinks.providerSessionId, session.id))
          : [];
        const connection = event.account ? await findActiveConnectionByAccount(event.account) : null;
        await settleCheckoutSession({ eventAccount: event.account, session, link: link ?? null, connection });
        break;
      }
      case "checkout.session.expired": {
        const session = event.data.object;
        const connection = event.account ? await findActiveConnectionByAccount(event.account) : null;
        if (session?.id && connection) {
          await db
            .update(paymentLinks)
            .set({ status: "expired" } as any)
            .where(and(eq(paymentLinks.providerSessionId, session.id), eq(paymentLinks.companyId, connection.companyId), eq(paymentLinks.status, "open")));
        }
        break;
      }
      case "charge.refunded": {
        const connection = event.account ? await findActiveConnectionByAccount(event.account) : null;
        const provider = getGatewayProvider();
        if (!connection || !provider) {
          log.warn({ eventId: event.id, account: event.account }, "Refund event for an unknown account: nothing posted");
          break;
        }
        for (const refund of await provider.parseRefunds(event)) {
          await processRefund({ companyId: connection.companyId, refund });
        }
        break;
      }
      case "account.application.deauthorized": {
        if (event.account && (await markRevokedByAccount(event.account))) {
          log.info({ account: event.account }, "A company revoked its Stripe connection");
        }
        break;
      }
      default:
        log.info({ type: event.type }, "Unhandled Connect event type");
    }
    return { handled: true };
  } catch (err) {
    // Let the provider's retry through: forget we saw this event.
    await storage.releaseStripeEvent(event.id).catch((releaseErr) => log.error({ eventId: event.id, err: releaseErr }, "Failed to release the event claim"));
    throw err;
  }
}
