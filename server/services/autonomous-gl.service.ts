import OpenAI from "openai";
import { journalMemo } from "@shared/journal-memo";
import { pool } from "../db";
import { storage } from "../storage";
import { getEnv } from "../config/env";
import { resolveModel } from "./ai/model-router";
import { createMeteredOpenAI } from "./ai/usage-meter";
import { DATA_BLOCK_INSTRUCTION, wrapUserData } from "./ai/data-blocks";
import { createLogger } from "../config/logger";
import { assertPeriodNotLocked } from "./period-lock.service";
import { recordAudit } from "./audit.service";
import { notificationCopy } from "../../shared/server-copy";
import { deleteDraft, postDraft, postJournal } from "../ledger";
import { AI_QUEUE_STILL_OPEN_SQL } from "./ai-gl-queue-sql";
import { categorisationReasonCopy } from "../../shared/server-copy";
import { DomainError, errorCode, errorMessage } from "../errors";
import {
  applyMatch,
  confirmPendingEntry,
  getMatches,
  unmatchTransaction,
} from "./bank-reconciliation.service";

const log = createLogger("autonomous-gl");

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

function createOpenAIClient(companyId: string): OpenAI | null {
  const apiKey = getEnv().OPENAI_API_KEY;
  if (!apiKey) {
    log.warn("OPENAI_API_KEY not set — autonomous GL AI features disabled");
    return null;
  }
  // Quota-checked and recorded in ai_usage_events (R05-26).
  return createMeteredOpenAI(new OpenAI({ apiKey }), {
    companyId,
    task: "categorize",
  }) as unknown as OpenAI;
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
  const openai = createOpenAIClient(companyId);

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

  // The model writes its reason in the company language, so Arabic companies read Arabic.
  const companyLocale: string =
    (await pool.query(`SELECT locale FROM companies WHERE id = $1`, [companyId])).rows[0]?.locale ??
    "en";

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
      const matchedAccount = accounts.find((a) => a.id === matchedRule!.account_id);
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
          matchedAccount?.type || "expense",
          matchedRule.confidence,
          categorisationReasonCopy("categorise.matchedRule", {
            pattern: matchedRule.merchant_pattern || matchedRule.description_pattern || "",
            applied: matchedRule.times_applied,
            accepted: matchedRule.times_accepted,
          }).text,
          0,
          "pending_review",
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
          categorisationReasonCopy("categorise.operator.notConfigured").text,
          0,
          "pending_review",
        ]
      );
      continue;
    }

    try {
      const result = await classifyWithOpenAI(
        openai,
        txn,
        accounts,
        fewShotExamples,
        companyLocale
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
          "pending_review",
        ]
      );

      aiClassified++;
    } catch (err: unknown) {
      // Over the monthly AI cap: stop the scan and surface 429 instead of queueing every row blank.
      if (errorCode(err) === "AI_QUOTA_EXCEEDED") throw err;
      log.error({ err, txnId: txn.id }, "Failed to classify transaction with OpenAI");

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
          categorisationReasonCopy("categorise.operator.error", {
            error: errorMessage(err) || "Unknown error",
          }).text,
          0,
          "pending_review",
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

/** Language the model is asked to write the customer-facing reason in. */
export function reasonLanguage(locale: string | null | undefined): string {
  return locale === "ar" ? "written in Arabic" : "written in English";
}

/**
 * Classify a bank transaction using OpenAI with the company's chart of accounts
 * and few-shot examples.
 */
async function classifyWithOpenAI(
  openai: OpenAI,
  txn: BankTransactionRow,
  accounts: ChartOfAccountRow[],
  fewShotExamples: FewShotExample[],
  locale = "en"
): Promise<AICategorizationResult> {
  const AI_MODEL = resolveModel("categorize");

  // Build chart of accounts context
  const accountList = accounts
    .map(
      (a) =>
        `- ${a.code} | ${a.name_en}${a.name_ar ? ` (${a.name_ar})` : ""} | Type: ${a.type}${a.sub_type ? ` / ${a.sub_type}` : ""}`
    )
    .join("\n");

  // Build few-shot examples
  let fewShotBlock = "";
  if (fewShotExamples.length > 0) {
    const examples = fewShotExamples
      .map(
        (ex, i) =>
          `Example ${i + 1}: "${ex.description}" (AED ${ex.amount}) -> Account: ${ex.account_code} ${ex.account_name}`
      )
      .join("\n");
    fewShotBlock = `\n\nHere are previously accepted categorizations for this company:\n${examples}`;
  }

  const systemPrompt = `You are an expert UAE accountant working with the Muhasib.ai platform. Categorize this bank transaction into the most appropriate account from the company's Chart of Accounts.

CHART OF ACCOUNTS:
${accountList}
${fewShotBlock}

${DATA_BLOCK_INSTRUCTION}

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
  "reason": "<brief 1-2 sentence explanation of why this account was chosen, ${reasonLanguage(locale)}>"
}`;

  const userPrompt = `Categorize this bank transaction:
${wrapUserData("description", txn.description, 500)}
Amount: AED ${Math.abs(txn.amount).toFixed(2)} (${txn.amount > 0 ? "credit/deposit" : "debit/payment"})
Date: ${txn.transaction_date}${txn.reference ? `\n${wrapUserData("reference", txn.reference, 200)}` : ""}`;

  const completion = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });

  const responseText = completion.choices[0].message.content || "{}";
  const parsed = JSON.parse(responseText);

  // Validate the accountId exists in the chart of accounts
  const matchedAccount = accounts.find((a) => a.id === parsed.accountId);
  if (!matchedAccount) {
    // Try matching by name or code as fallback
    const wantName = (parsed.accountName || "").toLowerCase().trim();
    const byName =
      accounts.find((a) => a.name_en.toLowerCase() === wantName) ||
      (wantName
        ? accounts.find(
            (a) =>
              a.name_en.toLowerCase().includes(wantName) ||
              wantName.includes(a.name_en.toLowerCase())
          )
        : undefined) ||
      (parsed.accountCode
        ? accounts.find((a) => String(a.code) === String(parsed.accountCode))
        : undefined);
    if (byName) {
      parsed.accountId = byName.id;
      parsed.accountName = byName.name_en;
    } else {
      // AI returned an invalid account — reduce confidence
      log.warn(
        { txnId: txn.id, aiAccountId: parsed.accountId },
        "AI returned unrecognized account ID"
      );
      parsed.confidence = Math.min(parsed.confidence || 0, 0.3);
      parsed.reason = (parsed.reason || "") + " (Warning: AI suggested an unrecognized account)";
    }
  }

  return {
    accountId: parsed.accountId || null,
    accountName: parsed.accountName || "Unknown",
    category: parsed.category || "expense",
    confidence: Math.max(0, Math.min(1, parsed.confidence || 0)),
    reason: parsed.reason || "AI categorization",
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
       AND ${AI_QUEUE_STILL_OPEN_SQL}
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

      await recordAudit({
        companyId,
        action: "ai_gl_draft_created",
        entityType: "journal_entry",
        entityId: journalEntryId,
        extra: {
          queueItemId: item.id,
          confidence: Number(item.ai_confidence),
          reason: item.ai_reason,
          description: item.description,
          amount: Number(item.amount),
        },
      });
    } catch (err: unknown) {
      log.error({ err, queueItemId: item.id }, "Failed to draft queue item");
      errors.push(`Failed to draft item ${item.id}: ${errorMessage(err)}`);
    }
  }

  if (draftedEntryIds.length > 0) {
    await notifyOwnerOfDrafts(companyId, draftedEntryIds.length).catch((err) => {
      log.error({ err, companyId }, "Failed to send draft notification");
    });
  }

  return { posted, errors };
}

