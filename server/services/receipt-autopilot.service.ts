/**
 * Phase 2: Receipt Autopilot — End-to-end pipeline
 *
 * Orchestrates the full receipt flow:
 *   1. Classify the OCR result with the internal classifier (OpenAI fallback below threshold).
 *   2. Resolve the suggested expense + payment accounts from the company COA.
 *   3. Persist a transaction_classifications row capturing the suggestion.
 *   4. If the company has autopilot enabled, the rule has accepted ≥ 5 times,
 *      and confidence ≥ 0.9 — auto-post a balanced journal entry and mark the
 *      receipt `auto_posted = true`.
 *   5. Otherwise queue the receipt for human review.
 *
 * The classification stage always runs OpenAI fallback when the internal
 * pipeline fails or returns confidence < threshold. If OpenAI itself errors out
 * we still record the best internal result so the receipt is never lost.
 */

import OpenAI from 'openai';
import { storage } from '../storage';
import { pool } from '../db';
import { getEnv } from '../config/env';
import { createLogger } from '../config/logger';
import { assertPeriodNotLocked } from './period-lock.service';
import {
  classifyReceipt,
  type ClassificationResult,
  type StandardCategory,
} from './receipt-classifier.service';
import {
  getModel,
  getClassifierConfig,
  invalidateModel,
  applyAccuracyFailsafe,
} from './training-data.service';
import type { Account } from '../../shared/schema';

const log = createLogger('receipt-autopilot');

// =============================================
// Public types
// =============================================

export interface OcrReceipt {
  merchant: string;
  amount: number; // subtotal (net)
  vatAmount: number;
  total: number;
  currency: string;
  date: string; // YYYY-MM-DD
  category?: string;
  lineItems?: Array<{ description?: string }>;
  rawText?: string | null;
  imagePath?: string | null;
  imageData?: string | null;
}

export interface AutopilotResult {
  /** The created (or updated) receipts.id */
  receiptId: string;
  classification: ClassificationResult;
  /** Set when the autopilot auto-posted a journal entry. */
  journalEntryId: string | null;
  /** True when the receipt was auto-posted by the pipeline (no user review needed). */
  autoPosted: boolean;
  /** True when the receipt is queued for human review (the default for low-confidence items). */
  queuedForReview: boolean;
  /** The transaction_classifications.id we recorded for ML feedback. */
  classificationId: string;
}

// =============================================
// OpenAI client
// =============================================

let _openai: OpenAI | null | undefined;
function getOpenAI(): OpenAI | null {
  if (_openai !== undefined) return _openai;
  const key = getEnv().OPENAI_API_KEY;
  _openai = key ? new OpenAI({ apiKey: key }) : null;
  return _openai;
}

// Test-only seam — lets unit tests inject a fake OpenAI client without
// reaching into module state.
export function __setOpenAIForTests(client: OpenAI | null): void {
  _openai = client;
}

// =============================================
// Public entry points
// =============================================

/**
 * Classify a single OCR-extracted receipt without touching the receipts table.
 * Used by /api/ai/categorize and the OCR route to surface a suggestion.
 */
export async function classifyOcrReceipt(
  companyId: string,
  ocr: Pick<OcrReceipt, 'merchant' | 'amount' | 'lineItems'>,
): Promise<ClassificationResult> {
  const config = await getClassifierConfig(companyId);
  const model = await getModel(companyId);

  const accounts = await storage.getAccountsByCompanyId(companyId);
  const expenseAccountNames = accounts
    .filter((a) => a.type === 'expense' && a.isActive && !a.isArchived)
    .map((a) => a.nameEn);

  return classifyReceipt({
    merchant: ocr.merchant,
    amount: ocr.amount,
    lineItems: (ocr.lineItems || []).map((li) => li?.description || '').filter(Boolean),
    model,
    options: { threshold: config.accuracyThreshold, mode: config.mode },
    openai: getOpenAI(),
    expenseAccountNames,
  });
}

/**
 * The full receipt-autopilot pipeline. Creates a `receipts` row and either
 * auto-posts a balanced journal entry or queues the row for user review.
 *
 * `uploadedBy` is the user the receipt is attributed to (also used as
 * created_by/posted_by on any auto-generated journal entry).
 */
