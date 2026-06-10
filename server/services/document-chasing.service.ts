// Phase 5: Document Chasing Autopilot service.
//
// This service handles the lifecycle of document requirements (what each
// client owes the firm) and the escalating chase pipeline used to collect
// them. The pure functions at the top of the file have no DB dependencies
// so they can be unit-tested in isolation; the DB-bound helpers at the
// bottom drive the routes layer.

import { and, asc, desc, eq, gte, lte, ne, sql } from 'drizzle-orm';
import { db } from '../db';
import {
  documentRequirements,
  documentChases,
  complianceCalendar,
  type DocumentRequirement,
  type DocumentChase,
  type ComplianceEvent,
  type DocumentType,
  type ChaseLevel,
  type ChaseChannel,
  type ComplianceEventType,
  CHASE_LEVELS,
} from '@shared/schema';

// ──────────────────────────────────────────────────────────────────────
// Pure logic (no DB) — exercised by tests/unit/document-chasing.test.ts
// ──────────────────────────────────────────────────────────────────────

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// Default reminder offsets in days before an event.
export const DEFAULT_REMINDER_DAYS = [30, 14, 7, 0] as const;

// Hard escalation thresholds: a requirement that is N days past due gets
// pushed to at least level X. Picking from the bottom means a single
// "gentle" send 60 days after the due date still escalates to "final".
const ESCALATION_THRESHOLDS: Array<{ daysOverdue: number; level: ChaseLevel }> = [
  { daysOverdue: 60, level: 'final' },
  { daysOverdue: 30, level: 'urgent' },
  { daysOverdue: 14, level: 'follow_up' },
  { daysOverdue: 0, level: 'friendly' },
];

export function daysBetween(a: Date, b: Date): number {
  const start = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const end = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((end - start) / MS_PER_DAY);
}

export function daysUntil(target: Date | string, now: Date = new Date()): number {
  return daysBetween(now, new Date(target));
}

// Detect missing documents from a set of required + uploaded items.
// "Missing" = not yet received and the due date is in the past or any
// status that the firm wants to chase (pending, requested, overdue).
export function detectMissingDocuments(
  requirements: Array<Pick<DocumentRequirement, 'id' | 'status' | 'dueDate' | 'documentType' | 'receivedAt'>>,
  now: Date = new Date(),
): Array<{ id: string; documentType: string; dueDate: Date; daysOverdue: number; isOverdue: boolean }> {
  const out: Array<{ id: string; documentType: string; dueDate: Date; daysOverdue: number; isOverdue: boolean }> = [];
  for (const r of requirements) {
    if (r.status === 'received' || r.status === 'waived' || r.receivedAt) continue;
    const due = new Date(r.dueDate);
    const overdueDays = daysBetween(due, now);
    out.push({
      id: r.id,
      documentType: r.documentType,
      dueDate: due,
      daysOverdue: overdueDays > 0 ? overdueDays : 0,
      isOverdue: overdueDays > 0,
    });
  }
  return out;
}

// Given the current level and recent send history, return the next level
// to send. The escalation also takes into account how overdue the doc is —
// a long-overdue requirement skips ahead even if no chases have been sent.
export function nextChaseLevel(
  previousLevel: ChaseLevel | null,
  daysOverdue: number,
): ChaseLevel {
  // Always honor the time-based floor first.
  let floor: ChaseLevel = 'friendly';
  for (const t of ESCALATION_THRESHOLDS) {
    if (daysOverdue >= t.daysOverdue) { floor = t.level; break; }
  }
  if (previousLevel === null) return floor;
  const idxPrev = CHASE_LEVELS.indexOf(previousLevel);
  const idxFloor = CHASE_LEVELS.indexOf(floor);
  // Take the higher of "previous + 1" and the time-based floor, capped at final.
  const next = Math.min(CHASE_LEVELS.length - 1, Math.max(idxPrev + 1, idxFloor));
  return CHASE_LEVELS[next];
}

// Determine which reminder offsets are due to fire now. A 30/14/7/0 schedule
// against a due date in T days returns the offsets that are <= T but were
// not yet "passed" — i.e. T <= offset.
export function dueReminderOffsets(
  daysUntilDue: number,
  reminderDays: readonly number[] = DEFAULT_REMINDER_DAYS,
): number[] {
  // A reminder for offset O fires when daysUntilDue <= O. We return all
  // offsets that have been reached.
  return [...reminderDays].sort((a, b) => b - a).filter((d) => daysUntilDue <= d);
}

