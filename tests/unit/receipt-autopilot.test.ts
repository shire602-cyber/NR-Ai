/**
 * Phase 2 — Receipt Autopilot service tests.
 *
 * The autopilot service depends on `storage` (Drizzle ORM), `pool` (Postgres
 * pool), and the period-lock helper. We mock all of those at the module level
 * with vi.mock so the tests stay fully in-memory.
 *
 * Test focus:
 *   - The pipeline always creates a receipt + classification row.
 *   - Auto-post only fires when autopilot is enabled, the rule has ≥5 accepts,
 *     and confidence ≥ 0.9.
 *   - Account-picking helpers behave correctly across COA layouts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------- in-memory state used by the storage mock ----------
const state = {
  company: { id: 'co-1', classifierConfig: null as any },
  accounts: [] as any[],
  receipts: [] as any[],
  classifications: [] as any[],
  journalEntries: [] as any[],
};

// Mocks must be hoisted before the imports below.
vi.mock('../../server/storage', () => ({
  storage: {
    getCompany: vi.fn(async (_id: string) => state.company),
    getAccountsByCompanyId: vi.fn(async (_id: string) => state.accounts),
    createReceipt: vi.fn(async (r: any) => {
      const row = { id: `r-${state.receipts.length + 1}`, ...r };
      state.receipts.push(row);
      return row;
    }),
    updateReceipt: vi.fn(async (id: string, patch: any) => {
      const r = state.receipts.find((x) => x.id === id);
      Object.assign(r, patch);
      return r;
    }),
    createTransactionClassification: vi.fn(async (c: any) => {
      const row = { id: `c-${state.classifications.length + 1}`, ...c };
      state.classifications.push(row);
      return row;
    }),
    updateTransactionClassification: vi.fn(async (id: string, patch: any) => {
      const c = state.classifications.find((x) => x.id === id);
      Object.assign(c, patch);
      return c;
    }),
    hasCompanyAccess: vi.fn(async () => true),
    generateEntryNumber: vi.fn(async () => 'JE-TEST-001'),
    createJournalEntry: vi.fn(async (entry: any, _lines: any[]) => {
      const row = { id: `je-${state.journalEntries.length + 1}`, ...entry };
      state.journalEntries.push(row);
      return row;
    }),
  },
}));

vi.mock('../../server/db', () => ({
  pool: {
    query: vi.fn(async () => ({ rows: [] })),
  },
}));

vi.mock('../../server/services/period-lock.service', () => ({
  assertPeriodNotLocked: vi.fn(async () => undefined),
}));

vi.mock('../../server/services/training-data.service', async () => {
  const actual = await vi.importActual<any>('../../server/services/training-data.service');
  return {
    ...actual,
    // Replace getModel/getClassifierConfig with thin in-memory shims so we
    // don't hit Postgres during unit tests.
    getModel: vi.fn(async () => ({
      rules: state._rules,
      trainingExamples: state._trainingExamples,
      builtAt: Date.now(),
    })),
    getClassifierConfig: vi.fn(async () => state._config),
    invalidateModel: vi.fn(),
    applyAccuracyFailsafe: vi.fn(async () => state._config),
    setClassifierConfig: vi.fn(async (_id: string, patch: any) => {
      state._config = { ...state._config, ...patch };
      return state._config;
    }),
  };
});

// Extend state with classifier config + model state used by the mocked module.
(state as any)._rules = [];
(state as any)._trainingExamples = [];
(state as any)._config = { mode: 'hybrid', accuracyThreshold: 0.8, autopilotEnabled: false };

// Now import the SUT.
import {
  runAutopilot,
  classifyOcrReceipt,
  __setOpenAIForTests,
  __test,
} from '../../server/services/receipt-autopilot.service';

beforeEach(() => {
  state.accounts = [
    { id: 'a-utilities', code: '6100', nameEn: 'Utilities Expense', type: 'expense', isActive: true, isArchived: false, isVatAccount: false },
    { id: 'a-meals', code: '6200', nameEn: 'Meals & Entertainment', type: 'expense', isActive: true, isArchived: false, isVatAccount: false },
    { id: 'a-comm', code: '6300', nameEn: 'Communication', type: 'expense', isActive: true, isArchived: false, isVatAccount: false },
    { id: 'a-other', code: '6900', nameEn: 'Other Expense', type: 'expense', isActive: true, isArchived: false, isVatAccount: false },
    { id: 'a-cash', code: '1100', nameEn: 'Cash on Hand', type: 'asset', subType: 'current_asset', isActive: true, isArchived: false, isVatAccount: false },
    { id: 'a-vat-input', code: '1500', nameEn: 'Input VAT', type: 'asset', subType: 'current_asset', isActive: true, isArchived: false, isVatAccount: true, vatType: 'input' },
  ];
  state.receipts = [];
  state.classifications = [];
  state.journalEntries = [];
  (state as any)._rules = [];
  (state as any)._trainingExamples = [];
  (state as any)._config = { mode: 'hybrid', accuracyThreshold: 0.8, autopilotEnabled: false };
  __setOpenAIForTests(null);
});

// =========================================================
// classifyOcrReceipt — single-receipt classification
// =========================================================

describe('classifyOcrReceipt', () => {
  it('classifies UAE merchants without DB hits', async () => {
    const r = await classifyOcrReceipt('co-1', { merchant: 'DEWA April', amount: 540 });
    expect(r.category).toBe('Utilities');
    expect(r.method).toBe('keyword');
  });
});

// =========================================================
// pickExpenseAccountForCategory / pickPaymentAccount
// =========================================================

describe('account-picking helpers', () => {
  it('matches account name directly when it contains the category', () => {
    const id = __test.pickExpenseAccountForCategory(state.accounts, 'Utilities');
    expect(id).toBe('a-utilities');
  });

  it('falls back to category synonyms', () => {
    // Replace 'Communication' account with one named "Telephone & Internet"
    state.accounts = state.accounts.map((a) =>
      a.id === 'a-comm' ? { ...a, nameEn: 'Telephone & Internet' } : a,
    );
    const id = __test.pickExpenseAccountForCategory(state.accounts, 'Communication');
    expect(id).toBe('a-comm');
  });

  it('returns the first generic expense account as a last resort', () => {
    // No matches → falls back to 'Other Expense'.
    state.accounts = state.accounts.filter((a) => a.id === 'a-other' || a.type !== 'expense');
    const id = __test.pickExpenseAccountForCategory(state.accounts, 'Travel');
    expect(id).toBe('a-other');
  });

  it('prefers cash over bank for the payment account', () => {
    state.accounts.push({ id: 'a-bank', nameEn: 'Bank — ENBD', type: 'asset', subType: 'current_asset', isActive: true, isArchived: false });
    expect(__test.pickPaymentAccount(state.accounts)).toBe('a-cash');
  });

  it('falls back to bank when there is no cash account', () => {
    state.accounts = state.accounts.filter((a) => a.id !== 'a-cash');
    state.accounts.push({ id: 'a-bank', nameEn: 'Bank — ENBD', type: 'asset', subType: 'current_asset', isActive: true, isArchived: false });
    expect(__test.pickPaymentAccount(state.accounts)).toBe('a-bank');
  });
});

// =========================================================
// runAutopilot — pipeline
// =========================================================

describe('runAutopilot pipeline', () => {
  const ocr = {
    merchant: 'DEWA April 2026',
    amount: 95.24,
    vatAmount: 4.76,
    total: 100,
    currency: 'AED',
    date: '2026-04-12',
  };

  it('always creates a receipt + classification row', async () => {
    const result = await runAutopilot('co-1', 'user-1', ocr);
    expect(result.receiptId).toBeTruthy();
    expect(result.classification.category).toBe('Utilities');
    expect(state.receipts.length).toBe(1);
    expect(state.classifications.length).toBe(1);
  });

  it('queues for review when autopilot is disabled', async () => {
    const result = await runAutopilot('co-1', 'user-1', ocr);
    expect(result.queuedForReview).toBe(true);
    expect(result.autoPosted).toBe(false);
    expect(result.journalEntryId).toBeNull();
  });

  it('does NOT auto-post when there is no matched rule (only keyword match)', async () => {
    (state as any)._config.autopilotEnabled = true;
    const result = await runAutopilot('co-1', 'user-1', ocr);
    expect(result.autoPosted).toBe(false); // keyword-only path requires a rule with ≥5 accepts
  });

  it('auto-posts when the company opted in AND a rule with ≥5 accepts AND confidence ≥0.9', async () => {
    (state as any)._config.autopilotEnabled = true;
    (state as any)._rules = [
      {
        id: 'rule-1',
        merchantPattern: 'DEWA April 2026',
        descriptionPattern: null,
        accountId: 'a-utilities',
        category: 'Utilities',
        confidence: 0.95,
        timesApplied: 10,
        timesAccepted: 9,
        timesRejected: 1,
      },
    ];
    const result = await runAutopilot('co-1', 'user-1', ocr);
    expect(result.classification.method).toBe('rule');
    expect(result.autoPosted).toBe(true);
    expect(result.journalEntryId).toBeTruthy();
    expect(state.journalEntries.length).toBe(1);
    // Receipt should be marked posted + auto_posted.
    const receipt = state.receipts[0];
    expect(receipt.posted).toBe(true);
    expect(receipt.autoPosted).toBe(true);
  });

  it('does NOT auto-post when rule has fewer than 5 accepts', async () => {
    (state as any)._config.autopilotEnabled = true;
    (state as any)._rules = [
      {
        id: 'rule-1',
        merchantPattern: 'DEWA April 2026',
        descriptionPattern: null,
        accountId: 'a-utilities',
        category: 'Utilities',
        confidence: 0.95,
        timesApplied: 6,
        timesAccepted: 4, // < 5
        timesRejected: 2,
      },
    ];
    const result = await runAutopilot('co-1', 'user-1', ocr);
    expect(result.classification.method).toBe('rule');
    expect(result.autoPosted).toBe(false);
  });

  it('records classifierMethod on the transaction_classifications row', async () => {
    await runAutopilot('co-1', 'user-1', ocr);
    expect(state.classifications[0].classifierMethod).toBe('keyword');
  });

  it('records classifierMethod on the receipt itself (drives Internal/AI badge)', async () => {
    await runAutopilot('co-1', 'user-1', ocr);
    expect(state.receipts[0].classifierMethod).toBe('keyword');
  });

  it('auto-posts a balanced 3-line entry (net + VAT input + cash) when a VAT input account exists', async () => {
    (state as any)._config.autopilotEnabled = true;
    (state as any)._rules = [
      {
        id: 'rule-vat',
        merchantPattern: 'DEWA April 2026',
        descriptionPattern: null,
        accountId: 'a-utilities',
        category: 'Utilities',
        confidence: 0.95,
        timesApplied: 10,
        timesAccepted: 9,
        timesRejected: 1,
      },
    ];
    const { storage } = await import('../../server/storage');
    const result = await runAutopilot('co-1', 'user-1', ocr);
    expect(result.autoPosted).toBe(true);

    const calls = (storage.createJournalEntry as any).mock.calls;
    // Mock fns accumulate calls across tests in the suite — read the latest call.
    const lines: Array<{ accountId: string; debit: number; credit: number }> = calls[calls.length - 1][1];
    // Three lines: expense (net), VAT input (vat), cash (gross credit)
    expect(lines).toHaveLength(3);
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    expect(totalDebit).toBeCloseTo(totalCredit, 6);
    expect(totalDebit).toBeCloseTo(100, 6);
    const expenseLine = lines.find((l) => l.accountId === 'a-utilities');
    const vatLine = lines.find((l) => l.accountId === 'a-vat-input');
    const cashLine = lines.find((l) => l.accountId === 'a-cash');
    expect(expenseLine).toBeDefined();
    expect(expenseLine!.debit).toBeCloseTo(95.24, 2);
    expect(vatLine).toBeDefined();
    expect(vatLine!.debit).toBeCloseTo(4.76, 2);
    expect(cashLine).toBeDefined();
    expect(cashLine!.credit).toBeCloseTo(100, 2);
  });

  it('auto-posts a balanced 2-line entry (gross expense + cash) when no VAT input account exists', async () => {
    // Drop the VAT input account.
    state.accounts = state.accounts.filter((a) => a.id !== 'a-vat-input');
    (state as any)._config.autopilotEnabled = true;
    (state as any)._rules = [
      {
        id: 'rule-novat',
        merchantPattern: 'DEWA April 2026',
        descriptionPattern: null,
        accountId: 'a-utilities',
        category: 'Utilities',
        confidence: 0.95,
        timesApplied: 10,
        timesAccepted: 9,
        timesRejected: 1,
      },
    ];
    const { storage } = await import('../../server/storage');
    const result = await runAutopilot('co-1', 'user-1', ocr);
    expect(result.autoPosted).toBe(true);

    const calls = (storage.createJournalEntry as any).mock.calls;
    const lines: Array<{ accountId: string; debit: number; credit: number }> = calls[calls.length - 1][1];
    expect(lines).toHaveLength(2);
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    expect(totalDebit).toBeCloseTo(totalCredit, 6);
    expect(totalDebit).toBeCloseTo(100, 6);
  });
});