export async function runAutopilot(
  companyId: string,
  uploadedBy: string,
  ocr: OcrReceipt,
): Promise<AutopilotResult> {
  const config = await getClassifierConfig(companyId);
  const accounts = await storage.getAccountsByCompanyId(companyId);
  const expenseAccounts = accounts.filter(
    (a) => a.type === 'expense' && a.isActive && !a.isArchived,
  );
  const expenseAccountNames = expenseAccounts.map((a) => a.nameEn);

  // Defensive: the route already validates, but if a caller passes a non-string
  // merchant we must not crash on slice() / toLowerCase().
  const merchantSafe = typeof ocr.merchant === 'string' ? ocr.merchant : '';
  const netAmount = Number(ocr.amount) || 0;
  const vatAmount = Number(ocr.vatAmount) || 0;
  const grossAmount = Number(ocr.total) > 0 ? Number(ocr.total) : netAmount + vatAmount;

  // Stage 1 — classify.
  const model = await getModel(companyId);
  const classification = await classifyReceipt({
    merchant: merchantSafe,
    amount: netAmount,
    lineItems: (ocr.lineItems || []).map((li) => li?.description || '').filter(Boolean),
    model,
    options: { threshold: config.accuracyThreshold, mode: config.mode },
    openai: getOpenAI(),
    expenseAccountNames,
  });

  // Stage 2 — resolve account ids.
  const expenseAccountId =
    classification.accountId ||
    pickExpenseAccountForCategory(expenseAccounts, classification.category);
  const paymentAccountId = pickPaymentAccount(accounts);

  // Stage 3 — create the receipt row (always — never lose data).
  const receipt = await storage.createReceipt({
    companyId,
    merchant: merchantSafe.slice(0, 200),
    date: new Date(ocr.date),
    amount: netAmount,
    vatAmount,
    currency: ocr.currency || 'AED',
    category: classification.category,
    accountId: expenseAccountId,
    paymentAccountId,
    rawText: ocr.rawText ?? null,
    imageData: ocr.imageData ?? null,
    imagePath: ocr.imagePath ?? null,
    uploadedBy,
    posted: false,
    autoPosted: false,
  });

  // Stage 4 — log the classification for ML feedback.
  const classificationRow = await storage.createTransactionClassification({
    companyId,
    description: merchantSafe,
    merchant: merchantSafe,
    amount: grossAmount,
    suggestedAccountId: expenseAccountId ?? null,
    suggestedCategory: classification.category,
    aiConfidence: classification.confidence,
    aiReason: classification.reason,
    classifierMethod: classification.method,
  });

  // Stage 5 — decide whether to auto-post.
  const matchedRule = classification.matchedRuleId
    ? model.rules.find((r) => r.id === classification.matchedRuleId)
    : null;
  const ruleAcceptedEnough = matchedRule ? matchedRule.timesAccepted >= 5 : false;
  // Auto-post requires a positive net amount. Posting a zero/negative entry
  // would either throw at assertBalanced (negative case) or create a
  // meaningless balanced-zero entry (zero case) — both are surprising and
  // belong in the manual-review queue.
  const shouldAutoPost =
    config.autopilotEnabled &&
    classification.confidence >= 0.9 &&
    ruleAcceptedEnough &&
    !!expenseAccountId &&
    !!paymentAccountId &&
    netAmount > 0;

  if (!shouldAutoPost) {
    return {
      receiptId: receipt.id,
      classification,
      journalEntryId: null,
      autoPosted: false,
      queuedForReview: true,
      classificationId: classificationRow.id,
    };
  }

  // Auto-post the balanced journal entry. Net + VAT is split if there is a VAT
  // input account, otherwise the gross goes straight to the expense account.
  try {
    const journalEntryId = await autoPostJournalEntry({
      companyId,
      uploadedBy,
      ocr,
      expenseAccountId: expenseAccountId!,
      paymentAccountId: paymentAccountId!,
      accounts,
      classification,
    });

    await storage.updateReceipt(receipt.id, {
      posted: true,
      autoPosted: true,
      journalEntryId,
      accountId: expenseAccountId,
      paymentAccountId,
    });

    // Bump the matched rule's times_applied so confidence stats stay correct.
    if (classification.matchedRuleId) {
      await pool.query(
        `UPDATE ai_company_rules SET times_applied = times_applied + 1, updated_at = now() WHERE id = $1`,
        [classification.matchedRuleId],
      );
    }

    return {
      receiptId: receipt.id,
      classification,
      journalEntryId,
      autoPosted: true,
      queuedForReview: false,
      classificationId: classificationRow.id,
    };
  } catch (err: any) {
    log.error({ err: err?.message || err, receiptId: receipt.id }, 'Auto-post failed — leaving receipt for manual review');
    return {
      receiptId: receipt.id,
      classification,
      journalEntryId: null,
      autoPosted: false,
      queuedForReview: true,
      classificationId: classificationRow.id,
    };
  }
}

/**
 * Record user feedback on an autopilot suggestion. Updates the classification
 * row, invalidates the cached model, and applies the accuracy failsafe.
 */
export async function recordClassificationFeedback(
  companyId: string,
  classificationId: string,
  wasAccepted: boolean,
  userSelectedAccountId?: string | null,
): Promise<void> {
  await storage.updateTransactionClassification(classificationId, {
    wasAccepted,
    userSelectedAccountId: userSelectedAccountId ?? undefined,
  });
  invalidateModel(companyId);
  await applyAccuracyFailsafe(companyId);
}

// =============================================
// Internals
// =============================================

interface AutoPostInput {
  companyId: string;
  uploadedBy: string;
  ocr: OcrReceipt;
  expenseAccountId: string;
  paymentAccountId: string;
  accounts: Account[];
  classification: ClassificationResult;
}

