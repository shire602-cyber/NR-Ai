/**
 * Payment Chasing Autopilot — pure logic.
 *
 * The service exposes pure functions (aging, escalation, template rendering,
 * grouping, eligibility) so they can be unit-tested without a database. The
 * routes layer wires these into storage calls.
 *
 * Design notes:
 *  - Escalation level is computed from days overdue, but we never *downgrade*
 *    a chase. Once an invoice has reached level 3 we will not send a level 1
 *    reminder again even if the user adjusts the due date — that would feel
 *    inconsistent to the recipient.
 *  - Outstanding amount = total - paidAmount. We compute paidAmount from the
 *    invoice_payments rows passed in, not from any cached field, so partial
 *    payments are reflected immediately.
 *  - "Days overdue" uses calendar days (UTC midnight) so we don't get the
 *    classic "47.9 days" off-by-one when the server runs at 00:30 UAE time.
 */

export type ChaseLevel = 1 | 2 | 3 | 4;
export type ChaseLanguage = 'en' | 'ar';
export type ChaseMethod = 'whatsapp' | 'email' | 'manual';

export interface ChaseInvoice {
  id: string;
  number: string;
  customerName: string;
  currency: string;
  total: number;
  dueDate: Date | string | null;
  status: string; // draft | sent | paid | partial | void
  contactId?: string | null;
  chaseLevel?: number;
  lastChasedAt?: Date | string | null;
  doNotChase?: boolean;
}

export interface ChasePayment {
  invoiceId: string;
  amount: number;
}

export interface ChaseContact {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
}

export interface ChaseAgingRow {
  invoice: ChaseInvoice;
  paidAmount: number;
  outstanding: number;
  daysOverdue: number;
  bucket: AgingBucket;
  recommendedLevel: ChaseLevel;
}

export type AgingBucket = 'current' | '1-7' | '8-30' | '31-60' | '60+';

export interface RenderContext {
  customerName: string;
  invoiceNumber: string;
  amount: string; // pre-formatted
  currency: string;
  dueDate: string; // pre-formatted (YYYY-MM-DD)
  daysOverdue: number;
  paymentLink: string;
  senderName: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

// Spec: L1 = 1-7, L2 = 8-30, L3 = 31-60, L4 = 60+ (i.e. ≥61).
const LEVEL_THRESHOLDS: Array<{ minDays: number; level: ChaseLevel }> = [
  { minDays: 61, level: 4 },
  { minDays: 31, level: 3 },
  { minDays: 8, level: 2 },
  { minDays: 1, level: 1 },
];

const TERMINAL_INVOICE_STATUSES = new Set(['paid', 'void', 'cancelled']);

// ─── Aging ───────────────────────────────────────────────────────────────────

/** UTC-midnight days between two dates. Negative result = future. */
export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.floor((b - a) / 86_400_000);
}

export function calculateDaysOverdue(dueDate: Date | string | null, now: Date = new Date()): number {
  if (!dueDate) return 0;
  const due = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
  if (Number.isNaN(due.getTime())) return 0;
  const diff = daysBetween(due, now);
  return diff > 0 ? diff : 0;
}

export function bucketFor(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 7) return '1-7';
  if (daysOverdue <= 30) return '8-30';
  if (daysOverdue <= 60) return '31-60';
  return '60+';
}

export function recommendedLevelFor(daysOverdue: number): ChaseLevel {
  for (const t of LEVEL_THRESHOLDS) {
    if (daysOverdue >= t.minDays) return t.level;
  }
  return 1;
}

/**
 * Compute outstanding amount (total - sum of payments). Clamped at zero so
 * over-applied payments don't produce negative chasing amounts.
 */
export function outstandingFor(invoice: ChaseInvoice, payments: ChasePayment[]): number {
  const paid = payments
    .filter(p => p.invoiceId === invoice.id)
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const outstanding = Math.max(0, (Number(invoice.total) || 0) - paid);
  return Math.round(outstanding * 100) / 100;
}

