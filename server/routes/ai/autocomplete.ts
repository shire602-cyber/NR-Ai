// Autocomplete (accounts, customers, merchants, descriptions) and smart-suggest handlers.
// Handlers moved from ai.routes.ts (R20-09); the route registrations (paths and
// middleware order) stay in ai.routes.ts.
import { DATA_BLOCK_INSTRUCTION, wrapUserData } from "../../services/ai/data-blocks";
import type { Request, Response } from "express";
import { aiErrorBody } from "../../services/ai/usage-meter";
import { classifyOcrReceipt } from "../../services/receipt-autopilot.service";
import { errorMessage, errorStatus, errorStatusCode } from "../../errors";
import { resolveModel } from "../../services/ai/model-router";
import { storage } from "../../storage";
import { AiHandlerContext, log } from "./shared";

/** GET /api/autocomplete/accounts */
export const handleGetAutocompleteAccounts = async (req: Request, res: Response) => {
  try {
    const { companyId, query, type, limit = 10 } = req.query;
    const userId = req.user!.id;

    if (!companyId) {
      return res
        .status(400)
        .json({ code: "COMPANY_ID_REQUIRED", message: "Company ID is required" });
    }

    // Verify company access
    const companyUsers = await storage.getCompanyUsersByCompanyId(companyId as string);
    if (!companyUsers.some((cu) => cu.userId === userId)) {
      return res.status(403).json({ code: "COMPANY_ACCESS_DENIED", message: "Access denied" });
    }

    let accounts = await storage.getAccountsByCompanyId(companyId as string);

    // Filter by type if specified
    if (type) {
      accounts = accounts.filter((a) => a.type === type);
    }

    // Filter by query if specified
    if (query) {
      const q = (query as string).toLowerCase();
      accounts = accounts.filter(
        (a) =>
          a.nameEn.toLowerCase().includes(q) || (a.nameAr && a.nameAr.toLowerCase().includes(q))
      );
    }

    // Sort by relevance (exact matches first) and limit
    accounts.sort((a, b) => {
      const qLower = ((query as string) || "").toLowerCase();
      const aExact = a.nameEn.toLowerCase().startsWith(qLower) ? 0 : 1;
      const bExact = b.nameEn.toLowerCase().startsWith(qLower) ? 0 : 1;
      return aExact - bExact;
    });

    res.json(
      accounts.slice(0, Number(limit)).map((a) => ({
        id: a.id,
        nameEn: a.nameEn,
        nameAr: a.nameAr,
        type: a.type,
        description: `${a.type.charAt(0).toUpperCase() + a.type.slice(1)} Account`,
      }))
    );
  } catch (error: unknown) {
    res
      .status(errorStatus(error) || errorStatusCode(error) || 500)
      .json({ message: errorMessage(error), ...aiErrorBody(error) });
  }
};

/** GET /api/autocomplete/customers */
export const handleGetAutocompleteCustomers = async (req: Request, res: Response) => {
  try {
    const { companyId, query, limit = 10 } = req.query;
    const userId = req.user!.id;

    if (!companyId) {
      return res
        .status(400)
        .json({ code: "COMPANY_ID_REQUIRED", message: "Company ID is required" });
    }

    // Verify company access
    const companyUsers = await storage.getCompanyUsersByCompanyId(companyId as string);
    if (!companyUsers.some((cu) => cu.userId === userId)) {
      return res.status(403).json({ code: "COMPANY_ACCESS_DENIED", message: "Access denied" });
    }

    // Get unique customers from invoices
    const invoices = await storage.getInvoicesByCompanyId(companyId as string);
    const customerMap = new Map<string, { name: string; trn: string | null; count: number }>();

    for (const invoice of invoices) {
      const key = invoice.customerName.toLowerCase();
      const existing = customerMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        customerMap.set(key, {
          name: invoice.customerName,
          trn: invoice.customerTrn,
          count: 1,
        });
      }
    }

    let customers = Array.from(customerMap.values());

    // Filter by query if specified
    if (query) {
      const q = (query as string).toLowerCase();
      customers = customers.filter(
        (c) => c.name.toLowerCase().includes(q) || c.trn?.toLowerCase().includes(q)
      );
    }

    // Sort by frequency and limit
    customers.sort((a, b) => b.count - a.count);

    res.json(
      customers.slice(0, Number(limit)).map((c) => ({
        name: c.name,
        trn: c.trn,
        invoiceCount: c.count,
      }))
    );
  } catch (error: unknown) {
    res
      .status(errorStatus(error) || errorStatusCode(error) || 500)
      .json({ message: errorMessage(error), ...aiErrorBody(error) });
  }
};

