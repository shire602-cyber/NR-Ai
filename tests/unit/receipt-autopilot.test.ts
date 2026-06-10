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
    updateReceipt: vi.fn(async (id: string, _companyId: string, patch: any) => {
      const r = state.receipts.find((x) => x.id === id);
      Object.assign(r, patch);
      return r;
    }),
    createTransactionClassification: vi.fn(async (c: any) => {
      const row = { id: `c-${state.classifications.length + 1}`, ...c };
      state.classifications.push(row);
      return row;
    }),
    updateTransactionClassification: vi.fn(async (id: string, companyId: string, patch: any) => {
      const c = state.classifications.find((x) => x.id === id && x.companyId === companyId);
      if (!c) throw new Error('Transaction classification not found');
      Object.assign(c, patch);
      return c;
    }),
    hasCompanyAccess: vi.fn(async () => true),
    generateEntryNumber: vi.fn(async () => 'JE-TEST-001'),
    createJournalEntry: vi.fn(async (entry: any, lines: any[]) => {
      // Mirror the production assertion so tests fail loudly on an unbalanced
      // entry rather than silently swallowing the bug.
      const totalDebit = lines.reduce((s: number, l: any) => s + (Number(l.debit) || 0), 0);
      const totalCredit = lines.reduce((s: number, l: any) => s + (Number(l.credit) || 0), 0);
      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        throw new Error(`Test mock: unbalanced entry ${totalDebit} vs ${totalCredit}`);
      }
      const row = { id: `je-${state.journalEntries.length + 1}`, ...entry, lines };
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
  recordClassificationFeedback,
  __setOpenAIForTests,
  __test,
} from '../../server/services/receipt-autopilot.service';
import {
  invalidateModel as invalidateModelMock,
  applyAccuracyFailsafe as applyAccuracyFailsafeMock,
} from '../../server/services/training-data.service';
import { storage as storageMock } from '../../server/storage';

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

  // ---------- regression coverage for the auto-post fixes ----------

  function highConfidenceRule() {
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
  }

  it('auto-posts a balanced 3-line entry when a VAT input account exists', async () => {
    highConfidenceRule();
    const result = await runAutopilot('co-1', 'user-1', ocr);
    expect(result.autoPosted).toBe(true);
    const je = state.journalEntries[0];
    expect(je.lines).toHaveLength(3);
    const [expense, vatLine, payment] = je.lines;
    expect(expense.accountId).toBe('a-utilities');
    expect(expense.debit).toBeCloseTo(95.24, 2);
    expect(vatLine.accountId).toBe('a-vat-input');
    expect(vatLine.debit).toBeCloseTo(4.76, 2);
    expect(payment.accountId).toBe('a-cash');
    expect(payment.credit).toBeCloseTo(100, 2);
  });

  it('falls back to a 2-line entry when no VAT input account is configured', async () => {
    state.accounts = state.accounts.filter((a) => a.id !== 'a-vat-input');
    highConfidenceRule();
    const result = await runAutopilot('co-1', 'user-1', ocr);
    expect(result.autoPosted).toBe(true);
    const je = state.journalEntries[0];
    expect(je.lines).toHaveLength(2);
    // Without a VAT split, the entry should still balance — gross flows
    // straight to the expense line.
    const sumDebit = je.lines.reduce((s: number, l: any) => s + l.debit, 0);
    const sumCredit = je.lines.reduce((s: number, l: any) => s + l.credit, 0);
    expect(sumDebit).toBeCloseTo(sumCredit, 2);
  });

  it('still produces a balanced entry when OCR net+vat disagrees with total', async () => {
    // Real-world OCR rounding: 95.24 + 4.78 = 100.02, but reported total is
    // 100.00. Auto-post must derive total from net+vat so the journal entry
    // balances and is not bounced into manual review.
    highConfidenceRule();
    const result = await runAutopilot('co-1', 'user-1', {
      ...ocr,
      vatAmount: 4.78,
      total: 100, // intentionally inconsistent with net+vat
    });
    expect(result.autoPosted).toBe(true);
    const je = state.journalEntries[0];
    const sumDebit = je.lines.reduce((s: number, l: any) => s + l.debit, 0);
    const sumCredit = je.lines.reduce((s: number, l: any) => s + l.credit, 0);
    expect(Math.abs(sumDebit - sumCredit)).toBeLessThanOrEqual(0.01);
    expect(sumCredit).toBeCloseTo(100.02, 2); // gross derived from net+vat, not OCR total
  });

  it('does NOT auto-post when amount is zero, even with high confidence + accepted rule', async () => {
    highConfidenceRule();
    const result = await runAutopilot('co-1', 'user-1', { ...ocr, amount: 0, vatAmount: 0, total: 0 });
    expect(result.autoPosted).toBe(false);
    expect(result.queuedForReview).toBe(true);
    expect(state.journalEntries).toHaveLength(0);
  });

  it('does NOT auto-post when amount is negative', async () => {
    highConfidenceRule();
    const result = await runAutopilot('co-1', 'user-1', { ...ocr, amount: -50, vatAmount: 0, total: -50 });
    expect(result.autoPosted).toBe(false);
    expect(result.queuedForReview).toBe(true);
  });

  it('does not crash when merchant is null (defense-in-depth past the route)', async () => {
    const result = await runAutopilot('co-1', 'user-1', { ...ocr, merchant: null as any });
    // Empty merchant → no internal match → OpenAI fallback unavailable →
    // 'Other' at 0.3 confidence → cannot auto-post. Receipt still recorded.
    expect(result.autoPosted).toBe(false);
    expect(result.receiptId).toBeTruthy();
    expect(state.receipts[0].merchant).toBe('');
  });

  // ---------- confidence boundary regression ----------
  // The auto-post gate is `confidence >= 0.9`. We pin both sides of the
  // boundary so a future refactor cannot silently change the threshold.

  it('auto-posts at the exact 0.9 confidence boundary', async () => {
    (state as any)._config.autopilotEnabled = true;
    (state as any)._rules = [
      {
        id: 'rule-1',
        merchantPattern: 'DEWA April 2026',
        descriptionPattern: null,
        accountId: 'a-utilities',
        category: 'Utilities',
        confidence: 0.9, // exact boundary
        timesApplied: 10,
        timesAccepted: 9,
        timesRejected: 1,
      },
    ];
    const result = await runAutopilot('co-1', 'user-1', ocr);
    expect(result.autoPosted).toBe(true);
  });

  it('does NOT auto-post just below the 0.9 confidence boundary', async () => {
    (state as any)._config.autopilotEnabled = true;
    (state as any)._rules = [
      {
        id: 'rule-1',
        merchantPattern: 'DEWA April 2026',
        descriptionPattern: null,
        accountId: 'a-utilities',
        category: 'Utilities',
        confidence: 0.89, // just under the boundary
        timesApplied: 10,
        timesAccepted: 9,
        timesRejected: 1,
      },
    ];
    const result = await runAutopilot('co-1', 'user-1', ocr);
    expect(result.classification.method).toBe('rule');
    expect(result.autoPosted).toBe(false);
    expect(result.queuedForReview).toBe(true);
  });

  it('auto-posts at the exact 5-accept boundary (timesAccepted === 5)', async () => {
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
        timesAccepted: 5, // exact boundary
        timesRejected: 1,
      },
    ];
    const result = await runAutopilot('co-1', 'user-1', ocr);
    expect(result.autoPosted).toBe(true);
  });

  // ---------- regression: foreign-currency must not auto-post ----------

  it('does NOT auto-post when currency is non-AED, even with high confidence + accepted rule', async () => {
    highConfidenceRule();
    const result = await runAutopilot('co-1', 'user-1', { ...ocr, currency: 'USD' });
    // Auto-posting USD numbers as AED in the GL would be a real-money mistake.
    // The pipeline must queue these for manual review until FX is wired in.
    expect(result.autoPosted).toBe(false);
    expect(result.queuedForReview).toBe(true);
    expect(state.journalEntries).toHaveLength(0);
  });

  it('still auto-posts when currency is "aed" (case-insensitive)', async () => {
    highConfidenceRule();
    const result = await runAutopilot('co-1', 'user-1', { ...ocr, currency: 'aed' });
    expect(result.autoPosted).toBe(true);
  });

  // ---------- regression: archived rule account must not be used for auto-post ----------

  it('falls back to category pick when rule account has been archived', async () => {
    (state as any)._config.autopilotEnabled = true;
    (state as any)._rules = [
      {
        id: 'rule-1',
        merchantPattern: 'DEWA April 2026',
        descriptionPattern: null,
        accountId: 'a-archived', // an account NOT in state.accounts
        category: 'Utilities',
        confidence: 0.95,
        timesApplied: 10,
        timesAccepted: 9,
        timesRejected: 1,
      },
    ];
    const result = await runAutopilot('co-1', 'user-1', ocr);
    // We should still auto-post — but to the live Utilities Expense account,
    // not the archived one named in the rule.
    expect(result.autoPosted).toBe(true);
    const je = state.journalEntries[0];
    const debitLine = je.lines.find((l: any) => l.debit > 0 && l.accountId !== 'a-vat-input');
    expect(debitLine.accountId).toBe('a-utilities');
  });

  // ---------- regression: post-JE failures preserve autoPosted: true ----------

  it('returns autoPosted: true when JE is created even if the receipt link update fails', async () => {
    highConfidenceRule();
    const { storage: mockedStorage } = await import('../../server/storage');
    // Simulate DB blip on the post-JE updateReceipt — the JE itself succeeds.
    (mockedStorage.updateReceipt as any).mockImplementationOnce(async () => {
      throw new Error('connection lost');
    });
    const result = await runAutopilot('co-1', 'user-1', ocr);
    // The JE was created, so the response must report autoPosted: true. A false
    // response would diverge from DB reality (the JE row exists).
    expect(result.autoPosted).toBe(true);
    expect(result.journalEntryId).toBeTruthy();
    expect(state.journalEntries).toHaveLength(1);
  });
});