export function buildAgingRow(
  invoice: ChaseInvoice,
  payments: ChasePayment[],
  now: Date = new Date(),
): ChaseAgingRow {
  const paidAmount = (Number(invoice.total) || 0) - outstandingFor(invoice, payments);
  const outstanding = outstandingFor(invoice, payments);
  const daysOverdue = calculateDaysOverdue(invoice.dueDate, now);
  return {
    invoice,
    paidAmount: Math.round(paidAmount * 100) / 100,
    outstanding,
    daysOverdue,
    bucket: bucketFor(daysOverdue),
    recommendedLevel: recommendedLevelFor(daysOverdue),
  };
}

/**
 * Filter to invoices that should appear in the chasing dashboard. An invoice
 * is "overdue and chaseable" when:
 *   - status is sent or partial (not draft, paid, void)
 *   - dueDate is in the past
 *   - outstanding > 0
 *   - doNotChase is not set
 */
export function isOverdueAndChaseable(row: ChaseAgingRow): boolean {
  const inv = row.invoice;
  if (TERMINAL_INVOICE_STATUSES.has(inv.status)) return false;
  if (inv.status === 'draft') return false;
  if (inv.doNotChase) return false;
  if (row.outstanding <= 0) return false;
  if (row.daysOverdue <= 0) return false;
  return true;
}

// ─── Escalation logic ────────────────────────────────────────────────────────

/**
 * Determine the next chase level to send for an invoice. Returns null when
 * no chase should be sent (already paid, do-not-chase, or already at max).
 *
 * Rules:
 *  1. Invoice status / outstanding gate: reuse isOverdueAndChaseable
 *  2. Level monotonically non-decreasing: nextLevel = max(currentLevel, recommendedLevel + 1 if currentLevel >= recommendedLevel else recommendedLevel)
 *     ↳ in other words: if currentLevel is already at/above recommended,
 *       escalate by one. Otherwise jump to the recommended level.
 *  3. Capped at config.maxLevel (default 4).
 */
export function nextLevelFor(
  row: ChaseAgingRow,
  opts: { maxLevel?: number } = {},
): ChaseLevel | null {
  if (!isOverdueAndChaseable(row)) return null;
  const max = Math.min(4, Math.max(1, opts.maxLevel ?? 4)) as ChaseLevel;
  const currentLevel = (row.invoice.chaseLevel ?? 0) as 0 | ChaseLevel;
  const recommended = row.recommendedLevel;

  let next: number;
  if (currentLevel === 0) {
    next = recommended;
  } else if (currentLevel < recommended) {
    next = recommended;
  } else {
    next = currentLevel + 1;
  }

  if (next > max) return null;
  return Math.min(4, Math.max(1, next)) as ChaseLevel;
}

/**
 * Frequency throttle. Returns true when the invoice has *not* been chased
 * recently — i.e. it is eligible for another chase right now.
 */
export function isFrequencyEligible(
  lastChasedAt: Date | string | null | undefined,
  frequencyDays: number,
  now: Date = new Date(),
): boolean {
  if (!lastChasedAt) return true;
  const last = typeof lastChasedAt === 'string' ? new Date(lastChasedAt) : lastChasedAt;
  if (Number.isNaN(last.getTime())) return true;
  const elapsed = daysBetween(last, now);
  return elapsed >= Math.max(0, frequencyDays);
}

// ─── Template rendering ──────────────────────────────────────────────────────

/**
 * Replace {placeholder} tokens with values. Unknown tokens are left intact
 * (so a typo in a custom template is visible rather than rendering to "").
 */
export function renderTemplate(body: string, ctx: Record<string, string | number>): string {
  return body.replace(/\{(\w+)\}/g, (_match, key) => {
    const v = ctx[key];
    return v === undefined || v === null ? `{${key}}` : String(v);
  });
}

