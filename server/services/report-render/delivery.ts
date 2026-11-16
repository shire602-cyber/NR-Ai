/**
 * Report delivery executor (W5-A, R12-01, R12-10).
 *
 * A queued run is rendered server-side (PDF + XLSX), the files are stored on
 * company_report_delivery_artifacts, and one outbox email per recipient carries them.
 * The run status only ever says what actually happened:
 *
 *   queued → rendering → sent                      every recipient's email was accepted
 *                      → failed (reason)           render error or provider error; the outbox
 *                                                  retries with backoff (retry_scheduled_at)
 *                      → blocked (no_email_provider | no_recipients)   nothing was sent
 *
 * A failed run whose outbox messages later go out is reconciled to `sent` on read
 * (refreshReportDeliveryRuns). In-app notifications are an extra signal only.
 */
import crypto from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../../db";
import {
  companyReportDeliveryArtifacts,
  companyReportDeliveryRuns,
  emailOutbox,
  type CompanyReportDeliveryArtifact,
  type CompanyReportDeliveryRun,
} from "../../../shared/schema";
import { activeProviderName, deliverOutboxMessage, enqueueEmail } from "../../outbox";
import { isCapabilityLive } from "../../../shared/capabilities";
import { EMAIL_NOT_SET_UP_RUN_ERROR } from "../../../shared/notification-copy";
import { renderServerCopy } from "../../../shared/server-copy";
import { createLogger } from "../../config/logger";
import { DomainError } from "../../errors";
import { getObject, hasDurableObjectStore, putObject } from "../fileStorage";
import { buildDeliveryPack, deliveryPeriod, type RenderedFile } from "./pack";
import { STATEMENT_TITLES } from "./statements";

const log = createLogger("report-delivery-executor");

export type ReportDeliveryRunStatus =
  | "queued"
  | "rendering"
  | "sent"
  | "failed"
  | "blocked"
  | "cancelled";

export type ReportDeliveryBlockedReason = "no_email_provider" | "no_recipients" | "handoff_review";

/** The slice of a delivery plan the executor needs (see report-delivery.service). */
export interface DeliveryPlanInput {
  id: string;
  persona: "owner" | "freelancer" | "accountant";
  title: string;
  cadence: string;
  recipients: string;
  channel: string;
  reports: Array<{ id: string; name: string }>;
}

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;
const MAX_RECIPIENTS = 10;

/** Email addresses written in a recipients setting ("a@x.ae, b@y.ae"). */
export function parseRecipientEmails(value: string | null | undefined): string[] {
  if (!value) return [];
  const out: string[] = [];
  for (const raw of value.split(/[\s,;]+/)) {
    const email = raw.trim().replace(/^<|>$/g, "").toLowerCase();
    if (EMAIL_RE.test(email) && !out.includes(email)) out.push(email);
  }
  return out.slice(0, MAX_RECIPIENTS);
}

const PERSONA_ROLES: Record<DeliveryPlanInput["persona"], string[]> = {
  owner: ["owner", "admin"],
  freelancer: ["owner", "admin"],
  accountant: ["accountant", "owner"],
};

/**
 * Recipients: addresses written in the subscription's recipients setting, else the
 * company members whose role matches the subscription persona.
 */
export async function resolveDeliveryRecipients(
  companyId: string,
  plan: Pick<DeliveryPlanInput, "persona" | "recipients">
): Promise<string[]> {
  const explicit = parseRecipientEmails(plan.recipients);
  if (explicit.length) return explicit;
  const roles = PERSONA_ROLES[plan.persona] ?? ["owner"];
  const { rows } = await pool.query(
    `SELECT DISTINCT lower(u.email) AS email
       FROM company_users cu JOIN users u ON u.id = cu.user_id
      WHERE cu.company_id = $1 AND cu.role = ANY($2::text[]) AND u.email IS NOT NULL
      ORDER BY 1 LIMIT ${MAX_RECIPIENTS}`,
    [companyId, roles]
  );
  return rows.map((r: { email: string }) => r.email).filter((e: string) => EMAIL_RE.test(e));
}

/** Google Sheets is offered only when the integration is configured (capability live). */
export function googleSheetsDeliveryAvailable(): boolean {
  return isCapabilityLive("google_sheets");
}

export function channelMentionsGoogleSheets(channel: string | null | undefined): boolean {
  return /google\s*sheets|\bsheets?\b/i.test(channel ?? "");
}

async function updateRun(
  companyId: string,
  runId: string,
  patch: Partial<typeof companyReportDeliveryRuns.$inferInsert>
): Promise<CompanyReportDeliveryRun> {
  const [row] = await db
    .update(companyReportDeliveryRuns)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(companyReportDeliveryRuns.companyId, companyId),
        eq(companyReportDeliveryRuns.id, runId)
      )
    )
    .returning();
  return row as CompanyReportDeliveryRun;
}

