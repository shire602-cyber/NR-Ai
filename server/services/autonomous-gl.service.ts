import OpenAI from 'openai';
import { pool } from '../db';
import { storage } from '../storage';
import { getEnv } from '../config/env';
import { createLogger } from '../config/logger';
import { assertPeriodNotLocked } from './period-lock.service';

const log = createLogger('autonomous-gl');

// =============================================
// Types
// =============================================

interface AIGLQueueItem {
  id: string;
  company_id: string;
  bank_transaction_id: string | null;
  description: string;
  amount: string;
  transaction_date: string;
  suggested_account_id: string | null;
  suggested_category: string | null;
  ai_confidence: string;
  ai_reason: string | null;
  few_shot_examples_used: number;
  status: string;
  journal_entry_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  user_selected_account_id: string | null;
  created_at: string;
}

interface AICompanyRule {
  id: string;
  company_id: string;
  merchant_pattern: string | null;
  description_pattern: string | null;
  account_id: string;
  times_applied: number;
  times_accepted: number;
  times_rejected: number;
  confidence: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface ChartOfAccountRow {
  id: string;
  code: string;
  name_en: string;
  name_ar: string | null;
  type: string;
  sub_type: string | null;
}

interface BankTransactionRow {
  id: string;
  company_id: string;
  bank_account_id: string | null;
  transaction_date: string;
  description: string;
  amount: number;
  reference: string | null;
  category: string | null;
  is_reconciled: boolean;
}

interface FewShotExample {
  description: string;
  amount: number;
  account_name: string;
  account_code: string;
  category: string | null;
}

interface AICategorizationResult {
  accountId: string;
  accountName: string;
  category: string;
  confidence: number;
  reason: string;
}

// =============================================
// OpenAI client
// =============================================

function createOpenAIClient(): OpenAI | null {
  const apiKey = getEnv().OPENAI_API_KEY;
  if (!apiKey) {
    log.warn('OPENAI_API_KEY not set — autonomous GL AI features disabled');
    return null;
  }
  return new OpenAI({ apiKey });
}

// =============================================
// Core Engine Functions
// =============================================

/**
 * Scan unreconciled bank transactions and classify them using AI company rules
 * or OpenAI, then store results in the ai_gl_queue.
 */
export async function scanAndClassifyTransactions(companyId: string): Promise<{
  scanned: number;
  classified: number;
  ruleMatched: number;
  aiClassified: number;
}> {
  const openai = createOpenAIClient();

  // 1. Find unreconciled bank transactions that are NOT already in ai_gl_queue
  const _unreconciledResult = await pool.query(
    `SELECT bt.*
     FROM bank_transactions bt
     LEFT JOIN ai_gl_queue q ON q.bank_transaction_id = bt.id
     WHERE bt.company_id = $1
       AND bt.is_reconciled = false
       AND q.id IS NULL
     ORDER BY bt.transaction_date DESC`,
    [companyId]
  );
  const unreconciledTxns: BankTransactionRow[] = _unreconciledResult.rows;

  if (unreconciledTxns.length === 0) {
    return { scanned: 0, classified: 0, ruleMatched: 0, aiClassified: 0 };
  }

  // 2. Load company rules and chart of accounts
  const _rulesResult = await pool.query(
    `SELECT * FROM ai_company_rules
     WHERE company_id = $1 AND is_active = true`,
    [companyId]
  );
  const rules: AICompanyRule[] = _rulesResult.rows;

  const _accountsResult = await pool.query(
    `SELECT id, code, name_en, name_ar, type, sub_type
     FROM accounts
     WHERE company_id = $1 AND is_active = true AND is_archived = false
     ORDER BY code`,
    [companyId]
  );
  const accounts: ChartOfAccountRow[] = _accountsResult.rows;

  // 3. Load few-shot examples (previously accepted classifications)
  const _fewShotResult = await pool.query(
    `SELECT tc.description, tc.amount, a.name_en as account_name, a.code as account_code, tc.suggested_category as category
     FROM transaction_classifications tc
     JOIN accounts a ON a.id = tc.user_selected_account_id
     WHERE tc.company_id = $1 AND tc.was_accepted = true
     ORDER BY tc.created_at DESC
     LIMIT 10`,
    [companyId]
  );
  const fewShotExamples: FewShotExample[] = _fewShotResult.rows;

  let ruleMatched = 0;
  let aiClassified = 0;

  for (const txn of unreconciledTxns) {
    const descLower = txn.description.toLowerCase();

    // 3a. Check ai_company_rules for matching merchant/description pattern
    let matchedRule: AICompanyRule | null = null;
    for (const rule of rules) {
      if (rule.merchant_pattern) {
        const pattern = rule.merchant_pattern.toLowerCase();
        if (descLower.includes(pattern)) {
          matchedRule = rule;
          break;
        }
      }
      if (rule.description_pattern) {
        const pattern = rule.description_pattern.toLowerCase();
        if (descLower.includes(pattern)) {
          matchedRule = rule;
          break;
        }
      }
    }

    // 3b. If rule found with confidence > 0.85, use it directly
    if (matchedRule && parseFloat(matchedRule.confidence) > 0.85) {
      const matchedAccount = accounts.find((a: any) => a.id === matchedRule!.account_id);
      await pool.query(
        `INSERT INTO ai_gl_queue
         (company_id, bank_transaction_id, description, amount, transaction_date,
          suggested_account_id, suggested_category, ai_confidence, ai_reason,
          few_shot_examples_used, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          companyId,
          txn.id,
          txn.description,
          Math.abs(txn.amount),
          txn.transaction_date,
          matchedRule.account_id,
          matchedAccount?.type || 'expense',
          matchedRule.confidence,
          `Matched rule: ${matchedRule.merchant_pattern || matchedRule.description_pattern} (applied ${matchedRule.times_applied} times, ${matchedRule.times_accepted} accepted)`,
          0,
          'pending_review',
        ]
      );

      // Increment times_applied for the rule
      await pool.query(
        `UPDATE ai_company_rules SET times_applied = times_applied + 1, updated_at = now() WHERE id = $1`,
        [matchedRule.id]
      );

      ruleMatched++;
      continue;
    }

    // 3c. If no high-confidence rule, call OpenAI
    if (!openai) {
      // No OpenAI available — store with zero confidence
      await pool.query(
        `INSERT INTO ai_gl_queue
         (company_id, bank_transaction_id, description, amount, transaction_date,
          ai_confidence, ai_reason, few_shot_examples_used, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          companyId,
          txn.id,
          txn.description,
          Math.abs(txn.amount),
          txn.transaction_date,
          0,
          'OpenAI not configured — manual categorization required',
          0,
          'pending_review',
        ]
      );
      continue;
    }

    try {
      const result = await classifyWithOpenAI(
        openai,
        txn,
        accounts,
        fewShotExamples
      );

      await pool.query(
        `INSERT INTO ai_gl_queue
         (company_id, bank_transaction_id, description, amount, transaction_date,
          suggested_account_id, suggested_category, ai_confidence, ai_reason,
          few_shot_examples_used, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          companyId,
          txn.id,
          txn.description,
          Math.abs(txn.amount),
          txn.transaction_date,
          result.accountId,
          result.category,
          result.confidence,
          result.reason,
          fewShotExamples.length,
          'pending_review',
        ]
      );

      aiClassified++;
    } catch (err: any) {
      log.error({ err, txnId: txn.id }, 'Failed to classify transaction with OpenAI');

      // Store with zero confidence on error
      await pool.query(
        `INSERT INTO ai_gl_queue
         (company_id, bank_transaction_id, description, amount, transaction_date,
          ai_confidence, ai_reason, few_shot_examples_used, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          companyId,
          txn.id,
          txn.description,
          Math.abs(txn.amount),
          txn.transaction_date,
          0,
          `AI classification error: ${err.message || 'Unknown error'}`,
          0,
          'pending_review',
        ]
      );
    }
  }

  return {
    scanned: unreconciledTxns.length,
    classified: ruleMatched + aiClassified,
    ruleMatched,
    aiClassified,
  };
}

/**
 * Classify a bank transaction using OpenAI with the company's chart of accounts
 * and few-shot examples.
 */
async function classifyWithOpenAI(
  openai: OpenAI,
  txn: BankTransactionRow,
  accounts: ChartOfAccountRow[],
  fewShotExamples: FewShotExample[]
): Promise<AICategorizationResult> {
  const AI_MODEL = getEnv().AI_MODEL;

  // Build chart of accounts context
  const accountList = accounts
    .map(a => `- ${a.code} | ${a.name_en}${a.name_ar ? ` (${a.name_ar})` : ''} | Type: ${a.type}${a.sub_type ? ` / ${a.sub_type}` : ''}`)
    .join('\n');

  // Build few-shot examples
  let fewShotBlock = '';
  if (fewShotExamples.length > 0) {
    const examples = fewShotExamples
      .map(
        (ex, i) =>
          `Example ${i + 1}: "${ex.description}" (AED ${ex.amount}) -> Account: ${ex.account_code} ${ex.account_name}`
      )
      .join('\n');
    fewShotBlock = `\n\nHere are previously accepted categorizations for this company:\n${examples}`;
  }

  const systemPrompt = `You are an expert UAE accountant working with the Muhasib.ai platform. Categorize this bank transaction into the most appropriate account from the company's Chart of Accounts.

CHART OF ACCOUNTS:
${accountList}
${fewShotBlock}

RULES:
- For payments/debits: typically debit an expense/asset account and credit the bank account.
- For deposits/credits: typically debit the bank account and credit an income/liability account.
- Consider UAE-specific patterns: DEWA (utilities), du/Etisalat (telecom), Careem/Uber (transport), Salik (tolls), ADNOC/ENOC (fuel), etc.
- Look at the description carefully for merchant names, payment references, and transaction types.
- If uncertain, prefer more general accounts and set confidence lower.

Return a JSON object with exactly these fields:
{
  "accountId": "<uuid of the best matching account from the chart>",
  "accountName": "<English name of the chosen account>",
  "category": "<account type: expense, income, asset, liability, equity>",
  "confidence": <number between 0.0 and 1.0>,
  "reason": "<brief 1-2 sentence explanation of why this account was chosen>"
}`;

  const userPrompt = `Categorize this bank transaction:
Description: ${txn.description}
Amount: AED ${Math.abs(txn.amount).toFixed(2)} (${txn.amount > 0 ? 'credit/deposit' : 'debit/payment'})
Date: ${txn.transaction_date}${txn.reference ? `\nReference: ${txn.reference}` : ''}`;

  const completion = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  });

  const responseText = completion.choices[0].message.content || '{}';
  const parsed = JSON.parse(responseText);

  // Validate the accountId exists in the chart of accounts
  const matchedAccount = accounts.find(a => a.id === parsed.accountId);
  if (!matchedAccount) {
    // Try matching by name or code as fallback
    const byName = accounts.find(
      a => a.name_en.toLowerCase() === (parsed.accountName || '').toLowerCase()
    );
    if (byName) {
      parsed.accountId = byName.id;
      parsed.accountName = byName.name_en;
    } else {
      // AI returned an invalid account — reduce confidence
      log.warn({ txnId: txn.id, aiAccountId: parsed.accountId }, 'AI returned unrecognized account ID');
      parsed.confidence = Math.min(parsed.confidence || 0, 0.3);
      parsed.reason = (parsed.reason || '') + ' (Warning: AI suggested an unrecognized account)';
    }
  }

  return {
    accountId: parsed.accountId || null,
    accountName: parsed.accountName || 'Unknown',
    category: parsed.category || 'expense',
    confidence: Math.max(0, Math.min(1, parsed.confidence || 0)),
    reason: parsed.reason || 'AI categorization',
  };
}

