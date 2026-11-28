/**
 * Loop 2 follow-up to #214: three server "today" sites that had no test. Each runs with the
 * clock at 2026-11-27T21:30:00Z, when UTC is still 27 Nov but the Dubai day is 28 Nov.
 */
import { afterEach, expect, it } from "vitest";
import { freezeTime, useHarness } from "./harness";

// Firm sign-up is closed by default; the firm owner fixture needs it open.
process.env.FIRM_SELF_SIGNUP = "true";

const h = useHarness();
const INSTANT = "2026-11-27T21:30:00Z";
let thaw: (() => void) | null = null;
afterEach(() => {
  thaw?.();
  thaw = null;
});

it("firm billing respondToLetter sets nextBillingDate to the Dubai day on acceptance", async () => {
  thaw = freezeTime(INSTANT);
  const owner = await h.createTenant({ name: "NROwner", firmRole: "firm_owner" });
  const client = await h.createTenant({ name: "BillingClient" });
  const cid = client.company.id;
  const invite = await owner.as.post("/api/firm/client-links", { inviteeEmail: client.email });
  expect(invite.status, invite.text).toBe(201);
  const joined = await client.as.post(`/api/firm-invitations/${invite.body.link.id}/accept`, {
    companyId: cid,
  });
  expect(joined.status, joined.text).toBe(200);
  const created = await owner.as.post(`/api/firm/clients/${cid}/engagement-letters`, {
    title: "Bookkeeping engagement",
    feeAmount: 1500,
    billingCycle: "monthly",
  });
  expect(created.status, created.text).toBe(201);
  const id = created.body.letter.id;
  expect((await owner.as.post(`/api/firm/engagement-letters/${id}/send`)).status).toBe(200);
  const accepted = await client.as.post(`/api/companies/${cid}/engagement-letters/${id}/respond`, {
    decision: "accept",
    typedName: "Client Owner",
  });
  expect(accepted.status, accepted.text).toBe(200);
  const [eng] = await h.sql<{ d: string }>(
    `SELECT to_char(e.next_billing_date::date, 'YYYY-MM-DD') AS d
       FROM firm_engagement_letters l JOIN engagements e ON e.id = l.engagement_id WHERE l.id = $1`,
    [id]
  );
  expect(eng.d).toBe("2026-11-28");
});

it("scanVatDeadlines uses a 14-day cutoff counted from the Dubai day", async () => {
  thaw = freezeTime(INSTANT);
  const { scanVatDeadlines } = await import("../../server/services/notification-engine.service");
  const t = await h.createTenant();
  // Dubai day 2026-11-28 + 14 = 2026-12-12 (the UTC day would stop at 2026-12-11).
  await h.sql(
    `INSERT INTO vat_returns (company_id, period_start, period_end, due_date, status, fta_reference_number, created_by)
     VALUES ($1, '2026-07-01', '2026-09-30', '2026-12-12', 'submitted', NULL, $2),
            ($1, '2026-04-01', '2026-06-30', '2026-12-13', 'submitted', NULL, $2)`,
    [t.company.id, t.user.id]
  );
  expect(await scanVatDeadlines(new Date(INSTANT))).toBe(1);
});

it("sendDailyDigests keys and dates the digest by the Dubai day", async () => {
  thaw = freezeTime(INSTANT);
  const { sendDailyDigests } = await import("../../server/services/notification-engine.service");
  const t = await h.createTenant();
  const prefs = await t.as.put("/api/notification-preferences", {
    digestFrequency: "daily",
    emailEnabled: true,
  });
  expect(prefs.status, prefs.text).toBe(200);
  await h.sql(
    `INSERT INTO notifications (user_id, type, title, message, created_at)
     VALUES ($1, 'system', 'Notice', 'Digest detail', $2)`,
    [t.user.id, "2026-11-27T20:00:00Z"]
  );
  expect(await sendDailyDigests(new Date(INSTANT))).toBe(1);
  const [mail] = await h.sql<{ key: string }>(
    `SELECT idempotency_key AS key FROM email_outbox WHERE category = 'digest' AND to_address = $1`,
    [t.email]
  );
  expect(mail.key).toBe(`digest:${t.user.id}:2026-11-28`);
});
