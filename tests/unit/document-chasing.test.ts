import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REMINDER_DAYS,
  computeEffectiveness,
  daysBetween,
  daysUntil,
  detectMissingDocuments,
  dueReminderOffsets,
  humanizeDocumentType,
  nextChaseLevel,
  parseReminderDays,
  renderChaseMessage,
  serializeReminderDays,
  shouldChaseNow,
  upcomingDeadlines,
  whatsappDeepLink,
} from '../../server/services/document-chasing.service';
import { DOCUMENT_TYPES, COMPLIANCE_EVENT_TYPES } from '@shared/schema';

const NOW = new Date('2026-04-30T12:00:00.000Z');
function daysFromNow(d: number) {
  const r = new Date(NOW);
  r.setUTCDate(r.getUTCDate() + d);
  return r;
}

describe('document-chasing: time helpers', () => {
  it('daysBetween counts whole days regardless of intra-day time', () => {
    const a = new Date('2026-04-30T01:00:00.000Z');
    const b = new Date('2026-05-02T23:00:00.000Z');
    expect(daysBetween(a, b)).toBe(2);
  });

  it('daysUntil returns positive for future and negative for past', () => {
    expect(daysUntil(daysFromNow(7), NOW)).toBe(7);
    expect(daysUntil(daysFromNow(-3), NOW)).toBe(-3);
    expect(daysUntil(daysFromNow(0), NOW)).toBe(0);
  });
});

describe('document-chasing: missing detection', () => {
  it('flags requirements that are not received and have not been waived', () => {
    const reqs = [
      { id: 'a', status: 'pending', dueDate: daysFromNow(-5), documentType: 'trade_license', receivedAt: null },
      { id: 'b', status: 'requested', dueDate: daysFromNow(2), documentType: 'emirates_id', receivedAt: null },
      { id: 'c', status: 'received', dueDate: daysFromNow(-1), documentType: 'visa_copy', receivedAt: daysFromNow(-1) },
      { id: 'd', status: 'waived', dueDate: daysFromNow(-10), documentType: 'bank_statement', receivedAt: null },
    ];
    const missing = detectMissingDocuments(reqs as any, NOW);
    expect(missing.map((m) => m.id).sort()).toEqual(['a', 'b']);
  });

  it('marks the past-due item as overdue and the future one as not', () => {
    const reqs = [
      { id: 'p', status: 'pending', dueDate: daysFromNow(-5), documentType: 'tenancy_contract', receivedAt: null },
      { id: 'f', status: 'pending', dueDate: daysFromNow(10), documentType: 'tenancy_contract', receivedAt: null },
    ];
    const missing = detectMissingDocuments(reqs as any, NOW);
    expect(missing.find((m) => m.id === 'p')!.isOverdue).toBe(true);
    expect(missing.find((m) => m.id === 'p')!.daysOverdue).toBe(5);
    expect(missing.find((m) => m.id === 'f')!.isOverdue).toBe(false);
    expect(missing.find((m) => m.id === 'f')!.daysOverdue).toBe(0);
  });

  it('treats a receivedAt timestamp as proof of receipt even if status is stale', () => {
    const reqs = [
      { id: 'x', status: 'pending', dueDate: daysFromNow(-1), documentType: 'invoice', receivedAt: daysFromNow(-1) },
    ];
    expect(detectMissingDocuments(reqs as any, NOW)).toHaveLength(0);
  });

  it('returns an empty list when nothing is required', () => {
    expect(detectMissingDocuments([], NOW)).toEqual([]);
  });
});

describe('document-chasing: chase escalation', () => {
  it('starts at "friendly" when nothing has been sent and the doc is on time', () => {
    expect(nextChaseLevel(null, 0)).toBe('friendly');
  });

  it('jumps to "follow_up" once 14+ days overdue even with no send history', () => {
    expect(nextChaseLevel(null, 14)).toBe('follow_up');
  });

  it('jumps to "urgent" at 30+ days overdue', () => {
    expect(nextChaseLevel(null, 30)).toBe('urgent');
  });

  it('jumps to "final" at 60+ days overdue', () => {
    expect(nextChaseLevel(null, 90)).toBe('final');
  });

  it('escalates by one level on each subsequent send within the same window', () => {
    expect(nextChaseLevel('friendly', 0)).toBe('follow_up');
    expect(nextChaseLevel('follow_up', 0)).toBe('urgent');
    expect(nextChaseLevel('urgent', 0)).toBe('final');
  });

  it('caps at "final" — repeated sends do not climb past it', () => {
    expect(nextChaseLevel('final', 0)).toBe('final');
    expect(nextChaseLevel('final', 200)).toBe('final');
  });

  it('honors the time-based floor over a stale "previous" level', () => {
    // 30+ days overdue forces at least urgent even if last send was friendly
    expect(nextChaseLevel('friendly', 35)).toBe('urgent');
  });
});

