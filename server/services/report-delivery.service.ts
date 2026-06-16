import {
  reportAutomationStarters,
  reportAutomationTriggerRules,
  reportCatalog,
  reportDecisionShortcuts,
  reportDeliverySubscriptionHref,
  reportDeliverySubscriptions,
  reportPackTemplates,
  reportPersonas,
  type ReportDeliverySubscription,
  type ReportPersona,
} from "../../client/src/lib/reportCatalog";
import type { InsertNotification } from "../../shared/schema";

export interface ReportDeliveryPlan {
  id: string;
  persona: ReportPersona;
  title: string;
  audience: string;
  cadence: string;
  channel: string;
  format: string;
  recipients: string;
  deliveryGuardrail: string;
  href: string;
  nextRunAt: string;
  nextRunLabel: string;
  status: "ready" | "setup";
  reportCount: number;
  readyReportCount: number;
  triggerRuleCount: number;
  packTemplate: {
    id: string;
    title: string;
  } | null;
  automationStarter: {
    id: string;
    title: string;
  } | null;
  decisionShortcut: {
    id: string;
    question: string;
  } | null;
  reports: Array<{
    id: string;
    name: string;
    status: string;
  }>;
  triggerRules: Array<{
    id: string;
    title: string;
    severity: string;
  }>;
}

export function isReportDeliveryPersona(value: unknown): value is ReportPersona {
  return typeof value === "string" && reportPersonas.includes(value as ReportPersona);
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function atUtcHour(date: Date, hour: number): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, 0, 0, 0)
  );
}

function nextUtcWeekday(now: Date): Date {
  let candidate = atUtcHour(addUtcDays(now, 1), 8);
  while (candidate.getUTCDay() === 0 || candidate.getUTCDay() === 6) {
    candidate = atUtcHour(addUtcDays(candidate, 1), 8);
  }
  return candidate;
}

function nextUtcMonday(now: Date): Date {
  const day = now.getUTCDay();
  const daysUntilMonday = (1 - day + 7) % 7 || 7;
  return atUtcHour(addUtcDays(now, daysUntilMonday), 8);
}

function nextUtcMonthEnd(now: Date): Date {
  const currentMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 17));
  if (currentMonthEnd > now) return currentMonthEnd;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 0, 17));
}

export function estimateReportDeliveryNextRun(
  subscription: Pick<ReportDeliverySubscription, "cadence">,
  now = new Date()
): Date {
  const cadence = subscription.cadence.toLowerCase();
  if (cadence.includes("weekday")) return nextUtcWeekday(now);
  if (cadence.includes("monday")) return nextUtcMonday(now);
  if (cadence.includes("daily")) return atUtcHour(addUtcDays(now, 1), 8);
  if (cadence.includes("month-end") || cadence.includes("monthly")) return nextUtcMonthEnd(now);
  if (cadence.includes("tax") || cadence.includes("deadline"))
    return atUtcHour(addUtcDays(now, 14), 8);
  return atUtcHour(addUtcDays(now, 7), 8);
}

function formatNextRunLabel(nextRunAt: Date): string {
  return nextRunAt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export function buildReportDeliveryPlan(
  subscription: ReportDeliverySubscription,
  now = new Date()
): ReportDeliveryPlan {
  const reports = subscription.reportIds
    .map((reportId) => reportCatalog.find((report) => report.id === reportId))
    .filter((report): report is (typeof reportCatalog)[number] => Boolean(report));
  const readyReportCount = reports.filter((report) => report.status !== "planned").length;
  const triggerRules = subscription.triggerRuleIds
    .map((ruleId) => reportAutomationTriggerRules.find((rule) => rule.id === ruleId))
    .filter((rule): rule is (typeof reportAutomationTriggerRules)[number] => Boolean(rule));
  const packTemplate = reportPackTemplates.find(
    (template) => template.id === subscription.packTemplateId
  );
  const automationStarter = reportAutomationStarters.find(
    (starter) => starter.id === subscription.automationStarterId
  );
  const decisionShortcut = reportDecisionShortcuts.find(
    (shortcut) => shortcut.id === subscription.decisionShortcutId
  );
  const nextRunAt = estimateReportDeliveryNextRun(subscription, now);

  return {
    id: subscription.id,
    persona: subscription.persona,
    title: subscription.title,
    audience: subscription.audience,
    cadence: subscription.cadence,
    channel: subscription.channel,
    format: subscription.format,
    recipients: subscription.recipients,
    deliveryGuardrail: subscription.deliveryGuardrail,
    href: reportDeliverySubscriptionHref(subscription),
    nextRunAt: nextRunAt.toISOString(),
    nextRunLabel: formatNextRunLabel(nextRunAt),
    status: readyReportCount === reports.length ? "ready" : "setup",
    reportCount: reports.length,
    readyReportCount,
    triggerRuleCount: triggerRules.length,
    packTemplate: packTemplate ? { id: packTemplate.id, title: packTemplate.title } : null,
    automationStarter: automationStarter
      ? { id: automationStarter.id, title: automationStarter.title }
      : null,
    decisionShortcut: decisionShortcut
      ? { id: decisionShortcut.id, question: decisionShortcut.question }
      : null,
    reports: reports.map((report) => ({
      id: report.id,
      name: report.name,
      status: report.status,
    })),
    triggerRules: triggerRules.map((rule) => ({
      id: rule.id,
      title: rule.title,
      severity: rule.severity,
    })),
  };
}

export function getReportDeliveryPlans(
  options: {
    persona?: ReportPersona | null;
    now?: Date;
  } = {}
): ReportDeliveryPlan[] {
  return reportDeliverySubscriptions
    .filter((subscription) => !options.persona || subscription.persona === options.persona)
    .map((subscription) => buildReportDeliveryPlan(subscription, options.now));
}

export function getReportDeliveryPlan(
  subscriptionId: string,
  now = new Date()
): ReportDeliveryPlan | null {
  const subscription = reportDeliverySubscriptions.find((item) => item.id === subscriptionId);
  return subscription ? buildReportDeliveryPlan(subscription, now) : null;
}

export function buildReportDeliveryNotificationInput(input: {
  userId: string;
  companyId: string;
  subscriptionId: string;
  now?: Date;
}): { notification: InsertNotification; plan: ReportDeliveryPlan } | null {
  const plan = getReportDeliveryPlan(input.subscriptionId, input.now);
  if (!plan) return null;

  return {
    plan,
    notification: {
      userId: input.userId,
      companyId: input.companyId,
      type: "system",
      title: `Report delivery queued: ${plan.title}`,
      message: `${plan.format} scheduled for ${plan.nextRunLabel}. ${plan.channel}. Guardrail: ${plan.deliveryGuardrail}`,
      priority: plan.status === "ready" ? "normal" : "high",
      relatedEntityType: "report_delivery_subscription",
      actionUrl: plan.href,
      isRead: false,
      isDismissed: false,
      scheduledFor: new Date(plan.nextRunAt),
    },
  };
}