/** GET /api/autocomplete/merchants */
export const handleGetAutocompleteMerchants = async (req: Request, res: Response) => {
  try {
    const { companyId, query, limit = 10 } = req.query;
    const userId = req.user!.id;

    if (!companyId) {
      return res
        .status(400)
        .json({ code: "COMPANY_ID_REQUIRED", message: "Company ID is required" });
    }

    // Verify company access
    const companyUsers = await storage.getCompanyUsersByCompanyId(companyId as string);
    if (!companyUsers.some((cu) => cu.userId === userId)) {
      return res.status(403).json({ code: "COMPANY_ACCESS_DENIED", message: "Access denied" });
    }

    // Get unique merchants from receipts
    const receipts = await storage.getReceiptsByCompanyId(companyId as string);
    const merchantMap = new Map<
      string,
      { name: string; category: string | null; count: number; lastAmount: number }
    >();

    for (const receipt of receipts) {
      if (!receipt.merchant) continue;
      const key = receipt.merchant.toLowerCase();
      const existing = merchantMap.get(key);
      const receiptTotal = (Number(receipt.amount) || 0) + (Number(receipt.vatAmount) || 0);
      if (existing) {
        existing.count++;
        existing.lastAmount = receiptTotal;
      } else {
        merchantMap.set(key, {
          name: receipt.merchant,
          category: receipt.category,
          count: 1,
          lastAmount: receiptTotal,
        });
      }
    }

    let merchants = Array.from(merchantMap.values());

    // Filter by query if specified
    if (query) {
      const q = (query as string).toLowerCase();
      merchants = merchants.filter((m) => m.name.toLowerCase().includes(q));
    }

    // Sort by frequency and limit
    merchants.sort((a, b) => b.count - a.count);

    res.json(
      merchants.slice(0, Number(limit)).map((m) => ({
        name: m.name,
        category: m.category,
        receiptCount: m.count,
        lastAmount: m.lastAmount,
      }))
    );
  } catch (error: unknown) {
    res
      .status(errorStatus(error) || errorStatusCode(error) || 500)
      .json({ message: errorMessage(error), ...aiErrorBody(error) });
  }
};

/** GET /api/autocomplete/descriptions */
export const handleGetAutocompleteDescriptions = async (req: Request, res: Response) => {
  try {
    const { companyId, query, type, limit = 10 } = req.query;
    const userId = req.user!.id;

    if (!companyId) {
      return res
        .status(400)
        .json({ code: "COMPANY_ID_REQUIRED", message: "Company ID is required" });
    }

    // Verify company access
    const companyUsers = await storage.getCompanyUsersByCompanyId(companyId as string);
    if (!companyUsers.some((cu) => cu.userId === userId)) {
      return res.status(403).json({ code: "COMPANY_ACCESS_DENIED", message: "Access denied" });
    }

    const descriptions = new Map<string, number>();

    // Collect descriptions from journal entries
    if (!type || type === "journal") {
      const entries = await storage.getJournalEntriesByCompanyId(companyId as string);
      for (const entry of entries) {
        if (entry.memo) {
          const key = entry.memo.toLowerCase().trim();
          descriptions.set(key, (descriptions.get(key) || 0) + 1);
        }
      }
    }

    // Collect descriptions from invoice lines — single batched query.
    if (!type || type === "invoice") {
      const invoices = await storage.getInvoicesByCompanyId(companyId as string);
      const allLines = await storage.getInvoiceLinesByInvoiceIds(invoices.map((i) => i.id));
      for (const line of allLines) {
        if (line.description) {
          const key = line.description.toLowerCase().trim();
          descriptions.set(key, (descriptions.get(key) || 0) + 1);
        }
      }
    }

    let results = Array.from(descriptions.entries()).map(([text, count]) => ({ text, count }));

    // Filter by query if specified
    if (query) {
      const q = (query as string).toLowerCase();
      results = results.filter((d) => d.text.includes(q));
    }

    // Sort by frequency and limit
    results.sort((a, b) => b.count - a.count);

    res.json(
      results.slice(0, Number(limit)).map((d) => ({
        text: d.text.charAt(0).toUpperCase() + d.text.slice(1),
        usageCount: d.count,
      }))
    );
  } catch (error: unknown) {
    res
      .status(errorStatus(error) || errorStatusCode(error) || 500)
      .json({ message: errorMessage(error), ...aiErrorBody(error) });
  }
};