// =========================================================
// recordClassificationFeedback
// =========================================================

describe('recordClassificationFeedback', () => {
  it('updates the classification row, invalidates cache, and runs the failsafe', async () => {
    // Seed a classification row to update.
    const cls = await storageMock.createTransactionClassification({
      companyId: 'co-1',
      description: 'DEWA',
      merchant: 'DEWA',
      amount: 100,
      suggestedAccountId: 'a-utilities',
      suggestedCategory: 'Utilities',
      aiConfidence: 0.95,
      aiReason: 'rule match',
      classifierMethod: 'rule',
    } as any);

    (invalidateModelMock as any).mockClear?.();
    (applyAccuracyFailsafeMock as any).mockClear?.();

    await recordClassificationFeedback('co-1', cls.id, true, 'a-utilities');

    const stored = state.classifications.find((c) => c.id === cls.id)!;
    expect(stored.wasAccepted).toBe(true);
    expect(stored.userSelectedAccountId).toBe('a-utilities');
    // Cache must be invalidated so the next prediction uses fresh training data.
    expect(invalidateModelMock).toHaveBeenCalledWith('co-1');
    // Failsafe runs after every feedback to flip below-threshold companies.
    expect(applyAccuracyFailsafeMock).toHaveBeenCalledWith('co-1');
  });

  it('records a rejection without overwriting a missing userSelectedAccountId', async () => {
    const cls = await storageMock.createTransactionClassification({
      companyId: 'co-1',
      description: 'unknown vendor',
      merchant: 'unknown vendor',
      amount: 10,
      suggestedAccountId: 'a-other',
      suggestedCategory: 'Other',
      aiConfidence: 0.4,
      aiReason: 'low conf',
      classifierMethod: 'openai',
    } as any);

    await recordClassificationFeedback('co-1', cls.id, false);

    const stored = state.classifications.find((c) => c.id === cls.id)!;
    expect(stored.wasAccepted).toBe(false);
    expect(stored.userSelectedAccountId).toBeUndefined();
  });
});

// =========================================================
// recordClassificationFeedback — multi-tenancy defense-in-depth
// =========================================================

describe('recordClassificationFeedback companyId scoping', () => {
  // The storage layer scopes UPDATE by (id, company_id). A regression in the
  // route that lets a feedback request through with the wrong companyId must
  // not silently mutate another tenant's row.
  it('refuses to update a row that exists under a different companyId', async () => {
    state.classifications.push({
      id: 'c-foreign',
      companyId: 'co-other',
      wasAccepted: null,
      userSelectedAccountId: null,
    });
    await expect(
      recordClassificationFeedback('co-1', 'c-foreign', true, null),
    ).rejects.toThrow(/Transaction classification not found/);
    // The foreign row must remain untouched.
    const foreign = state.classifications.find((x) => x.id === 'c-foreign');
    expect(foreign.wasAccepted).toBeNull();
  });
});