async function storeArtifacts(
  companyId: string,
  runId: string,
  files: RenderedFile[]
): Promise<void> {
  for (const f of files) {
    const sha256 = crypto.createHash("sha256").update(f.content).digest("hex");
    // S5: bytes go to durable object storage when it is configured (S3 / Blob); the row keeps
    // only the key. Without object storage (dev/test) the bytes stay in the row (bytea).
    let storageKey: string | null = null;
    if (hasDurableObjectStore()) {
      storageKey = await putObject(
        "report-artifacts",
        `${companyId}/${runId}/${sha256.slice(0, 16)}-${f.filename}`.replace(/\//g, "_"),
        f.content,
        f.contentType
      );
    }
    await db.insert(companyReportDeliveryArtifacts).values({
      companyId,
      runId,
      kind: f.kind,
      filename: f.filename,
      contentType: f.contentType,
      sizeBytes: f.content.length,
      sha256,
      content: storageKey ? null : f.content,
      storageKey,
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function emailBody(input: {
  plan: DeliveryPlanInput;
  companyName: string;
  periodLabel: string;
  rendered: string[];
  openInApp: string[];
}): { html: string; text: string } {
  const list = (items: string[]) => items.map((i) => `<li>${escapeHtml(i)}</li>`).join("");
  const html = `<p>${escapeHtml(input.plan.title)} for ${escapeHtml(input.companyName)} (${escapeHtml(
    input.periodLabel
  )}).</p>
<p>Attached: a PDF and an Excel workbook with:</p><ul>${list(input.rendered)}</ul>${
    input.openInApp.length
      ? `<p>Indicator reports not attached (open them in Muhasib.ai):</p><ul>${list(input.openInApp)}</ul>`
      : ""
  }<p>Figures come from posted ledger entries at the time of sending.</p>`;
  const text = [
    `${input.plan.title} for ${input.companyName} (${input.periodLabel}).`,
    "Attached (PDF and Excel):",
    ...input.rendered.map((r) => `- ${r}`),
    ...(input.openInApp.length
      ? [
          "Indicator reports not attached (open them in Muhasib.ai):",
          ...input.openInApp.map((r) => `- ${r}`),
        ]
      : []),
  ].join("\n");
  return { html, text };
}

/**
 * Render, store and email one run. Never throws for delivery problems: the returned run
 * carries the truthful status and reason.
 */
export async function executeReportDeliveryRun(input: {
  companyId: string;
  runId: string;
  plan: DeliveryPlanInput;
  now?: Date;
}): Promise<CompanyReportDeliveryRun> {
  try {
    return await executeRun(input);
  } catch (err) {
    log.error({ err, companyId: input.companyId, runId: input.runId }, "Report delivery failed");
    return updateRun(input.companyId, input.runId, {
      status: "failed",
      errorMessage: renderServerCopy("reportDelivery.run.failed", {
        reason: (err as Error).message,
      }).slice(0, 1000),
    });
  }
}

/** Record the in-app notification that accompanied a run. */
export async function setRunNotification(
  companyId: string,
  runId: string,
  notificationId: string
): Promise<CompanyReportDeliveryRun> {
  return updateRun(companyId, runId, { notificationId });
}

async function executeRun(input: {
  companyId: string;
  runId: string;
  plan: DeliveryPlanInput;
  now?: Date;
}): Promise<CompanyReportDeliveryRun> {
  const { companyId, runId, plan } = input;
  await updateRun(companyId, runId, {
    status: "rendering",
    errorMessage: null,
    blockedReason: null,
  });

  let recipients: string[];
  try {
    recipients = await resolveDeliveryRecipients(companyId, plan);
  } catch (err) {
    return updateRun(companyId, runId, {
      status: "failed",
      errorMessage: renderServerCopy("reportDelivery.run.recipientsFailed", {
        reason: (err as Error).message,
      }).slice(0, 1000),
    });
  }

  const period = deliveryPeriod(plan.cadence, input.now);
  let pack: Awaited<ReturnType<typeof buildDeliveryPack>>;
  try {
    pack = await buildDeliveryPack({
      companyId,
      title: plan.title,
      reportIds: plan.reports.map((r) => r.id),
      period,
    });
    await storeArtifacts(companyId, runId, pack.files);
  } catch (err) {
    log.error({ err, companyId, runId }, "Report pack render failed");
    return updateRun(companyId, runId, {
      status: "failed",
      errorMessage: renderServerCopy("reportDelivery.run.renderFailed", {
        reason: (err as Error).message,
      }).slice(0, 1000),
    });
  }

  const renderedAt = new Date();
  const base = {
    renderedAt,
    artifactCount: pack.files.length,
    recipientAddresses: recipients,
  };

  if (recipients.length === 0) {
    return updateRun(companyId, runId, {
      ...base,
      status: "blocked",
      blockedReason: "no_recipients",
      errorMessage: renderServerCopy("reportDelivery.run.noRecipients"),
    });
  }

  if (!activeProviderName()) {
    // D2b: the run (shown in-app) carries user copy; the configuration detail stays in the log.
    log.warn(
      { companyId, runId },
      "Report delivery blocked: no email provider configured (set RESEND_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASS)"
    );
    return updateRun(companyId, runId, {
      ...base,
      status: "blocked",
      blockedReason: "no_email_provider",
      errorMessage: EMAIL_NOT_SET_UP_RUN_ERROR,
    });
  }

  let sheetsNote: string | null = null;
  if (channelMentionsGoogleSheets(plan.channel) && googleSheetsDeliveryAvailable()) {
    try {
      const { exportCustomDataToSheet } = await import("../../integrations/googleSheets");
      const copy = await exportCustomDataToSheet(
        `${plan.title} ${period.to}`,
        pack.reports.flatMap((report) =>
          report.tables.map((t, i) => ({
            name: `${report.title.en}${i ? ` ${i + 1}` : ""}`.slice(0, 90),
            headers: t.columns.map((c) => c.header.en),
            rows: t.rows.map((r) => t.columns.map((c) => r.cells[c.key] ?? null)),
          }))
        )
      );
      sheetsNote = renderServerCopy("reportDelivery.run.sheetsCopy", { url: copy.url });
    } catch (err) {
      sheetsNote = renderServerCopy("reportDelivery.run.sheetsFailed", {
        reason: (err as Error).message,
      });
    }
  }

  const periodText = `${period.from} – ${period.to}`;
  const body = emailBody({
    plan,
    companyName: pack.company.name,
    periodLabel: periodText,
    rendered: pack.statementKinds.map((k) => STATEMENT_TITLES[k].en),
    openInApp: pack.coverage.filter((c) => c.status === "open_in_app").map((c) => c.name),
  });

  const outboxIds: string[] = [];
  const statuses: string[] = [];
  const errors: string[] = [];
  for (const to of recipients) {
    try {
      const queued = await enqueueEmail({
        to,
        subject: `${plan.title} – ${pack.company.name} – ${periodText}`,
        html: body.html,
        text: body.text,
        companyId,
        category: "report_delivery",
        relatedEntityType: "report_delivery_run",
        relatedEntityId: runId,
        idempotencyKey: `report-delivery:${runId}:${to}`,
        attachments: pack.files.map((f) => ({
          filename: f.filename,
          contentType: f.contentType,
          content: f.content,
        })),
      });
      outboxIds.push(queued.id);
      const attempt = (await deliverOutboxMessage(queued.id)) ?? queued;
      statuses.push(attempt.status);
      if (attempt.error)
        errors.push(
          renderServerCopy("reportDelivery.run.recipientFailed", {
            recipient: to,
            reason: attempt.error,
          })
        );
    } catch (err) {
      statuses.push("failed");
      errors.push(
        renderServerCopy("reportDelivery.run.recipientFailed", {
          recipient: to,
          reason: (err as Error).message,
        })
      );
    }
  }

  const allSent = statuses.every((s) => s === "sent" || s === "delivered");
  if (allSent) {
    return updateRun(companyId, runId, {
      ...base,
      outboxMessageIds: outboxIds,
      status: "sent",
      sentAt: new Date(),
      errorMessage: sheetsNote,
      retryScheduledAt: null,
    });
  }
  if (statuses.every((s) => s === "blocked_no_provider")) {
    return updateRun(companyId, runId, {
      ...base,
      outboxMessageIds: outboxIds,
      status: "blocked",
      blockedReason: "no_email_provider",
      errorMessage: EMAIL_NOT_SET_UP_RUN_ERROR,
    });
  }
  const retryAt = await nextOutboxRetry(outboxIds);
  return updateRun(companyId, runId, {
    ...base,
    outboxMessageIds: outboxIds,
    status: "failed",
    errorMessage: (
      errors.join("; ") || renderServerCopy("reportDelivery.run.providerRejected")
    ).slice(0, 1000),
    retryScheduledAt: retryAt,
  });
}

async function nextOutboxRetry(ids: string[]): Promise<Date | null> {
  if (!ids.length) return null;
  const rows = await db
    .select({ status: emailOutbox.status, nextAttemptAt: emailOutbox.nextAttemptAt })
    .from(emailOutbox)
    .where(inArray(emailOutbox.id, ids));
  const retrying = rows
    .filter((r: { status: string }) => r.status === "retrying")
    .map((r: { nextAttemptAt: Date }) => new Date(r.nextAttemptAt).getTime());
  return retrying.length ? new Date(Math.min(...retrying)) : null;
}

/**
 * Reconcile failed/blocked runs with their outbox rows: once every message is sent the
 * run becomes `sent`; when every remaining message is dead the retry is cleared.
 */
export async function refreshReportDeliveryRuns<T extends CompanyReportDeliveryRun>(
  runs: T[]
): Promise<T[]> {
  const stale = runs.filter(
    (r) =>
      (r.status === "failed" || r.status === "blocked") && (r.outboxMessageIds ?? []).length > 0
  );
  if (!stale.length) return runs;
  const ids = stale.flatMap((r) => r.outboxMessageIds ?? []);
  const rows = await db
    .select({ id: emailOutbox.id, status: emailOutbox.status, sentAt: emailOutbox.sentAt })
    .from(emailOutbox)
    .where(inArray(emailOutbox.id, ids));
  const byId = new Map(
    rows.map((r: { id: string; status: string; sentAt: Date | null }) => [r.id, r])
  );
  const updated = new Map<string, T>();
  for (const run of stale) {
    const msgs = (run.outboxMessageIds ?? []).map((id) => byId.get(id)).filter(Boolean) as Array<{
      status: string;
      sentAt: Date | null;
    }>;
    if (msgs.length && msgs.every((m) => m.status === "sent" || m.status === "delivered")) {
      const row = await updateRun(run.companyId, run.id, {
        status: "sent",
        sentAt: msgs[0].sentAt ?? new Date(),
        errorMessage: null,
        blockedReason: null,
        retryScheduledAt: null,
      });
      updated.set(run.id, row as T);
    } else if (
      run.retryScheduledAt &&
      msgs.every((m) => m.status === "dead" || m.status === "sent")
    ) {
      const row = await updateRun(run.companyId, run.id, { retryScheduledAt: null });
      updated.set(run.id, row as T);
    }
  }
  return runs.map((r) => updated.get(r.id) ?? r);
}

/** A manual retry supersedes the previous run's pending outbox messages (no double send). */
export async function cancelPendingRunEmails(run: CompanyReportDeliveryRun): Promise<void> {
  const ids = run.outboxMessageIds ?? [];
  if (!ids.length) return;
  await db
    .update(emailOutbox)
    .set({
      status: "cancelled",
      lastError: "Superseded by a manual report delivery retry",
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(emailOutbox.id, ids),
        inArray(emailOutbox.status, ["queued", "retrying", "blocked_no_provider"])
      )
    );
}

export async function listRunArtifacts(
  companyId: string,
  runId: string
): Promise<Array<Omit<CompanyReportDeliveryArtifact, "content" | "storageKey">>> {
  return db
    .select({
      id: companyReportDeliveryArtifacts.id,
      companyId: companyReportDeliveryArtifacts.companyId,
      runId: companyReportDeliveryArtifacts.runId,
      kind: companyReportDeliveryArtifacts.kind,
      filename: companyReportDeliveryArtifacts.filename,
      contentType: companyReportDeliveryArtifacts.contentType,
      sizeBytes: companyReportDeliveryArtifacts.sizeBytes,
      sha256: companyReportDeliveryArtifacts.sha256,
      createdAt: companyReportDeliveryArtifacts.createdAt,
    })
    .from(companyReportDeliveryArtifacts)
    .where(
      and(
        eq(companyReportDeliveryArtifacts.companyId, companyId),
        eq(companyReportDeliveryArtifacts.runId, runId)
      )
    );
}

export async function getRunArtifact(
  companyId: string,
  runId: string,
  artifactId: string
): Promise<(CompanyReportDeliveryArtifact & { content: Buffer }) | undefined> {
  const [row] = await db
    .select()
    .from(companyReportDeliveryArtifacts)
    .where(
      and(
        eq(companyReportDeliveryArtifacts.companyId, companyId),
        eq(companyReportDeliveryArtifacts.runId, runId),
        eq(companyReportDeliveryArtifacts.id, artifactId)
      )
    )
    .limit(1);
  if (!row) return undefined;
  const artifact = row as CompanyReportDeliveryArtifact;
  if (artifact.storageKey) {
    const stored = await getObject(artifact.storageKey);
    if (!stored) {
      throw new DomainError(
        "ARTIFACT_STORAGE_UNAVAILABLE",
        503,
        { storageKey: artifact.storageKey },
        "The report file could not be read from file storage."
      );
    }
    if (crypto.createHash("sha256").update(stored.buffer).digest("hex") !== artifact.sha256) {
      throw new DomainError(
        "ARTIFACT_INTEGRITY_FAILED",
        409,
        undefined,
        "The stored report file does not match its checksum."
      );
    }
    return { ...artifact, content: stored.buffer };
  }
  const content = artifact.content;
  return { ...artifact, content: Buffer.isBuffer(content) ? content : Buffer.from(content ?? []) };
}