/**
 * Create draft journal entries for high-confidence items from the queue.
 * Creates DRAFT journal entries for items where ai_confidence >= 0.85 and status = 'pending_review'.
 * A human must review and approve each draft before it is posted to the GL.
 * Notifies the company owner that drafts are awaiting review.
 */
export async function autoPostHighConfidence(companyId: string): Promise<{
  posted: number;
  errors: string[];
}> {
  const _highConfResult = await pool.query(
    `SELECT q.*, bt.bank_account_id
     FROM ai_gl_queue q
     LEFT JOIN bank_transactions bt ON bt.id = q.bank_transaction_id
     WHERE q.company_id = $1
       AND q.ai_confidence >= 0.85
       AND q.status = 'pending_review'
       AND q.suggested_account_id IS NOT NULL
     ORDER BY q.transaction_date`,
    [companyId]
  );
  const highConfItems: AIGLQueueItem[] = _highConfResult.rows;

  let posted = 0;
  const errors: string[] = [];
  const draftedEntryIds: string[] = [];

  for (const item of highConfItems) {
    try {
      const journalEntryId = await createJournalEntryForQueueItem(companyId, item);

      // Mark queue item as auto-actioned. The JE itself is a DRAFT — see
      // createJournalEntryForQueueItem. Bank transactions are NOT marked
      // reconciled here; that happens only when a human approves the draft
      // and it moves to 'posted'.
      await pool.query(
        `UPDATE ai_gl_queue
         SET journal_entry_id = $1, status = 'auto_posted'
         WHERE id = $2`,
        [journalEntryId, item.id]
      );

      draftedEntryIds.push(journalEntryId);
      posted++;
    } catch (err: any) {
      log.error({ err, queueItemId: item.id }, 'Failed to draft queue item');
      errors.push(`Failed to draft item ${item.id}: ${err.message}`);
    }
  }

  if (draftedEntryIds.length > 0) {
    await notifyOwnerOfDrafts(companyId, draftedEntryIds.length).catch((err) => {
      log.error({ err, companyId }, 'Failed to send draft notification');
    });
  }

  return { posted, errors };
}

