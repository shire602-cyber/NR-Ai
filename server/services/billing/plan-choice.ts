/**
 * STEP4: the plan a customer chose for after the 14-day trial.
 *
 * The choice lives in subscriptions.chosen_* (migration 0135) and is NEVER read by the plan gates:
 * the trial stays a planless trial of the top plan, and after it the workspace is locked until
 * the chosen plan is activated (an NR admin applies it, or checkout when Stripe is configured).
 * Every email goes through the durable outbox (sendEmail); without a provider it is queued as
 * blocked_no_provider and nothing claims to be sent.
 */
import type { Request } from "express";
import { pq } from "../connectors/pq";
import { ensureFreeSubscription } from "../../middleware/featureGate";
import { sendEmail } from "../email.service";
import { recordAudit } from "../audit.service";
import {
  afterTrialPlan,
  planPrice,
  type BillingCycle,
  type PaidPlanId,
  type PlanChoiceSource,
} from "../../../shared/plans";
import { TRIAL_DAYS, UPGRADE_CONTACT_EMAIL } from "../../../shared/trial";
import { createLogger } from "../../config/logger";

const log = createLogger("plan-choice");

export interface PlanChoice {
  planId: PaidPlanId;
  billingCycle: BillingCycle;
  source: PlanChoiceSource;
}

export interface StoredChoice {
  planId: PaidPlanId;
  billingCycle: BillingCycle;
  source: PlanChoiceSource | null;
  chosenAt: string | null;
  price: number;
}

const LATEST = `(SELECT id FROM subscriptions WHERE company_id = $1 ORDER BY created_at DESC LIMIT 1)`;

export function rowToChoice(row: {
  chosen_plan_id?: string | null;
  chosen_billing_cycle?: string | null;
  chosen_plan_source?: string | null;
  chosen_plan_at?: Date | string | null;
}): StoredChoice | null {
  const plan = afterTrialPlan({
    chosenPlanId: row.chosen_plan_id,
    chosenBillingCycle: row.chosen_billing_cycle,
  });
  if (!plan) return null;
  return {
    planId: plan.planId,
    billingCycle: plan.billingCycle,
    source: (row.chosen_plan_source as PlanChoiceSource | null) ?? null,
    chosenAt: row.chosen_plan_at ? new Date(row.chosen_plan_at).toISOString() : null,
    price: plan.price,
  };
}

