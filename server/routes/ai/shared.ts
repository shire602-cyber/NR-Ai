// Shared AI route helpers: request schemas, logger and the handler context type.
// Split from ai.routes.ts (R20-09); shared by its route handler modules.
import type { AiTask } from "../../services/ai/model-router";
import type { MeteredOpenAI } from "../../services/ai/usage-meter";
import OpenAI from "openai";
import type { Request } from "express";
import { createLogger } from "../../config/logger";
import { z } from "zod";
import { zText, zUuid } from "../../../shared/validators/primitives";

export const manualBankTransactionBody = z
  .object({
    bankAccountId: zUuid,
    transactionDate: z.string().max(40),
    description: z.string().max(1000),
    amount: z.union([z.number(), z.string().max(40)]),
    reference: zText(200).nullable().optional(),
    balance: z
      .union([z.number(), z.string().max(40)])
      .nullable()
      .optional(),
    allowDuplicates: z.boolean().optional(),
  })
  .strict();

export type ManualBankTransactionBody = z.output<typeof manualBankTransactionBody>;

export const forecastCashflowBody = z
  .object({
    companyId: zUuid,
    forecastMonths: z.number().int().min(1).max(12).optional(),
    days: z.number().int().min(7).max(365).optional(),
  })
  .strict();

export const log = createLogger("ai");

// RFC 4122 UUID format guard — used before validating AI-returned IDs against
// tenant ownership, so we don't waste a DB round-trip on garbage strings.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Values registerAIRoutes closes over that AI handlers need (the metered client factory). */
export interface AiHandlerContext {
  openai: OpenAI | null;
  getAI: (req: Request, task: AiTask) => MeteredOpenAI;
}