async function notifyOwnerOfDrafts(companyId: string, draftCount: number): Promise<void> {
  const ownerUserId = await storage.resolveCompanyActorUserId(companyId);
  if (!ownerUserId) return;

  await pool.query(
    `INSERT INTO notifications
       (user_id, company_id, type, title, message, priority, related_entity_type, action_url)
     VALUES ($1, $2, 'system', $3, $4, 'high', 'journal_entry', '/journal?status=draft')`,
    // Sweep: the link was /journal-entries?status=draft (no such page: 404) and the copy was
    // English-only; it is now catalog copy the client localises.
    [
      ownerUserId,
      companyId,
      ...Object.values(
        notificationCopy(
          "notification.aiDraftsReview.title",
          "notification.aiDraftsReview.message",
          {
            count: draftCount,
          }
        )
      ),
    ]
  );
}

/**
 * Create the journal entry for a queue item through the ledger kernel.
 *
 * Bank-linked items go through the bank match service (applyMatch, target "entry"): the entry,
 * its allocation row in bank_transaction_matches and the line's reconciled state are written in
 * one transaction, so "Unmatch" on the Banking page reverses exactly what the AI created. An
 * unattended draft becomes a PENDING match (the line is not reconciled until a human posts it).
 * Items without a bank line post a plain kernel entry against the first cash/bank account.
 */
