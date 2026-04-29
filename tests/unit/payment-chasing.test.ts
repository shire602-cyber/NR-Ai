import { describe, it, expect } from 'vitest';
import {
  daysBetween,
  calculateDaysOverdue,
  bucketFor,
  recommendedLevelFor,
  outstandingFor,
  buildAgingRow,
  isOverdueAndChaseable,
  nextLevelFor,
  isFrequencyEligible,
  renderTemplate,
  contextForInvoice,
  groupByClient,
  renderGroupedMessage,
  computeEffectiveness,
  normalizePhoneForWa,
  buildWaMeLink,
  type ChaseInvoice,
  type ChasePayment,
  type ChaseAgingRow,
} from '../../server/services/payment-chasing.service';

const today = new Date('2026-04-29T10:00:00Z');

function inv(overrides: Partial<ChaseInvoice> = {}): ChaseInvoice {
  return {
    id: overrides.id ?? 'inv-1',
    number: overrides.number ?? 'INV-2026-00001',
    customerName: overrides.customerName ?? 'Acme LLC',
    currency: overrides.currency ?? 'AED',
    total: overrides.total ?? 1000,
    dueDate: overrides.dueDate ?? '2026-04-01T00:00:00Z',
    status: overrides.status ?? 'sent',
    contactId: overrides.contactId ?? 'contact-1',
    chaseLevel: overrides.chaseLevel ?? 0,
    lastChasedAt: overrides.lastChasedAt ?? null,
    doNotChase: overrides.doNotChase ?? false,
  };
}

describe('daysBetween & calculateDaysOverdue', () => {
  it('returns 0 when there is no due date', () => {
    expect(calculateDaysOverdue(null, today)).toBe(0);
  });

  it('returns 0 when due date is in the future', () => {
    expect(calculateDaysOverdue('2026-05-15', today)).toBe(0);
  });

  it('counts whole calendar days, not partial', () => {
    expect(calculateDaysOverdue('2026-04-28T23:59:59Z', today)).toBe(1);
  });

  it('floors negative day spans to zero', () => {
    expect(daysBetween(new Date('2026-04-30'), new Date('2026-04-29'))).toBe(-1);
  });
});

describe('bucketFor', () => {
  it('classifies aging buckets', () => {
    expect(bucketFor(0)).toBe('current');
    expect(bucketFor(1)).toBe('1-7');
    expect(bucketFor(7)).toBe('1-7');
    expect(bucketFor(8)).toBe('8-30');
    expect(bucketFor(30)).toBe('8-30');
    expect(bucketFor(31)).toBe('31-60');
    expect(bucketFor(60)).toBe('31-60');
    expect(bucketFor(61)).toBe('60+');
  });
});

describe('recommendedLevelFor', () => {
  it('escalates with days overdue', () => {
    expect(recommendedLevelFor(0)).toBe(1);
    expect(recommendedLevelFor(7)).toBe(1);
    expect(recommendedLevelFor(8)).toBe(2);
    expect(recommendedLevelFor(30)).toBe(2);
    expect(recommendedLevelFor(31)).toBe(3);
    expect(recommendedLevelFor(60)).toBe(3);
    expect(recommendedLevelFor(61)).toBe(4);
    expect(recommendedLevelFor(365)).toBe(4);
  });
});

describe('outstandingFor', () => {
  it('subtracts payments from total', () => {
    const i = inv({ total: 1000 });
    const payments: ChasePayment[] = [
      { invoiceId: 'inv-1', amount: 300 },
      { invoiceId: 'inv-1', amount: 200 },
      { invoiceId: 'other', amount: 999 }, // ignored
    ];
    expect(outstandingFor(i, payments)).toBe(500);
  });

  it('clamps over-applied payments at zero', () => {
    const i = inv({ total: 100 });
    expect(outstandingFor(i, [{ invoiceId: 'inv-1', amount: 200 }])).toBe(0);
  });
});

