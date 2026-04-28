/**
 * Phase 2: Receipt Autopilot — Training Data Manager
 *
 * Loads `transaction_classifications` + `ai_company_rules` for a company and
 * shapes them into the `InternalClassifierModel` consumed by the receipt
 * classifier. Models are cached in-process per companyId; the cache is
 * invalidated whenever new feedback arrives.
 *
 * Stats are computed by counting rows in `transaction_classifications` grouped
 * by `classifier_method` × `was_accepted`. The overall accuracy and per-method
 * accuracy power the auto-failsafe that flips a company to `openai_only` mode.
 */

import { pool } from '../db';
import { storage } from '../storage';
import {
  type InternalClassifierModel,
  type CompanyRuleSnapshot,
  type TrainingExample,
  STANDARD_CATEGORIES,
} from './receipt-classifier.service';
import {
  type ClassifierMethod,
  type ClassifierConfig,
  DEFAULT_CLASSIFIER_CONFIG,
} from '../../shared/schema';
import { createLogger } from '../config/logger';

const log = createLogger('training-data');

// =============================================
// Cache
// =============================================
// Keyed by companyId. Eviction is manual via invalidateModel(); a TTL backstop
// keeps a long-lived process from serving indefinitely-stale models.
//
// We cache the in-flight Promise rather than the resolved model so concurrent
// first-time reads share one DB build (no thundering herd). Rejected promises
// are evicted so a transient failure doesn't poison subsequent reads.
const MODEL_TTL_MS = 5 * 60 * 1000;
interface CacheEntry {
  promise: Promise<InternalClassifierModel>;
  builtAt: number;
}
const modelCache = new Map<string, CacheEntry>();

export function invalidateModel(companyId: string): void {
  modelCache.delete(companyId);
}

export function clearAllModels(): void {
  modelCache.clear();
}

// =============================================
// Build / load model
// =============================================

export async function getModel(companyId: string): Promise<InternalClassifierModel> {
  const cached = modelCache.get(companyId);
  if (cached && Date.now() - cached.builtAt < MODEL_TTL_MS) {
    return cached.promise;
  }

  const builtAt = Date.now();
  const promise = buildModel(companyId);
  const entry: CacheEntry = { promise, builtAt };
  modelCache.set(companyId, entry);
  // On rejection, evict so the next call rebuilds instead of replaying the
  // failure. Guard against a concurrent write replacing this entry.
  promise.catch((err) => {
    if (modelCache.get(companyId) === entry) {
      modelCache.delete(companyId);
    }
    log.warn({ err: err?.message || err, companyId }, 'buildModel failed — cache evicted');
  });
  return promise;
}

export async function updateModel(companyId: string): Promise<InternalClassifierModel> {
  invalidateModel(companyId);
  return getModel(companyId);
}

async function buildModel(companyId: string): Promise<InternalClassifierModel> {
  const [rules, examples] = await Promise.all([
    loadRules(companyId),
    loadTrainingExamples(companyId),
  ]);

  return {
    rules,
    trainingExamples: examples,
    builtAt: Date.now(),
  };
}

async function loadRules(companyId: string): Promise<CompanyRuleSnapshot[]> {
  const { rows } = await pool.query(
    `SELECT
       r.id,
       r.merchant_pattern,
       r.description_pattern,
       r.account_id,
       a.name_en AS account_name,
       a.type AS account_type,
       r.confidence::float AS confidence,
       r.times_applied,
       r.times_accepted,
       r.times_rejected
     FROM ai_company_rules r
     LEFT JOIN accounts a ON a.id = r.account_id
     WHERE r.company_id = $1 AND r.is_active = true
     ORDER BY r.times_accepted DESC, r.confidence DESC`,
    [companyId],
  );

  return rows.map((r: any) => ({
    id: r.id,
    merchantPattern: r.merchant_pattern,
    descriptionPattern: r.description_pattern,
    accountId: r.account_id,
    // Map account name → standard category when we can; otherwise null and the
    // pipeline will default the category to 'Other' if the rule fires.
    category: deriveCategoryFromAccountName(r.account_name),
    confidence: r.confidence ?? 0.5,
    timesApplied: r.times_applied || 0,
    timesAccepted: r.times_accepted || 0,
    timesRejected: r.times_rejected || 0,
  }));
}