async function notifyOwnerOfDrafts(companyId: string, draftCount: number): Promise<void> {
  const { rows: ownerRows } = await pool.query(
    `SELECT user_id FROM company_users WHERE company_id = $1 AND role = 'owner' LIMIT 1`,
    [companyId]
  );
  const ownerUserId = ownerRows[0]?.user_id;
  if (!ownerUserId) return;

  await pool.query(
    `INSERT INTO notifications
       (user_id, company_id, type, title, message, priority, related_entity_type, action_url)
     VALUES ($1, $2, 'system', $3, $4, 'high', 'journal_entry', '/journal-entries?status=draft')`,
    [
      ownerUserId,
      companyId,
      `${draftCount} AI draft journal ${draftCount === 1 ? 'entry' : 'entries'} need review`,
      `The AI categorized ${draftCount} bank transaction${draftCount === 1 ? '' : 's'} with high confidence. Review and approve each draft journal entry before it posts to the GL.`,
    ]
  );
}

/**
 * Create a journal entry from a queue item.
 * Debit/credit depends on the transaction direction.
 */
async function createJournalEntryForQueueItem(
  companyId: string,
  item: AIGLQueueItem & { bank_account_id?: string | null }
): Promise<string> {
  const amount = parseFloat(item.amount);
  const txnDate = new Date(item.transaction_date);

  // Block AI auto-posting into a locked period.
  await assertPeriodNotLocked(companyId, txnDate);

  // Determine bank account (from bank_transaction or fallback to first bank/cash account)
  let bankAccountId = (item as any).bank_account_id;
  if (!bankAccountId) {
    const { rows: bankAccounts } = await pool.query(
      `SELECT id FROM accounts
       WHERE company_id = $1 AND type = 'asset' AND sub_type = 'current_asset'
         AND (lower(name_en) LIKE '%bank%' OR lower(name_en) LIKE '%cash%')
         AND is_active = true
       ORDER BY code LIMIT 1`,
      [companyId]
    );
    bankAccountId = bankAccounts[0]?.id || null;
  }

  if (!bankAccountId) {
    throw new Error('No bank account found for journal entry');
  }

  if (!item.suggested_account_id) {
    throw new Error('Cannot post: queue item has no suggested account');
  }

  // Resolve the company owner's user ID to satisfy the FK constraint on created_by
  const { rows: ownerRows } = await pool.query(
    `SELECT user_id FROM company_users WHERE company_id = $1 AND role = 'owner' LIMIT 1`,
    [companyId]
  );
  const systemUserId = ownerRows[0]?.user_id;
  if (!systemUserId) {
    throw new Error(`No owner user found for company ${companyId} — cannot create auto-posted journal entry`);
  }

  // Determine direction from original bank transaction:
  //   negative amount → payment out (debit expense, credit bank)
  //   positive amount → deposit in (debit bank, credit income)
  let isDebit = true;
  if (item.bank_transaction_id) {
    const { rows: [bankTxn] } = await pool.query(
      `SELECT amount FROM bank_transactions WHERE id = $1`,
      [item.bank_transaction_id]
    );
    if (bankTxn && bankTxn.amount > 0) {
      isDebit = false;
    }
  }

  const lines = isDebit
    ? [
        { accountId: item.suggested_account_id, debit: amount, credit: 0, description: item.description },
        { accountId: bankAccountId as string, debit: 0, credit: amount, description: item.description },
      ]
    : [
        { accountId: bankAccountId as string, debit: amount, credit: 0, description: item.description },
        { accountId: item.suggested_account_id, debit: 0, credit: amount, description: item.description },
      ];

  // Use storage helper: validates balance + wraps entry+lines in a single transaction.
  // High-confidence AI suggestions are saved as DRAFT — a human must review and
  // approve each draft before it is posted to the GL.
  const entryNumber = await storage.generateEntryNumber(companyId, txnDate);
  const entry = await storage.createJournalEntry(
    {
      companyId,
      entryNumber,
      date: txnDate,
      memo: `AI Draft (review required): ${item.description}`,
      status: 'draft',
      source: 'system',
      sourceId: item.bank_transaction_id,
      createdBy: systemUserId,
    } as any,
    lines
  );

  return entry.id;
}