export async function readChoice(companyId: string): Promise<StoredChoice | null> {
  const { rows } = await pq<{
    chosen_plan_id: string | null;
    chosen_billing_cycle: string | null;
    chosen_plan_source: string | null;
    chosen_plan_at: Date | null;
  }>(
    `SELECT chosen_plan_id, chosen_billing_cycle, chosen_plan_source, chosen_plan_at
       FROM subscriptions WHERE company_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [companyId]
  );
  return rows[0] ? rowToChoice(rows[0]) : null;
}

/**
 * Freezes the trial end at sign-up (created_at + TRIAL_DAYS), the same value the entitlement
 * computes today, so the date shown on the sign-up screen stays the customer's date. A later admin
 * extension overwrites it. Only fills a NULL, so it never shortens an extension.
 */
export async function freezeTrialEnd(companyId: string): Promise<void> {
  await ensureFreeSubscription(companyId);
  await pq(
    `UPDATE subscriptions
        SET trial_ends_at = created_at + ($2::int * interval '1 day')
      WHERE id = ${LATEST} AND trial_ends_at IS NULL AND plan_id = 'free'`,
    [companyId, TRIAL_DAYS]
  );
}

/**
 * Records the chosen plan on the company's latest subscription row. The previous choice is
 * returned so callers can audit before and after. Does not touch plan_id, status or any gate input.
 */
export async function recordPlanChoice(
  companyId: string,
  choice: PlanChoice,
  opts: { userId?: string | null; req?: Request } = {}
): Promise<{ before: StoredChoice | null; after: StoredChoice }> {
  await ensureFreeSubscription(companyId);
  const before = await readChoice(companyId);
  await pq(
    `UPDATE subscriptions
        SET plan_activation_requested_at = CASE
              WHEN chosen_plan_id IS DISTINCT FROM $2 OR chosen_billing_cycle IS DISTINCT FROM $3
              THEN NULL ELSE plan_activation_requested_at END,
            chosen_plan_id = $2, chosen_billing_cycle = $3, chosen_plan_source = $4,
            chosen_plan_at = now(), updated_at = now()
      WHERE id = ${LATEST}`,
    [companyId, choice.planId, choice.billingCycle, choice.source]
  );
  const after = (await readChoice(companyId))!;
  await recordAudit({
    userId: opts.userId ?? null,
    companyId,
    action: "billing.plan_chosen",
    entityType: "subscription",
    entityId: companyId,
    before: before ? { planId: before.planId, billingCycle: before.billingCycle } : null,
    after: { planId: choice.planId, billingCycle: choice.billingCycle, source: choice.source },
    req: opts.req,
  });
  return { before, after };
}

// ── Emails (outbox only, English first then Arabic below) ────────────────────────────────────

/**
 * Plan names as they read inside a sentence. Arabic uses the phrase form ("خطة المبتدئ", "الخطة
 * الاحترافية", "خطة المؤسسات"), so the noun agrees ("طلب تفعيل الخطة الاحترافية"); the client
 * catalog carries the same forms (marketing.prPlanPhrase_*).
 */
export const PLAN_NAMES: Record<PaidPlanId, { en: string; ar: string }> = {
  starter: { en: "Starter", ar: "خطة المبتدئ" },
  professional: { en: "Professional", ar: "الخطة الاحترافية" },
  enterprise: { en: "Enterprise", ar: "خطة المؤسسات" },
};

/**
 * The calendar day (Asia/Dubai, YYYY-MM-DD) that email dedupe keys roll over on, so "once a day"
 * means the customer's day, not 04:00 Dubai time.
 */
export function dubaiDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function dateEn(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Dubai",
  });
}
function dateAr(d: Date): string {
  return d.toLocaleDateString("ar-AE-u-nu-latn", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Dubai",
  });
}
function priceLine(planId: PaidPlanId, cycle: BillingCycle) {
  const amount = planPrice(planId, cycle).toLocaleString("en-US");
  return {
    en: `AED ${amount} ${cycle === "yearly" ? "a year" : "a month"}`,
    ar: `${amount} د.إ ${cycle === "yearly" ? "سنويًا" : "شهريًا"}`,
  };
}

function appUrl(path: string): string {
  const base = (process.env.APP_URL || process.env.PUBLIC_APP_URL || "").replace(/\/+$/, "");
  return `${base}${path}`;
}

async function trialEndOf(companyId: string): Promise<Date | null> {
  const { rows } = await pq<{ trial_end: Date | null }>(
    `SELECT COALESCE(trial_ends_at, created_at + ($2::int * interval '1 day')) AS trial_end
       FROM subscriptions WHERE company_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [companyId, TRIAL_DAYS]
  );
  return rows[0]?.trial_end ? new Date(rows[0].trial_end) : null;
}

export interface ActivationResult {
  activationRequestedAt: string;
}

/**
 * Records "activate my chosen plan" and queues two outbox emails (support, requester). The
 * idempotency keys carry the day, so a double tap sends one pair a day. Throws NO_PLAN_CHOSEN when
 * there is no choice (the route maps it to 409).
 */