async function autoPostJournalEntry(input: AutoPostInput): Promise<string> {
  const { companyId, uploadedBy, ocr, expenseAccountId, paymentAccountId, accounts, classification } = input;
  const txnDate = new Date(ocr.date);
  await assertPeriodNotLocked(companyId, txnDate);

  const net = round2(Number(ocr.amount) || 0);
  const vat = round2(Number(ocr.vatAmount) || 0);
  // Always derive total from net + vat for the journal entry. OCR can return
  // values whose sum disagrees with the reported total by more than the
  // 0.01 tolerance enforced by assertBalanced(); using OCR's total here would
  // throw on every retry and silently force the receipt into manual review.
  // The receipt row preserves the original ocr.total separately.
  const total = round2(net + vat);

  // Try to find a "VAT Input" / "Input VAT" / "Recoverable VAT" account so we
  // split the entry. If we can't find one, the gross goes to the expense.
  const vatInputAccount = accounts.find(
    (a) => a.isVatAccount && a.vatType === 'input' && a.isActive && !a.isArchived,
  );

  const merchantLabel = typeof ocr.merchant === 'string' ? ocr.merchant : '';
  const lines: Array<{ accountId: string; debit: number; credit: number; description: string }> = [];
  if (vatInputAccount && vat > 0) {
    lines.push({ accountId: expenseAccountId, debit: net, credit: 0, description: merchantLabel });
    lines.push({ accountId: vatInputAccount.id, debit: vat, credit: 0, description: `Input VAT — ${merchantLabel}` });
    lines.push({ accountId: paymentAccountId, debit: 0, credit: total, description: merchantLabel });
  } else {
    lines.push({ accountId: expenseAccountId, debit: total, credit: 0, description: merchantLabel });
    lines.push({ accountId: paymentAccountId, debit: 0, credit: total, description: merchantLabel });
  }

  const entryNumber = await storage.generateEntryNumber(companyId, txnDate);
  const entry = await storage.createJournalEntry(
    {
      companyId,
      entryNumber,
      date: txnDate,
      memo: `Receipt Autopilot: ${merchantLabel} (${classification.method}, ${(classification.confidence * 100).toFixed(0)}% conf)`,
      status: 'posted',
      source: 'system',
      createdBy: uploadedBy,
      postedBy: uploadedBy,
      postedAt: new Date(),
    },
    lines,
  );
  return entry.id;
}

// =============================================
// Account picking helpers
// =============================================

function pickExpenseAccountForCategory(
  expenseAccounts: Account[],
  category: StandardCategory,
): string | null {
  if (expenseAccounts.length === 0) return null;
  const lower = category.toLowerCase();
  // Direct name match first.
  const direct = expenseAccounts.find((a) => a.nameEn.toLowerCase().includes(lower));
  if (direct) return direct.id;
  // Category-specific synonym fallbacks.
  const synonymMap: Record<StandardCategory, string[]> = {
    'Office Supplies': ['supplies', 'stationery'],
    'Utilities': ['utility', 'utilities', 'water', 'electricity'],
    'Travel': ['travel', 'transport', 'fuel'],
    'Meals': ['meals', 'entertainment', 'food'],
    'Rent': ['rent'],
    'Marketing': ['marketing', 'advertising', 'promotion'],
    'Equipment': ['equipment', 'hardware'],
    'Professional Services': ['professional', 'consulting', 'legal'],
    'Insurance': ['insurance'],
    'Maintenance': ['maintenance', 'repairs'],
    'Communication': ['communication', 'telephone', 'internet'],
    'Other': ['miscellaneous', 'other expense', 'general expense'],
  };
  const syns = synonymMap[category];
  for (const syn of syns) {
    const acc = expenseAccounts.find((a) => a.nameEn.toLowerCase().includes(syn));
    if (acc) return acc.id;
  }
  // Last resort — first generic expense account.
  const generic = expenseAccounts.find((a) => /general|other|miscellaneous/i.test(a.nameEn));
  return (generic || expenseAccounts[0])?.id ?? null;
}

function pickPaymentAccount(accounts: Account[]): string | null {
  // Prefer cash, then bank.
  const cash = accounts.find(
    (a) => a.type === 'asset' && a.isActive && !a.isArchived && /cash/i.test(a.nameEn),
  );
  if (cash) return cash.id;
  const bank = accounts.find(
    (a) => a.type === 'asset' && a.isActive && !a.isArchived && /bank/i.test(a.nameEn),
  );
  if (bank) return bank.id;
  // Generic current asset fallback.
  const fallback = accounts.find(
    (a) => a.type === 'asset' && a.subType === 'current_asset' && a.isActive && !a.isArchived,
  );
  return fallback?.id ?? null;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// =============================================
// Test-only exports
// =============================================
export const __test = {
  pickExpenseAccountForCategory,
  pickPaymentAccount,
};
