/**
 * Phase 2 — Training data / classifier-stats tests.
 *
 * Mocks the Postgres pool so we can assert the failsafe logic without a real DB.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Per-test query script: the mock returns rows from this queue in order.
const queryScript: any[] = [];

vi.mock('../../server/db', () => ({
  pool: {
    query: vi.fn(async () => {
      const next = queryScript.shift();
      return next || { rows: [] };
    }),
  },
}));

vi.mock('../../server/storage', () => ({
  storage: {
    getCompany: vi.fn(async () => ({
      id: 'co-1',
      classifierConfig: { mode: 'hybrid', accuracyThreshold: 0.8, autopilotEnabled: false },
    })),
  },
}));

import {
  getModel,
  getModelStats,
  applyAccuracyFailsafe,
  setClassifierConfig,
  getClassifierConfig,
  invalidateModel,
  updateModel,
  clearAllModels,
} from '../../server/services/training-data.service';
import { pool } from '../../server/db';

beforeEach(() => {
  queryScript.length = 0;
  clearAllModels();
  // Restore the queryScript-based implementation. Earlier tests (notably the
  // thundering-herd block) call mockResolvedValue / mockRejectedValueOnce on
  // pool.query, which would otherwise persist and starve subsequent tests of
  // their scripted rows.
  (pool.query as any).mockReset();
  (pool.query as any).mockImplementation(async () => {
    const next = queryScript.shift();
    return next || { rows: [] };
  });
});

describe('getModelStats', () => {
  it('aggregates per-method accuracy and overall accuracy', async () => {
    queryScript.push({
      rows: [
        { method: 'rule', accepted: '40', rejected: '5', pending: '0', total: '45' },
        { method: 'keyword', accepted: '20', rejected: '5', pending: '5', total: '30' },
        { method: 'openai', accepted: '10', rejected: '2', pending: '1', total: '13' },
      ],
    });
    const stats = await getModelStats('co-1');
    expect(stats.totalAccepted).toBe(70);
    expect(stats.totalRejected).toBe(12);
    expect(stats.totalPending).toBe(6);
    // Overall = 70 / (70+12) ≈ 0.854
    expect(stats.overallAccuracy).toBeGreaterThan(0.8);
    const rule = stats.byMethod.find((m) => m.method === 'rule')!;
    expect(rule.accuracy).toBeCloseTo(40 / 45, 3);
  });

  it('marks a company below threshold once internal accuracy drops under 80% with enough samples', async () => {
    // 30 internal judged (15 accepted / 15 rejected) → 50% accuracy → below 80%
    queryScript.push({
      rows: [
        { method: 'rule', accepted: '5', rejected: '10', pending: '0', total: '15' },
        { method: 'keyword', accepted: '10', rejected: '5', pending: '0', total: '15' },
      ],
    });
    const stats = await getModelStats('co-1');
    expect(stats.belowThreshold).toBe(true);
  });

  it('does NOT mark below-threshold when sample size is too small', async () => {
    queryScript.push({
      rows: [
        { method: 'rule', accepted: '0', rejected: '5', pending: '0', total: '5' }, // 0% but only 5 samples
      ],
    });
    const stats = await getModelStats('co-1');
    expect(stats.belowThreshold).toBe(false);
  });

  it('reports zero accuracy gracefully when no judgments exist', async () => {
    queryScript.push({ rows: [] });
    const stats = await getModelStats('co-1');
    expect(stats.overallAccuracy).toBe(0);
    expect(stats.byMethod.every((m) => m.accuracy === 0)).toBe(true);
  });
});

describe('applyAccuracyFailsafe', () => {
  it('flips a hybrid company to openai_only when below threshold', async () => {
    // First call → getModelStats (querying classifications)
    queryScript.push({
      rows: [
        { method: 'rule', accepted: '5', rejected: '15', pending: '0', total: '20' },
        { method: 'keyword', accepted: '5', rejected: '10', pending: '0', total: '15' },
      ],
    });
    // Second call inside setClassifierConfig (UPDATE companies)
    queryScript.push({ rows: [] });

    const config = await applyAccuracyFailsafe('co-1');
    expect(config.mode).toBe('openai_only');
  });

  it('leaves an already-openai_only company alone', async () => {
    // Override storage mock for this test.
    const { storage } = await import('../../server/storage');
    (storage.getCompany as any).mockResolvedValueOnce({
      id: 'co-1',
      classifierConfig: { mode: 'openai_only', accuracyThreshold: 0.8, autopilotEnabled: false },
    });
    queryScript.push({
      rows: [
        { method: 'rule', accepted: '5', rejected: '15', pending: '0', total: '20' },
      ],
    });
    const config = await applyAccuracyFailsafe('co-1');
    expect(config.mode).toBe('openai_only');
  });
});

describe('setClassifierConfig', () => {
  it('persists patches via UPDATE companies', async () => {
    queryScript.push({ rows: [] });
    const next = await setClassifierConfig('co-1', { autopilotEnabled: true });
    expect(next.autopilotEnabled).toBe(true);
    expect(next.mode).toBe('hybrid'); // preserved from default
  });

  it('clamps a sub-floor accuracyThreshold up to 0.5', async () => {
    queryScript.push({ rows: [] });
    const next = await setClassifierConfig('co-1', { accuracyThreshold: 0.1 });
    expect(next.accuracyThreshold).toBe(0.5);
  });

  it('clamps a super-ceiling accuracyThreshold down to 0.99', async () => {
    queryScript.push({ rows: [] });
    const next = await setClassifierConfig('co-1', { accuracyThreshold: 1.5 });
    expect(next.accuracyThreshold).toBe(0.99);
  });

  it('accepts a threshold at the exact 0.5 floor', async () => {
    queryScript.push({ rows: [] });
    const next = await setClassifierConfig('co-1', { accuracyThreshold: 0.5 });
    expect(next.accuracyThreshold).toBe(0.5);
  });

  it('accepts a threshold at the exact 0.8 default', async () => {
    queryScript.push({ rows: [] });
    const next = await setClassifierConfig('co-1', { accuracyThreshold: 0.8 });
    expect(next.accuracyThreshold).toBe(0.8);
  });

  it('ignores unknown patch fields rather than persisting them', async () => {
    queryScript.push({ rows: [] });
    const next = await setClassifierConfig('co-1', { mode: 'banana' as any, accuracyThreshold: 'oops' as any });
    // mode falls through unchanged ('hybrid' default), threshold stays default.
    expect(next.mode).toBe('hybrid');
    expect(next.accuracyThreshold).toBe(0.8);
  });
});

describe('clampThreshold (via getClassifierConfig)', () => {
  it('clamps a malformed stored threshold up to the 0.5 floor', async () => {
    const { storage } = await import('../../server/storage');
    (storage.getCompany as any).mockResolvedValueOnce({
      id: 'co-1',
      classifierConfig: { mode: 'hybrid', accuracyThreshold: 0.0, autopilotEnabled: false },
    });
    const cfg = await getClassifierConfig('co-1');
    expect(cfg.accuracyThreshold).toBe(0.5);
  });

  it('falls back to default when stored threshold is non-finite', async () => {
    const { storage } = await import('../../server/storage');
    (storage.getCompany as any).mockResolvedValueOnce({
      id: 'co-1',
      classifierConfig: { mode: 'hybrid', accuracyThreshold: NaN, autopilotEnabled: false },
    });
    const cfg = await getClassifierConfig('co-1');
    // Non-numeric → fall through to DEFAULT_CLASSIFIER_CONFIG.accuracyThreshold (0.8).
    expect(cfg.accuracyThreshold).toBe(0.8);
  });
});

describe('updateModel', () => {
  it('forces a rebuild even when the cache is fresh', async () => {
    const queryMock = pool.query as any;
    queryMock.mockClear();
    queryMock.mockResolvedValue({ rows: [] });

    invalidateModel('co-fresh');
    const first = await getModel('co-fresh');
    const callsAfterFirst = queryMock.mock.calls.length;
    expect(callsAfterFirst).toBe(2); // rules + training examples

    // updateModel must invalidate then rebuild — a second pair of queries.
    const next = await updateModel('co-fresh');
    expect(queryMock.mock.calls.length).toBe(callsAfterFirst + 2);
    expect(next).not.toBe(first); // fresh promise / object
  });
});

describe('boundary sample sizes for the failsafe', () => {
  it('does NOT trip the failsafe with a single judged classification (way below MIN_SAMPLE)', async () => {
    queryScript.push({
      rows: [
        { method: 'rule', accepted: '0', rejected: '1', pending: '0', total: '1' },
      ],
    });
    const stats = await getModelStats('co-1');
    expect(stats.totalPredictions).toBe(1);
    expect(stats.belowThreshold).toBe(false);
  });

  it('does NOT trip the failsafe at exactly 19 internal judged (one shy of MIN_SAMPLE)', async () => {
    queryScript.push({
      rows: [
        { method: 'rule', accepted: '0', rejected: '19', pending: '0', total: '19' },
      ],
    });
    const stats = await getModelStats('co-1');
    expect(stats.belowThreshold).toBe(false);
  });

  it('trips the failsafe at exactly 20 internal judged with accuracy below threshold', async () => {
    queryScript.push({
      rows: [
        { method: 'rule', accepted: '10', rejected: '10', pending: '0', total: '20' }, // 50% < 80%
      ],
    });
    const stats = await getModelStats('co-1');
    expect(stats.belowThreshold).toBe(true);
  });
});

describe('classifier_method bucketing', () => {
  it('coalesces NULL/legacy classifier_method into the openai bucket', async () => {
    queryScript.push({
      rows: [
        // The SQL `COALESCE(classifier_method, 'openai')` collapses these rows.
        { method: 'openai', accepted: '5', rejected: '2', pending: '0', total: '7' },
      ],
    });
    const stats = await getModelStats('co-1');
    const openai = stats.byMethod.find((m) => m.method === 'openai')!;
    expect(openai.accepted).toBe(5);
    expect(openai.rejected).toBe(2);
    // The four canonical methods are always represented (zero-filled).
    expect(stats.byMethod.map((m) => m.method).sort()).toEqual(
      ['keyword', 'openai', 'rule', 'statistical'],
    );
  });
});

describe('getClassifierConfig defaults', () => {
  it('falls back to defaults when classifier_config is missing', async () => {
    const { storage } = await import('../../server/storage');
    (storage.getCompany as any).mockResolvedValueOnce({ id: 'co-1', classifierConfig: null });
    const cfg = await getClassifierConfig('co-1');
    expect(cfg.mode).toBe('hybrid');
    expect(cfg.accuracyThreshold).toBe(0.8);
    expect(cfg.autopilotEnabled).toBe(false);
  });
});

describe('getModel cache (thundering-herd protection)', () => {
  it('shares one in-flight build across concurrent first reads', async () => {
    // buildModel issues two pool.query calls (rules + training examples). With
    // a Promise cache, two concurrent getModel('co-x') calls should produce
    // exactly two queries — not four.
    const queryMock = pool.query as any;
    queryMock.mockClear();
    queryMock.mockResolvedValue({ rows: [] });

    invalidateModel('co-x');
    const [a, b] = await Promise.all([getModel('co-x'), getModel('co-x')]);
    expect(a).toBe(b); // same resolved object
    expect(queryMock.mock.calls.length).toBe(2);
  });

  it('evicts the cache entry when buildModel rejects so the next call retries', async () => {
    const queryMock = pool.query as any;
    queryMock.mockClear();
    queryMock.mockRejectedValueOnce(new Error('db down'));

    invalidateModel('co-y');
    await expect(getModel('co-y')).rejects.toThrow('db down');

    // Next call must rebuild (succeeds when the mock recovers) — proving the
    // failed promise was not left in the cache.
    queryMock.mockResolvedValue({ rows: [] });
    const recovered = await getModel('co-y');
    expect(recovered).toBeTruthy();
  });
});

describe('multi-tenancy isolation', () => {
  // The model cache is keyed by companyId. Building a model for company A
  // must never serve A's training data when company B asks for its model.
  it('caches a separate model per companyId — never cross-contaminates', async () => {
    // Company A: 1 rule + 1 training example
    queryScript.push({
      rows: [
        {
          id: 'rule-A',
          merchant_pattern: 'DEWA',
          description_pattern: null,
          account_id: 'acc-A',
          account_name: 'Utilities Expense',
          confidence: 0.9,
          times_applied: 10,
          times_accepted: 8,
          times_rejected: 2,
        },
      ],
    });
    queryScript.push({
      rows: [{ merchant: 'DEWA', category: 'Utilities', account_id: 'acc-A' }],
    });
    const modelA = await getModel('co-A');
    expect(modelA.rules).toHaveLength(1);
    expect(modelA.rules[0].id).toBe('rule-A');
    expect(modelA.trainingExamples).toHaveLength(1);

    // Company B: empty model
    queryScript.push({ rows: [] }); // rules
    queryScript.push({ rows: [] }); // training examples
    const modelB = await getModel('co-B');
    expect(modelB.rules).toHaveLength(0);
    expect(modelB.trainingExamples).toHaveLength(0);

    // Re-fetching company A's model must not have been clobbered by B's load.
    // No new query script entries pushed → if A's cache was lost the call
    // would return empty (the default mock returns { rows: [] }).
    const modelARefetched = await getModel('co-A');
    expect(modelARefetched.rules).toHaveLength(1);
    expect(modelARefetched.rules[0].id).toBe('rule-A');
  });

  it('invalidateModel only affects the targeted company', async () => {
    // Build co-A and co-B caches.
    queryScript.push({
      rows: [
        {
          id: 'rule-A',
          merchant_pattern: 'DEWA',
          description_pattern: null,
          account_id: 'acc-A',
          account_name: 'Utilities Expense',
          confidence: 0.9,
          times_applied: 10,
          times_accepted: 8,
          times_rejected: 2,
        },
      ],
    });
    queryScript.push({ rows: [] });
    await getModel('co-A');

    queryScript.push({ rows: [] });
    queryScript.push({ rows: [] });
    await getModel('co-B');

    // Invalidate ONLY co-A.
    invalidateModel('co-A');

    // co-A must reload (next call drains the script we push now).
    queryScript.push({
      rows: [
        {
          id: 'rule-A2',
          merchant_pattern: 'DEWA',
          description_pattern: null,
          account_id: 'acc-A',
          account_name: 'Utilities Expense',
          confidence: 0.92,
          times_applied: 11,
          times_accepted: 9,
          times_rejected: 2,
        },
      ],
    });
    queryScript.push({ rows: [] });
    const reloadedA = await getModel('co-A');
    expect(reloadedA.rules[0].id).toBe('rule-A2');

    // co-B must still serve its cached (empty) model — no new queries needed.
    const modelB = await getModel('co-B');
    expect(modelB.rules).toHaveLength(0);
    expect(modelB.trainingExamples).toHaveLength(0);
  });
});