/**
 * Process user feedback on a queue item: accept, reject, or correct.
 */
export async function processUserFeedback(
  queueId: string,
  action: 'accept' | 'reject' | 'correct',
  userId: string,
  userAccountId?: string
): Promise<{ success: boolean; message: string }> {
  // Get the queue item
  const _itemResult = await pool.query(
    `SELECT * FROM ai_gl_queue WHERE id = $1`,
    [queueId]
  );
  const [item]: AIGLQueueItem[] = _itemResult.rows;

  if (!item) {
    return { success: false, message: 'Queue item not found' };
  }

  if (item.status !== 'pending_review' && item.status !== 'auto_posted') {
    return { success: false, message: `Cannot process feedback for item with status: ${item.status}` };
  }

  if (action === 'accept') {
    // If not yet posted, create journal entry
    let journalEntryId = item.journal_entry_id;
    if (!journalEntryId) {
      if (!item.suggested_account_id) {
        return { success: false, message: 'Cannot accept — no suggested account' };
      }
      // Get bank_account_id from bank transaction
      let bankAccountId: string | null = null;
      if (item.bank_transaction_id) {
        const { rows: [bt] } = await pool.query(
          `SELECT bank_account_id FROM bank_transactions WHERE id = $1`,
          [item.bank_transaction_id]
        );
        bankAccountId = bt?.bank_account_id || null;
      }
      journalEntryId = await createJournalEntryForQueueItem(
        item.company_id,
        { ...item, bank_account_id: bankAccountId }
      );
    }

    await pool.query(
      `UPDATE ai_gl_queue
       SET status = 'accepted', journal_entry_id = $1, reviewed_by = $2, reviewed_at = now()
       WHERE id = $3`,
      [journalEntryId, userId, queueId]
    );

    // Mark bank transaction as reconciled
    if (item.bank_transaction_id) {
      await pool.query(
        `UPDATE bank_transactions
         SET is_reconciled = true, matched_journal_entry_id = $1
         WHERE id = $2`,
        [journalEntryId, item.bank_transaction_id]
      );
    }

    // Update ai_company_rules: increment times_accepted
    await updateRuleFromFeedback(item, 'accepted');

    // Also store in transaction_classifications for future few-shot learning
    await pool.query(
      `INSERT INTO transaction_classifications
       (company_id, description, amount, suggested_account_id, suggested_category,
        ai_confidence, ai_reason, was_accepted, user_selected_account_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $4)`,
      [
        item.company_id,
        item.description,
        parseFloat(item.amount),
        item.suggested_account_id,
        item.suggested_category,
        parseFloat(item.ai_confidence),
        item.ai_reason,
      ]
    );

    return { success: true, message: 'Transaction accepted and posted to GL' };
  }

  if (action === 'reject') {
    await pool.query(
      `UPDATE ai_gl_queue
       SET status = 'rejected', reviewed_by = $1, reviewed_at = now()
       WHERE id = $2`,
      [userId, queueId]
    );

    // Update ai_company_rules: increment times_rejected
    await updateRuleFromFeedback(item, 'rejected');

    return { success: true, message: 'Transaction rejected' };
  }

  if (action === 'correct') {
    if (!userAccountId) {
      return { success: false, message: 'userAccountId is required for correction' };
    }

    // Create journal entry with user's chosen account
    let bankAccountId: string | null = null;
    if (item.bank_transaction_id) {
      const { rows: [bt] } = await pool.query(
        `SELECT bank_account_id FROM bank_transactions WHERE id = $1`,
        [item.bank_transaction_id]
      );
      bankAccountId = bt?.bank_account_id || null;
    }

    const correctedItem = {
      ...item,
      suggested_account_id: userAccountId,
      bank_account_id: bankAccountId,
    };
    const journalEntryId = await createJournalEntryForQueueItem(
      item.company_id,
      correctedItem
    );

    await pool.query(
      `UPDATE ai_gl_queue
       SET status = 'corrected', user_selected_account_id = $1,
           journal_entry_id = $2, reviewed_by = $3, reviewed_at = now()
       WHERE id = $4`,
      [userAccountId, journalEntryId, userId, queueId]
    );

    // Mark bank transaction as reconciled
    if (item.bank_transaction_id) {
      await pool.query(
        `UPDATE bank_transactions
         SET is_reconciled = true, matched_journal_entry_id = $1
         WHERE id = $2`,
        [journalEntryId, item.bank_transaction_id]
      );
    }

    // Create or update rule for this merchant/description pattern
    await createOrUpdateRuleFromCorrection(item, userAccountId);

    // Store in transaction_classifications for future few-shot learning
    await pool.query(
      `INSERT INTO transaction_classifications
       (company_id, description, amount, suggested_account_id, suggested_category,
        ai_confidence, ai_reason, was_accepted, user_selected_account_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)`,
      [
        item.company_id,
        item.description,
        parseFloat(item.amount),
        item.suggested_account_id,
        item.suggested_category,
        parseFloat(item.ai_confidence),
        item.ai_reason,
        userAccountId,
      ]
    );

    return { success: true, message: 'Transaction corrected and posted to GL' };
  }

  return { success: false, message: 'Invalid action' };
}