export function parseReminderDays(s: string | null | undefined): number[] {
  if (!s) return [...DEFAULT_REMINDER_DAYS];
  const out: number[] = [];
  for (const part of s.split(',')) {
    const n = Number(part.trim());
    if (Number.isFinite(n) && n >= 0) out.push(n);
  }
  return out.length > 0 ? out : [...DEFAULT_REMINDER_DAYS];
}

export function serializeReminderDays(days: readonly number[]): string {
  return [...days].sort((a, b) => b - a).join(',');
}

// Decide whether we should chase a requirement right now. The caller passes
// the most recent chase (if any) and the schedule from the linked compliance
// event. We chase when: (a) a reminder offset just became due, AND (b) we
// have not yet sent at that offset.
export function shouldChaseNow(
  requirement: { dueDate: Date | string; status: string; receivedAt: Date | string | null },
  lastChase: { sentAt: Date | string; chaseLevel: ChaseLevel } | null,
  reminderDays: readonly number[] = DEFAULT_REMINDER_DAYS,
  now: Date = new Date(),
): boolean {
  if (requirement.status === 'received' || requirement.status === 'waived' || requirement.receivedAt) return false;
  const dUntil = daysUntil(requirement.dueDate, now);
  const dueOffsets = dueReminderOffsets(dUntil, reminderDays);
  if (dueOffsets.length === 0) return false;
  if (!lastChase) return true;
  // Don't re-send within 24h of the last chase regardless of offset.
  const sinceLast = daysBetween(new Date(lastChase.sentAt), now);
  return sinceLast >= 1;
}

// Render a friendly WhatsApp/email body. Templates live here so the
// service can ship a sane default; firms can override per-channel later.
export function renderChaseMessage(
  level: ChaseLevel,
  documentType: DocumentType | string,
  dueDate: Date | string,
  companyName: string,
  daysOverdue: number,
): string {
  const due = new Date(dueDate).toISOString().slice(0, 10);
  const human = humanizeDocumentType(documentType);
  switch (level) {
    case 'friendly':
      return [
        `Hi ${companyName},`,
        ``,
        `A quick reminder that we still need your ${human} for our records (due ${due}).`,
        `Could you upload it whenever convenient? Reply here if you have any questions.`,
        ``,
        `— Muhasib.ai`,
      ].join('\n');
    case 'follow_up':
      return [
        `Hi ${companyName},`,
        ``,
        `Following up on your ${human} — it was due ${due} (${daysOverdue} days ago).`,
        `Please upload it at your earliest convenience so we can keep your books current.`,
        ``,
        `— Muhasib.ai`,
      ].join('\n');
    case 'urgent':
      return [
        `Hi ${companyName},`,
        ``,
        `Your ${human} is now ${daysOverdue} days overdue (was due ${due}).`,
        `Please upload it within the next 48 hours so we can stay ahead of any FTA filing risk.`,
        ``,
        `— Muhasib.ai`,
      ].join('\n');
    case 'final':
      return [
        `Hi ${companyName},`,
        ``,
        `Final notice: your ${human} has been outstanding for ${daysOverdue} days (due ${due}).`,
        `If we do not receive it in the next 24 hours, your account will be flagged as non-compliant and we will need to pause certain services.`,
        ``,
        `— Muhasib.ai`,
      ].join('\n');
  }
}

export function humanizeDocumentType(t: string): string {
  return t.replace(/_/g, ' ');
}

// wa.me deep link. Accepts any phone format; strips non-digits. Returns null
// if the phone is empty so the caller can fall back to email.
export function whatsappDeepLink(phone: string | null | undefined, message: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return null;
  const encoded = encodeURIComponent(message);
  return `https://wa.me/${digits}?text=${encoded}`;
}