async function loadTrainingExamples(companyId: string): Promise<TrainingExample[]> {
  const { rows } = await pool.query(
    `SELECT
       COALESCE(tc.merchant, tc.description) AS merchant,
       tc.suggested_category AS category,
       tc.user_selected_account_id AS account_id
     FROM transaction_classifications tc
     WHERE tc.company_id = $1
       AND tc.was_accepted = true
       AND COALESCE(tc.merchant, tc.description) IS NOT NULL
       AND tc.suggested_category IS NOT NULL`,
    [companyId],
  );

  return rows.map((r: any) => ({
    merchant: r.merchant,
    category: r.category,
    accountId: r.account_id,
  }));
}

// Heuristic: try to map an expense-account name to one of the 12 standard
// receipt categories. If nothing matches we return null and the classifier
// will fall back to 'Other' for category but still emit the accountId.
function deriveCategoryFromAccountName(accountName: string | null | undefined): string | null {
  if (!accountName) return null;
  const lower = accountName.toLowerCase();
  // Direct contains match against the canonical category names first.
  for (const c of STANDARD_CATEGORIES) {
    if (lower.includes(c.toLowerCase())) return c;
  }
  // Then a few common synonyms.
  if (lower.includes('utility') || lower.includes('utilities') || lower.includes('water') || lower.includes('electric')) return 'Utilities';
  if (lower.includes('telecom') || lower.includes('phone') || lower.includes('internet')) return 'Communication';
  if (lower.includes('transport') || lower.includes('vehicle') || lower.includes('fuel')) return 'Travel';
  if (lower.includes('food') || lower.includes('catering') || lower.includes('entertainment')) return 'Meals';
  if (lower.includes('advertis')) return 'Marketing';
  if (lower.includes('repair')) return 'Maintenance';
  if (lower.includes('legal') || lower.includes('audit') || lower.includes('professional')) return 'Professional Services';
  return null;
}

// =============================================
// Stats — used for the AI Accuracy dashboard + failsafe
// =============================================

export interface MethodStats {
  method: ClassifierMethod;
  totalPredictions: number;
  accepted: number;
  rejected: number;
  pending: number;
  accuracy: number; // accepted / (accepted + rejected); 0 if both are 0
}

export interface ModelStats {
  companyId: string;
  totalPredictions: number;
  totalAccepted: number;
  totalRejected: number;
  totalPending: number;
  overallAccuracy: number;
  byMethod: MethodStats[];
  /** Below threshold: failsafe should switch the company to openai_only. */
  belowThreshold: boolean;
  threshold: number;
  config: ClassifierConfig;
}

const ALL_METHODS: ClassifierMethod[] = ['rule', 'keyword', 'statistical', 'openai'];

export async function getModelStats(companyId: string): Promise<ModelStats> {
  const config = await getClassifierConfig(companyId);

  const { rows } = await pool.query(
    `SELECT
       COALESCE(classifier_method, 'openai') AS method,
       COUNT(*) FILTER (WHERE was_accepted = true)  AS accepted,
       COUNT(*) FILTER (WHERE was_accepted = false) AS rejected,
       COUNT(*) FILTER (WHERE was_accepted IS NULL) AS pending,
       COUNT(*) AS total
     FROM transaction_classifications
     WHERE company_id = $1
     GROUP BY COALESCE(classifier_method, 'openai')`,
    [companyId],
  );

  const byMethod = ALL_METHODS.map((method) => {
    const row = rows.find((r: any) => r.method === method);
    const accepted = row ? parseInt(row.accepted, 10) || 0 : 0;
    const rejected = row ? parseInt(row.rejected, 10) || 0 : 0;
    const pending = row ? parseInt(row.pending, 10) || 0 : 0;
    const totalPredictions = accepted + rejected + pending;
    const judged = accepted + rejected;
    return {
      method,
      totalPredictions,
      accepted,
      rejected,
      pending,
      accuracy: judged > 0 ? accepted / judged : 0,
    };
  });

  const totalAccepted = byMethod.reduce((s, m) => s + m.accepted, 0);
  const totalRejected = byMethod.reduce((s, m) => s + m.rejected, 0);
  const totalPending = byMethod.reduce((s, m) => s + m.pending, 0);
  const totalPredictions = totalAccepted + totalRejected + totalPending;
  const judged = totalAccepted + totalRejected;
  const overallAccuracy = judged > 0 ? totalAccepted / judged : 0;

  // Failsafe — only consider the internal methods (rule/keyword/statistical)
  // when judging whether to flip to openai_only. We use a minimum-judged-count
  // floor so a single rejection on a brand-new company doesn't flip everything.
  const internalMethods = byMethod.filter((m) => m.method !== 'openai');
  const internalAccepted = internalMethods.reduce((s, m) => s + m.accepted, 0);
  const internalRejected = internalMethods.reduce((s, m) => s + m.rejected, 0);
  const internalJudged = internalAccepted + internalRejected;
  const internalAccuracy = internalJudged > 0 ? internalAccepted / internalJudged : 1;

  const MIN_SAMPLE = 20;
  const belowThreshold = internalJudged >= MIN_SAMPLE && internalAccuracy < config.accuracyThreshold;

  return {
    companyId,
    totalPredictions,
    totalAccepted,
    totalRejected,
    totalPending,
    overallAccuracy,
    byMethod,
    belowThreshold,
    threshold: config.accuracyThreshold,
    config,
  };
}

