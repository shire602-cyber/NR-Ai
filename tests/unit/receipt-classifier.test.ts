/**
 * Phase 2: Receipt Autopilot — Internal classifier tests.
 *
 * Pure-logic tests against the receipt-classifier service. We exercise each
 * stage of the pipeline (rule, keyword, statistical) and verify confidence
 * banding, threshold gating, and the OpenAI fallback path.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyReceipt,
  normalizeMerchant,
  isStandardCategory,
  STANDARD_CATEGORIES,
  __test,
  type CompanyRuleSnapshot,
  type InternalClassifierModel,
} from '../../server/services/receipt-classifier.service';

// ---------- helpers ----------

function emptyModel(): InternalClassifierModel {
  return { rules: [], trainingExamples: [], builtAt: Date.now() };
}

function makeRule(overrides: Partial<CompanyRuleSnapshot> = {}): CompanyRuleSnapshot {
  return {
    id: 'rule-1',
    merchantPattern: 'DEWA',
    descriptionPattern: null,
    accountId: 'acc-utilities',
    category: 'Utilities',
    confidence: 0.95,
    timesApplied: 10,
    timesAccepted: 9,
    timesRejected: 1,
    ...overrides,
  };
}

// =========================================================
// normalizeMerchant
// =========================================================

describe('normalizeMerchant', () => {
  it('lowercases and strips company suffixes', () => {
    expect(normalizeMerchant('Acme Trading LLC')).toBe('acme');
    expect(normalizeMerchant('ABC Co. Ltd')).toBe('abc');
    expect(normalizeMerchant('Foo FZCO')).toBe('foo');
  });

  it('returns empty string for null/undefined/empty input', () => {
    expect(normalizeMerchant(null)).toBe('');
    expect(normalizeMerchant(undefined)).toBe('');
    expect(normalizeMerchant('')).toBe('');
  });

  it('strips punctuation and collapses whitespace', () => {
    expect(normalizeMerchant('  DEWA   Bill - April  2026!  ')).toBe('dewa bill april 2026');
  });
});

// =========================================================
// Stage 1+2 — rule lookup
// =========================================================

describe('matchAgainstRules', () => {
  it('returns null when no merchant is provided', () => {
    expect(__test.matchAgainstRules('', [makeRule()])).toBeNull();
  });

  it('finds an exact normalized merchant match', () => {
    const rules = [makeRule({ merchantPattern: 'DEWA' })];
    const m = __test.matchAgainstRules('DEWA LLC', rules);
    expect(m?.matchType).toBe('exact');
    expect(m?.rule.id).toBe('rule-1');
  });

  it('skips rules with confidence ≤ 0.7 from the exact pass', () => {
    const rules = [makeRule({ confidence: 0.6 })];
    expect(__test.matchAgainstRules('DEWA', rules)).toBeNull();
  });

  it('skips rules with timesApplied ≤ 3 from the exact pass', () => {
    const rules = [makeRule({ timesApplied: 2 })];
    expect(__test.matchAgainstRules('DEWA', rules)).toBeNull();
  });

  it('falls back to fuzzy substring match on description_pattern', () => {
    const rules = [
      makeRule({ merchantPattern: null, descriptionPattern: 'salik', confidence: 0.6, timesApplied: 1 }),
    ];
    const m = __test.matchAgainstRules('Salik Tag April 2026', rules);
    expect(m?.matchType).toBe('fuzzy');
  });
});

// =========================================================
// Stage 3 — keyword classifier
// =========================================================

describe('keyword classifier', () => {
  it('routes UAE utility merchants to Utilities with high confidence', async () => {
    const result = await classifyReceipt({
      merchant: 'DEWA April 2026 bill',
      amount: 540,
      model: emptyModel(),
      options: { threshold: 0.8, mode: 'hybrid' },
      openai: null,
    });
    expect(result.category).toBe('Utilities');
    expect(result.method).toBe('keyword');
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('routes Etisalat to Communication', async () => {
    const result = await classifyReceipt({
      merchant: 'Etisalat business plan',
      amount: 250,
      model: emptyModel(),
      options: { threshold: 0.8, mode: 'hybrid' },
      openai: null,
    });
    expect(result.category).toBe('Communication');
    expect(result.method).toBe('keyword');
  });

  it('routes Careem to Travel', async () => {
    const result = await classifyReceipt({
      merchant: 'Careem ride',
      amount: 35,
      model: emptyModel(),
      options: { threshold: 0.8, mode: 'hybrid' },
      openai: null,
    });
    expect(result.category).toBe('Travel');
  });

  it('prefers high-specificity keywords when both match', async () => {
    // "rent" (medium) vs "DEWA" (high) — DEWA should win.
    const result = await classifyReceipt({
      merchant: 'DEWA Rent receipt April',
      amount: 100,
      model: emptyModel(),
      options: { threshold: 0.8, mode: 'hybrid' },
      openai: null,
    });
    expect(result.category).toBe('Utilities');
  });

  it('returns Other via fallback when nothing matches and no model is loaded', async () => {
    const result = await classifyReceipt({
      merchant: 'Random Name 12345',
      amount: 10,
      model: emptyModel(),
      options: { threshold: 0.8, mode: 'hybrid' },
      openai: null, // no fallback
    });
    expect(result.category).toBe('Other');
    expect(result.method).toBe('openai');
  });
});

// =========================================================
// Stage 4 — Naive Bayes statistical classifier
// =========================================================

describe('Naive Bayes statistical classifier', () => {
  it('learns from training examples', () => {
    const examples = Array.from({ length: 30 }, (_, i) => ({
      merchant: `Acme Stationery ${i}`,
      category: 'Office Supplies',
      accountId: null,
    }));
    const model = __test.buildNaiveBayes(examples);
    const prediction = __test.predictNaiveBayes(model, 'Acme Stationery 99');
    expect(prediction?.category).toBe('Office Supplies');
  });

  it('returns null for an empty model', () => {
    const model = __test.buildNaiveBayes([]);
    expect(__test.predictNaiveBayes(model, 'anything')).toBeNull();
  });

  it('caps statistical confidence below threshold when training volume is tiny', () => {
    // 3 examples → confidence should stay below 0.6 so the OpenAI fallback fires.
    const examples = [
      { merchant: 'Foo', category: 'Other', accountId: null },
      { merchant: 'Bar', category: 'Other', accountId: null },
      { merchant: 'Baz', category: 'Other', accountId: null },
    ];
    const m = __test.buildNaiveBayes(examples);
    const p = __test.predictNaiveBayes(m, 'Foo')!;
    const conf = __test.statisticalConfidence(p, examples.length);
    expect(conf).toBeLessThan(0.6);
  });

  it('boosts statistical confidence when volume is high and margin is decisive', () => {
    const examples: Array<{ merchant: string; category: string; accountId: null }> = [];
    for (let i = 0; i < 60; i++) {
      examples.push({ merchant: `Stationery World ${i}`, category: 'Office Supplies', accountId: null });
      examples.push({ merchant: `Cafe Latte ${i}`, category: 'Meals', accountId: null });
    }
    const m = __test.buildNaiveBayes(examples);
    const p = __test.predictNaiveBayes(m, 'Stationery World 999')!;
    const conf = __test.statisticalConfidence(p, examples.length);
    expect(conf).toBeGreaterThanOrEqual(0.7);
  });
});

// =========================================================
// classifyReceipt() pipeline
// =========================================================

describe('classifyReceipt pipeline', () => {
  it('matches a high-confidence rule before checking keywords', async () => {
    const model: InternalClassifierModel = {
      rules: [
        makeRule({
          merchantPattern: 'Etisalat', // Etisalat is normally a "Communication" keyword;
          category: 'Office Supplies', // rule overrides to a different category to prove ordering
          accountId: 'acc-office',
        }),
      ],
      trainingExamples: [],
      builtAt: Date.now(),
    };
    const result = await classifyReceipt({
      merchant: 'Etisalat Business Plan',
      amount: 100,
      model,
      options: { threshold: 0.8, mode: 'hybrid' },
      openai: null,
    });
    expect(result.method).toBe('rule');
    expect(result.category).toBe('Office Supplies');
    expect(result.accountId).toBe('acc-office');
    expect(result.matchedRuleId).toBe('rule-1');
  });

  it('falls through to keyword stage when rule confidence is too low', async () => {
    const model: InternalClassifierModel = {
      rules: [makeRule({ confidence: 0.4, timesApplied: 1, merchantPattern: 'NoMatch' })],
      trainingExamples: [],
      builtAt: Date.now(),
    };
    const result = await classifyReceipt({
      merchant: 'DEWA bill',
      amount: 50,
      model,
      options: { threshold: 0.8, mode: 'hybrid' },
      openai: null,
    });
    expect(result.method).toBe('keyword');
    expect(result.category).toBe('Utilities');
  });

  it('respects openai_only mode and skips internal stages', async () => {
    const fakeOpenAI = {
      chat: {
        completions: {
          create: async () => ({
            choices: [
              { message: { content: JSON.stringify({ category: 'Marketing', confidence: 0.9, reason: 'fake' }) } },
            ],
          }),
        },
      },
    };
    const result = await classifyReceipt({
      merchant: 'DEWA bill',
      amount: 50,
      model: emptyModel(),
      options: { threshold: 0.8, mode: 'openai_only' },
      openai: fakeOpenAI as any,
    });
    expect(result.method).toBe('openai');
    expect(result.category).toBe('Marketing');
  });

  it('falls back to OpenAI when internal confidence is below threshold', async () => {
    const calls: any[] = [];
    const fakeOpenAI = {
      chat: {
        completions: {
          create: async (req: any) => {
            calls.push(req);
            return {
              choices: [
                { message: { content: JSON.stringify({ category: 'Other', confidence: 0.85, reason: 'ok' }) } },
              ],
            };
          },
        },
      },
    };
    const result = await classifyReceipt({
      merchant: 'unknown vendor xyz', // matches nothing in keywords
      amount: 1,
      model: emptyModel(),
      options: { threshold: 0.95, mode: 'hybrid' },
      openai: fakeOpenAI as any,
    });
    expect(calls.length).toBe(1);
    expect(result.method).toBe('openai');
  });

  it('keeps best internal result when OpenAI fallback throws', async () => {
    const fakeOpenAI = {
      chat: {
        completions: {
          create: async () => {
            throw new Error('OpenAI down');
          },
        },
      },
    };
    const result = await classifyReceipt({
      merchant: 'DEWA',
      amount: 50,
      model: emptyModel(),
      // Threshold > keyword confidence (~0.85) so we'd normally hit OpenAI; throw → fall back to keyword.
      options: { threshold: 0.99, mode: 'hybrid' },
      openai: fakeOpenAI as any,
    });
    expect(result.method).toBe('keyword');
    expect(result.category).toBe('Utilities');
  });

  it('clamps OpenAI confidence into [0,1] and defaults Other when category is invalid', async () => {
    const fakeOpenAI = {
      chat: {
        completions: {
          create: async () => ({
            choices: [
              { message: { content: JSON.stringify({ category: 'Outer Space', confidence: 99 }) } },
            ],
          }),
        },
      },
    };
    const result = await classifyReceipt({
      merchant: 'mystery vendor',
      amount: 1,
      model: emptyModel(),
      options: { threshold: 0.8, mode: 'openai_only' },
      openai: fakeOpenAI as any,
    });
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.category).toBe('Other');
  });
});

// =========================================================
// Coverage of every standard category by keyword
// =========================================================

describe('keyword coverage', () => {
  it('exposes 12 standard categories', () => {
    expect(STANDARD_CATEGORIES.length).toBe(12);
  });

  it('isStandardCategory only accepts known categories', () => {
    expect(isStandardCategory('Travel')).toBe(true);
    expect(isStandardCategory('Bogus')).toBe(false);
    expect(isStandardCategory(null)).toBe(false);
  });

  it('keyword catalogue covers each non-Other category at least once', () => {
    const covered = new Set(__test.KEYWORD_RULES.map((r) => r.category));
    for (const cat of STANDARD_CATEGORIES) {
      if (cat === 'Other') continue;
      expect(covered.has(cat)).toBe(true);
    }
  });
});

// =========================================================
// Word-boundary keywords: ' du ', 'hp ', 'meta ' must match
// at the START or END of the haystack as well as the middle
// =========================================================

describe('keyword word-boundary matching', () => {
  it('matches " du " at the very start of the merchant', () => {
    // Pre-fix: haystack was "du telecom" with no leading space, so " du "
    // missed. After padding, it should hit Communication.
    const hit = __test.matchKeywords('DU Telecom');
    expect(hit?.category).toBe('Communication');
  });

  it('matches "hp " at the very end of the merchant', () => {
    const hit = __test.matchKeywords('Buy new HP');
    expect(hit?.category).toBe('Equipment');
  });

  it('matches "meta " at the very end of the merchant', () => {
    const hit = __test.matchKeywords('Ad spend with Meta');
    expect(hit?.category).toBe('Marketing');
  });
});