// Compliance calendar deadline calc: returns the next event within `windowDays`.
export function upcomingDeadlines(
  events: Array<Pick<ComplianceEvent, 'id' | 'eventDate' | 'eventType' | 'description' | 'status' | 'reminderDays'>>,
  windowDays: number,
  now: Date = new Date(),
): Array<{
  id: string;
  eventType: string;
  description: string;
  eventDate: Date;
  daysUntil: number;
  isOverdue: boolean;
  reminderActive: boolean;
}> {
  const out = [];
  for (const e of events) {
    if (e.status === 'completed' || e.status === 'dismissed') continue;
    const dUntil = daysUntil(e.eventDate, now);
    if (dUntil > windowDays) continue;
    const reminderDays = parseReminderDays(e.reminderDays);
    const reminderActive = dueReminderOffsets(dUntil, reminderDays).length > 0;
    out.push({
      id: e.id,
      eventType: e.eventType,
      description: e.description,
      eventDate: new Date(e.eventDate),
      daysUntil: dUntil,
      isOverdue: dUntil < 0,
      reminderActive,
    });
  }
  return out.sort((a, b) => a.daysUntil - b.daysUntil);
}

// Compute response rate / avg time-to-upload from a chase + requirement set.
export function computeEffectiveness(
  requirements: Array<Pick<DocumentRequirement, 'id' | 'status' | 'createdAt' | 'receivedAt'>>,
  chases: Array<Pick<DocumentChase, 'requirementId' | 'sentAt' | 'responseReceived'>>,
): { totalChased: number; totalReceived: number; responseRate: number; avgDaysToUpload: number | null } {
  // Pre-group chases by requirementId in one O(N) pass so per-requirement
  // lookups are O(1) instead of an O(N*M) inner filter.
  const earliestSentByReq = new Map<string, number>();
  for (const c of chases) {
    const ts = new Date(c.sentAt).getTime();
    const existing = earliestSentByReq.get(c.requirementId);
    if (existing === undefined || ts < existing) earliestSentByReq.set(c.requirementId, ts);
  }
  const totalChased = earliestSentByReq.size;
  let totalReceived = 0;
  const uploadDelaysDays: number[] = [];
  for (const r of requirements) {
    const sent = earliestSentByReq.get(r.id);
    if (sent === undefined) continue;
    if (r.status === 'received' && r.receivedAt) {
      totalReceived++;
      const recv = new Date(r.receivedAt).getTime();
      uploadDelaysDays.push(Math.max(0, (recv - sent) / MS_PER_DAY));
    }
  }
  const responseRate = totalChased === 0 ? 0 : totalReceived / totalChased;
  const avgDaysToUpload =
    uploadDelaysDays.length === 0 ? null : uploadDelaysDays.reduce((a, b) => a + b, 0) / uploadDelaysDays.length;
  return { totalChased, totalReceived, responseRate, avgDaysToUpload };
}

// ──────────────────────────────────────────────────────────────────────
// DB-bound helpers — used by routes layer.
// All queries are companyId-scoped to enforce tenancy.
// ──────────────────────────────────────────────────────────────────────

export async function listRequirements(companyId: string): Promise<DocumentRequirement[]> {
  return await db.select().from(documentRequirements)
    .where(eq(documentRequirements.companyId, companyId))
    .orderBy(asc(documentRequirements.dueDate));
}

export async function getRequirement(companyId: string, id: string): Promise<DocumentRequirement | undefined> {
  const [row] = await db.select().from(documentRequirements)
    .where(and(eq(documentRequirements.companyId, companyId), eq(documentRequirements.id, id)));
  return row;
}

export async function createRequirement(input: {
  companyId: string;
  documentType: string;
  description?: string | null;
  dueDate: Date | string;
  isRecurring?: boolean;
  recurringIntervalDays?: number | null;
  notes?: string | null;
}): Promise<DocumentRequirement> {
  const [row] = await db.insert(documentRequirements).values({
    companyId: input.companyId,
    documentType: input.documentType,
    description: input.description ?? null,
    dueDate: new Date(input.dueDate),
    isRecurring: input.isRecurring ?? false,
    recurringIntervalDays: input.recurringIntervalDays ?? null,
    notes: input.notes ?? null,
    status: 'pending',
  }).returning();
  return row;
}

