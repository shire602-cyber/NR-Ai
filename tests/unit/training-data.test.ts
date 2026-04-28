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