describe('buildAgingRow', () => {
  it('produces a complete aging row', () => {
    const row = buildAgingRow(inv({ dueDate: '2026-04-01' }), [], today);
    expect(row.daysOverdue).toBe(28);
    expect(row.bucket).toBe('8-30');
    expect(row.recommendedLevel).toBe(2);
    expect(row.outstanding).toBe(1000);
    expect(row.paidAmount).toBe(0);
  });
});

describe('isOverdueAndChaseable', () => {
  it('rejects paid invoices', () => {
    const row = buildAgingRow(inv({ status: 'paid' }), [], today);
    expect(isOverdueAndChaseable(row)).toBe(false);
  });

  it('rejects draft invoices', () => {
    const row = buildAgingRow(inv({ status: 'draft' }), [], today);
    expect(isOverdueAndChaseable(row)).toBe(false);
  });

  it('rejects do-not-chase invoices', () => {
    const row = buildAgingRow(inv({ doNotChase: true }), [], today);
    expect(isOverdueAndChaseable(row)).toBe(false);
  });

  it('rejects invoices with zero outstanding', () => {
    const row = buildAgingRow(inv({ total: 100 }), [{ invoiceId: 'inv-1', amount: 100 }], today);
    expect(isOverdueAndChaseable(row)).toBe(false);
  });

  it('rejects invoices not yet due', () => {
    const row = buildAgingRow(inv({ dueDate: '2026-05-15' }), [], today);
    expect(isOverdueAndChaseable(row)).toBe(false);
  });

  it('accepts overdue, sent, partly-paid invoices', () => {
    const row = buildAgingRow(
      inv({ status: 'partial', total: 1000 }),
      [{ invoiceId: 'inv-1', amount: 400 }],
      today,
    );
    expect(isOverdueAndChaseable(row)).toBe(true);
    expect(row.outstanding).toBe(600);
  });
});

describe('nextLevelFor', () => {
  it('starts at the recommended level when never chased', () => {
    const row = buildAgingRow(inv({ dueDate: '2026-04-20' }), [], today); // 9 days overdue
    expect(nextLevelFor(row)).toBe(2);
  });

  it('jumps forward when current level is below recommended', () => {
    const row = buildAgingRow(inv({ dueDate: '2026-02-01', chaseLevel: 1 }), [], today); // ~87 days
    expect(nextLevelFor(row)).toBe(4); // recommended is 4
  });

  it('escalates by one when current level meets/exceeds recommended', () => {
    const row = buildAgingRow(inv({ dueDate: '2026-04-25', chaseLevel: 1 }), [], today); // ~4 days, recommended 1
    expect(nextLevelFor(row)).toBe(2);
  });

  it('returns null when at max level', () => {
    const row = buildAgingRow(inv({ dueDate: '2026-01-01', chaseLevel: 4 }), [], today);
    expect(nextLevelFor(row)).toBe(null);
  });

  it('honours custom maxLevel', () => {
    const row = buildAgingRow(inv({ dueDate: '2026-04-20', chaseLevel: 2 }), [], today);
    expect(nextLevelFor(row, { maxLevel: 2 })).toBe(null);
  });

  it('returns null for non-chaseable invoices', () => {
    const row = buildAgingRow(inv({ status: 'paid' }), [], today);
    expect(nextLevelFor(row)).toBe(null);
  });

  // Regression: the L3 → L4 boundary must trigger at exactly 61 days overdue.
  // Spec is L3 = 31..60, L4 = 60+ meaning ≥61. Off-by-one here would either
  // (a) fail to escalate stale invoices, or (b) prematurely flip a 60-day
  // invoice into "Final notice" before policy allows.
  describe('day-60 → day-61 escalation boundary', () => {
    const today60 = new Date('2026-04-29T10:00:00Z');
    // Due dates chosen so daysBetween(due, today60) lands on the target day.
    const dueAt60 = '2026-02-28T00:00:00Z'; // 60 days before 2026-04-29
    const dueAt61 = '2026-02-27T00:00:00Z'; // 61 days

    it('day 60, never chased → L3', () => {
      const row = buildAgingRow(inv({ dueDate: dueAt60 }), [], today60);
      expect(row.daysOverdue).toBe(60);
      expect(row.recommendedLevel).toBe(3);
      expect(nextLevelFor(row)).toBe(3);
    });

    it('day 61, never chased → L4', () => {
      const row = buildAgingRow(inv({ dueDate: dueAt61 }), [], today60);
      expect(row.daysOverdue).toBe(61);
      expect(row.recommendedLevel).toBe(4);
      expect(nextLevelFor(row)).toBe(4);
    });

    it('day 60 already at L3 → escalates to L4', () => {
      const row = buildAgingRow(inv({ dueDate: dueAt60, chaseLevel: 3 }), [], today60);
      expect(nextLevelFor(row)).toBe(4);
    });

    it('day 61 already at L4 → no further escalation (returns null)', () => {
      const row = buildAgingRow(inv({ dueDate: dueAt61, chaseLevel: 4 }), [], today60);
      expect(nextLevelFor(row)).toBe(null);
    });

    it('day 60 already at L4 → no further escalation (no downgrade)', () => {
      const row = buildAgingRow(inv({ dueDate: dueAt60, chaseLevel: 4 }), [], today60);
      expect(nextLevelFor(row)).toBe(null);
    });
  });
});

