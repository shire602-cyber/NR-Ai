/**
 * Phase 2: Receipt Autopilot — Internal Receipt Classifier
 *
 * Pure-logic classifier with a 4-stage pipeline (rule → keyword → statistical → OpenAI):
 *   1. Exact merchant match against `ai_company_rules` (confidence > 0.7, applied > 3 times).
 *   2. Fuzzy merchant match (normalized substring) against the same table.
 *   3. UAE-specific keyword classifier covering the 12 standard receipt categories.
 *   4. Naive Bayes with Laplace smoothing trained on accepted classifications.
 *
 * Anything below the configured confidence threshold (default 0.8) is escalated to
 * the OpenAI fallback by the caller — this service exposes the deterministic stages.
 *
 * The 12 standard categories live in `STANDARD_CATEGORIES`. Any change must stay in
 * sync with the OCR/AI routes that already validate against the same list.
 */

import type OpenAI from 'openai';
import type { ClassifierMethod } from '../../shared/schema';
import { createLogger } from '../config/logger';

const log = createLogger('receipt-classifier');

// =============================================
// Types
// =============================================

export const STANDARD_CATEGORIES = [
  'Office Supplies',
  'Utilities',
  'Travel',
  'Meals',
  'Rent',
  'Marketing',
  'Equipment',
  'Professional Services',
  'Insurance',
  'Maintenance',
  'Communication',
  'Other',
] as const;

export type StandardCategory = (typeof STANDARD_CATEGORIES)[number];

export interface CompanyRuleSnapshot {
  id: string;
  merchantPattern: string | null;
  descriptionPattern: string | null;
  accountId: string;
  category: string | null;
  confidence: number;
  timesApplied: number;
  timesAccepted: number;
  timesRejected: number;
}

export interface TrainingExample {
  merchant: string;
  category: string;
  accountId: string | null;
}

export interface InternalClassifierModel {
  /** Active rules from ai_company_rules + their derived account category. */
  rules: CompanyRuleSnapshot[];
  /** Accepted historical classifications (used for Naive Bayes training). */
  trainingExamples: TrainingExample[];
  /** Cached at — for debugging only; cache invalidation is done in the training-data service. */
  builtAt: number;
}

export interface ClassifyOptions {
  /** Minimum confidence we will accept from the internal pipeline. Below → OpenAI. */
  threshold: number;
  /** When 'openai_only', skip the deterministic pipeline entirely. */
  mode: 'hybrid' | 'openai_only';
}

export interface ClassificationResult {
  category: StandardCategory;
  accountId: string | null;
  confidence: number;
  method: ClassifierMethod;
  reason: string;
  /** When set, the caller should record the matched rule id (so times_applied increments). */
  matchedRuleId?: string;
}

// =============================================
// UAE keyword patterns — Phase 2 spec
// =============================================
//
// Each entry is { category, keywords[], specificity }. Specificity drives the
// confidence band: highly distinctive merchant names (DEWA, Etisalat) get 0.85;
// generic keywords (rent, marketing, repair) get 0.65–0.75.

interface KeywordRule {
  category: StandardCategory;
  keywords: string[];
  specificity: 'high' | 'medium' | 'low';
}