/**
 * Update ai_company_rules based on feedback.
 */
async function updateRuleFromFeedback(
  item: AIGLQueueItem,
  feedbackType: 'accepted' | 'rejected'
): Promise<void> {
  if (!item.suggested_account_id) return;

  const descLower = item.description.toLowerCase();

  // Find any matching rule
  const _matchingRulesResult = await pool.query(
    `SELECT * FROM ai_company_rules
     WHERE company_id = $1
       AND account_id = $2
       AND is_active = true
       AND (
         ($3 ILIKE '%' || merchant_pattern || '%' AND merchant_pattern IS NOT NULL)
         OR ($3 ILIKE '%' || description_pattern || '%' AND description_pattern IS NOT NULL)
       )
     LIMIT 1`,
    [item.company_id, item.suggested_account_id, descLower]
  );
  const matchingRules: AICompanyRule[] = _matchingRulesResult.rows;

  if (matchingRules.length > 0) {
    const rule = matchingRules[0];
    if (feedbackType === 'accepted') {
      // Increment accepted count and boost confidence
      const newAccepted = rule.times_accepted + 1;
      const total = newAccepted + rule.times_rejected;
      const newConfidence = Math.min(0.99, newAccepted / total);
      await pool.query(
        `UPDATE ai_company_rules
         SET times_accepted = $1, confidence = $2, updated_at = now()
         WHERE id = $3`,
        [newAccepted, newConfidence, rule.id]
      );
    } else {
      // Increment rejected count and reduce confidence
      const newRejected = rule.times_rejected + 1;
      const total = rule.times_accepted + newRejected;
      const newConfidence = Math.max(0.1, rule.times_accepted / total);
      await pool.query(
        `UPDATE ai_company_rules
         SET times_rejected = $1, confidence = $2, updated_at = now()
         WHERE id = $3`,
        [newRejected, newConfidence, rule.id]
      );

      // Deactivate rule if confidence drops too low
      if (newConfidence < 0.2) {
        await pool.query(
          `UPDATE ai_company_rules SET is_active = false, updated_at = now() WHERE id = $1`,
          [rule.id]
        );
      }
    }
  }
}

