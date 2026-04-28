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
  getModelStats,
  applyAccuracyFailsafe,
  setClassifierConfig,
  getClassifierConfig,
  clearAllModels,
  getModel,
  invalidateModel,
} from '../../server/services/training-data.service';

beforeEach(() => {
  queryScript.length = 0;
  clearAllModels();
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
