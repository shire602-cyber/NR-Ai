import {
  AiNotConfiguredError,
  type MeteredOpenAI,
  createMeteredOpenAI,
} from "../services/ai/usage-meter";
import type { AiTask } from "../services/ai/model-router";
import type { Express, Request } from "express";
import OpenAI from "openai";
import { aiStatementImportBody } from "../../shared/validators/banking";
import { asyncHandler } from "../middleware/errorHandler";
import { authMiddleware, requireCompanyAccess, requireCustomer } from "../middleware/auth";
import { buildLimiter, limiterProfiles } from "../middleware/rateLimit";
import { getEnv } from "../config/env";
import { strictBody } from "../http/strict-body";
import {
  aiReconcileBody,
  batchCategorizeBody,
  cfoAdviceBody,
  detectAnomaliesBody,
  nlGatewayBody,
  parseBankStatementBody,
  resolveAnomalyAlertBody,
  smartSuggestBody,
} from "./ai/bodies";
import { UUID_RE, forecastCashflowBody, log, manualBankTransactionBody } from "./ai/shared";
import {
  handlePostAiCategorize,
  handlePostAiParseBankStatement,
  handlePostAiCfoAdvice,
  handlePostAiBatchCategorize,
} from "./ai/categorization";
import {
  handlePostAiDetectAnomalies,
  handleGetCompaniesAnomalyAlerts,
  handlePostAnomalyAlertsResolve,
} from "./ai/anomalies";
import {
  handlePostAiReconcile,
  handleGetCompaniesBankTransactions,
  handlePostCompaniesBankTransactions,
  handlePostCompaniesBankTransactionsImport,
} from "./ai/bank-transactions";
import {
  handlePostAiForecastCashflow,
  handleGetCompaniesForecasts,
  handlePostAiClassificationFeedback,
  handlePostAiAutopilotProcess,
  handleGetAiClassifierStats,
  handleGetAiClassifierConfig,
  handlePatchAiClassifierConfig,
} from "./ai/forecast-classifier";
import { handlePostAiNlGateway, handlePostAsk, handleGetAskHistory } from "./ai/assistant";
import {
  handleGetAutocompleteAccounts,
  handleGetAutocompleteCustomers,
  handleGetAutocompleteMerchants,
  handleGetAutocompleteDescriptions,
  handlePostAiSmartSuggest,
} from "./ai/autocomplete";

// =============================================
// AI client initialisation
// =============================================

function createOpenAIClient(): OpenAI | null {
  const apiKey = getEnv().OPENAI_API_KEY;
  if (!apiKey) {
    log.warn("OPENAI_API_KEY not set — AI features will be disabled");
    return null;
  }
  return new OpenAI({ apiKey });
}

/** Company the request is about (body, params or query); only used for metering/quota. */
function resolveRequestCompanyId(req: Request): string | null {
  const candidate =
    (req.body && typeof req.body === "object"
      ? (req.body as { companyId?: unknown }).companyId
      : undefined) ??
    req.params?.companyId ??
    (typeof req.query?.companyId === "string" ? req.query.companyId : undefined);
  return typeof candidate === "string" && UUID_RE.test(candidate) ? candidate : null;
}

export interface AIRouteDeps {
  /** Inject a (mock) OpenAI client. `null` forces the not-configured state. */
  openaiClient?: OpenAI | null;
}

// =============================================
// Register AI routes
// =============================================