/**
 * Create or update a rule when the user corrects a classification.
 */
async function createOrUpdateRuleFromCorrection(
  item: AIGLQueueItem,
  correctAccountId: string
): Promise<void> {
  // Extract a simple merchant/pattern from the description
  // Take the first 2-3 meaningful words as the pattern
  const words = item.description
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2)
    .slice(0, 3);
  const pattern = words.join(' ').toLowerCase();

  if (!pattern) return;

  // Check if a rule already exists for this pattern and account
  const { rows: existing } = await pool.query(
    `SELECT * FROM ai_company_rules
     WHERE company_id = $1
       AND description_pattern = $2
       AND account_id = $3
     LIMIT 1`,
    [item.company_id, pattern, correctAccountId]
  );

  if (existing.length > 0) {
    // Update existing rule
    await pool.query(
      `UPDATE ai_company_rules
       SET times_accepted = times_accepted + 1,
           confidence = LEAST(0.99, (times_accepted + 1.0) / GREATEST(1, times_accepted + times_rejected + 1)),
           updated_at = now()
       WHERE id = $1`,
      [existing[0].id]
    );
  } else {
    // Create new rule
    await pool.query(
      `INSERT INTO ai_company_rules
       (company_id, description_pattern, account_id, times_applied, times_accepted, confidence)
       VALUES ($1, $2, $3, 1, 1, 0.6)`,
      [item.company_id, pattern, correctAccountId]
    );
  }
}