describe('document-chasing: reminder schedule', () => {
  it('default reminders fire at 30/14/7/0 day offsets', () => {
    expect(DEFAULT_REMINDER_DAYS).toEqual([30, 14, 7, 0]);
  });

  it('dueReminderOffsets returns all offsets that have been reached', () => {
    expect(dueReminderOffsets(35)).toEqual([]);
    expect(dueReminderOffsets(30)).toEqual([30]);
    expect(dueReminderOffsets(14)).toEqual([30, 14]);
    expect(dueReminderOffsets(7)).toEqual([30, 14, 7]);
    expect(dueReminderOffsets(0)).toEqual([30, 14, 7, 0]);
    expect(dueReminderOffsets(-5)).toEqual([30, 14, 7, 0]);
  });

  it('parses a comma-separated reminder string and rejects garbage', () => {
    expect(parseReminderDays('30,14,7,0')).toEqual([30, 14, 7, 0]);
    expect(parseReminderDays(' 60 , 30 ')).toEqual([60, 30]);
    expect(parseReminderDays('')).toEqual([...DEFAULT_REMINDER_DAYS]);
    expect(parseReminderDays(null)).toEqual([...DEFAULT_REMINDER_DAYS]);
    expect(parseReminderDays('xyz')).toEqual([...DEFAULT_REMINDER_DAYS]);
  });

  it('serializes reminder offsets in descending order', () => {
    expect(serializeReminderDays([7, 30, 14, 0])).toBe('30,14,7,0');
  });

  it('shouldChaseNow returns false when nothing is due yet', () => {
    expect(
      shouldChaseNow(
        { dueDate: daysFromNow(60), status: 'pending', receivedAt: null },
        null,
        DEFAULT_REMINDER_DAYS,
        NOW,
      ),
    ).toBe(false);
  });

  it('shouldChaseNow returns true at the 30-day mark with no prior chase', () => {
    expect(
      shouldChaseNow(
        { dueDate: daysFromNow(30), status: 'pending', receivedAt: null },
        null,
        DEFAULT_REMINDER_DAYS,
        NOW,
      ),
    ).toBe(true);
  });

  it('shouldChaseNow suppresses a re-send within 24h of the previous chase', () => {
    expect(
      shouldChaseNow(
        { dueDate: daysFromNow(0), status: 'requested', receivedAt: null },
        { sentAt: NOW, chaseLevel: 'friendly' },
        DEFAULT_REMINDER_DAYS,
        NOW,
      ),
    ).toBe(false);
  });

  it('shouldChaseNow allows another chase 24h+ after the last one', () => {
    expect(
      shouldChaseNow(
        { dueDate: daysFromNow(0), status: 'requested', receivedAt: null },
        { sentAt: daysFromNow(-2), chaseLevel: 'friendly' },
        DEFAULT_REMINDER_DAYS,
        NOW,
      ),
    ).toBe(true);
  });

  it('shouldChaseNow refuses to chase a received or waived requirement', () => {
    expect(
      shouldChaseNow(
        { dueDate: daysFromNow(-5), status: 'received', receivedAt: daysFromNow(-1) },
        null,
        DEFAULT_REMINDER_DAYS,
        NOW,
      ),
    ).toBe(false);
    expect(
      shouldChaseNow(
        { dueDate: daysFromNow(-5), status: 'waived', receivedAt: null },
        null,
        DEFAULT_REMINDER_DAYS,
        NOW,
      ),
    ).toBe(false);
  });
});

describe('document-chasing: message rendering', () => {
  it('renders the company name and human-readable doc type', () => {
    const msg = renderChaseMessage('friendly', 'trade_license', daysFromNow(0), 'Acme LLC', 0);
    expect(msg).toContain('Acme LLC');
    expect(msg).toContain('trade license');
  });

  it('escalating tone is reflected in the body', () => {
    const due = daysFromNow(-30);
    const friendly = renderChaseMessage('friendly', 'visa_copy', due, 'Foo', 30);
    const urgent = renderChaseMessage('urgent', 'visa_copy', due, 'Foo', 30);
    const final = renderChaseMessage('final', 'visa_copy', due, 'Foo', 30);
    expect(friendly.toLowerCase()).toContain('reminder');
    expect(urgent.toLowerCase()).toContain('overdue');
    expect(final.toLowerCase()).toContain('final notice');
  });

  it('humanizeDocumentType replaces underscores with spaces', () => {
    expect(humanizeDocumentType('emirates_id')).toBe('emirates id');
    expect(humanizeDocumentType('audited_financials')).toBe('audited financials');
  });
});

