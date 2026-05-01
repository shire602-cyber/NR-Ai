import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());

vi.mock('../../server/db', () => ({
  pool: {
    query: queryMock,
  },
}));

vi.mock('../../server/storage', () => ({
  storage: {
    getAccount: vi.fn(),
    getJournalEntry: vi.fn(),
    getJournalLinesByEntryId: vi.fn(),
    updateJournalEntry: vi.fn(),
    generateEntryNumber: vi.fn(),
    createJournalEntry: vi.fn(),
  },
}));

vi.mock('../../server/services/period-lock.service', () => ({
  assertPeriodNotLocked: vi.fn(async () => undefined),
}));

import { processUserFeedback } from '../../server/services/autonomous-gl.service';
import { storage } from '../../server/storage';

describe('AI GL feedback tenant and posting safeguards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads queue feedback rows by queue id and company id', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const result = await processUserFeedback('company-1', 'queue-1', 'accept', 'user-1');

    expect(result.success).toBe(false);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id = $1 AND company_id = $2'),
      ['queue-1', 'company-1'],
    );
  });

  it('rejects corrected accounts that do not belong to the queue company', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        id: 'queue-1',
        company_id: 'company-1',
        status: 'pending_review',
        bank_transaction_id: null,
        suggested_account_id: 'acct-old',
        amount: '100',
        transaction_date: '2026-01-15',
        description: 'Test transaction',
        suggested_category: 'expense',
        ai_confidence: '0.8',
        ai_reason: 'test',
        journal_entry_id: null,
      }],
    });
    vi.mocked(storage.getAccount).mockResolvedValueOnce(undefined as any);

    const result = await processUserFeedback('company-1', 'queue-1', 'correct', 'user-1', 'acct-other');

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/does not belong/i);
    expect(storage.getAccount).toHaveBeenCalledWith('acct-other', 'company-1');
  });

  it('posts the accepted journal entry before reconciling the bank transaction', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ai_gl_queue')) {
        return { rows: [{
          id: 'queue-1',
          company_id: 'company-1',
          status: 'pending_review',
          bank_transaction_id: 'bank-txn-1',
          suggested_account_id: 'acct-suggested',
          amount: '100',
          transaction_date: '2026-01-15',
          description: 'Card payment',
          suggested_category: 'expense',
          ai_confidence: '0.9',
          ai_reason: 'test',
          journal_entry_id: null,
        }] };
      }
      if (sql.includes('SELECT bank_account_id FROM bank_transactions')) {
        return { rows: [{ bank_account_id: 'acct-bank' }] };
      }
      if (sql.includes('SELECT id FROM accounts WHERE company_id')) {
        return { rows: [{ id: 'acct-suggested' }, { id: 'acct-bank' }] };
      }
      if (sql.includes('SELECT user_id FROM company_users')) {
        return { rows: [{ user_id: 'owner-1' }] };
      }
      if (sql.includes('SELECT amount FROM bank_transactions')) {
        return { rows: [{ amount: -100 }] };
      }
      if (sql.includes('MAX(CAST(SUBSTRING(entry_number')) {
        return { rows: [{ max_seq: 0 }] };
      }
      if (sql.includes('INSERT INTO journal_entries')) {
        return { rows: [{ id: 'journal-1' }] };
      }
      if (sql.includes('FROM journal_entries')) {
        return { rows: [{ id: 'journal-1', date: new Date('2026-01-15'), status: 'draft' }] };
      }
      if (sql.includes('FROM journal_lines')) {
        return { rows: [{ debit: 100, credit: 0 }, { debit: 0, credit: 100 }] };
      }
      return { rows: [] };
    });

    const result = await processUserFeedback('company-1', 'queue-1', 'accept', 'user-1');

    expect(result.success).toBe(true);
    const calls = queryMock.mock.calls.map(([sql]) => String(sql));
    const postIndex = calls.findIndex((sql) => sql.includes('UPDATE journal_entries'));
    const reconcileIndex = calls.findIndex((sql) => sql.includes('UPDATE bank_transactions'));
    expect(postIndex).toBeGreaterThan(-1);
    expect(reconcileIndex).toBeGreaterThan(-1);
    expect(postIndex).toBeLessThan(reconcileIndex);
  });

  it('posts corrected feedback with the company-owned corrected account before reconciliation', async () => {
    vi.mocked(storage.getAccount).mockResolvedValueOnce({ id: 'acct-corrected' } as any);
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ai_gl_queue')) {
        return { rows: [{
          id: 'queue-1',
          company_id: 'company-1',
          status: 'pending_review',
          bank_transaction_id: 'bank-txn-1',
          suggested_account_id: 'acct-original',
          amount: '250',
          transaction_date: '2026-02-01',
          description: 'Deposit',
          suggested_category: 'income',
          ai_confidence: '0.7',
          ai_reason: 'test',
          journal_entry_id: null,
        }] };
      }
      if (sql.includes('SELECT bank_account_id FROM bank_transactions')) {
        return { rows: [{ bank_account_id: 'acct-bank' }] };
      }
      if (sql.includes('SELECT id FROM accounts WHERE company_id')) {
        return { rows: [{ id: 'acct-corrected' }, { id: 'acct-bank' }] };
      }
      if (sql.includes('SELECT user_id FROM company_users')) {
        return { rows: [{ user_id: 'owner-1' }] };
      }
      if (sql.includes('SELECT amount FROM bank_transactions')) {
        return { rows: [{ amount: 250 }] };
      }
      if (sql.includes('MAX(CAST(SUBSTRING(entry_number')) {
        return { rows: [{ max_seq: 0 }] };
      }
      if (sql.includes('INSERT INTO journal_entries')) {
        return { rows: [{ id: 'journal-1' }] };
      }
      if (sql.includes('FROM journal_entries')) {
        return { rows: [{ id: 'journal-1', date: new Date('2026-02-01'), status: 'draft' }] };
      }
      if (sql.includes('FROM journal_lines')) {
        return { rows: [{ debit: 250, credit: 0 }, { debit: 0, credit: 250 }] };
      }
      if (sql.includes('SELECT * FROM ai_company_rules')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await processUserFeedback('company-1', 'queue-1', 'correct', 'user-1', 'acct-corrected');

    expect(result.success).toBe(true);
    const calls = queryMock.mock.calls;
    const journalLineCalls = calls.filter(([sql]) => String(sql).includes('INSERT INTO journal_lines'));
    expect(journalLineCalls.some(([, params]) => params?.includes('acct-corrected'))).toBe(true);
    const postIndex = calls.findIndex(([sql]) => String(sql).includes('UPDATE journal_entries'));
    const reconcileIndex = calls.findIndex(([sql]) => String(sql).includes('UPDATE bank_transactions'));
    expect(postIndex).toBeGreaterThan(-1);
    expect(reconcileIndex).toBeGreaterThan(-1);
    expect(postIndex).toBeLessThan(reconcileIndex);
  });
});