describe('isFrequencyEligible', () => {
  it('allows immediate first send', () => {
    expect(isFrequencyEligible(null, 7, today)).toBe(true);
  });

  it('blocks repeated sends within frequency window', () => {
    expect(isFrequencyEligible('2026-04-26', 7, today)).toBe(false);
  });

  it('allows after the window has elapsed', () => {
    expect(isFrequencyEligible('2026-04-20', 7, today)).toBe(true);
  });

  it('treats invalid dates as eligible (fail-open)', () => {
    expect(isFrequencyEligible('not a date', 7, today)).toBe(true);
  });

  // Boundary: with frequencyDays=7, a chase sent exactly 7 calendar days ago
  // must be eligible (>=, not >); 6 days ago must be blocked.
  it('is eligible at exactly the configured frequency window', () => {
    expect(isFrequencyEligible('2026-04-22T00:00:00Z', 7, today)).toBe(true);
  });

  it('is ineligible at one day under the window', () => {
    expect(isFrequencyEligible('2026-04-23T00:00:00Z', 7, today)).toBe(false);
  });

  it('treats lastChasedAt later in the day as same calendar day (UTC-midnight aging)', () => {
    // 7 days ago at 23:59 UTC is still day-7 by UTC-midnight bucketing.
    expect(isFrequencyEligible('2026-04-22T23:59:59Z', 7, today)).toBe(true);
  });

  it('with frequencyDays=0 always re-allows (no throttle)', () => {
    expect(isFrequencyEligible('2026-04-29T09:00:00Z', 0, today)).toBe(true);
  });

  it('clamps negative frequencyDays to 0 (defensive)', () => {
    expect(isFrequencyEligible('2026-04-29T09:00:00Z', -5, today)).toBe(true);
  });
});