async function createJournalEntryForQueueItem(
  companyId: string,
  item: AIGLQueueItem & { bank_account_id?: string | null },
  // Human-reviewed actions (accept/correct) POST immediately — the review IS
  // the approval. Only the unattended autopilot path drafts for later review.
  postImmediately = false,
  actorUserId?: string
): Promise<string> {
  const txnDate = new Date(item.transaction_date);

  // Block AI auto-posting into a locked period.
  await assertPeriodNotLocked(companyId, txnDate);

  if (!item.suggested_account_id) {
    throw new Error("Cannot post: queue item has no suggested account");
  }

  // Resolve a valid actor user (owner / member / firm owner) for created_by.
  const actorId = actorUserId ?? (await storage.resolveCompanyActorUserId(companyId));
  if (!actorId) {
    throw new Error(
      `No actor user found for company ${companyId} — cannot create auto-posted journal entry`
    );
  }
  const memoFields = journalMemo(postImmediately ? "aiReviewed" : "aiDraft", {
    party: item.description,
  });

  if (item.bank_transaction_id) {
    const result = await applyMatch({
      companyId,
      transactionId: item.bank_transaction_id,
      actorId,
      target: {
        kind: "entry",
        accountId: item.suggested_account_id,
        memo: memoFields.memo,
        memoKey: memoFields.memoKey,
        memoParams: memoFields.memoParams,
        postingMode: postImmediately ? "posted" : "draft",
      },
      idempotencyKey: `ai-gl:${item.id}:${postImmediately ? "post" : "draft"}:${item.suggested_account_id}`,
    });
    const entryId = result.journalEntryIds[0];
    if (!entryId) throw new Error("Bank match created no journal entry");
    return entryId;
  }

  // No bank line: post against the first cash/bank account of the company.
  let bankAccountId = item.bank_account_id ?? null;
  if (!bankAccountId) {
    const { rows: bankAccounts } = await pool.query(
      `SELECT id FROM accounts
       WHERE company_id = $1 AND type = 'asset' AND sub_type IN ('current_asset', 'cash', 'bank')
         AND (lower(name_en) LIKE '%bank%' OR lower(name_en) LIKE '%cash%')
         AND is_active = true
       ORDER BY code LIMIT 1`,
      [companyId]
    );
    bankAccountId = bankAccounts[0]?.id || null;
  }
  if (!bankAccountId) {
    throw new Error("No bank account found for journal entry");
  }

  // Without a bank line the direction is unknown; like before, treat it as money paid out
  // (debit the suggested account, credit cash/bank).
  const amountFils = Math.round(Math.abs(parseFloat(item.amount)) * 100);
  const lines = [
    { accountId: item.suggested_account_id, debitFils: amountFils, description: item.description },
    { accountId: bankAccountId, creditFils: amountFils, description: item.description },
  ];
  const { entry } = await postJournal(
    {
      companyId,
      date: txnDate,
      ...memoFields,
      source: "ai_gl",
      sourceId: item.id,
      idempotencyKey: `ai-gl:${item.id}:${postImmediately ? "post" : "draft"}:${item.suggested_account_id}`,
      status: postImmediately ? "posted" : "draft",
      lines,
    },
    { actorId, audit: true }
  );
  return entry.id;
}

/**
 * Post the draft an autopilot run created for a queue item (human approval). A bank-linked draft
 * is a pending match: confirming it posts the entry and reconciles the line in one transaction.
 */