/** Build the standard render context for a single-invoice chase. */
export function contextForInvoice(
  row: ChaseAgingRow,
  contact: ChaseContact | null,
  opts: { senderName: string; paymentLink: string; locale?: ChaseLanguage },
): RenderContext {
  const inv = row.invoice;
  const customerName = contact?.name?.trim() || inv.customerName || 'Customer';
  const due = inv.dueDate ? new Date(inv.dueDate) : null;
  const dueStr = due && !Number.isNaN(due.getTime()) ? due.toISOString().slice(0, 10) : '—';
  return {
    customerName,
    invoiceNumber: inv.number,
    amount: row.outstanding.toFixed(2),
    currency: inv.currency,
    dueDate: dueStr,
    daysOverdue: row.daysOverdue,
    paymentLink: opts.paymentLink,
    senderName: opts.senderName,
  };
}

// ─── Smart grouping ──────────────────────────────────────────────────────────

export interface ChaseGroup {
  contactId: string | null;
  customerName: string;
  rows: ChaseAgingRow[];
  totalOutstanding: number;
  currency: string;
  recommendedLevel: ChaseLevel;
}

/**
 * Group eligible chases by contactId (falling back to customerName) so that a
 * single client with five overdue invoices gets one combined message instead
 * of five. Groups inherit the *highest* recommended level among their rows.
 */
export function groupByClient(rows: ChaseAgingRow[]): ChaseGroup[] {
  const map = new Map<string, ChaseGroup>();
  for (const row of rows) {
    const key = row.invoice.contactId ?? `name:${row.invoice.customerName.trim().toLowerCase()}`;
    const g = map.get(key);
    if (g) {
      g.rows.push(row);
      g.totalOutstanding = Math.round((g.totalOutstanding + row.outstanding) * 100) / 100;
      if (row.recommendedLevel > g.recommendedLevel) g.recommendedLevel = row.recommendedLevel;
    } else {
      map.set(key, {
        contactId: row.invoice.contactId ?? null,
        customerName: row.invoice.customerName,
        rows: [row],
        totalOutstanding: row.outstanding,
        currency: row.invoice.currency,
        recommendedLevel: row.recommendedLevel,
      });
    }
  }
  // Stable sort: highest level first, then largest outstanding.
  return Array.from(map.values()).sort((a, b) => {
    if (b.recommendedLevel !== a.recommendedLevel) return b.recommendedLevel - a.recommendedLevel;
    return b.totalOutstanding - a.totalOutstanding;
  });
}

/**
 * Build a combined chase body for a group of invoices. We render the level-N
 * template once with summary fields, then append a bullet list of invoices.
 */
export function renderGroupedMessage(
  group: ChaseGroup,
  template: { body: string; subject?: string | null },
  opts: { senderName: string; paymentLink: string },
): { subject: string | null; body: string } {
  const ctx = {
    customerName: group.customerName,
    invoiceNumber: group.rows.length === 1
      ? group.rows[0].invoice.number
      : `${group.rows.length} invoices`,
    amount: group.totalOutstanding.toFixed(2),
    currency: group.currency,
    dueDate: '—',
    daysOverdue: Math.max(...group.rows.map(r => r.daysOverdue)),
    paymentLink: opts.paymentLink,
    senderName: opts.senderName,
  };
  let body = renderTemplate(template.body, ctx);
  if (group.rows.length > 1) {
    const lines = group.rows
      .sort((a, b) => b.daysOverdue - a.daysOverdue)
      .map(r => `  • ${r.invoice.number} — ${r.invoice.currency} ${r.outstanding.toFixed(2)} (${r.daysOverdue} days overdue)`)
      .join('\n');
    body += `\n\nOutstanding invoices:\n${lines}`;
  }
  const subject = template.subject ? renderTemplate(template.subject, ctx) : null;
  return { subject, body };
}

// ─── Effectiveness ───────────────────────────────────────────────────────────

export interface EffectivenessStats {
  totalChases: number;
  uniqueInvoices: number;
  paidAfterChase: number;
  paidWithin7: number;
  paidWithin14: number;
  paidWithin30: number;
  conversionRate: number; // 0..1
  avgDaysToPayment: number | null;
  byLevel: Record<ChaseLevel, { sent: number; paid: number }>;
}

