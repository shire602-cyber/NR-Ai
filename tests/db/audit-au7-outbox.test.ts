import { afterEach, expect, it } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();
let seq = 0;

afterEach(async () => {
  const { setEmailTransportOverride } = await import("../../server/outbox/providers");
  setEmailTransportOverride(null);
});

/** A verified Resend webhook body, taken through the real parser (no outbox id, id only). */
async function webhook(type: string, messageId: string) {
  const { parseResendEvent } = await import("../../server/outbox/webhooks");
  const { applyProviderEvent } = await import("../../server/outbox/outbox");
  const parsed = parseResendEvent({
    type,
    data: { email_id: messageId, bounce: { type: "hard", message: "no mailbox" } },
  })!;
  expect(parsed.outboxId).toBeNull();
  return applyProviderEvent({ provider: "resend", ...parsed });
}

async function message(send: (messageId: string, outboxId: string) => Promise<void>) {
  const t = await h.createTenant();
  const { setEmailTransportOverride } = await import("../../server/outbox/providers");
  const outbox = await import("../../server/outbox/outbox");
  const messageId = `au7-message-${++seq}`;
  setEmailTransportOverride({
    name: "resend",
    async send(m) {
      await send(messageId, m.outboxId);
      return { providerMessageId: messageId };
    },
  });
  const queued = await outbox.enqueueEmail({
    companyId: t.company.id,
    to: "demo@example.test",
    subject: "Demo",
    html: "<p>Demo</p>",
  });
  return {
    messageId,
    id: queued.id,
    deliver: () => outbox.deliverOutboxMessage(queued.id),
    row: async () => (await outbox.getOutboxMessage(queued.id))!,
    unmatched: () =>
      h.sql(
        "SELECT 1 FROM email_delivery_events WHERE provider_message_id=$1 AND outbox_id IS NULL",
        [messageId]
      ),
  };
}

it("AU7 applies a delivery that arrives before the send result is recorded", async () => {
  const m = await message(async (id) => {
    expect(await webhook("email.delivered", id)).toBeNull();
  });
  expect((await m.deliver())!.status).toBe("delivered");
  expect((await m.row()).deliveredAt).toBeTruthy();
  expect(await m.unmatched()).toEqual([]);
});

it("AU7 applies an early bounce with generic text, not the unmatched raw detail", async () => {
  const m = await message(async (id) => {
    await webhook("email.bounced", id);
  });
  expect((await m.deliver())!.status).toBe("bounced");
  const row = await m.row();
  expect(row.lastError).toBe("Bounced");
  expect(row.bouncedAt).toBeTruthy();
  expect(await m.unmatched()).toEqual([]);
  const stored = await h.sql(
    "SELECT detail FROM email_delivery_events WHERE provider_message_id=$1 AND event_type='bounced'",
    [m.messageId]
  );
  expect(stored).toEqual([{ detail: null }]);
});

it("AU7 does not apply another provider's event with the same message id", async () => {
  const m = await message(async () => undefined);
  expect((await m.deliver())!.status).toBe("sent");
  const { applyProviderEvent } = await import("../../server/outbox/outbox");
  const matched = await applyProviderEvent({
    provider: "other",
    providerMessageId: m.messageId,
    type: "bounced",
    detail: "no mailbox",
  });
  expect(matched).toBeNull();
  const row = await m.row();
  expect(row.status).toBe("sent");
  expect(row.lastError).toBeNull();
  expect(await m.unmatched()).toHaveLength(1);
  // The right provider still matches.
  expect(await webhook("email.delivered", m.messageId)).toBe(m.id);
});

it("AU7 does not lose a delivery racing the send completion", async () => {
  for (let round = 0; round < 8; round++) {
    let pending: Promise<unknown> = Promise.resolve();
    const m = await message(async (id) => {
      pending = webhook("email.delivered", id);
    });
    await m.deliver();
    await pending;
    expect((await m.row()).status).toBe("delivered");
    expect(await m.unmatched()).toEqual([]);
  }
});

it("AU7 stays delivered when the acknowledgement follows the send, repeated or not", async () => {
  const m = await message(async () => undefined);
  expect((await m.deliver())!.status).toBe("sent");
  expect(await webhook("email.delivered", m.messageId)).toBe(m.id);
  expect(await webhook("email.delivered", m.messageId)).toBe(m.id);
  expect((await m.row()).status).toBe("delivered");
});

it("AU7 clears a failed attempt's error when the retry is acknowledged early", async () => {
  for (const matchBy of ["messageId", "outboxId"] as const) {
    let attempts = 0;
    const m = await message(async (messageId, outboxId) => {
      if (++attempts === 1) throw new Error("temporary outage");
      if (matchBy === "messageId") return void (await webhook("email.delivered", messageId));
      const { applyProviderEvent } = await import("../../server/outbox/outbox");
      await applyProviderEvent({ provider: "resend", outboxId, type: "delivered" });
    });
    expect((await m.deliver())!.status).toBe("retrying");
    expect((await m.row()).lastError).toBe("temporary outage");
    expect((await m.deliver())!.status).toBe("delivered");
    expect((await m.row()).lastError).toBeNull();
  }
});