const KEYWORD_RULES: KeywordRule[] = [
  // Utilities — UAE utility providers are highly distinctive.
  {
    category: 'Utilities',
    keywords: ['dewa', 'sewa', 'fewa', 'addc', 'aadc', 'tawreed'],
    specificity: 'high',
  },
  // Communication — telecom + meeting/SaaS comms providers.
  {
    category: 'Communication',
    keywords: ['etisalat', ' du ', 'virgin mobile', 'stc', 'zoom', 'microsoft teams', 'slack', 'webex', 'internet'],
    specificity: 'high',
  },
  // Travel — UAE transport + ride-hail + airlines + tolls + parking.
  {
    category: 'Travel',
    keywords: [
      'emirates', 'flydubai', 'etihad', 'air arabia',
      'uber', 'careem', 'rta', 'salik', 'taxi', 'parking',
      'enoc', 'adnoc', 'eppco', 'fuel',
    ],
    specificity: 'high',
  },
  // Meals — restaurants + UAE food-delivery aggregators.
  {
    category: 'Meals',
    keywords: ['restaurant', 'cafe', 'coffee', 'food', 'deliveroo', 'talabat', 'zomato', 'careem food', 'noon food'],
    specificity: 'medium',
  },
  // Rent / real estate.
  {
    category: 'Rent',
    keywords: ['rent', 'lease', 'ejari', 'real estate', 'property management', 'landlord'],
    specificity: 'medium',
  },
  // Marketing.
  {
    category: 'Marketing',
    keywords: ['google ads', 'meta ', 'facebook ads', 'instagram ads', 'linkedin ads', 'marketing', 'advertising', 'promotion'],
    specificity: 'medium',
  },
  // Equipment — hardware vendors and computer/electronics keywords.
  {
    category: 'Equipment',
    keywords: ['apple', 'dell', 'hp ', 'lenovo', 'asus', 'samsung', 'computer', 'laptop', 'printer', 'monitor'],
    specificity: 'medium',
  },
  // Office Supplies.
  {
    category: 'Office Supplies',
    keywords: ['stationery', 'officeworks', 'paper', 'ink', 'toner', 'pens', 'office depot'],
    specificity: 'medium',
  },
  // Professional Services.
  {
    category: 'Professional Services',
    keywords: ['consultant', 'consulting', 'legal', 'lawyer', 'audit', 'advisory', 'accounting', 'bookkeeping', 'tax services'],
    specificity: 'medium',
  },
  // Insurance — UAE Takaful providers.
  {
    category: 'Insurance',
    keywords: ['insurance', 'takaful', 'aman', 'daman', 'oman insurance', 'salama', 'noor takaful'],
    specificity: 'high',
  },
  // Maintenance.
  {
    category: 'Maintenance',
    keywords: ['maintenance', 'repair', 'cleaning', 'plumber', 'electrician', 'handyman', 'service charge'],
    specificity: 'low',
  },
];

// =============================================
// Public helpers
// =============================================

