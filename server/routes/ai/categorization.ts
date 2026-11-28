// AI categorization handlers: categorize, parse bank statement, CFO advice, batch categorize.
// Handlers moved from ai.routes.ts (R20-09); the route registrations (paths and
// middleware order) stay in ai.routes.ts.
import { DATA_BLOCK_INSTRUCTION, wrapUserData } from "../../services/ai/data-blocks";
import {
  GROUNDING_RULES,
  INSUFFICIENT_DATA_ANSWER,
  buildGroundedContext,
  renderFiguresBlock,
  verifyCitations,
} from "../../services/ai/grounding";
import type { Request, Response } from "express";
import { aiErrorBody } from "../../services/ai/usage-meter";
import { categorizationRequestSchema } from "../../../shared/schema";
import { classifyOcrReceipt } from "../../services/receipt-autopilot.service";
import { errorMessage, errorStatus, errorStatusCode } from "../../errors";
import { getClassifierConfig } from "../../services/training-data.service";
import { resolveModel } from "../../services/ai/model-router";
import { storage } from "../../storage";
import { AiHandlerContext, log } from "./shared";

/** POST /api/ai/categorize */
export function handlePostAiCategorize({ getAI }: Pick<AiHandlerContext, "getAI">) {
  return async (req: Request, res: Response) => {
    try {
      const validated = categorizationRequestSchema.parse(req.body);
      const userId = req.user!.id;

      // Verify company access
      const hasAccess = await storage.hasCompanyAccess(userId, validated.companyId);
      if (!hasAccess) {
        return res.status(403).json({ code: "COMPANY_ACCESS_DENIED", message: "Access denied" });
      }

      // Phase 2: Try internal classifier first. Only fall through to OpenAI when
      // the internal pipeline returns < 0.8 confidence (or the company is in
      // openai_only mode — handled inside classifyOcrReceipt itself).
      // Wrapped: a transient internal-classifier failure (DB blip, etc.) must
      // not break /categorize — fall through to the OpenAI path instead of
      // surfacing a 500. This preserves the pre-Phase-2 behaviour as a floor.
      let internal: Awaited<ReturnType<typeof classifyOcrReceipt>> | null = null;
      try {
        internal = await classifyOcrReceipt(validated.companyId, {
          merchant: validated.description,
          amount: parseFloat(String(validated.amount)) || 0,
          lineItems: [],
        });
      } catch (err: unknown) {
        log.warn(
          { err: errorMessage(err) || err },
          "Internal classifier failed — falling through to OpenAI"
        );
      }

      // Get company's Chart of Accounts
      const accounts = await storage.getAccountsByCompanyId(validated.companyId);
      const expenseAccounts = accounts.filter((a) => a.type === "expense");

      if (internal && internal.method !== "openai" && internal.confidence >= 0.8) {
        // We can short-circuit OpenAI entirely. Resolve the suggested account.
        const suggested = internal.accountId
          ? expenseAccounts.find((a) => a.id === internal.accountId)
          : expenseAccounts.find((a) =>
              a.nameEn.toLowerCase().includes(internal.category.toLowerCase())
            );
        if (suggested) {
          return res.json({
            suggestedAccountCode: suggested.code,
            suggestedAccountName: suggested.nameEn,
            accountId: suggested.id,
            confidence: internal.confidence,
            reason: internal.reason,
            method: internal.method,
          });
        }
        // Fall through to OpenAI when our COA has no clean match for the category.
      }

      // Build account list for AI prompt
      const accountList = expenseAccounts
        .map((acc) => `${acc.nameEn}${acc.nameAr ? ` (${acc.nameAr})` : ""}`)
        .join("\n");

      // Use OpenAI to categorize the expense
      const completion = await getAI(req, "categorize").chat.completions.create({
        model: resolveModel("categorize"),
        messages: [
          {
            role: "system",
            content: `You are an expert accountant specializing in UAE business expenses. Your task is to categorize expenses into the appropriate account from the Chart of Accounts.

Available expense accounts:
${accountList}

Analyze the transaction description and amount, then respond with a JSON object containing:
- accountCode: the most appropriate account code
- accountName: the English name of the account
- confidence: a number between 0 and 1 indicating how confident you are
- reason: a brief explanation (1-2 sentences) of why you chose this account

Consider UAE-specific patterns like DEWA (utilities), Careem/Uber (transport), du/Etisalat (telecom), etc.

${DATA_BLOCK_INSTRUCTION}`,
          },
          {
            role: "user",
            content: `Categorize this transaction:
${wrapUserData("description", validated.description, 500)}
Amount: ${validated.amount} ${validated.currency}`,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      });

      const aiResponse = JSON.parse(completion.choices[0].message.content || "{}");

      // Validate AI response scope: ensure the suggested account belongs to this company.
      // Prevents AI hallucinations from referencing accounts outside the company's COA.
      const suggestedAccount = expenseAccounts.find(
        (a) =>
          a.nameEn.toLowerCase() === (aiResponse.accountName || "").toLowerCase() ||
          (a.nameAr && a.nameAr === aiResponse.accountName)
      );

      if (!suggestedAccount) {
        log.warn(
          { companyId: validated.companyId, accountName: aiResponse.accountName },
          "AI suggested account not found in company COA"
        );
        return res.status(422).json({
          code: "AI_ACCOUNT_NOT_IN_COA",
          message: "AI suggested an account that does not exist in your Chart of Accounts",
        });
      }

      res.json({
        suggestedAccountCode: aiResponse.accountCode,
        suggestedAccountName: suggestedAccount.nameEn,
        accountId: suggestedAccount.id,
        confidence: aiResponse.confidence,
        reason: aiResponse.reason,
      });
    } catch (error: unknown) {
      log.error({ err: error }, "AI categorization error");
      res.status(errorStatus(error) || errorStatusCode(error) || 500).json({
        message: errorMessage(error) || "AI categorization failed",
        ...aiErrorBody(error),
      });
    }
  };
}

/** Keep saved clients pointed at the supported upload flow. */
export async function handlePostAiParseBankStatement(_req: Request, res: Response) {
  res.status(410).json({
    code: "STATEMENT_CSV_REQUIRED",
    message: "Choose a bank CSV export.",
  });
}

/** POST /api/ai/cfo-advice */
export function handlePostAiCfoAdvice({ getAI }: Pick<AiHandlerContext, "getAI">) {
  return async (req: Request, res: Response) => {
    try {
      const { companyId, question } = req.body;

      if (!companyId || !question || typeof question !== "string") {
        return res
          .status(400)
          .json({ code: "AI_QUESTION_REQUIRED", message: "Company ID and question are required" });
      }

      // Throws 503 AI_NOT_CONFIGURED / 429 AI_QUOTA_EXCEEDED before any work is done.
      const ai = getAI(req, "advisory");
      const grounding = await buildGroundedContext(companyId);

      if (grounding.insufficientData) {
        return res.json({
          advice: INSUFFICIENT_DATA_ANSWER,
          insufficientData: true,
          grounded: true,
          citations: [],
          missing: grounding.missing,
          context: { companyName: grounding.companyName, period: grounding.period },
        });
      }

      const completion = await ai.chat.completions.create({
        model: resolveModel("advisory"),
        messages: [
          {
            role: "system",
            content: `You are an experienced CFO and financial advisor specializing in UAE businesses. You provide strategic financial advice based ONLY on the verified figures below.

Company: ${grounding.companyName || "Your Business"}
Period: ${grounding.period.start} to ${grounding.period.end}

VERIFIED FIGURES (computed by the server from posted ledger entries):
${renderFiguresBlock(grounding)}

${GROUNDING_RULES}

Your role is to:
1. Provide actionable financial advice specific to UAE businesses
2. Identify trends, risks, and opportunities in the figures
3. Suggest concrete steps to improve financial health
4. Consider UAE-specific factors like VAT (5%), corporate tax, and local business practices
5. Be concise but thorough (2-4 paragraphs)

Keep your tone professional but friendly, like a trusted advisor.

${DATA_BLOCK_INSTRUCTION}`,
          },
          {
            role: "user",
            content: wrapUserData("question", question, 2000),
          },
        ],
        temperature: 0.2,
        max_tokens: 800,
      });

      const advice = completion.choices[0].message.content || "";
      const check = verifyCitations(advice, grounding);

      res.json({
        advice,
        grounded: check.grounded,
        insufficientData: false,
        citations: check.cited.map((f) => ({
          id: f.id,
          label: f.label,
          value: f.value,
          unit: f.unit,
          source: f.source,
        })),
        ...(check.unknown.length > 0 ? { unverifiedCitations: check.unknown } : {}),
        missing: grounding.missing,
        context: {
          companyName: grounding.companyName,
          period: grounding.period,
          figures: grounding.figures,
        },
      });
    } catch (error: unknown) {
      log.error({ err: error }, "AI CFO advice error");
      res.status(errorStatus(error) || errorStatusCode(error) || 500).json({
        message: errorMessage(error) || "Failed to get AI advice",
        ...aiErrorBody(error),
      });
    }
  };
}

/** POST /api/ai/batch-categorize */
export function handlePostAiBatchCategorize({ getAI }: Pick<AiHandlerContext, "getAI">) {
  return async (req: Request, res: Response) => {
    try {
      const { companyId, transactions } = req.body;
      const userId = req.user!.id;

      if (!companyId || !transactions || !Array.isArray(transactions)) {
        return res.status(400).json({
          code: "TRANSACTIONS_REQUIRED",
          message: "Company ID and transactions array required",
        });
      }

      // Verify company access
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ code: "COMPANY_ACCESS_DENIED", message: "Access denied" });
      }

      const accounts = await storage.getAccountsByCompanyId(companyId);
      const expenseAccounts = accounts.filter((a) => a.type === "expense");
      const incomeAccounts = accounts.filter((a) => a.type === "income");
      const allAccounts = [...expenseAccounts, ...incomeAccounts];

      const accountList = allAccounts
        .map((acc) => `${acc.nameEn} (${acc.type})${acc.nameAr ? ` - ${acc.nameAr}` : ""}`)
        .join("\n");

      // Phase 2: try the internal classifier on each transaction. High-confidence
      // hits (≥ 0.8) skip the OpenAI call entirely and are merged into the
      // response; the rest are passed to OpenAI as a smaller batch.
      // Pre-fetch config + accounts ONCE so the per-transaction loop doesn't
      // re-issue getCompany / getAccountsByCompanyId on every call (N+1 fix).
      const classifierConfig = await getClassifierConfig(companyId);
      const internalResults: Record<
        number,
        {
          category: string;
          confidence: number;
          reason: string;
          method: string;
          accountName?: string;
        }
      > = {};
      const remaining: Array<{ originalIndex: number; t: (typeof transactions)[number] }> = [];
      for (let i = 0; i < transactions.length; i++) {
        const t = transactions[i];
        try {
          const r = await classifyOcrReceipt(
            companyId,
            {
              merchant: t.description || t.merchant || "",
              amount: parseFloat(String(t.amount)) || 0,
              lineItems: [],
            },
            { config: classifierConfig, accounts }
          );
          if (r.method !== "openai" && r.confidence >= 0.8) {
            const matched = r.accountId
              ? expenseAccounts.find((a) => a.id === r.accountId)
              : expenseAccounts.find((a) =>
                  a.nameEn.toLowerCase().includes(r.category.toLowerCase())
                );
            internalResults[i] = {
              category: r.category,
              confidence: r.confidence,
              reason: r.reason,
              method: r.method,
              accountName: matched?.nameEn,
            };
          } else {
            remaining.push({ originalIndex: i, t });
          }
        } catch (err: unknown) {
          log.warn(
            { err: errorMessage(err), idx: i },
            "Internal classifier failed for batch item — falling back to OpenAI"
          );
          remaining.push({ originalIndex: i, t });
        }
      }

      // Get previous classifications for learning context (for OpenAI prompt only).
      const previousClassifications =
        await storage.getTransactionClassificationsByCompanyId(companyId);
      const learningContext = previousClassifications
        .filter((c) => c.wasAccepted === true)
        .slice(0, 20)
        .map((c) => `"${c.description}" -> ${c.suggestedCategory}`)
        .join("\n");

      const transactionList = remaining
        .map(
          (row, i) =>
            `${i + 1}. ${row.t.description} - Amount: ${row.t.amount} ${row.t.currency || "AED"}`
        )
        .join("\n");

      // Build the merged response, starting with the internal-classifier hits.
      const allClassifications: Array<Record<string, unknown> & { index: number }> = [];
      for (const idxStr of Object.keys(internalResults)) {
        const idx = parseInt(idxStr, 10);
        const r = internalResults[idx];
        const t = transactions[idx];
        allClassifications.push({
          index: idx,
          accountName: r.accountName || r.category,
          category: r.category,
          confidence: r.confidence,
          reason: r.reason,
          method: r.method,
        });
        await storage.createTransactionClassification({
          companyId,
          description: t.description,
          merchant: t.merchant,
          amount: t.amount,
          suggestedCategory: r.category,
          aiConfidence: r.confidence,
          aiReason: r.reason,
          classifierMethod: r.method,
        });
      }

      // Only call OpenAI for the remaining low-confidence transactions.
      if (remaining.length > 0) {
        const completion = await getAI(req, "categorize").chat.completions.create({
          model: resolveModel("categorize"),
          messages: [
            {
              role: "system",
              content: `You are an expert UAE accountant specializing in transaction categorization using machine learning principles.

Available accounts:
${accountList}

${
  learningContext
    ? `Previous learned patterns (user-confirmed):
${learningContext}`
    : ""
}

Categorize each transaction based on:
1. UAE-specific vendor patterns (DEWA, du, Etisalat, Careem, RTA, ENOC, ADNOC, etc.)
2. Amount patterns and transaction context
3. Previous user-confirmed categorizations

Respond with a JSON object:
{
  "classifications": [
    {
      "index": 0,
      "accountName": "suggested account name",
      "category": "expense or income category",
      "confidence": 0.95,
      "reason": "brief explanation",
      "flags": ["unusual_amount", "duplicate_risk"] // optional warnings
    }
  ]
}

${DATA_BLOCK_INSTRUCTION}`,
            },
            {
              role: "user",
              content: `Categorize these transactions:\n${wrapUserData("transactions", transactionList, 30000)}`,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
        });

        const aiResponse = JSON.parse(completion.choices[0].message.content || "{}");

        for (const classification of aiResponse.classifications || []) {
          // OpenAI's index is into `remaining` (1-based label 1 → array index 0).
          const remainingIdx = typeof classification.index === "number" ? classification.index : -1;
          const row =
            remainingIdx >= 0 && remainingIdx < remaining.length ? remaining[remainingIdx] : null;
          if (!row) continue;
          const t = row.t;
          allClassifications.push({
            ...classification,
            index: row.originalIndex,
            method: "openai",
          });
          await storage.createTransactionClassification({
            companyId,
            description: t.description,
            merchant: t.merchant,
            amount: t.amount,
            suggestedCategory: classification.category,
            aiConfidence: classification.confidence,
            aiReason: classification.reason,
            classifierMethod: "openai",
          });
        }
      }

      // Sort by original index so the response order matches the input order.
      allClassifications.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      res.json({ classifications: allClassifications });
    } catch (error: unknown) {
      log.error({ err: error }, "Batch categorization error");
      res.status(errorStatus(error) || errorStatusCode(error) || 500).json({
        message: errorMessage(error) || "Batch categorization failed",
        ...aiErrorBody(error),
      });
    }
  };
}
