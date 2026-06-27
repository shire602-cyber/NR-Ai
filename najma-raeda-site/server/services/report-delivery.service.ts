import {
  reportAutomationStarters,
  reportAutomationTriggerRules,
  reportCatalog,
  reportDecisionShortcuts,
  reportDeliverySubscriptionHref,
  reportDeliverySubscriptions,
  reportPackTemplates,
  reportPersonas,
  reportSuiteHref,
  reportSuiteProfiles,
  type ReportDeliverySubscription,
  type ReportPersona,
  type ReportWorkflowGapFilter,
} from "../../client/src/lib/reportCatalog";
import type {
  CompanyReportDeliveryRun,
  CompanyReportDeliverySubscription,
  InsertCompanyReportDeliveryRun,
  InsertNotification,
} from "../../shared/schema";

export type ReportDeliverySetting = Pick<
  CompanyReportDeliverySubscription,
  | "subscriptionId"
  | "enabled"
  | "cadenceOverride"
  | "channelOverride"
  | "formatOverride"
  | "recipientsOverride"
  | "deliveryGuardrailOverride"
  | "updatedAt"
>;

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
  enabled: boolean;
  settingsSource: "catalog" | "company";
  settingsUpdatedAt: string | null;
  href: string;
  nextRunAt: string;
  nextRunLabel: string;
  status: "ready" | "setup" | "paused";
  reportCount: number;
  readyReportCount: number;
  triggerRuleCount: number;
  suiteCount: number;
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
  reportSuites: Array<{
    id: string;
    title: string;
    workflow: string;
    href: string;
  }>;
  preview: ReportDeliveryPreview;
}

export interface ReportDeliveryPreview {
  summary: string;
  readinessLabel: string;
  checklist: Array<{
    label: string;
    status: "ready" | "review" | "paused";
    detail: string;
  }>;
  reportNames: string[];
  triggerRuleTitles: string[];
  suiteTitles: string[];
}

export interface ReportDeliveryHandoffReview {
  gap: ReportWorkflowGapFilter;
  message: string;
  detail: string;
  latestRunId?: string | null;
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
  now = new Date(),
  setting?: ReportDeliverySetting | null
): ReportDeliveryPlan {
  const cadence = setting?.cadenceOverride || subscription.cadence;
  const channel = setting?.channelOverride || subscription.channel;
  const format = setting?.formatOverride || subscription.format;
  const recipients = setting?.recipientsOverride || subscription.recipients;
  const deliveryGuardrail = setting?.deliveryGuardrailOverride || subscription.deliveryGuardrail;
  const enabled = setting?.enabled ?? true;
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
  const reportSuites = reportSuiteProfiles.filter(
    (suite) => suite.deliverySubscriptionId === subscription.id
  );
  const nextRunAt = estimateReportDeliveryNextRun({ cadence }, now);
  const blockedReportCount = reports.length - readyReportCount;
  const readinessLabel = !enabled
    ? "Paused"
    : blockedReportCount > 0
      ? "Setup needed before queue"
      : "Ready for queue";
  const preview: ReportDeliveryPreview = {
    summary: `${format} to ${recipients} through ${channel}.`,
    readinessLabel,
    checklist: [
      {
        label: "Reports",
        status: blockedReportCount > 0 ? "review" : "ready",
        detail: `${readyReportCount}/${reports.length} reports ready for this pack.`,
      },
      {
        label: "Report suites",
        status: reportSuites.length > 0 ? "ready" : "review",
        detail:
          reportSuites.length > 0
            ? reportSuites.map((suite) => suite.title).join(", ")
            : "No role-based report suite is attached to this delivery.",
      },
      {
        label: "Guardrail",
        status: enabled ? "ready" : "paused",
        detail: deliveryGuardrail,
      },
      {
        label: "Recipients",
        status: enabled ? "ready" : "paused",
        detail: recipients,
      },
      {
        label: "Automation rules",
        status: triggerRules.length > 0 ? "review" : "ready",
        detail:
          triggerRules.length > 0
            ? `${triggerRules.length} trigger rules will be checked before delivery.`
            : "No trigger rules are attached to this subscription.",
      },
    ],
    reportNames: reports.map((report) => report.name),
    triggerRuleTitles: triggerRules.map((rule) => rule.title),
    suiteTitles: reportSuites.map((suite) => suite.title),
  };

  return {
    id: subscription.id,
    persona: subscription.persona,
    title: subscription.title,
    audience: subscription.audience,
    cadence,
    channel,
    format,
    recipients,
    deliveryGuardrail,
    enabled,
    settingsSource: setting ? "company" : "catalog",
    settingsUpdatedAt: setting?.updatedAt ? new Date(setting.updatedAt).toISOString() : null,
    href: reportDeliverySubscriptionHref(subscription),
    nextRunAt: nextRunAt.toISOString(),
    nextRunLabel: formatNextRunLabel(nextRunAt),
    status: !enabled ? "paused" : readyReportCount === reports.length ? "ready" : "setup",
    reportCount: reports.length,
    readyReportCount,
    triggerRuleCount: triggerRules.length,
    suiteCount: reportSuites.length,
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
    reportSuites: reportSuites.map((suite) => ({
      id: suite.id,
      title: suite.title,
      workflow: suite.workflow,
      href: reportSuiteHref(suite),
    })),
    preview,
  };
}

export function getReportDeliveryPlans(
  options: {
    persona?: ReportPersona | null;
    now?: Date;
    settings?: ReportDeliverySetting[];
  } = {}
): ReportDeliveryPlan[] {
  const settingsBySubscriptionId = new Map(
    (options.settings ?? []).map((setting) => [setting.subscriptionId, setting])
  );

  return reportDeliverySubscriptions
    .filter((subscription) => !options.persona || subscription.persona === options.persona)
    .map((subscription) =>
      buildReportDeliveryPlan(
        subscription,
        options.now,
        settingsBySubscriptionId.get(subscription.id)
      )
    );
}