async function postQueueDraft(
  companyId: string,
  item: AIGLQueueItem,
  journalEntryId: string,
  userId: string
): Promise<void> {
  const [je] = (
    await pool.query(`SELECT status FROM journal_entries WHERE id = $1 AND company_id = $2`, [
      journalEntryId,
      companyId,
    ])
  ).rows as Array<{ status: string }>;
  if (!je)
    throw new DomainError("JOURNAL_ENTRY_NOT_FOUND", 404, undefined, "Draft entry not found");
  if (je.status !== "draft") return;
  if (item.bank_transaction_id) {
    const pending = await getMatches(companyId, item.bank_transaction_id, ["pending"]);
    if (pending.some((m) => m.journalEntryId === journalEntryId)) {
      await confirmPendingEntry({
        companyId,
        transactionId: item.bank_transaction_id,
        actorId: userId,
      });
      return;
    }
  }
  await postDraft(journalEntryId, { actorId: userId, companyId });
}

/**
 * Remove the draft an autopilot run created for a queue item (reject / correct). A bank-linked
 * draft is undone through the bank match service so the line returns to unmatched.
 */
async function discardQueueDraft(
  companyId: string,
  item: AIGLQueueItem,
  userId: string
): Promise<void> {
  if (!item.journal_entry_id) return;
  const [je] = (
    await pool.query(`SELECT status FROM journal_entries WHERE id = $1 AND company_id = $2`, [
      item.journal_entry_id,
      companyId,
    ])
  ).rows as Array<{ status: string }>;
  if (je?.status !== "draft") return;
  if (item.bank_transaction_id) {
    const pending = await getMatches(companyId, item.bank_transaction_id, ["pending"]);
    if (pending.some((m) => m.journalEntryId === item.journal_entry_id)) {
      await unmatchTransaction({
        companyId,
        transactionId: item.bank_transaction_id,
        actorId: userId,
        reason: "AI GL suggestion rejected or corrected",
      });
      return;
    }
  }
  await deleteDraft(item.journal_entry_id, { actorId: userId, companyId });
}

/**
 * Process user feedback on a queue item: accept, reject, or correct.
 */