export async function updateRequirement(
  companyId: string,
  id: string,
  patch: Partial<{
    documentType: string;
    description: string | null;
    dueDate: Date | string;
    isRecurring: boolean;
    recurringIntervalDays: number | null;
    status: string;
    receivedAt: Date | null;
    uploadedDocumentId: string | null;
    notes: string | null;
  }>,
): Promise<DocumentRequirement | undefined> {
  const setClause: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.documentType !== undefined) setClause.documentType = patch.documentType;
  if (patch.description !== undefined) setClause.description = patch.description;
  if (patch.dueDate !== undefined) setClause.dueDate = new Date(patch.dueDate);
  if (patch.isRecurring !== undefined) setClause.isRecurring = patch.isRecurring;
  if (patch.recurringIntervalDays !== undefined) setClause.recurringIntervalDays = patch.recurringIntervalDays;
  if (patch.status !== undefined) setClause.status = patch.status;
  if (patch.receivedAt !== undefined) setClause.receivedAt = patch.receivedAt;
  if (patch.uploadedDocumentId !== undefined) setClause.uploadedDocumentId = patch.uploadedDocumentId;
  if (patch.notes !== undefined) setClause.notes = patch.notes;
  const [row] = await db.update(documentRequirements)
    .set(setClause)
    .where(and(eq(documentRequirements.companyId, companyId), eq(documentRequirements.id, id)))
    .returning();
  return row;
}

// Mark a requirement as received and (when it is recurring) auto-create the
// next instance one interval forward. Returns both rows so the caller can
// surface the new requirement in UI.
//
// Wrapped in a transaction with a status-guarded UPDATE to prevent two
// concurrent calls from both spawning a next occurrence: the second call's
// UPDATE returns no rows because the first has already flipped status to
// 'received', so it short-circuits before the recurring INSERT.
export async function markRequirementReceived(
  companyId: string,
  id: string,
  uploadedDocumentId: string | null = null,
): Promise<{ updated: DocumentRequirement | undefined; nextOccurrence: DocumentRequirement | null }> {
  return await db.transaction(async (tx: typeof db) => {
    const [existing] = await tx
      .select()
      .from(documentRequirements)
      .where(and(eq(documentRequirements.companyId, companyId), eq(documentRequirements.id, id)));
    if (!existing) return { updated: undefined, nextOccurrence: null };

    // Guard against a concurrent receive: only flip rows that are not already
    // received/waived. If the row is already received, return it as-is and
    // skip the recurring next-occurrence creation entirely.
    const [updated] = await tx
      .update(documentRequirements)
      .set({
        status: 'received',
        receivedAt: new Date(),
        uploadedDocumentId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(documentRequirements.companyId, companyId),
          eq(documentRequirements.id, id),
          ne(documentRequirements.status, 'received'),
          ne(documentRequirements.status, 'waived'),
        ),
      )
      .returning();

    if (!updated) {
      return { updated: existing, nextOccurrence: null };
    }

    let nextOccurrence: DocumentRequirement | null = null;
    if (existing.isRecurring && existing.recurringIntervalDays && existing.recurringIntervalDays > 0) {
      const nextDue = new Date(existing.dueDate);
      nextDue.setUTCDate(nextDue.getUTCDate() + existing.recurringIntervalDays);
      const [created] = await tx
        .insert(documentRequirements)
        .values({
          companyId,
          documentType: existing.documentType,
          description: existing.description,
          dueDate: nextDue,
          isRecurring: true,
          recurringIntervalDays: existing.recurringIntervalDays,
          notes: existing.notes,
          status: 'pending',
        })
        .returning();
      nextOccurrence = created ?? null;
    }
    return { updated, nextOccurrence };
  });
}

export async function listChasesForRequirement(
  companyId: string,
  requirementId: string,
): Promise<DocumentChase[]> {
  return await db.select().from(documentChases)
    .where(and(eq(documentChases.companyId, companyId), eq(documentChases.requirementId, requirementId)))
    .orderBy(desc(documentChases.sentAt));
}

export async function listAllChases(companyId: string): Promise<DocumentChase[]> {
  return await db.select().from(documentChases)
    .where(eq(documentChases.companyId, companyId))
    .orderBy(desc(documentChases.sentAt));
}