/**
 * Get statistics for the AI GL engine for a company.
 */
export async function getAIGLStats(companyId: string): Promise<{
  totalProcessed: number;
  autoPosted: number;
  autoPostedPercent: number;
  accuracy: number;
  pendingReview: number;
  rulesCount: number;
}> {
  const { rows: [stats] } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status != 'pending_review') as total_processed,
       COUNT(*) FILTER (WHERE status = 'auto_posted') as auto_posted,
       COUNT(*) FILTER (WHERE status = 'accepted' OR status = 'auto_posted') as accepted,
       COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
       COUNT(*) FILTER (WHERE status = 'pending_review') as pending_review,
       COUNT(*) as total
     FROM ai_gl_queue
     WHERE company_id = $1`,
    [companyId]
  );

  const { rows: [ruleStats] } = await pool.query(
    `SELECT COUNT(*) as rules_count
     FROM ai_company_rules
     WHERE company_id = $1 AND is_active = true`,
    [companyId]
  );

  const totalProcessed = parseInt(stats.total_processed, 10) || 0;
  const autoPosted = parseInt(stats.auto_posted, 10) || 0;
  const accepted = parseInt(stats.accepted, 10) || 0;
  const rejected = parseInt(stats.rejected, 10) || 0;
  const pendingReview = parseInt(stats.pending_review, 10) || 0;
  const total = parseInt(stats.total, 10) || 0;

  const autoPostedPercent = total > 0 ? (autoPosted / total) * 100 : 0;
  const accuracy = accepted + rejected > 0 ? (accepted / (accepted + rejected)) * 100 : 0;

  return {
    totalProcessed,
    autoPosted,
    autoPostedPercent: Math.round(autoPostedPercent * 10) / 10,
    accuracy: Math.round(accuracy * 10) / 10,
    pendingReview,
    rulesCount: parseInt(ruleStats.rules_count, 10) || 0,
  };
}

/**
 * Scan and classify transactions for all companies in the system.
 * Called by the scheduler on a recurring basis.
 */
export async function scanAndClassifyAllCompanies(): Promise<void> {
  const { rows: companies } = await pool.query(
    `SELECT DISTINCT company_id FROM bank_transactions WHERE is_reconciled = false`
  );
  const companyIds: string[] = companies.map((r: any) => r.company_id);
  for (const companyId of companyIds) {
    try {
      await scanAndClassifyTransactions(companyId);
    } catch (err) {
      // Log per-company failures but continue with others
      const log = (await import('../config/logger')).createLogger('autonomous-gl');
      log.error({ err, companyId }, 'Error scanning company');
    }
  }
}