export async function processUserFeedback(
  queueId: string,
  action: "accept" | "reject" | "correct",
  userId: string,
  userAccountId: string | undefined,
  companyId: string
): Promise<{ success: boolean; message: string; code?: string }> {
  // Get the queue item. Scoped to the caller's company: loading by id alone let a user of
  // company B accept/reject/correct company A's queue items (W1A-02).
  const _itemResult = await pool.query(
    `SELECT * FROM ai_gl_queue WHERE id = $1 AND company_id = $2`,
    [queueId, companyId]
  );
  const [item]: AIGLQueueItem[] = _itemResult.rows;

  if (!item) {
    return { success: false, code: "QUEUE_ITEM_NOT_FOUND", message: "Queue item not found" };
  }

  if (item.status !== "pending_review" && item.status !== "auto_posted") {
    return {
      success: false,
      code: "QUEUE_ITEM_NOT_PENDING",
      message: `Cannot process feedback for item with status: ${item.status}`,
    };
  }

  if (action === "accept") {
    // If not yet posted, create journal entry
    let journalEntryId = item.journal_entry_id;
    if (!journalEntryId) {
      if (!item.suggested_account_id) {
        return {
          success: false,
          code: "QUEUE_ITEM_NO_SUGGESTED_ACCOUNT",
          message: "Cannot accept — no suggested account",
        };
      }
      // human accepted -> post to GL now (bank-linked: through the bank match service, which
      // writes the allocation row and reconciles the line in the same transaction)
      journalEntryId = await createJournalEntryForQueueItem(item.company_id, item, true, userId);
    } else {
      // A draft already exists (auto-drafted by autopilot) — accepting it is the human
      // approval: post it through the ledger kernel (and confirm the pending bank match).
      await postQueueDraft(item.company_id, item, journalEntryId, userId);
    }

    await pool.query(
      `UPDATE ai_gl_queue
       SET status = 'accepted', journal_entry_id = $1, reviewed_by = $2, reviewed_at = now()
       WHERE id = $3`,
      [journalEntryId, userId, queueId]
    );

    // Update ai_company_rules: increment times_accepted
    await updateRuleFromFeedback(item, "accepted");

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

    await recordAudit({
      userId,
      companyId: item.company_id,
      action: "ai_gl_suggestion_accepted",
      entityType: "journal_entry",
      entityId: journalEntryId,
      extra: {
        queueItemId: item.id,
        confidence: Number(item.ai_confidence),
        description: item.description,
        amount: Number(item.amount),
      },
    });

    return { success: true, message: "Transaction accepted and posted to GL" };
  }

  if (action === "reject") {
    // An autopilot draft for a rejected suggestion must not stay postable.
    await discardQueueDraft(item.company_id, item, userId);
    await pool.query(
      `UPDATE ai_gl_queue
       SET status = 'rejected', reviewed_by = $1, reviewed_at = now()
       WHERE id = $2`,
      [userId, queueId]
    );

    // Update ai_company_rules: increment times_rejected
    await updateRuleFromFeedback(item, "rejected");

    return { success: true, message: "Transaction rejected" };
  }

  if (action === "correct") {
    if (!userAccountId) {
      return {
        success: false,
        code: "ACCOUNT_ID_REQUIRED",
        message: "userAccountId is required for correction",
      };
    }
    // The chosen account must belong to the same company as the queue item (W1A-02).
    const { rows: ownedAccount } = await pool.query(
      `SELECT 1 FROM accounts WHERE id = $1 AND company_id = $2`,
      [userAccountId, companyId]
    );
    if (ownedAccount.length === 0) {
      return {
        success: false,
        code: "ACCOUNT_NOT_IN_COMPANY",
        message: "Account not found for this company",
      };
    }

    // Replace any autopilot draft, then post with the user's chosen account.
    await discardQueueDraft(item.company_id, item, userId);
    const correctedItem = {
      ...item,
      journal_entry_id: null,
      suggested_account_id: userAccountId,
    };
    const journalEntryId = await createJournalEntryForQueueItem(
      item.company_id,
      correctedItem,
      true, // human corrected + approved -> post to GL now
      userId
    );

    await pool.query(
      `UPDATE ai_gl_queue
       SET status = 'corrected', user_selected_account_id = $1,
           journal_entry_id = $2, reviewed_by = $3, reviewed_at = now()
       WHERE id = $4`,
      [userAccountId, journalEntryId, userId, queueId]
    );

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

    return { success: true, message: "Transaction corrected and posted to GL" };
  }

  return { success: false, code: "INVALID_ACTION", message: "Invalid action" };
}

/**
 * Update ai_company_rules based on feedback.
 */
async function updateRuleFromFeedback(
  item: AIGLQueueItem,
  feedbackType: "accepted" | "rejected"
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
    if (feedbackType === "accepted") {
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
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 3);
  const pattern = words.join(" ").toLowerCase();

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
  const {
    rows: [stats],
  } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status != 'pending_review') as total_processed,
       COUNT(*) FILTER (WHERE status = 'auto_posted') as auto_posted,
       COUNT(*) FILTER (WHERE status = 'accepted' OR status = 'auto_posted') as accepted,
       COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
       COUNT(*) FILTER (WHERE status = 'pending_review' AND ${AI_QUEUE_STILL_OPEN_SQL}) as pending_review,
       COUNT(*) as total
     FROM ai_gl_queue q
     WHERE company_id = $1`,
    [companyId]
  );

  const {
    rows: [ruleStats],
  } = await pool.query(
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
  const companyIds: string[] = companies.map((r) => r.company_id);
  const { runForCompany } = await import("../platform/company-automations");
  for (const companyId of companyIds) {
    try {
      // WQ7: skipped for companies that switched "Categorise bank lines" off in Automations.
      await runForCompany(
        "categorise",
        companyId,
        () => scanAndClassifyTransactions(companyId),
        (scan) => {
          const s = scan as unknown as Record<string, unknown> | undefined;
          return s && typeof s === "object"
            ? { classified: Number(s.classified ?? 0), scanned: Number(s.scanned ?? 0) }
            : null;
        }
      );
    } catch (err) {
      // Log per-company failures but continue with others
      const log = (await import("../config/logger")).createLogger("autonomous-gl");
      log.error({ err, companyId }, "Error scanning company");
    }
  }
}