// Build the queue of requirements that should be chased now, with the
// already-computed next level and rendered message. Routes layer turns
// these into wa.me links / sends.
export async function buildChaseQueue(
  companyId: string,
  companyName: string,
  recipient: { phone: string | null; email: string | null },
  now: Date = new Date(),
): Promise<Array<{
  requirement: DocumentRequirement;
  nextLevel: ChaseLevel;
  message: string;
  whatsappLink: string | null;
  daysOverdue: number;
}>> {
  const reqs = await listRequirements(companyId);
  const allChases = await listAllChases(companyId);
  const lastByReq = new Map<string, DocumentChase>();
  for (const c of allChases) {
    const existing = lastByReq.get(c.requirementId);
    if (!existing || new Date(c.sentAt) > new Date(existing.sentAt)) lastByReq.set(c.requirementId, c);
  }
  const out: Array<{
    requirement: DocumentRequirement;
    nextLevel: ChaseLevel;
    message: string;
    whatsappLink: string | null;
    daysOverdue: number;
  }> = [];
  for (const r of reqs) {
    if (r.status === 'received' || r.status === 'waived' || r.receivedAt) continue;
    const last = lastByReq.get(r.id) ?? null;
    if (!shouldChaseNow(
      { dueDate: r.dueDate, status: r.status, receivedAt: r.receivedAt },
      last ? { sentAt: last.sentAt, chaseLevel: last.chaseLevel as ChaseLevel } : null,
      DEFAULT_REMINDER_DAYS,
      now,
    )) continue;
    const dUntil = daysUntil(r.dueDate, now);
    const overdue = dUntil < 0 ? -dUntil : 0;
    const nextLevel = nextChaseLevel(last ? (last.chaseLevel as ChaseLevel) : null, overdue);
    const message = renderChaseMessage(nextLevel, r.documentType, r.dueDate, companyName, overdue);
    out.push({
      requirement: r,
      nextLevel,
      message,
      whatsappLink: whatsappDeepLink(recipient.phone, message),
      daysOverdue: overdue,
    });
  }
  return out;
}

export async function recordChaseSend(input: {
  companyId: string;
  requirementId: string;
  chaseLevel: ChaseLevel;
  sentVia: ChaseChannel;
  messageContent: string;
  recipientPhone?: string | null;
  recipientEmail?: string | null;
}): Promise<DocumentChase> {
  const [row] = await db.insert(documentChases).values({
    companyId: input.companyId,
    requirementId: input.requirementId,
    chaseLevel: input.chaseLevel,
    sentVia: input.sentVia,
    messageContent: input.messageContent,
    recipientPhone: input.recipientPhone ?? null,
    recipientEmail: input.recipientEmail ?? null,
  }).returning();
  // Bump the requirement to "requested" so it shows up in the right column.
  await db.update(documentRequirements)
    .set({ status: sql`CASE WHEN status = 'received' OR status = 'waived' THEN status ELSE 'requested' END`, updatedAt: new Date() })
    .where(and(
      eq(documentRequirements.companyId, input.companyId),
      eq(documentRequirements.id, input.requirementId),
    ));
  return row;
}

export async function listComplianceEvents(
  companyId: string,
  opts: { from?: Date; to?: Date } = {},
): Promise<ComplianceEvent[]> {
  const conds = [eq(complianceCalendar.companyId, companyId)];
  if (opts.from) conds.push(gte(complianceCalendar.eventDate, opts.from));
  if (opts.to) conds.push(lte(complianceCalendar.eventDate, opts.to));
  return await db.select().from(complianceCalendar)
    .where(and(...conds))
    .orderBy(asc(complianceCalendar.eventDate));
}

export async function createComplianceEvent(input: {
  companyId: string;
  eventType: ComplianceEventType | string;
  description: string;
  eventDate: Date | string;
  reminderDays?: readonly number[];
  linkedRequirementId?: string | null;
}): Promise<ComplianceEvent> {
  const [row] = await db.insert(complianceCalendar).values({
    companyId: input.companyId,
    eventType: input.eventType,
    description: input.description,
    eventDate: new Date(input.eventDate),
    reminderDays: serializeReminderDays(input.reminderDays ?? DEFAULT_REMINDER_DAYS),
    linkedRequirementId: input.linkedRequirementId ?? null,
  }).returning();
  return row;
}

export async function effectivenessReport(companyId: string): Promise<{
  totalChased: number;
  totalReceived: number;
  responseRate: number;
  avgDaysToUpload: number | null;
}> {
  const [reqs, chases] = await Promise.all([
    listRequirements(companyId),
    listAllChases(companyId),
  ]);
  return computeEffectiveness(reqs, chases);
}