interface EffectivenessChase {
  invoiceId: string;
  level: number;
  sentAt: Date | string;
  paidAt?: Date | string | null;
}

/**
 * Compute aggregate chase-effectiveness metrics. We dedupe per invoice using
 * its *first* chase as the "start of the funnel" — any subsequent chase
 * counts toward the by-level breakdown but not the unique-invoice count.
 */
export function computeEffectiveness(chases: EffectivenessChase[]): EffectivenessStats {
  const byLevel: Record<ChaseLevel, { sent: number; paid: number }> = {
    1: { sent: 0, paid: 0 },
    2: { sent: 0, paid: 0 },
    3: { sent: 0, paid: 0 },
    4: { sent: 0, paid: 0 },
  };
  const firstByInvoice = new Map<string, EffectivenessChase>();
  for (const c of chases) {
    const lvl = (c.level >= 1 && c.level <= 4) ? c.level as ChaseLevel : 1;
    byLevel[lvl].sent += 1;
    if (c.paidAt) byLevel[lvl].paid += 1;
    const existing = firstByInvoice.get(c.invoiceId);
    const sent = typeof c.sentAt === 'string' ? new Date(c.sentAt) : c.sentAt;
    if (!existing || (typeof existing.sentAt === 'string' ? new Date(existing.sentAt) : existing.sentAt) > sent) {
      firstByInvoice.set(c.invoiceId, c);
    }
  }
  let paidAfterChase = 0;
  let paidWithin7 = 0;
  let paidWithin14 = 0;
  let paidWithin30 = 0;
  let daysSum = 0;
  let daysCount = 0;
  for (const c of firstByInvoice.values()) {
    if (!c.paidAt) continue;
    paidAfterChase += 1;
    const sent = typeof c.sentAt === 'string' ? new Date(c.sentAt) : c.sentAt;
    const paid = typeof c.paidAt === 'string' ? new Date(c.paidAt) : c.paidAt;
    const days = daysBetween(sent, paid);
    if (days >= 0) {
      daysSum += days;
      daysCount += 1;
      if (days <= 7) paidWithin7 += 1;
      if (days <= 14) paidWithin14 += 1;
      if (days <= 30) paidWithin30 += 1;
    }
  }
  const uniqueInvoices = firstByInvoice.size;
  return {
    totalChases: chases.length,
    uniqueInvoices,
    paidAfterChase,
    paidWithin7,
    paidWithin14,
    paidWithin30,
    conversionRate: uniqueInvoices === 0 ? 0 : paidAfterChase / uniqueInvoices,
    avgDaysToPayment: daysCount === 0 ? null : Math.round((daysSum / daysCount) * 10) / 10,
    byLevel,
  };
}

// ─── WhatsApp deep-link helpers ──────────────────────────────────────────────

const UAE_DIAL_CODE = '971';

/**
 * Normalize a phone number to E.164 digits (no plus) for wa.me. UAE numbers
 * are commonly entered in three forms — all of which should reach the same
 * destination:
 *   - "+971 50 123 4567" / "971501234567"  → already country-coded
 *   - "0501234567" (UAE local trunk format) → strip the trunk 0, prepend 971
 *   - "00971501234567" (00 international prefix) → drop the 00
 *
 * We only auto-prepend 971 when the input starts with a single leading 0,
 * which is the unambiguous UAE local convention. Foreign numbers should be
 * stored with their own country code; we don't guess.
 *
 * Empty / non-digit input → empty string.
 */
export function normalizePhoneForWa(phone: string | null | undefined): string {
  if (!phone) return '';
  let digits = phone.replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0')) {
    digits = UAE_DIAL_CODE + digits.slice(1);
  }
  return digits;
}

export function buildWaMeLink(phone: string | null | undefined, message: string): string | null {
  const digits = normalizePhoneForWa(phone);
  if (!digits) return null;
  // wa.me caps the URL at ~2k chars in practice; we don't truncate here so
  // the caller can decide how to handle very long bodies.
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