describe('renderTemplate', () => {
  it('substitutes known placeholders', () => {
    expect(renderTemplate('Hello {customerName}', { customerName: 'Acme' })).toBe('Hello Acme');
  });

  it('leaves unknown placeholders intact', () => {
    expect(renderTemplate('Hello {nope}', { customerName: 'X' })).toBe('Hello {nope}');
  });

  it('handles numeric values', () => {
    expect(renderTemplate('{count} days', { count: 14 })).toBe('14 days');
  });

  it('escapes nothing — caller controls trust boundary', () => {
    // Ensures we don't accidentally HTML-encode WhatsApp message content.
    expect(renderTemplate('A & B {x}', { x: '<' })).toBe('A & B <');
  });

  // Edge cases that have bitten template engines before — explicit tests so
  // we don't regress on real customer messages.
  it('substitutes the same placeholder multiple times', () => {
    expect(renderTemplate('{x}/{x}/{x}', { x: 'A' })).toBe('A/A/A');
  });

  it('renders zero values (not null/undefined)', () => {
    expect(renderTemplate('{daysOverdue} days', { daysOverdue: 0 })).toBe('0 days');
  });

  it('renders empty-string values rather than leaving the token', () => {
    expect(renderTemplate('Re: {invoiceNumber}', { invoiceNumber: '' })).toBe('Re: ');
  });

  it('returns the body unchanged when there are no placeholders', () => {
    expect(renderTemplate('Plain text — no tokens.', { x: 'Y' })).toBe('Plain text — no tokens.');
  });

  it('handles adjacent placeholders without separators', () => {
    expect(renderTemplate('{a}{b}{c}', { a: '1', b: '2', c: '3' })).toBe('123');
  });

  it('does not recursively expand placeholder values that look like tokens', () => {
    // Values are inserted verbatim — a malicious or accidental "{customerName}"
    // inside a value must NOT trigger another substitution pass.
    expect(renderTemplate('{x}', { x: '{customerName}', customerName: 'Acme' })).toBe('{customerName}');
  });

  it('only matches \\w+ tokens (not arbitrary punctuation)', () => {
    // Dotted "tokens" should be treated as plain text.
    expect(renderTemplate('{a.b}', { a: 'A', b: 'B' })).toBe('{a.b}');
  });

  it('substitutes Arabic placeholder values without mangling characters', () => {
    expect(renderTemplate('عميل: {customerName}', { customerName: 'شركة الفجر' }))
      .toBe('عميل: شركة الفجر');
  });

  it('returns empty string for empty body input', () => {
    expect(renderTemplate('', { x: 'Y' })).toBe('');
  });
});

describe('contextForInvoice', () => {
  it('uses contact name when present', () => {
    const row = buildAgingRow(inv({ customerName: 'fallback' }), [], today);
    const ctx = contextForInvoice(row, { id: 'c', name: 'Real Co.', phone: '+971501234567' }, {
      senderName: 'Muhasib',
      paymentLink: 'https://pay.example/x',
    });
    expect(ctx.customerName).toBe('Real Co.');
  });

  it('falls back to invoice.customerName when contact missing', () => {
    const row = buildAgingRow(inv(), [], today);
    const ctx = contextForInvoice(row, null, { senderName: 'M', paymentLink: '' });
    expect(ctx.customerName).toBe('Acme LLC');
  });

  it('formats amounts to 2 decimals', () => {
    const row = buildAgingRow(inv({ total: 1234.5 }), [], today);
    const ctx = contextForInvoice(row, null, { senderName: 'M', paymentLink: '' });
    expect(ctx.amount).toBe('1234.50');
  });
});