export function getReportDeliveryPlan(
  subscriptionId: string,
  now = new Date(),
  settings: ReportDeliverySetting[] = []
): ReportDeliveryPlan | null {
  const subscription = reportDeliverySubscriptions.find((item) => item.id === subscriptionId);
  const setting = settings.find((item) => item.subscriptionId === subscriptionId);
  return subscription ? buildReportDeliveryPlan(subscription, now, setting) : null;
}

export function buildReportDeliveryNotificationInput(input: {
  userId: string;
  companyId: string;
  subscriptionId: string;
  now?: Date;
  settings?: ReportDeliverySetting[];
  scheduledFor?: Date;
}): { notification: InsertNotification; plan: ReportDeliveryPlan } | null {
  const plan = getReportDeliveryPlan(input.subscriptionId, input.now, input.settings ?? []);
  if (!plan) return null;

  return {
    plan,
    notification: buildReportDeliveryNotificationForPlan({
      userId: input.userId,
      companyId: input.companyId,
      plan,
      scheduledFor: input.scheduledFor,
    }),
  };
}

export function buildReportDeliveryHandoffReview(input: {
  plan: ReportDeliveryPlan;
  latestRun?: Pick<
    CompanyReportDeliveryRun,
    "id" | "status" | "readinessStatus" | "errorMessage" | "readyReportCount" | "reportCount"
  > | null;
}): ReportDeliveryHandoffReview | null {
  const { plan, latestRun } = input;
  if (latestRun?.status === "failed") {
    return {
      gap: "delivery-gaps",
      message: "Report delivery has unresolved handoff gaps",
      detail: latestRun.errorMessage ?? "Recover the latest failed delivery before queueing again.",
      latestRunId: latestRun.id,
    };
  }

  const reportGapCount = Math.max(0, plan.reportCount - plan.readyReportCount);
  if (reportGapCount > 0 || plan.status === "setup") {
    return {
      gap: "report-gaps",
      message: "Report delivery has unresolved handoff gaps",
      detail: `${plan.readyReportCount}/${plan.reportCount} reports are ready for this delivery.`,
      latestRunId: latestRun?.id ?? null,
    };
  }

  if (latestRun && latestRun.readinessStatus !== "ready") {
    return {
      gap: "delivery-gaps",
      message: "Report delivery has unresolved handoff gaps",
      detail: `Latest delivery readiness is ${latestRun.readinessStatus}.`,
      latestRunId: latestRun.id,
    };
  }

  return null;
}

export function buildReportDeliveryNotificationForPlan(input: {
  userId: string;
  companyId: string;
  plan: ReportDeliveryPlan;
  scheduledFor?: Date;
}): InsertNotification {
  const { plan } = input;

  const scheduledFor = input.scheduledFor ?? new Date(plan.nextRunAt);
  const scheduledForLabel = formatNextRunLabel(scheduledFor);
  const suiteLabel = plan.reportSuites.length
    ? ` Suite: ${plan.reportSuites.map((suite) => suite.title).join(", ")}.`
    : "";

  return {
    userId: input.userId,
    companyId: input.companyId,
    type: "system",
    title: `Report delivery queued: ${plan.title}`,
    message: `${plan.format} scheduled for ${scheduledForLabel}. ${plan.channel}.${suiteLabel} Guardrail: ${plan.deliveryGuardrail}`,
    priority: plan.status === "ready" ? "normal" : "high",
    relatedEntityType: "report_delivery_subscription",
    actionUrl: plan.href,
    isRead: false,
    isDismissed: false,
    scheduledFor,
  };
}

export function buildReportDeliveryRunInput(input: {
  companyId: string;
  queuedBy: string;
  plan: ReportDeliveryPlan;
  status?: "queued" | "failed" | "sent" | "cancelled";
  errorMessage?: string | null;
  notificationId?: string | null;
  retriedFromRunId?: string | null;
  scheduledFor?: Date;
}): InsertCompanyReportDeliveryRun {
  const { plan } = input;
  const scheduledFor = input.scheduledFor ?? new Date(plan.nextRunAt);
  const scheduledForLabel = formatNextRunLabel(scheduledFor);

  return {
    companyId: input.companyId,
    subscriptionId: plan.id,
    status: input.status ?? "queued",
    readinessStatus: plan.status,
    notificationId: input.notificationId ?? null,
    retriedFromRunId: input.retriedFromRunId ?? null,
    errorMessage: input.errorMessage ?? null,
    scheduledFor,
    queuedBy: input.queuedBy,
    channel: plan.channel,
    format: plan.format,
    recipients: plan.recipients,
    deliveryGuardrail: plan.deliveryGuardrail,
    reportCount: plan.reportCount,
    readyReportCount: plan.readyReportCount,
    triggerRuleCount: plan.triggerRuleCount,
    snapshot: {
      title: plan.title,
      persona: plan.persona,
      audience: plan.audience,
      href: plan.href,
      nextRunAt: scheduledFor.toISOString(),
      nextRunLabel: scheduledForLabel,
      errorMessage: input.errorMessage ?? null,
      retriedFromRunId: input.retriedFromRunId ?? null,
      settingsSource: plan.settingsSource,
      reports: plan.reports,
      triggerRules: plan.triggerRules,
      reportSuites: plan.reportSuites,
      packTemplate: plan.packTemplate,
      automationStarter: plan.automationStarter,
      decisionShortcut: plan.decisionShortcut,
      preview: plan.preview,
    },
  };
}
