import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbState = vi.hoisted(() => ({
  insertedValues: [] as any[],
  ownedAccounts: [] as any[],
  transactionCount: 0,
}));

vi.mock('../../server/db', () => {
  const db: any = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => dbState.ownedAccounts),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: any) => {
        dbState.insertedValues.push(values);
        return {
          onConflictDoUpdate: vi.fn(() => ({
            returning: vi.fn(async () => [{ lastValue: 1 }]),
          })),
          returning: vi.fn(async () => [{ id: 'journal-entry-1', ...values }]),
        };
      }),
    })),
  };

  db.transaction = vi.fn(async (callback: (tx: any) => Promise<any>) => {
    dbState.transactionCount++;
    return callback(db);
  });

  return { db };
});

import { DatabaseStorage } from '../../server/storage';

const entry = {
  companyId: 'company-1',
  date: new Date('2026-06-01T00:00:00.000Z'),
  memo: 'Manual entry',
  status: 'posted',
  source: 'manual',
  sourceId: null,
  createdBy: 'user-1',
  postedBy: 'user-1',
  postedAt: new Date('2026-06-01T00:00:00.000Z'),
} as any;

describe('journal account company scoping', () => {
  beforeEach(() => {
    dbState.insertedValues = [];
    dbState.ownedAccounts = [];
    dbState.transactionCount = 0;
    vi.clearAllMocks();
  });

  it('creates a journal entry when all line accounts belong to the company', async () => {
    dbState.ownedAccounts = [{ id: 'account-1' }, { id: 'account-2' }];
    const storage = new DatabaseStorage();

    const created = await storage.createJournalEntryWithGeneratedNumber(entry, [
      { accountId: 'account-1', debit: 100, credit: 0, description: 'Debit' },
      { accountId: 'account-2', debit: 0, credit: 100, description: 'Credit' },
    ] as any);

    expect(created.id).toBe('journal-entry-1');
    expect(dbState.transactionCount).toBe(1);
    expect(dbState.insertedValues.some((values) => values.accountId === 'account-1')).toBe(true);
    expect(dbState.insertedValues.some((values) => values.accountId === 'account-2')).toBe(true);
  });

  it('rejects a journal line account outside the journal company', async () => {
    dbState.ownedAccounts = [{ id: 'account-1' }];
    const storage = new DatabaseStorage();

    await expect(storage.createJournalEntryWithGeneratedNumber(entry, [
      { accountId: 'account-1', debit: 100, credit: 0, description: 'Debit' },
      { accountId: 'account-from-other-company', debit: 0, credit: 100, description: 'Credit' },
    ] as any)).rejects.toThrow(/does not belong to company/);

    expect(dbState.insertedValues).toEqual([]);
  });
});