describe('groupByClient', () => {
  function row(customerName: string, contactId: string | null, days: number, total: number, id: string): ChaseAgingRow {
    return buildAgingRow(
      inv({ id, customerName, contactId, dueDate: new Date(today.getTime() - days * 86400000).toISOString(), total }),
      [],
      today,
    );
  }

  it('groups multiple invoices for the same contact', () => {
    const rows = [
      row('Acme', 'c1', 5, 100, 'a'),
      row('Acme', 'c1', 12, 200, 'b'),
      row('Beta', 'c2', 2, 50, 'c'),
    ];
    const groups = groupByClient(rows);
    expect(groups).toHaveLength(2);
    const acme = groups.find(g => g.contactId === 'c1')!;
    expect(acme.rows).toHaveLength(2);
    expect(acme.totalOutstanding).toBe(300);
    expect(acme.recommendedLevel).toBe(2); // 12 days → level 2
  });

  it('falls back to customerName when contactId is null', () => {
    const rows = [row('No-id Co', null, 5, 100, 'a'), row('No-id Co', null, 7, 50, 'b')];
    const groups = groupByClient(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(2);
  });

  it('sorts by level descending then outstanding descending', () => {
    const rows = [
      row('Small old', 'c1', 70, 10, 'a'),    // level 4
      row('Big new', 'c2', 5, 9999, 'b'),     // level 1
      row('Medium', 'c3', 35, 500, 'c'),      // level 3
    ];
    const groups = groupByClient(rows);
    expect(groups.map(g => g.contactId)).toEqual(['c1', 'c3', 'c2']);
  });

  it('returns an empty array for an empty input list', () => {
    expect(groupByClient([])).toEqual([]);
  });

  it('uses normalised name fallback regardless of case/whitespace', () => {
    const rows = [
      row('  Acme LLC ', null, 5, 100, 'a'),
      row('acme llc', null, 7, 50, 'b'),
    ];
    const groups = groupByClient(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(2);
  });
});

describe('renderGroupedMessage', () => {
  it('renders single-invoice without bullet list', () => {
    const groups = groupByClient([buildAgingRow(inv(), [], today)]);
    const out = renderGroupedMessage(groups[0], { body: '{customerName}: {invoiceNumber} {amount}', subject: null }, {
      senderName: 'Sender', paymentLink: '',
    });
    expect(out.body).toContain('Acme LLC');
    expect(out.body).not.toContain('Outstanding invoices:');
  });

  it('appends invoice list when multiple', () => {
    const rows = [
      buildAgingRow(inv({ id: 'a', number: 'INV-A', dueDate: '2026-04-01', total: 100, contactId: 'c' }), [], today),
      buildAgingRow(inv({ id: 'b', number: 'INV-B', dueDate: '2026-03-01', total: 200, contactId: 'c' }), [], today),
    ];
    const groups = groupByClient(rows);
    const out = renderGroupedMessage(groups[0], { body: '{customerName}', subject: 'S {amount}' }, {
      senderName: 'X', paymentLink: '',
    });
    expect(out.body).toContain('Outstanding invoices:');
    expect(out.body).toContain('INV-A');
    expect(out.body).toContain('INV-B');
    expect(out.subject).toBe('S 300.00');
  });
});

describe('computeEffectiveness', () => {
  it('returns zeros for empty input', () => {
    const s = computeEffectiveness([]);
    expect(s.totalChases).toBe(0);
    expect(s.conversionRate).toBe(0);
    expect(s.avgDaysToPayment).toBe(null);
    expect(s.uniqueInvoices).toBe(0);
    expect(s.byLevel[1]).toEqual({ sent: 0, paid: 0 });
    expect(s.byLevel[4]).toEqual({ sent: 0, paid: 0 });
  });

  it('ignores paidAt earlier than sentAt for window/avg metrics', () => {
    // Data corruption guard: a chase logged after the payment shouldn't
    // count toward the "paid within N days" funnel — that would make the
    // dashboard show fictional negative response times.
    const stats = computeEffectiveness([
      { invoiceId: 'a', level: 1, sentAt: '2026-04-10', paidAt: '2026-04-01' },
    ]);
    expect(stats.paidAfterChase).toBe(1); // still counts as paid
    expect(stats.paidWithin7).toBe(0); // negative span excluded
    expect(stats.paidWithin30).toBe(0);
    expect(stats.avgDaysToPayment).toBe(null);
  });

  it('clamps unknown levels into level 1 (defensive)', () => {
    const stats = computeEffectiveness([
      { invoiceId: 'a', level: 99 as any, sentAt: '2026-04-01', paidAt: null },
    ]);
    expect(stats.byLevel[1].sent).toBe(1);
  });

  it('counts paid-after-chase per unique invoice', () => {
    const stats = computeEffectiveness([
      { invoiceId: 'a', level: 1, sentAt: '2026-04-01', paidAt: '2026-04-05' },
      { invoiceId: 'a', level: 2, sentAt: '2026-04-08', paidAt: '2026-04-12' }, // same invoice, second chase
      { invoiceId: 'b', level: 1, sentAt: '2026-04-01', paidAt: null },
      { invoiceId: 'c', level: 4, sentAt: '2026-04-01', paidAt: '2026-04-25' }, // 24 days
    ]);
    expect(stats.totalChases).toBe(4);
    expect(stats.uniqueInvoices).toBe(3);
    expect(stats.paidAfterChase).toBe(2); // a, c
    expect(stats.paidWithin7).toBe(1); // a (5 days from earliest chase)
    expect(stats.paidWithin30).toBe(2);
    expect(stats.byLevel[1].sent).toBe(2);
    expect(stats.byLevel[1].paid).toBe(1);
    expect(stats.byLevel[4].sent).toBe(1);
    expect(stats.byLevel[4].paid).toBe(1);
    expect(stats.conversionRate).toBeCloseTo(2 / 3, 5);
    expect(stats.avgDaysToPayment).not.toBe(null);
  });
});

describe('WhatsApp helpers', () => {
  it('strips non-digits from phone numbers', () => {
    expect(normalizePhoneForWa('+971 50 123 4567')).toBe('971501234567');
    expect(normalizePhoneForWa('+971-50-123-4567')).toBe('971501234567');
    expect(normalizePhoneForWa('  ')).toBe('');
    expect(normalizePhoneForWa(null)).toBe('');
  });

  it('rewrites UAE local format (leading 0) to E.164', () => {
    // wa.me requires a country-coded number — "0501234567" alone won't route.
    expect(normalizePhoneForWa('0501234567')).toBe('971501234567');
    expect(normalizePhoneForWa('050 123 4567')).toBe('971501234567');
    expect(normalizePhoneForWa('04 123 4567')).toBe('97141234567'); // landline
  });

  it('drops the 00 international prefix', () => {
    expect(normalizePhoneForWa('00971501234567')).toBe('971501234567');
    expect(normalizePhoneForWa('00 971 50 123 4567')).toBe('971501234567');
  });

  it('leaves already-country-coded foreign numbers alone', () => {
    expect(normalizePhoneForWa('+966501234567')).toBe('966501234567'); // KSA
    expect(normalizePhoneForWa('+15551234567')).toBe('15551234567'); // US
  });

  it('builds wa.me links and URL-encodes the message', () => {
    const link = buildWaMeLink('+971501234567', 'Hello there!');
    expect(link).toBe('https://wa.me/971501234567?text=Hello%20there!');
  });

  it('builds wa.me links for UAE local-format phone input', () => {
    const link = buildWaMeLink('050-123-4567', 'Hi');
    expect(link).toBe('https://wa.me/971501234567?text=Hi');
  });

  it('returns null for empty phone', () => {
    expect(buildWaMeLink('', 'msg')).toBe(null);
  });

  it('URL-encodes Arabic and newlines correctly', () => {
    const link = buildWaMeLink('+971501234567', 'مرحبا\nشكرا');
    expect(link).toContain('https://wa.me/971501234567?text=');
    // Newline must be encoded; Arabic must round-trip via decodeURIComponent.
    const text = decodeURIComponent(link!.split('?text=')[1]);
    expect(text).toBe('مرحبا\nشكرا');
  });
});

// ─── Edge-case coverage for outstandingFor ───────────────────────────────────
describe('outstandingFor edge cases', () => {
  it('treats null/undefined invoice.total as zero', () => {
    // Bypass the helper's `?? 1000` default so we can assert the service
    // clamps a missing total to zero (rather than returning negative paid).
    const i = { ...inv(), total: undefined as unknown as number };
    expect(outstandingFor(i, [{ invoiceId: 'inv-1', amount: 100 }])).toBe(0);
  });

  it('ignores NaN payment amounts', () => {
    const i = inv({ total: 1000 });
    expect(outstandingFor(i, [{ invoiceId: 'inv-1', amount: NaN as any }])).toBe(1000);
  });

  it('rounds to two decimals (no floating-point drift)', () => {
    const i = inv({ total: 100 });
    expect(outstandingFor(i, [
      { invoiceId: 'inv-1', amount: 33.33 },
      { invoiceId: 'inv-1', amount: 33.33 },
      { invoiceId: 'inv-1', amount: 33.33 },
    ])).toBe(0.01);
  });
});
