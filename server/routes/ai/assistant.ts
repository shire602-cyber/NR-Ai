// Natural-language gateway and grounded Ask handlers (ask, ask history).
// Handlers moved from ai.routes.ts (R20-09); the route registrations (paths and
// middleware order) stay in ai.routes.ts.
import {
  DATA_BLOCK_INSTRUCTION,
  TONE_PRESETS,
  TONE_PRESET_NAMES,
  wrapUserData,
} from "../../services/ai/data-blocks";
import {
  GROUNDING_RULES,
  buildGroundedContext,
  renderFiguresBlock,
  verifyCitations,
} from "../../services/ai/grounding";
import type { Request, Response } from "express";
import { aiErrorBody } from "../../services/ai/usage-meter";
import { allowedClientModels, resolveModel } from "../../services/ai/model-router";
import { errorCode, errorMessage, errorProperty, errorStatus, errorStatusCode } from "../../errors";
import { getEnv } from "../../config/env";
import { storage } from "../../storage";
import { z } from "zod";
import { AiHandlerContext, log } from "./shared";

/** POST /api/ai/nl-gateway */
export function handlePostAiNlGateway({ getAI }: Pick<AiHandlerContext, "getAI">) {
  return async (req: Request, res: Response) => {
    try {
      const { companyId, message } = req.body;
      const userId = req.user!.id;

      if (!companyId || !message) {
        return res.status(400).json({ message: "Company ID and message are required" });
      }

      // Verify company access
      const company = await storage.getCompany(companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Throws 503 AI_NOT_CONFIGURED / 429 AI_QUOTA_EXCEEDED before any query runs.
      const ai = getAI(req, "nl");

      // Server-computed, set-based figures from posted ledger entries (R05-09/R05-26).
      // The previous implementation loaded every journal line, invoice and receipt per call;
      // client-supplied `context` is ignored.
      const grounding = await buildGroundedContext(companyId);
      const figureValue = (prefix: string): number =>
        grounding.figures.find((f) => f.label.startsWith(prefix))?.value ?? 0;
      const financialSummary = {
        totalRevenue: figureValue("Revenue"),
        totalExpenses: figureValue("Expenses"),
        netProfit: figureValue("Net profit"),
        totalAssets: figureValue("Total assets"),
        totalLiabilities: figureValue("Total liabilities"),
        invoicesSummary: {
          pending: figureValue("Open invoices count"),
          outstandingValue: figureValue("Open receivables"),
        },
        expensesSummary: {
          total: figureValue("Receipts captured"),
          posted: figureValue("Receipts posted"),
          pending: Math.max(0, figureValue("Receipts captured") - figureValue("Receipts posted")),
          totalAmount: figureValue("Unposted receipt value"),
        },
      };
      const monthlyData = new Map<string, { revenue: number; expenses: number }>();

      const supportName = getEnv().SUPPORT_CONTACT_NAME;
      const supportPhone = getEnv().SUPPORT_CONTACT_PHONE;
      const supportLine =
        supportName && supportPhone
          ? `${supportName} at ${supportPhone}`
          : supportName || supportPhone || "a qualified professional";
      const supportGuidance =
        supportName && supportPhone
          ? `- IMPORTANT: When users ask for professional advice, complex accounting guidance, tax planning, or need expert consultation, always encourage them to contact ${supportLine} for personalized professional assistance`
          : `- IMPORTANT: When users ask for professional advice, complex accounting guidance, tax planning, or need expert consultation, always encourage them to consult a qualified professional`;
      const followUpLine =
        supportName && supportPhone
          ? `4. When professional advice is needed, suggest contacting ${supportLine}`
          : `4. When professional advice is needed, suggest consulting a qualified professional`;
      const closingGuidance =
        supportName && supportPhone
          ? `Always conclude with: "For personalized professional advice on this matter, I recommend contacting ${supportLine}. They can provide expert guidance tailored to your specific situation."`
          : `Always conclude with: "For personalized professional advice on this matter, I recommend consulting a qualified professional who can provide expert guidance tailored to your specific situation."`;

      const systemPrompt = `You are an intelligent bookkeeping assistant for a UAE business. You help users query and manage their financial data using natural language.

CAPABILITIES:
1. QUERY DATA: Answer questions about financial data (sales, expenses, profit, invoices, etc.)
2. PROVIDE INSIGHTS: Give analysis and recommendations based on the financial data
3. SUGGEST ACTIONS: Recommend actions the user could take (but don't execute them directly)

VERIFIED FIGURES (computed by the server from posted ledger entries, ${grounding.period.start} to ${grounding.period.end}):
${renderFiguresBlock(grounding)}

${GROUNDING_RULES}

${DATA_BLOCK_INSTRUCTION}

RULES:
- Currency is AED (UAE Dirhams), format as "AED X,XXX.XX"
- UAE VAT rate is 5%
- Always be accurate with numbers from the figures provided
- If asked about something not in the figures, say "insufficient data" and what is missing
- Be concise but helpful
- Support both English and Arabic (respond in the language of the query)
- Format numbers properly with thousand separators
- For date ranges, interpret "this month" as current calendar month, "last month" as previous calendar month, "this year" as current calendar year
- When suggesting actions, explain what the user should do but don't claim to have done it
${supportGuidance}

RESPONSE FORMAT:
Respond naturally in conversational language. Include:
1. Direct answer to the question
2. Relevant context or insights if helpful
3. Suggestions for follow-up questions or actions if appropriate
${followUpLine}

PROFESSIONAL ADVICE GUIDANCE:
Whenever a user asks about:
- Complex tax matters or tax planning
- Legal compliance issues
- Advanced financial strategies
- Business structure advice
- Professional accounting services
- Or any topic requiring expert consultation

${closingGuidance}

Current date: ${new Date().toISOString().split("T")[0]}
Company: ${company.name}`;

      const response = await ai.chat.completions.create({
        model: resolveModel("nl"),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: wrapUserData("question", message, 4000) },
        ],
        temperature: 0.2,
        max_tokens: 1000,
      });

      const assistantMessage =
        response.choices[0]?.message?.content || "I could not process your request.";
      const citationCheck = verifyCitations(assistantMessage, grounding);

      // Determine intent for UI hints
      let intent = "query";
      const lowerMessage = message.toLowerCase();
      if (
        lowerMessage.includes("create") ||
        lowerMessage.includes("add") ||
        lowerMessage.includes("record") ||
        lowerMessage.includes("new")
      ) {
        intent = "action";
      } else if (
        lowerMessage.includes("how") ||
        lowerMessage.includes("why") ||
        lowerMessage.includes("recommend") ||
        lowerMessage.includes("suggest")
      ) {
        intent = "advice";
      }

      // Generate follow-up suggestions based on context
      const followUpPrompts = [];
      if (financialSummary.invoicesSummary.pending > 0) {
        followUpPrompts.push("Show me overdue invoices");
      }
      if (financialSummary.expensesSummary.pending > 0) {
        followUpPrompts.push("What expenses need to be posted?");
      }
      if (financialSummary.totalRevenue > 0) {
        followUpPrompts.push("What's my profit margin this month?");
        followUpPrompts.push("How do my expenses compare to last month?");
      }

      res.json({
        response: assistantMessage,
        intent,
        grounded: citationCheck.grounded,
        insufficientData: grounding.insufficientData,
        citations: citationCheck.cited.map((f) => ({
          id: f.id,
          label: f.label,
          value: f.value,
          unit: f.unit,
          source: f.source,
        })),
        ...(citationCheck.unknown.length > 0 ? { unverifiedCitations: citationCheck.unknown } : {}),
        data: {
          summary: financialSummary,
          monthlyTrends: Object.fromEntries(monthlyData),
          figures: grounding.figures,
          period: grounding.period,
        },
        followUpPrompts: followUpPrompts.slice(0, 3),
        timestamp: new Date().toISOString(),
      });
    } catch (error: unknown) {
      log.error({ err: error }, "NL Gateway error");
      res.status(errorStatus(error) || errorStatusCode(error) || 500).json({
        message: errorMessage(error) || "Failed to process query",
        ...aiErrorBody(error),
      });
    }
  };
}