export async function requestActivation(
  companyId: string,
  user: { id: string; name: string; email: string },
  note?: string,
  req?: Request,
  now: Date = new Date()
): Promise<ActivationResult> {
  const choice = await readChoice(companyId);
  if (!choice) throw new Error("NO_PLAN_CHOSEN");
  const { rows } = await pq<{ at: Date }>(
    `UPDATE subscriptions SET plan_activation_requested_at = now(), updated_at = now()
      WHERE id = ${LATEST} RETURNING plan_activation_requested_at AS at`,
    [companyId]
  );
  const at = new Date(rows[0].at);
  const co = await pq<{ name: string }>(`SELECT name FROM companies WHERE id = $1`, [companyId]);
  const companyName = co.rows[0]?.name ?? companyId;
  const end = await trialEndOf(companyId);
  const day = dubaiDay(now);
  // The "books stay open" promise only holds while the trial runs; after it the workspace is locked.
  const ended = end !== null && end.getTime() <= now.getTime();
  const plan = PLAN_NAMES[choice.planId];
  const price = priceLine(choice.planId, choice.billingCycle);

  const supportBody = [
    `${companyName} asked to activate ${plan.en} (${choice.billingCycle}).`,
    "",
    `Company: ${companyName} (${companyId})`,
    `Requested by: ${user.name} <${user.email}>`,
    `Plan: ${plan.en}, ${choice.billingCycle}, ${price.en}`,
    end ? `Trial ends: ${dateEn(end)}` : "",
    note ? `Note: ${note}` : "",
    `Open in the admin console: ${appUrl("/admin")}`,
  ]
    .filter((l) => l !== "")
    .join("\n");
  await sendEmail(
    UPGRADE_CONTACT_EMAIL,
    `Plan activation: ${companyName} wants ${plan.en} (${choice.billingCycle})`,
    supportBody,
    {
      category: "billing",
      companyId,
      relatedEntityType: "subscription",
      relatedEntityId: companyId,
      idempotencyKey: `plan-activation:${companyId}:${day}:support`,
      replyTo: user.email,
    }
  );

  const customerBody = [
    `We've got your request to activate ${plan.en} (${price.en}).`,
    "We'll email you to confirm. Nothing is charged until we confirm with you.",
    ended
      ? "Your workspace is locked until we activate your plan. Your data is saved."
      : end
        ? `Your books stay fully open until ${dateEn(end)}.`
        : "",
    "",
    "---",
    "",
    `استلمنا طلب تفعيل ${plan.ar} (${price.ar}).`,
    "سنراسلك بالبريد للتأكيد. لا يُحصَّل أي مبلغ حتى نؤكد معك.",
    ended
      ? "تبقى مساحة عملك مقفلة حتى نفعّل خطتك. بياناتك محفوظة."
      : end
        ? `تبقى دفاترك مفتوحة بالكامل حتى ${dateAr(end)}.`
        : "",
  ]
    .filter((l, i, a) => !(l === "" && i === a.length - 1))
    .join("\n");
  await sendEmail(
    user.email,
    `We've got your request to activate ${plan.en} / استلمنا طلب تفعيل ${plan.ar}`,
    customerBody,
    {
      category: "billing",
      companyId,
      relatedEntityType: "subscription",
      relatedEntityId: companyId,
      idempotencyKey: `plan-activation:${companyId}:${day}:customer`,
    }
  );
  await recordAudit({
    userId: user.id,
    companyId,
    action: "billing.activation_requested",
    entityType: "subscription",
    entityId: companyId,
    after: { planId: choice.planId, billingCycle: choice.billingCycle, note: note ?? null },
    req,
  });
  return { activationRequestedAt: at.toISOString() };
}

/** The product name stays a proper noun in both languages (never translated to "محاسب"). */
const BRAND_NAME = "Muhasib.ai";

/**
 * "Your plan is active": queued (outbox) to every company owner when an NR admin applies a paid
 * plan, and clears the open activation request (the request is answered). The idempotency key is
 * per company + plan + recipient, so re-applying the same plan never sends a second email.
 */
export async function onPlanActivated(
  companyId: string,
  planId: PaidPlanId,
  billingCycle: BillingCycle | null
): Promise<{ queued: number }> {
  await pq(
    `UPDATE subscriptions SET plan_activation_requested_at = NULL, updated_at = now()
      WHERE id = ${LATEST} AND plan_activation_requested_at IS NOT NULL`,
    [companyId]
  );
  const { rows } = await pq<{ company_name: string; email: string }>(
    `SELECT c.name AS company_name, u.email
       FROM companies c
       JOIN company_users cu ON cu.company_id = c.id AND cu.role = 'owner'
       JOIN users u ON u.id = cu.user_id
      WHERE c.id = $1`,
    [companyId]
  );
  const plan = PLAN_NAMES[planId];
  const cycle = billingCycle ?? "monthly";
  const price = priceLine(planId, cycle);
  let queued = 0;
  for (const r of rows) {
    const text = [
      `Your ${plan.en} plan (${price.en}) is now active for ${r.company_name}.`,
      `You can add and change records as usual. Thank you for choosing ${BRAND_NAME}.`,
      `Manage your plan: ${appUrl("/subscription")}`,
      "",
      "---",
      "",
      `تم تفعيل ${plan.ar} (${price.ar}) لشركة ${r.company_name}.`,
      `يمكنك إضافة السجلات وتعديلها كالمعتاد. شكرًا لاختيارك ${BRAND_NAME}.`,
      `إدارة خطتك: ${appUrl("/subscription")}`,
    ].join("\n");
    const res = await sendEmail(
      r.email,
      `Your ${plan.en} plan is active / تم تفعيل ${plan.ar}`,
      text,
      {
        category: "billing",
        companyId,
        relatedEntityType: "subscription",
        relatedEntityId: companyId,
        idempotencyKey: `plan-active:${companyId}:${planId}:${r.email}`,
      }
    );
    if (res.queued) queued++;
  }
  return { queued };
}