// =============================================
// Per-company config helpers
// =============================================

// Floor / ceiling for the per-company accuracy threshold. We refuse anything
// below 0.5 because (a) it makes the OpenAI fallback unreachable in hybrid mode
// for any successful internal classification, and (b) `internalAccuracy <
// threshold` becomes impossible at threshold 0, neutralising the auto-failsafe.
// The 0.99 cap leaves the failsafe condition satisfiable but lets careful
// users run very strict.
const MIN_ACCURACY_THRESHOLD = 0.5;
const MAX_ACCURACY_THRESHOLD = 0.99;

function clampThreshold(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CLASSIFIER_CONFIG.accuracyThreshold;
  return Math.min(MAX_ACCURACY_THRESHOLD, Math.max(MIN_ACCURACY_THRESHOLD, value));
}

export async function getClassifierConfig(companyId: string): Promise<ClassifierConfig> {
  const company = await storage.getCompany(companyId);
  if (!company) return { ...DEFAULT_CLASSIFIER_CONFIG };
  const cfg = company.classifierConfig as Partial<ClassifierConfig> | null;
  if (!cfg) return { ...DEFAULT_CLASSIFIER_CONFIG };
  return {
    mode: cfg.mode === 'openai_only' ? 'openai_only' : 'hybrid',
    accuracyThreshold:
      typeof cfg.accuracyThreshold === 'number'
        ? clampThreshold(cfg.accuracyThreshold)
        : DEFAULT_CLASSIFIER_CONFIG.accuracyThreshold,
    autopilotEnabled: !!cfg.autopilotEnabled,
  };
}

export async function setClassifierConfig(
  companyId: string,
  patch: Partial<ClassifierConfig>,
): Promise<ClassifierConfig> {
  const current = await getClassifierConfig(companyId);
  // Defense-in-depth: even if a service-layer caller bypasses the route schema,
  // we re-clamp the threshold and whitelist the mode here.
  const sanitizedPatch: Partial<ClassifierConfig> = {};
  if (patch.mode === 'hybrid' || patch.mode === 'openai_only') sanitizedPatch.mode = patch.mode;
  if (typeof patch.accuracyThreshold === 'number') {
    sanitizedPatch.accuracyThreshold = clampThreshold(patch.accuracyThreshold);
  }
  if (typeof patch.autopilotEnabled === 'boolean') sanitizedPatch.autopilotEnabled = patch.autopilotEnabled;
  const next: ClassifierConfig = { ...current, ...sanitizedPatch };
  await pool.query(
    `UPDATE companies SET classifier_config = $1::jsonb WHERE id = $2`,
    [JSON.stringify(next), companyId],
  );
  invalidateModel(companyId);
  return next;
}

/**
 * Auto-failsafe: when internal accuracy drops below threshold, flip the company
 * to openai_only mode. Returns the resulting config so callers can log it.
 */
export async function applyAccuracyFailsafe(companyId: string): Promise<ClassifierConfig> {
  const stats = await getModelStats(companyId);
  if (stats.belowThreshold && stats.config.mode === 'hybrid') {
    log.warn(
      { companyId, accuracy: stats.overallAccuracy, threshold: stats.threshold },
      'Internal classifier accuracy below threshold — switching company to openai_only',
    );
    return setClassifierConfig(companyId, { mode: 'openai_only' });
  }
  return stats.config;
}