/** POST /api/ask, /api/ai/chat */
export function handlePostAsk({ getAI, openai }: Pick<AiHandlerContext, "getAI" | "openai">) {
  return async (req: Request, res: Response) => {
    const startTime = Date.now();
    let fullResponse = "";
    let conversationId: string | undefined;
    let isStreaming = false;
    // Models a client may request: cost-controlled allow-list derived from the router config.
    const allowedModels = allowedClientModels();
    const validationSchema = z.object({
      message: z.string().min(1, "Message is required").max(10000, "Message is too long"),
      companyId: z.string().uuid("Invalid company ID format").optional(),
      // Unknown or legacy model names (e.g. gpt-3.5-turbo from older clients) fall back to the
      // configured default rather than failing the request or reaching an unapproved model.
      model: z
        .string()
        .optional()
        .transform((m) => (m && allowedModels.includes(m) ? m : resolveModel("nl"))),
      tone: z.enum(TONE_PRESET_NAMES).optional().default("default"),
      stream: z.boolean().optional().default(false),
    });
    let validated: z.infer<typeof validationSchema> | undefined;

    try {
      const userId = req.user!.id;

      validated = validationSchema.parse(req.body);

      // If companyId is provided, verify access
      if (validated.companyId) {
        const hasAccess = await storage.hasCompanyAccess(userId, validated.companyId);
        if (!hasAccess) {
          return res.status(403).json({ message: "Access denied" });
        }
      }

      // "Not configured" is a 503 (service unavailable), never a 500 — an unconfigured AI
      // feature is an expected state, not a server fault.
      if (!openai) {
        return res.status(503).json({
          message: "AI service not configured — set OPENAI_API_KEY",
          code: "AI_NOT_CONFIGURED",
        });
      }
      const ai = getAI(req, "nl");

      const askSupportName = getEnv().SUPPORT_CONTACT_NAME;
      const askSupportPhone = getEnv().SUPPORT_CONTACT_PHONE;
      const askSupportLine =
        askSupportName && askSupportPhone
          ? `${askSupportName} at ${askSupportPhone}`
          : askSupportName || askSupportPhone || "a qualified professional";
      const askGuidanceBlock =
        askSupportName && askSupportPhone
          ? `- When users ask for professional advice, complex accounting guidance, tax planning, or need expert consultation, always encourage them to contact ${askSupportLine} for personalized professional assistance.
- For complex tax matters, legal compliance, advanced financial strategies, business structure advice, or any topic requiring expert consultation, always suggest: "For personalized professional advice on this matter, I recommend contacting ${askSupportLine}. They can provide expert guidance tailored to your specific situation."`
          : `- When users ask for professional advice, complex accounting guidance, tax planning, or need expert consultation, always encourage them to consult a qualified professional.
- For complex tax matters, legal compliance, advanced financial strategies, business structure advice, or any topic requiring expert consultation, always suggest: "For personalized professional advice on this matter, I recommend consulting a qualified professional who can provide expert guidance tailored to your specific situation."`;

      // Fixed server-side system prompt; the client picks only a tone preset.
      const systemPrompt = `You are a helpful AI assistant for accounting and financial management. Provide clear, accurate, and professional responses. You have no access to the user's books in this chat: if asked for the user's own figures, say you cannot see them and suggest the AI CFO or reports pages.
${TONE_PRESETS[validated.tone]}

IMPORTANT GUIDELINES:
${askGuidanceBlock}

${DATA_BLOCK_INSTRUCTION}`;
      const userContent = wrapUserData("question", validated.message, 10000);

      // Setup streaming if requested
      if (validated.stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
        isStreaming = true; // Mark that headers are committed

        try {
          const stream = await ai.chat.completions.create({
            model: validated.model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userContent },
            ],
            temperature: 0.4,
            max_tokens: 2000,
            stream: true,
          });

          // Stream the response
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
              fullResponse += content;
              res.write(`data: ${JSON.stringify({ content, done: false })}\n\n`);
            }
          }
        } catch (streamError: unknown) {
          // Error occurred during streaming - headers already sent, must use SSE format
          log.error({ err: streamError }, "/api/ask streaming error");

          // Send error as SSE message
          const streamErrorMessage =
            errorMessage(streamError) || "An error occurred while streaming the response";
          res.write(
            `data: ${JSON.stringify({
              error: true,
              code:
                errorCode(streamError) === "AI_QUOTA_EXCEEDED" ? "AI_QUOTA_EXCEEDED" : undefined,
              message: streamErrorMessage,
              done: true,
            })}\n\n`
          );
          res.end();

          // Store error conversation
          try {
            await storage.createAiConversation({
              userId,
              companyId: validated.companyId || null,
              prompt: validated.message,
              response: fullResponse || "Error: " + streamErrorMessage,
              model: validated.model,
              systemPrompt: `tone:${validated.tone}`,
              responseTime: Date.now() - startTime,
              error: streamErrorMessage,
            });
          } catch (dbError) {
            log.error({ err: dbError }, "Failed to store error conversation");
          }

          return; // Exit early, response already sent
        }

        // Store conversation BEFORE sending completion signal to avoid race condition
        // The client will refetch history when it receives done: true, so we need the
        // conversation to already be in the database at that point
        const responseTime = Date.now() - startTime;
        try {
          await storage.createAiConversation({
            userId,
            companyId: validated.companyId || null,
            prompt: validated.message,
            response: fullResponse,
            model: validated.model,
            systemPrompt: `tone:${validated.tone}`,
            responseTime,
          });
        } catch (dbError) {
          log.error({ err: dbError }, "Failed to store conversation");
          // Continue even if storage fails - still send completion signal
        }

        // Send completion signal after database storage completes
        res.write(`data: ${JSON.stringify({ content: "", done: true })}\n\n`);
        res.end();
      } else {
        // Non-streaming response
        const response = await ai.chat.completions.create({
          model: validated.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          temperature: 0.4,
          max_tokens: 2000,
        });

        const assistantMessage =
          response.choices[0]?.message?.content || "I could not process your request.";
        const responseTime = Date.now() - startTime;
        const tokensUsed = response.usage?.total_tokens;

        // Store conversation
        const conversation = await storage.createAiConversation({
          userId,
          companyId: validated.companyId || null,
          prompt: validated.message,
          response: assistantMessage,
          model: validated.model,
          systemPrompt: `tone:${validated.tone}`,
          responseTime,
          tokensUsed: tokensUsed || null,
        });
        conversationId = conversation.id;

        res.json({
          response: assistantMessage,
          model: validated.model,
          timestamp: new Date().toISOString(),
          conversationId,
          tokensUsed,
          responseTime,
        });
      }
    } catch (error: unknown) {
      log.error({ err: error }, "/api/ask error");

      // Check if headers have already been sent (streaming mode)
      // If headers are committed, we cannot send JSON responses - must use SSE format
      if (isStreaming || res.headersSent) {
        // Headers already committed - send error as SSE message
        const sseErrorMessage = errorMessage(error) || "Failed to process request";
        try {
          res.write(
            `data: ${JSON.stringify({
              error: true,
              message: sseErrorMessage,
              done: true,
            })}\n\n`
          );
          res.end();
        } catch (writeError) {
          // Response already ended or connection closed - log but don't throw
          log.error({ err: writeError }, "Failed to send SSE error message");
        }

        // Store error conversation if we have partial data
        // Use optional chaining since validated might not exist if error occurred early
        try {
          const userId = req.user!.id;
          if (userId) {
            await storage.createAiConversation({
              userId,
              companyId: validated?.companyId || null,
              prompt: validated?.message || "Unknown",
              response: fullResponse || "Error: " + sseErrorMessage,
              model: validated?.model || resolveModel("nl"),
              systemPrompt: `tone:${validated?.tone ?? "default"}`,
              responseTime: Date.now() - startTime,
              error: sseErrorMessage,
            });
          }
        } catch (dbError) {
          log.error({ err: dbError }, "Failed to store error conversation");
        }
        return; // Exit early, response already sent
      }

      // Headers not sent yet - can send normal JSON response
      // Handle Zod validation errors
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Validation error",
          errors: error.errors.map((e) => ({ path: e.path.join("."), message: e.message })),
        });
      }

      // Quota / not-configured errors carry stable codes.
      const status = errorStatus(error);
      if (errorCode(error) === "AI_QUOTA_EXCEEDED" || status === 503) {
        return res
          .status(status as number)
          .json({ message: errorMessage(error), ...aiErrorBody(error) });
      }

      // Handle OpenAI API errors
      if (status) {
        const statusCode = status >= 400 && status < 600 ? status : 500;
        return res.status(statusCode).json({
          message: errorMessage(error) || "OpenAI API error",
          error: errorMessage(errorProperty(error, "error")) || errorMessage(error),
        });
      }

      res.status(errorStatus(error) || errorStatusCode(error) || 500).json({
        message: errorMessage(error) || "Failed to process request",
        ...aiErrorBody(error),
      });
    }
  };
}

/** GET /api/ask/history */
export const handleGetAskHistory = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { companyId } = req.query;
    // Validate and parse limit parameter with fallback, matching pattern used elsewhere
    const limit = parseInt(req.query.limit as string) || 50;

    let conversations;
    if (companyId && typeof companyId === "string") {
      // Verify access
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }
      conversations = await storage.getAiConversationsByCompanyId(companyId, limit);
    } else {
      conversations = await storage.getAiConversationsByUserId(userId, limit);
    }

    res.json(conversations);
  } catch (error: unknown) {
    log.error({ err: error }, "/api/ask/history error");
    res.status(errorStatus(error) || errorStatusCode(error) || 500).json({
      message: errorMessage(error) || "Failed to fetch history",
      ...aiErrorBody(error),
    });
  }
};