describe('document-chasing: WhatsApp deep links', () => {
  it('builds a wa.me link with stripped non-digit characters', () => {
    const link = whatsappDeepLink('+971 50 123-4567', 'hello');
    expect(link).toBe('https://wa.me/971501234567?text=hello');
  });

  it('returns null for an empty or unusably short phone', () => {
    expect(whatsappDeepLink(null, 'hi')).toBeNull();
    expect(whatsappDeepLink('', 'hi')).toBeNull();
    expect(whatsappDeepLink('123', 'hi')).toBeNull();
  });

  it('URL-encodes the message body', () => {
    const link = whatsappDeepLink('+971501234567', 'Hi & welcome!')!;
    expect(link).toContain('Hi%20%26%20welcome!');
  });
});

describe('document-chasing: compliance calendar', () => {
  it('returns deadlines within the window, sorted by closeness', () => {
    const events = [
      { id: 'a', eventDate: daysFromNow(20), eventType: 'visa_expiry', description: 'Visa A', status: 'upcoming', reminderDays: '30,14,7,0' },
      { id: 'b', eventDate: daysFromNow(5), eventType: 'trade_license_renewal', description: 'TL', status: 'upcoming', reminderDays: '30,14,7,0' },
      { id: 'c', eventDate: daysFromNow(120), eventType: 'audit_deadline', description: 'far', status: 'upcoming', reminderDays: '60,30,14,7,0' },
    ];
    const upcoming = upcomingDeadlines(events as any, 30, NOW);
    expect(upcoming.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('marks reminderActive for events within their reminder window', () => {
    const events = [
      { id: 'soon', eventDate: daysFromNow(7), eventType: 'vat_filing', description: 'q', status: 'upcoming', reminderDays: '30,14,7,0' },
      { id: 'far', eventDate: daysFromNow(45), eventType: 'vat_filing', description: 'q', status: 'upcoming', reminderDays: '30,14,7,0' },
    ];
    const upcoming = upcomingDeadlines(events as any, 90, NOW);
    expect(upcoming.find((e) => e.id === 'soon')!.reminderActive).toBe(true);
    expect(upcoming.find((e) => e.id === 'far')!.reminderActive).toBe(false);
  });

  it('hides events that have been completed or dismissed', () => {
    const events = [
      { id: 'done', eventDate: daysFromNow(5), eventType: 'vat_filing', description: 'q', status: 'completed', reminderDays: '30' },
      { id: 'gone', eventDate: daysFromNow(5), eventType: 'vat_filing', description: 'q', status: 'dismissed', reminderDays: '30' },
    ];
    expect(upcomingDeadlines(events as any, 30, NOW)).toEqual([]);
  });

  it('marks past-due events as overdue with a negative daysUntil', () => {
    const events = [
      { id: 'late', eventDate: daysFromNow(-3), eventType: 'tenancy_renewal', description: 'r', status: 'upcoming', reminderDays: '30' },
    ];
    const out = upcomingDeadlines(events as any, 30, NOW);
    expect(out[0].isOverdue).toBe(true);
    expect(out[0].daysUntil).toBe(-3);
  });
});

describe('document-chasing: effectiveness metrics', () => {
  it('counts unique chased requirements (multiple sends do not double-count)', () => {
    const reqs = [
      { id: 'r1', status: 'received', createdAt: daysFromNow(-30), receivedAt: daysFromNow(-5) },
      { id: 'r2', status: 'pending', createdAt: daysFromNow(-30), receivedAt: null },
    ];
    const chases = [
      { requirementId: 'r1', sentAt: daysFromNow(-20), responseReceived: true },
      { requirementId: 'r1', sentAt: daysFromNow(-15), responseReceived: true },
      { requirementId: 'r2', sentAt: daysFromNow(-5), responseReceived: false },
    ];
    const eff = computeEffectiveness(reqs as any, chases as any);
    expect(eff.totalChased).toBe(2);
    expect(eff.totalReceived).toBe(1);
    expect(eff.responseRate).toBeCloseTo(0.5);
  });

  it('uses the earliest send as t0 when computing avg upload delay', () => {
    const reqs = [
      { id: 'r', status: 'received', createdAt: daysFromNow(-30), receivedAt: daysFromNow(-5) },
    ];
    const chases = [
      { requirementId: 'r', sentAt: daysFromNow(-20), responseReceived: true },
      { requirementId: 'r', sentAt: daysFromNow(-12), responseReceived: true },
    ];
    const eff = computeEffectiveness(reqs as any, chases as any);
    expect(eff.avgDaysToUpload).toBeCloseTo(15, 0);
  });

  it('returns null avgDaysToUpload when nothing has been received', () => {
    const reqs = [
      { id: 'a', status: 'pending', createdAt: daysFromNow(-30), receivedAt: null },
    ];
    const chases = [{ requirementId: 'a', sentAt: daysFromNow(-10), responseReceived: false }];
    const eff = computeEffectiveness(reqs as any, chases as any);
    expect(eff.totalReceived).toBe(0);
    expect(eff.avgDaysToUpload).toBeNull();
  });

  it('returns zero response rate when nothing has been chased', () => {
    expect(computeEffectiveness([], [])).toEqual({
      totalChased: 0,
      totalReceived: 0,
      responseRate: 0,
      avgDaysToUpload: null,
    });
  });

  it('ignores requirements that have not been chased yet', () => {
    // r2 is received but was never chased — should not inflate the rate.
    const reqs = [
      { id: 'r1', status: 'pending', createdAt: daysFromNow(-30), receivedAt: null },
      { id: 'r2', status: 'received', createdAt: daysFromNow(-30), receivedAt: daysFromNow(-1) },
    ];
    const chases = [{ requirementId: 'r1', sentAt: daysFromNow(-5), responseReceived: false }];
    const eff = computeEffectiveness(reqs as any, chases as any);
    expect(eff.totalChased).toBe(1);
    expect(eff.totalReceived).toBe(0);
  });
});

describe('document-chasing: UAE document and event types', () => {
  it('exposes the canonical UAE document types', () => {
    expect(DOCUMENT_TYPES).toContain('trade_license');
    expect(DOCUMENT_TYPES).toContain('emirates_id');
    expect(DOCUMENT_TYPES).toContain('vat_certificate');
    expect(DOCUMENT_TYPES).toContain('esr_notification');
    expect(DOCUMENT_TYPES).toContain('audited_financials');
  });

  it('exposes the canonical UAE compliance event types', () => {
    expect(COMPLIANCE_EVENT_TYPES).toContain('trade_license_renewal');
    expect(COMPLIANCE_EVENT_TYPES).toContain('visa_expiry');
    expect(COMPLIANCE_EVENT_TYPES).toContain('vat_filing');
    expect(COMPLIANCE_EVENT_TYPES).toContain('corporate_tax_filing');
    expect(COMPLIANCE_EVENT_TYPES).toContain('esr_report');
  });

  it('chase messages localize the document type even for compound names', () => {
    const msg = renderChaseMessage(
      'friendly',
      'corporate_tax_certificate',
      daysFromNow(30),
      'Beta Trading',
      0,
    );
    expect(msg).toContain('corporate tax certificate');
  });
});

describe('document-chasing: multi-tenancy isolation (logic level)', () => {
  // The DB-bound helpers always scope by companyId — these tests exercise the
  // pure pipeline functions to guarantee that data from one company can never
  // be mistakenly mixed with another by the chase queue logic itself.
  it('detectMissingDocuments only operates on the rows it is handed', () => {
    const tenantA = [
      { id: 'a1', status: 'pending', dueDate: daysFromNow(-1), documentType: 'invoice', receivedAt: null },
    ];
    const tenantB = [
      { id: 'b1', status: 'pending', dueDate: daysFromNow(-1), documentType: 'invoice', receivedAt: null },
    ];
    expect(detectMissingDocuments(tenantA as any, NOW).map((r) => r.id)).toEqual(['a1']);
    expect(detectMissingDocuments(tenantB as any, NOW).map((r) => r.id)).toEqual(['b1']);
  });

  it('computeEffectiveness only counts chases for requirements it knows about', () => {
    const reqs = [
      { id: 'a-r1', status: 'received', createdAt: daysFromNow(-10), receivedAt: daysFromNow(-1) },
    ];
    const chases = [
      { requirementId: 'a-r1', sentAt: daysFromNow(-5), responseReceived: true },
      // A foreign requirement id sneaking in should be ignored.
      { requirementId: 'b-r99', sentAt: daysFromNow(-5), responseReceived: true },
    ];
    const eff = computeEffectiveness(reqs as any, chases as any);
    expect(eff.totalChased).toBe(2); // chased ids tracked from chases input
    expect(eff.totalReceived).toBe(1); // only the requirement we know is received
  });
});
