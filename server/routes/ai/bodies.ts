// Request bodies for the AI handlers that read req.body directly. Each is applied with
// strictBody(...) at its registration in ai.routes.ts, so handlers only ever see the parsed,
// canonical body (R17-20). companyId stays client-supplied here: the handlers (or
// requireCompanyAccess("body")) verify access to it.
import { z } from "zod";

const companyId = z.string().min(1).max(64);

export const detectAnomaliesBody = z.object({ companyId }).strict();

export const resolveAnomalyAlertBody = z.object({ note: z.string().max(2000).nullish() }).strict();

export const aiReconcileBody = z.object({ companyId }).strict();

export const parseBankStatementBody = z
  .object({
    text: z.string().max(500_000),
    companyId: companyId.optional(),
  })
  .strict();

export const cfoAdviceBody = z
  .object({
    companyId,
    question: z.string().min(1).max(4000),
    // Client-supplied figures are ignored by the handler (R05-09); the key is still accepted.
    context: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const batchCategorizeBody = z
  .object({
    companyId,
    transactions: z.array(z.record(z.string(), z.unknown())).max(500),
  })
  .strict();

export const nlGatewayBody = z
  .object({
    companyId,
    message: z.string().min(1).max(4000),
    locale: z.string().max(16).optional(),
    // Client-supplied figures are ignored by the handler (R05-09); the key is still accepted.
    context: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const smartSuggestBody = z
  .object({
    companyId,
    context: z.record(z.string(), z.unknown()),
    fieldType: z.string().min(1).max(64),
    currentValue: z.string().max(1000).nullish(),
  })
  .strict();