export function registerAIRoutes(app: Express, deps: AIRouteDeps = {}) {
  const openai = deps.openaiClient !== undefined ? deps.openaiClient : createOpenAIClient();
  // Route-level AI rate limiter (also covers /api/ask, which is outside /api/ai/).
  const aiLimiter = buildLimiter(limiterProfiles.ai);

  // If OpenAI is not configured, register routes that return graceful errors
  if (!openai) {
    log.warn("AI routes registered without OpenAI — AI endpoints will return 503");
  }

  /** Metered, quota-checked model client for a task. Throws 503 when AI is not configured. */
  function getAI(req: Request, task: AiTask): MeteredOpenAI {
    if (!openai) throw new AiNotConfiguredError();
    return createMeteredOpenAI(openai, {
      companyId: resolveRequestCompanyId(req),
      userId: req.user?.id ?? null,
      task,
    });
  }

  // =====================================
  // AI Categorization Route
  // =====================================

  // Customer-only: AI expense categorization
  app.post(
    "/api/ai/categorize",
    authMiddleware,
    aiLimiter,
    requireCustomer,
    asyncHandler(handlePostAiCategorize({ getAI }))
  );

  // AI Bank Statement Parser Route
  app.post(
    "/api/ai/parse-bank-statement",
    authMiddleware,
    aiLimiter,
    strictBody(parseBankStatementBody, { allowServerOwned: ["companyId"] }),
    asyncHandler(handlePostAiParseBankStatement({ getAI }))
  );

  // AI CFO Advice Route (R05-09, R05-25, R05-26)
  // Figures are computed on the server from POSTED ledger data. Any client-supplied
  // `context` (revenue, profit, ...) is ignored: the model can never be fed arbitrary numbers.
  app.post(
    "/api/ai/cfo-advice",
    authMiddleware,
    aiLimiter,
    requireCustomer,
    strictBody(cfoAdviceBody, { allowServerOwned: ["companyId"] }),
    requireCompanyAccess("body"),
    asyncHandler(handlePostAiCfoAdvice({ getAI }))
  );

  // =====================================
  // AI-Driven Automation Features
  // =====================================

  // Enhanced AI Batch Transaction Categorization
  app.post(
    "/api/ai/batch-categorize",
    authMiddleware,
    aiLimiter,
    requireCustomer,
    strictBody(batchCategorizeBody, { allowServerOwned: ["companyId"] }),
    asyncHandler(handlePostAiBatchCategorize({ getAI }))
  );

  // Anomaly & Duplicate Detection
  app.post(
    "/api/ai/detect-anomalies",
    authMiddleware,
    aiLimiter,
    requireCustomer,
    strictBody(detectAnomaliesBody, { allowServerOwned: ["companyId"] }),
    asyncHandler(handlePostAiDetectAnomalies({ getAI }))
  );

  // Get Anomaly Alerts
  app.get(
    "/api/companies/:companyId/anomaly-alerts",
    authMiddleware,
    requireCustomer,
    asyncHandler(handleGetCompaniesAnomalyAlerts)
  );

  // Resolve Anomaly Alert
  app.post(
    "/api/anomaly-alerts/:id/resolve",
    authMiddleware,
    requireCustomer,
    strictBody(resolveAnomalyAlertBody),
    asyncHandler(handlePostAnomalyAlertsResolve)
  );

  // AI-Assisted Bank Reconciliation
  app.post(
    "/api/ai/reconcile",
    authMiddleware,
    aiLimiter,
    requireCustomer,
    strictBody(aiReconcileBody, { allowServerOwned: ["companyId"] }),
    asyncHandler(handlePostAiReconcile({ getAI }))
  );

  // Bank Transactions CRUD
  app.get(
    "/api/companies/:companyId/bank-transactions",
    authMiddleware,
    requireCustomer,
    asyncHandler(handleGetCompaniesBankTransactions)
  );

  // One manually keyed bank line (S3): same shared import pipeline as statement files and AI/PDF
  // rows — a managed bank account is required, the row is strictly validated (no NaN, no
  // client-set reconciliation state), deduplicated and recorded in an import batch with undo.
  app.post(
    "/api/companies/:companyId/bank-transactions",
    authMiddleware,
    requireCustomer,
    strictBody(manualBankTransactionBody),
    asyncHandler(handlePostCompaniesBankTransactions)
  );

  // PDF / AI-extracted statement rows (W3-C, R06-12): requires a managed bank account and goes
  // through the shared import pipeline (parser row shape, strict validation, dedupe, import
  // batch with undo, continuity check). Invalid rows are reported, never stored as NaN.
  app.post(
    "/api/companies/:companyId/bank-transactions/import",
    authMiddleware,
    requireCustomer,
    strictBody(aiStatementImportBody),
    asyncHandler(handlePostCompaniesBankTransactionsImport)
  );

  // Cash-flow forecast (S3). The figures come from the document-driven forecast
  // (open invoices / approved bills / payroll / tax due dates / scheduled items) and are stored as
  // a monthly snapshot. The former historical-average + model prediction fabricated inflows and
  // outflows, so no model output is stored or returned as a figure any more.
  app.post(
    "/api/ai/forecast-cashflow",
    authMiddleware,
    aiLimiter,
    requireCustomer,
    strictBody(forecastCashflowBody, { allowServerOwned: ["companyId"] }),
    asyncHandler(handlePostAiForecastCashflow)
  );

  // Get stored forecasts
  app.get(
    "/api/companies/:companyId/forecasts",
    authMiddleware,
    requireCompanyAccess("params"),
    asyncHandler(handleGetCompaniesForecasts)
  );

  app.post(
    "/api/ai/classification-feedback",
    authMiddleware,
    asyncHandler(handlePostAiClassificationFeedback)
  );

  // Run the full Receipt Autopilot pipeline on an OCR-extracted receipt.
  app.post(
    "/api/ai/autopilot/process",
    authMiddleware,
    aiLimiter,
    requireCustomer,
    asyncHandler(handlePostAiAutopilotProcess)
  );

  // Aggregate accuracy stats for the AI Accuracy dashboard.
  app.get(
    "/api/ai/classifier-stats",
    authMiddleware,
    requireCustomer,
    asyncHandler(handleGetAiClassifierStats)
  );

  // Get / update the per-company classifier config (mode, threshold, autopilot toggle).
  app.get(
    "/api/ai/classifier-config",
    authMiddleware,
    requireCustomer,
    asyncHandler(handleGetAiClassifierConfig)
  );

  app.patch(
    "/api/ai/classifier-config",
    authMiddleware,
    requireCustomer,
    asyncHandler(handlePatchAiClassifierConfig)
  );

  // =====================================
  // Natural Language Gateway Routes
  // =====================================

  // Main Natural Language Query Endpoint
  app.post(
    "/api/ai/nl-gateway",
    authMiddleware,
    aiLimiter,
    strictBody(nlGatewayBody, { allowServerOwned: ["companyId"] }),
    asyncHandler(handlePostAiNlGateway({ getAI }))
  );

  // Enhanced /api/ask endpoint with streaming support. POST /api/ai/chat is an alias (R05-14).
  // The client can no longer supply a system prompt (R05-10): only a named tone preset.
  app.post(
    ["/api/ask", "/api/ai/chat"],
    authMiddleware,
    aiLimiter,
    asyncHandler(handlePostAsk({ getAI, openai }))
  );

  // Get conversation history
  app.get("/api/ask/history", authMiddleware, asyncHandler(handleGetAskHistory));

  // Autocomplete endpoints for smart suggestions
  app.get(
    "/api/autocomplete/accounts",
    authMiddleware,
    asyncHandler(handleGetAutocompleteAccounts)
  );

  app.get(
    "/api/autocomplete/customers",
    authMiddleware,
    asyncHandler(handleGetAutocompleteCustomers)
  );

  app.get(
    "/api/autocomplete/merchants",
    authMiddleware,
    asyncHandler(handleGetAutocompleteMerchants)
  );

  app.get(
    "/api/autocomplete/descriptions",
    authMiddleware,
    asyncHandler(handleGetAutocompleteDescriptions)
  );

  // Smart suggestions based on context
  app.post(
    "/api/ai/smart-suggest",
    authMiddleware,
    aiLimiter,
    strictBody(smartSuggestBody, { allowServerOwned: ["companyId"] }),
    asyncHandler(handlePostAiSmartSuggest({ getAI }))
  );
}