// ── Admin queue ──────────────────────────────────────────────────────────────────────────────

export interface AdminTrialRow {
  companyId: string;
  companyName: string;
  ownerName: string | null;
  ownerEmail: string | null;
  trialEndsAt: string;
  trialEnded: boolean;
  chosenPlan: StoredChoice | null;
  activationRequestedAt: string | null;
}

/**
 * Companies on a trial (or ended within 30 days) with their choice, activation requests first.
 * One query: the owner is picked with a LATERAL join, so there is no N+1.
 */
export async function listTrialsForAdmin(
  now: Date = new Date(),
  limit = 200,
  adminUserId: string | null = null
): Promise<AdminTrialRow[]> {
  const { rows } = await pq<{
    company_id: string;
    company_name: string;
    owner_name: string | null;
    owner_email: string | null;
    trial_end: Date;
    chosen_plan_id: string | null;
    chosen_billing_cycle: string | null;
    chosen_plan_source: string | null;
    chosen_plan_at: Date | null;
    plan_activation_requested_at: Date | null;
  }>(
    `SELECT c.id AS company_id, c.name AS company_name, o.name AS owner_name, o.email AS owner_email,
            COALESCE(s.trial_ends_at, s.created_at + ($2::int * interval '1 day')) AS trial_end,
            s.chosen_plan_id, s.chosen_billing_cycle, s.chosen_plan_source, s.chosen_plan_at,
            s.plan_activation_requested_at
       FROM companies c
       JOIN LATERAL (
         SELECT * FROM subscriptions WHERE company_id = c.id ORDER BY created_at DESC LIMIT 1
       ) s ON true
       LEFT JOIN LATERAL (
         SELECT u.name, u.email FROM company_users cu JOIN users u ON u.id = cu.user_id
          WHERE cu.company_id = c.id AND cu.role = 'owner' ORDER BY cu.created_at LIMIT 1
       ) o ON true
      WHERE s.plan_id = 'free'
        AND COALESCE(c.company_type, 'customer') NOT IN ('client', 'firm')
        AND COALESCE(s.trial_ends_at, s.created_at + ($2::int * interval '1 day'))
              > $3::timestamptz - interval '30 days'
        -- Customers only: firm workspaces (owned by a firm member) and platform admins' own
        -- companies are not sales leads.
        AND NOT EXISTS (
          SELECT 1 FROM company_users cu2 JOIN users u2 ON u2.id = cu2.user_id
           WHERE cu2.company_id = c.id
             AND ((cu2.role = 'owner'
                   AND (u2.is_admin = true
                        OR EXISTS (SELECT 1 FROM firm_members fm WHERE fm.user_id = u2.id)))
                  OR ($4::uuid IS NOT NULL AND u2.id = $4::uuid))
        )
      ORDER BY (s.plan_activation_requested_at IS NOT NULL) DESC,
               s.plan_activation_requested_at DESC NULLS LAST,
               COALESCE(s.trial_ends_at, s.created_at + ($2::int * interval '1 day')) ASC
      LIMIT $1`,
    [limit, TRIAL_DAYS, now.toISOString(), adminUserId]
  );
  return rows.map((r) => ({
    companyId: r.company_id,
    companyName: r.company_name,
    ownerName: r.owner_name,
    ownerEmail: r.owner_email,
    trialEndsAt: new Date(r.trial_end).toISOString(),
    trialEnded: new Date(r.trial_end).getTime() <= now.getTime(),
    chosenPlan: rowToChoice(r),
    activationRequestedAt: r.plan_activation_requested_at
      ? new Date(r.plan_activation_requested_at).toISOString()
      : null,
  }));
}

// ── Reminders (job body) ─────────────────────────────────────────────────────────────────────

export interface ReminderSummary {
  ending: number;
  ended: number;
}

/**
 * Emails company owners 3 days before the trial ends and once after it ended (within 24 h).
 * Idempotency keys carry the company, the end date and the owner, so re-runs never duplicate.
 * Planless, non-client companies only. Without an email provider the outbox keeps them
 * blocked_no_provider.
 */