/** POST /api/ai/smart-suggest */
export function handlePostAiSmartSuggest({ getAI }: Pick<AiHandlerContext, "getAI">) {
  return async (req: Request, res: Response) => {
    try {
      const { companyId, context, fieldType, currentValue: _currentValue } = req.body;
      const userId = req.user!.id;

      if (!companyId || !context || !fieldType) {
        return res.status(400).json({
          code: "AUTOCOMPLETE_INPUT_REQUIRED",
          message: "Company ID, context, and fieldType are required",
        });
      }

      // Verify company access
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ code: "COMPANY_ACCESS_DENIED", message: "Access denied" });
      }

      const accounts = await storage.getAccountsByCompanyId(companyId);

      // Build context-aware suggestions
      const suggestions: Array<{
        value: string;
        label: string;
        confidence: number;
        reason: string;
      }> = [];

      if (fieldType === "account" && context.merchant) {
        // Phase 2: ask the internal classifier first. If it has a high-confidence
        // suggestion we surface it before the merchant-history lookup.
        try {
          const internal = await classifyOcrReceipt(companyId, {
            merchant: context.merchant,
            amount: parseFloat(String(context.amount || 0)) || 0,
            lineItems: [],
          });
          if (internal.method !== "openai" && internal.confidence >= 0.8) {
            const expenseAccounts = accounts.filter((a) => a.type === "expense");
            const matched = internal.accountId
              ? expenseAccounts.find((a) => a.id === internal.accountId)
              : expenseAccounts.find((a) =>
                  a.nameEn.toLowerCase().includes(internal.category.toLowerCase())
                );
            if (matched) {
              suggestions.push({
                value: matched.id,
                label: matched.nameEn,
                confidence: internal.confidence,
                reason: `${internal.reason} (${internal.method})`,
              });
            }
          }
        } catch (err: unknown) {
          log.warn({ err: errorMessage(err) }, "smart-suggest internal classifier failed");
        }

        // Learn from past categorizations for this merchant
        const receipts = await storage.getReceiptsByCompanyId(companyId);
        const merchantReceipts = receipts.filter(
          (r) => r.merchant?.toLowerCase() === context.merchant.toLowerCase() && r.journalEntryId
        );

        if (merchantReceipts.length > 0) {
          // Single batched fetch instead of one query per receipt.
          const entryIds = merchantReceipts
            .map((r) => r.journalEntryId)
            .filter((id): id is string => Boolean(id));
          const allLines = await storage.getJournalLinesByEntryIds(entryIds);
          const accountCounts = new Map<string, number>();
          for (const line of allLines) {
            const account = accounts.find((a) => a.id === line.accountId);
            if (account && account.type === "expense") {
              accountCounts.set(account.id, (accountCounts.get(account.id) || 0) + 1);
            }
          }

          const sorted = Array.from(accountCounts.entries()).sort((a, b) => b[1] - a[1]);
          for (const [accountId, count] of sorted.slice(0, 3)) {
            const account = accounts.find((a) => a.id === accountId);
            if (account) {
              suggestions.push({
                value: accountId,
                label: account.nameEn,
                confidence: Math.min(0.9, count / merchantReceipts.length),
                reason: `Used ${count} times for "${context.merchant}"`,
              });
            }
          }
        }

        // Use AI for unknown merchants
        if (suggestions.length === 0 && context.merchant) {
          const expenseAccounts = accounts.filter((a) => a.type === "expense");
          const prompt = `Given a UAE business expense, suggest the most appropriate expense account from this list:
${expenseAccounts.map((a) => `- ${a.nameEn}`).join("\n")}

${DATA_BLOCK_INSTRUCTION}
${wrapUserData("merchant", context.merchant, 200)}${context.category ? `\n${wrapUserData("category", context.category, 100)}` : ""}

Respond with just the account name, nothing else.`;

          const response = await getAI(req, "categorize").chat.completions.create({
            model: resolveModel("categorize"),
            messages: [{ role: "user", content: prompt }],
            temperature: 0.3,
            max_tokens: 50,
          });

          const suggestedName = response.choices[0]?.message?.content?.trim();
          const matchedAccount = expenseAccounts.find(
            (a) => a.nameEn.toLowerCase() === suggestedName?.toLowerCase()
          );

          if (matchedAccount) {
            suggestions.push({
              value: matchedAccount.id,
              label: matchedAccount.nameEn,
              confidence: 0.7,
              reason: "AI suggestion based on merchant name",
            });
          }
        }
      }

      if (fieldType === "category" && context.merchant) {
        // UAE-specific expense categories
        const categories = [
          "Office Supplies",
          "Utilities",
          "Travel",
          "Meals & Entertainment",
          "Rent",
          "Marketing",
          "Equipment",
          "Professional Services",
          "Insurance",
          "Maintenance",
          "Communication",
          "Other",
        ];

        const prompt = `For a UAE business expense, suggest the most appropriate expense category from: ${categories.join(", ")}

${DATA_BLOCK_INSTRUCTION}
${wrapUserData("merchant", context.merchant, 200)}

Respond with just the category name, nothing else.`;

        const response = await getAI(req, "categorize").chat.completions.create({
          model: resolveModel("categorize"),
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          max_tokens: 30,
        });

        const suggestedCategory = response.choices[0]?.message?.content?.trim();
        if (
          suggestedCategory &&
          categories.some((c) => c.toLowerCase() === suggestedCategory.toLowerCase())
        ) {
          suggestions.push({
            value: suggestedCategory,
            label: suggestedCategory,
            confidence: 0.8,
            reason: "AI suggestion based on merchant type",
          });
        }
      }

      res.json({ suggestions });
    } catch (error: unknown) {
      log.error({ err: error }, "Smart suggest error");
      res.status(errorStatus(error) || errorStatusCode(error) || 500).json({
        message: errorMessage(error) || "Failed to generate suggestions",
        ...aiErrorBody(error),
      });
    }
  };
}