export function normalizeMerchant(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .toLowerCase()
    .replace(/\b(ltd|llc|inc|fzc|fzco|fz-llc|l\.l\.c\.?|trading|co\.?|company|corp(?:oration)?|gmbh|sa)\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isStandardCategory(value: unknown): value is StandardCategory {
  return typeof value === 'string' && (STANDARD_CATEGORIES as readonly string[]).includes(value);
}

// =============================================
// Stage 1+2 — rule lookup (exact then fuzzy)
// =============================================

interface RuleMatch {
  rule: CompanyRuleSnapshot;
  matchType: 'exact' | 'fuzzy';
}

function matchAgainstRules(merchant: string, rules: CompanyRuleSnapshot[]): RuleMatch | null {
  const normalized = normalizeMerchant(merchant);
  if (!normalized) return null;

  // Pass 1: exact merchant_pattern match (after normalizing both sides).
  for (const rule of rules) {
    if (!rule.merchantPattern) continue;
    if (rule.confidence <= 0.7 || rule.timesApplied <= 3) continue;
    if (normalizeMerchant(rule.merchantPattern) === normalized) {
      return { rule, matchType: 'exact' };
    }
  }

  // Pass 2: fuzzy substring match — pattern contained in merchant or vice
  // versa. Phase 2 spec is ambiguous about whether fuzzy should re-apply the
  // confidence gate, but applying it keeps deactivated/low-quality rules from
  // bleeding into suggestions; description_pattern rules (which have no exact
  // pass) are exempt so they stay reachable.
  for (const rule of rules) {
    const usingMerchantPattern = !!rule.merchantPattern;
    const pattern = rule.merchantPattern || rule.descriptionPattern;
    if (!pattern) continue;
    if (usingMerchantPattern && (rule.confidence <= 0.7 || rule.timesApplied <= 3)) continue;
    const normalizedPattern = normalizeMerchant(pattern);
    if (!normalizedPattern) continue;
    if (normalized.includes(normalizedPattern) || normalizedPattern.includes(normalized)) {
      return { rule, matchType: 'fuzzy' };
    }
  }

  return null;
}

// =============================================
// Stage 3 — keyword classifier
// =============================================

interface KeywordHit {
  category: StandardCategory;
  hits: number;
  specificity: 'high' | 'medium' | 'low';
  matchedKeyword: string;
}

function matchKeywords(merchant: string, lineItems: string[] = []): KeywordHit | null {
  const inner = [merchant, ...lineItems].join(' ').toLowerCase();
  if (!inner.trim()) return null;
  // Pad with spaces so keywords that use leading/trailing spaces as a word
  // boundary (e.g. ' du ', 'hp ', 'meta ') match when the token sits at the
  // very start or end of the haystack. Without padding, "DU Telecom" would
  // miss the ' du ' keyword because there is no leading space in the input.
  const haystack = ` ${inner} `;

  let best: KeywordHit | null = null;

  for (const rule of KEYWORD_RULES) {
    let hits = 0;
    let firstMatch = '';
    for (const keyword of rule.keywords) {
      const k = keyword.toLowerCase();
      if (haystack.includes(k)) {
        hits++;
        if (!firstMatch) firstMatch = keyword.trim();
      }
    }
    if (hits === 0) continue;
    const candidate: KeywordHit = {
      category: rule.category,
      hits,
      specificity: rule.specificity,
      matchedKeyword: firstMatch,
    };
    // Prefer higher specificity, then more hits.
    if (
      !best ||
      specificityRank(candidate.specificity) > specificityRank(best.specificity) ||
      (specificityRank(candidate.specificity) === specificityRank(best.specificity) && candidate.hits > best.hits)
    ) {
      best = candidate;
    }
  }

  return best;
}

function specificityRank(s: 'high' | 'medium' | 'low'): number {
  return s === 'high' ? 3 : s === 'medium' ? 2 : 1;
}

function keywordConfidence(hit: KeywordHit): number {
  const base =
    hit.specificity === 'high' ? 0.85 : hit.specificity === 'medium' ? 0.75 : 0.65;
  // Multi-hit bonus: each extra match adds 0.02, capped at +0.08.
  return Math.min(0.92, base + Math.min(0.08, (hit.hits - 1) * 0.02));
}

// =============================================
// Stage 4 — Naive Bayes with Laplace smoothing
// =============================================

interface NaiveBayesModel {
  /** category → count of training examples. */
  categoryCounts: Map<string, number>;
  /** category → (word → count). */
  wordCounts: Map<string, Map<string, number>>;
  /** Vocabulary size across all categories. */
  vocabSize: number;
  totalExamples: number;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

function buildNaiveBayes(examples: TrainingExample[]): NaiveBayesModel {
  const categoryCounts = new Map<string, number>();
  const wordCounts = new Map<string, Map<string, number>>();
  const vocabulary = new Set<string>();

  for (const ex of examples) {
    if (!ex.merchant || !ex.category) continue;
    categoryCounts.set(ex.category, (categoryCounts.get(ex.category) || 0) + 1);
    let inner = wordCounts.get(ex.category);
    if (!inner) {
      inner = new Map();
      wordCounts.set(ex.category, inner);
    }
    for (const word of tokenize(ex.merchant)) {
      vocabulary.add(word);
      inner.set(word, (inner.get(word) || 0) + 1);
    }
  }

  return {
    categoryCounts,
    wordCounts,
    vocabSize: vocabulary.size,
    totalExamples: examples.length,
  };
}

interface NaiveBayesResult {
  category: string;
  /** logProb is for ranking — the calling code converts to a 0..1 confidence. */
  logProb: number;
  /** Difference between top and second-best logProb — how decisive the prediction is. */
  margin: number;
}

function predictNaiveBayes(model: NaiveBayesModel, merchant: string): NaiveBayesResult | null {
  if (model.totalExamples === 0 || model.vocabSize === 0) return null;

  const tokens = tokenize(merchant);
  if (tokens.length === 0) return null;

  const scores: Array<{ category: string; logProb: number }> = [];

  for (const [category, count] of model.categoryCounts.entries()) {
    const prior = Math.log(count / model.totalExamples);
    const inner = model.wordCounts.get(category);
    const totalWordsInCategory = inner
      ? Array.from(inner.values()).reduce((s, n) => s + n, 0)
      : 0;

    let logLikelihood = 0;
    for (const token of tokens) {
      const wordCount = inner?.get(token) || 0;
      // Laplace smoothing: add-1 over (totalWordsInCategory + vocabSize).
      const prob = (wordCount + 1) / (totalWordsInCategory + model.vocabSize);
      logLikelihood += Math.log(prob);
    }

    scores.push({ category, logProb: prior + logLikelihood });
  }

  if (scores.length === 0) return null;
  scores.sort((a, b) => b.logProb - a.logProb);
  const top = scores[0];
  const margin = scores.length >= 2 ? top.logProb - scores[1].logProb : Math.abs(top.logProb);
  return { category: top.category, logProb: top.logProb, margin };
}

function statisticalConfidence(result: NaiveBayesResult, totalExamples: number): number {
  // Volume floor: with very few examples, cap confidence below threshold to force OpenAI fallback.
  if (totalExamples < 10) return 0.4 + Math.min(0.2, totalExamples * 0.02);
  // Margin → 0..1 via a sigmoid-ish squash. A margin of ~3 logits is "decisive".
  const marginScore = Math.tanh(result.margin / 3); // 0..1
  const volumeScore = Math.min(1, totalExamples / 50);
  // Combine: weight margin more heavily once we have enough volume.
  const combined = 0.6 + marginScore * 0.25 + volumeScore * 0.1;
  return Math.max(0.5, Math.min(0.92, combined));
}

// =============================================
// Public classifier function
// =============================================

export interface ClassifyReceiptParams {
  merchant: string;
  amount: number;
  lineItems?: string[];
  model: InternalClassifierModel;
  options: ClassifyOptions;
  /** OpenAI client for the fallback stage. When null, returns the best internal result regardless. */
  openai: OpenAI | null;
  /** Available expense account names for OpenAI grounding (kept short to control tokens). */
  expenseAccountNames?: string[];
  /** Override the OpenAI model id (defaults to gpt-3.5-turbo per Phase 2 spec). */
  openaiModel?: string;
}

/**
 * Run the 4-stage classifier pipeline. Returns the best result from internal stages
 * if its confidence ≥ threshold, otherwise falls through to OpenAI.
 *
 * The returned `category` is always one of the 12 STANDARD_CATEGORIES (unknowns map
 * to 'Other'). `accountId` is set when stage 1/2 matched a rule, null otherwise.
 */
export async function classifyReceipt(
  params: ClassifyReceiptParams,
): Promise<ClassificationResult> {
  const { merchant, model, options, openai, expenseAccountNames, openaiModel } = params;
  const lineItems = params.lineItems || [];

  // OpenAI-only mode: skip internal pipeline.
  if (options.mode === 'openai_only') {
    return await callOpenAIFallback(merchant, lineItems, openai, expenseAccountNames, openaiModel);
  }

  // Stage 1 + 2 — rule lookup.
  const ruleMatch = matchAgainstRules(merchant, model.rules);
  if (ruleMatch) {
    const rule = ruleMatch.rule;
    const category: StandardCategory = isStandardCategory(rule.category) ? rule.category : 'Other';
    return {
      category,
      accountId: rule.accountId,
      confidence: rule.confidence,
      method: 'rule',
      reason: `Matched company rule (${ruleMatch.matchType}) "${rule.merchantPattern || rule.descriptionPattern}" — applied ${rule.timesApplied}× / accepted ${rule.timesAccepted}×.`,
      matchedRuleId: rule.id,
    };
  }

  // Stage 3 — keyword classifier.
  const keywordHit = matchKeywords(merchant, lineItems);
  let bestInternal: ClassificationResult | null = null;
  if (keywordHit) {
    bestInternal = {
      category: keywordHit.category,
      accountId: null,
      confidence: keywordConfidence(keywordHit),
      method: 'keyword',
      reason: `Keyword match "${keywordHit.matchedKeyword}" → ${keywordHit.category} (${keywordHit.specificity} specificity).`,
    };
  }

  // Stage 4 — Naive Bayes statistical classifier (only if we have examples).
  if (model.trainingExamples.length > 0) {
    const nb = buildNaiveBayes(model.trainingExamples);
    const prediction = predictNaiveBayes(nb, merchant);
    if (prediction) {
      const conf = statisticalConfidence(prediction, model.trainingExamples.length);
      const category: StandardCategory = isStandardCategory(prediction.category)
        ? prediction.category
        : 'Other';
      const statResult: ClassificationResult = {
        category,
        accountId: null,
        confidence: conf,
        method: 'statistical',
        reason: `Naive Bayes prediction over ${model.trainingExamples.length} training examples (margin ${prediction.margin.toFixed(2)}).`,
      };
      // Pick the more confident of keyword vs statistical.
      if (!bestInternal || statResult.confidence > bestInternal.confidence) {
        bestInternal = statResult;
      }
    }
  }

  // If internal best meets threshold, return it.
  if (bestInternal && bestInternal.confidence >= options.threshold) {
    return bestInternal;
  }

  // Fall through to OpenAI.
  try {
    return await callOpenAIFallback(merchant, lineItems, openai, expenseAccountNames, openaiModel);
  } catch (err: any) {
    log.warn({ err: err?.message || err, merchant }, 'OpenAI fallback failed — returning best internal result');
    if (bestInternal) return bestInternal;
    return {
      category: 'Other',
      accountId: null,
      confidence: 0.3,
      method: 'openai',
      reason: 'OpenAI fallback failed and no internal match — defaulted to Other.',
    };
  }
}

// =============================================
// OpenAI fallback
// =============================================

async function callOpenAIFallback(
  merchant: string,
  lineItems: string[],
  openai: OpenAI | null,
  expenseAccountNames: string[] | undefined,
  openaiModel: string | undefined,
): Promise<ClassificationResult> {
  if (!openai) {
    log.warn({ merchant }, 'OpenAI fallback requested but client is not configured');
    return {
      category: 'Other',
      accountId: null,
      confidence: 0.3,
      method: 'openai',
      reason: 'OpenAI fallback requested but OPENAI_API_KEY is not configured.',
    };
  }

  const itemsBlock = lineItems.length > 0 ? `\nLine items: ${lineItems.slice(0, 5).join(', ')}` : '';
  const accountHint = expenseAccountNames && expenseAccountNames.length > 0
    ? `\n\nIf relevant, the company has these expense accounts (for the reason text only — do not invent IDs): ${expenseAccountNames.slice(0, 30).join(', ')}.`
    : '';

  const prompt = `Categorize this UAE business receipt into exactly one of: ${STANDARD_CATEGORIES.join(', ')}.
Merchant: "${merchant}"${itemsBlock}${accountHint}

Respond with strict JSON: {"category":"<one of the categories>","confidence":<0..1>,"reason":"<short>"}`;

  const completion = await openai.chat.completions.create({
    model: openaiModel || 'gpt-3.5-turbo',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.2,
    max_tokens: 200,
  });

  const raw = completion.choices[0]?.message?.content || '{}';
  let parsed: { category?: string; confidence?: number; reason?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }

  const category: StandardCategory = isStandardCategory(parsed.category) ? parsed.category : 'Other';
  const confidence = typeof parsed.confidence === 'number'
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0.7;

  return {
    category,
    accountId: null,
    confidence,
    method: 'openai',
    reason: parsed.reason ? String(parsed.reason).slice(0, 300) : 'OpenAI fallback classification.',
  };
}

// =============================================
// Test-only exports
// =============================================
//
// These are exported for unit tests so we can exercise individual stages without
// running the full classifyReceipt() pipeline.

export const __test = {
  matchAgainstRules,
  matchKeywords,
  keywordConfidence,
  buildNaiveBayes,
  predictNaiveBayes,
  statisticalConfidence,
  tokenize,
  KEYWORD_RULES,
};