export async function sendTrialReminders(now: Date = new Date()): Promise<ReminderSummary> {
  const { rows } = await pq<{
    company_id: string;
    company_name: string;
    trial_end: Date;
    chosen_plan_id: string | null;
    chosen_billing_cycle: string | null;
    owner_email: string;
  }>(
    `SELECT c.id AS company_id, c.name AS company_name,
            COALESCE(s.trial_ends_at, s.created_at + ($1::int * interval '1 day')) AS trial_end,
            s.chosen_plan_id, s.chosen_billing_cycle, u.email AS owner_email
       FROM companies c
       JOIN LATERAL (
         SELECT * FROM subscriptions WHERE company_id = c.id ORDER BY created_at DESC LIMIT 1
       ) s ON true
       JOIN company_users cu ON cu.company_id = c.id AND cu.role = 'owner'
       JOIN users u ON u.id = cu.user_id
      WHERE s.plan_id = 'free'
        AND COALESCE(c.company_type, 'customer') NOT IN ('client', 'firm')
        AND COALESCE(s.trial_ends_at, s.created_at + ($1::int * interval '1 day'))
              BETWEEN $2::timestamptz - interval '1 day' AND $2::timestamptz + interval '3 days'`,
    [TRIAL_DAYS, now.toISOString()]
  );
  const out: ReminderSummary = { ending: 0, ended: 0 };
  for (const r of rows) {
    const end = new Date(r.trial_end);
    const ended = end.getTime() <= now.getTime();
    const endDay = dubaiDay(end);
    const choice = afterTrialPlan({
      chosenPlanId: r.chosen_plan_id,
      chosenBillingCycle: r.chosen_billing_cycle,
    });
    const link = appUrl("/subscription#after-trial");
    const planEn = choice
      ? `Plan after your trial: ${PLAN_NAMES[choice.planId].en} (${priceLine(choice.planId, choice.billingCycle).en}). Activate it to keep adding records.`
      : "Choose the plan you want to keep adding records.";
    const planAr = choice
      ? `الخطة بعد الفترة التجريبية: ${PLAN_NAMES[choice.planId].ar} (${priceLine(choice.planId, choice.billingCycle).ar}). فعّلها لمواصلة إضافة السجلات.`
      : "اختر الخطة التي تريدها لمواصلة إضافة السجلات.";
    const subjectEn = ended
      ? "Your trial ended and your workspace is locked"
      : `Your free trial ends on ${dateEn(end)}`;
    const subjectAr = ended
      ? "انتهت الفترة التجريبية وأُقفلت مساحة عملك"
      : `تنتهي فترتك التجريبية في ${dateAr(end)}`;
    const bodyEn = ended
      ? `Your free trial of ${r.company_name} ended on ${dateEn(end)}. Your workspace is locked until a paid plan is active. Your data is saved.`
      : `Your free trial of ${r.company_name} ends on ${dateEn(end)}.`;
    const bodyAr = ended
      ? `انتهت فترتك التجريبية لشركة ${r.company_name} في ${dateAr(end)}. تبقى مساحة عملك مقفلة حتى تفعيل خطة مدفوعة. بياناتك محفوظة.`
      : `تنتهي فترتك التجريبية لشركة ${r.company_name} في ${dateAr(end)}.`;
    const text = [
      bodyEn,
      planEn,
      `Manage your plan: ${link}`,
      "Your data stays safe and readable either way.",
      "",
      "---",
      "",
      bodyAr,
      planAr,
      `إدارة خطتك: ${link}`,
      "تبقى بياناتك آمنة ومقروءة في الحالتين.",
    ].join("\n");
    const idempotencyKey = `${ended ? "trial-ended" : "trial-ending"}:${r.company_id}:${endDay}:${r.owner_email}`;
    const seen = await pq(`SELECT 1 FROM email_outbox WHERE idempotency_key = $1 LIMIT 1`, [
      idempotencyKey,
    ]);
    if (seen.rows.length > 0) continue;
    const res = await sendEmail(r.owner_email, `${subjectEn} / ${subjectAr}`, text, {
      category: "billing",
      companyId: r.company_id,
      relatedEntityType: "subscription",
      relatedEntityId: r.company_id,
      idempotencyKey,
    });
    if (res.queued) {
      if (ended) out.ended++;
      else out.ending++;
    }
  }
  if (out.ending || out.ended) log.info(out, "trial reminders queued");
  return out;
}
