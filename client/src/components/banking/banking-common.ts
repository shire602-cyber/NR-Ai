// Small helpers shared by the banking components: server errors, match reasons and kinds in the active language.

import { ApiError } from "@/lib/queryClient";
import {
  bulkErrors,
  parseErrorLocation,
  reconciliationDifference,
  type ReasonCode,
  type SuggestionKind,
} from "@/lib/banking-api-types";
import { formatNumber } from "@/lib/format";
import { messages } from "./BankingCommon.i18n";

/** Query key under the bank-statements prefix, so one invalidation refreshes every list on the banking screens. */
export const bankKey = (companyId: string, ...rest: string[]): string[] => ["/api/companies", companyId, "bank-statements", ...rest];

export type CommonTr = ReturnType<typeof messages.useT>;

const REASONS: Record<ReasonCode, Parameters<CommonTr>[0]> = {
  AMOUNT_EXACT: "reasonAmountExact",
  AMOUNT_WITHIN_1_PCT: "reasonAmount1",
  AMOUNT_WITHIN_5_PCT: "reasonAmount5",
  DATE_SAME_DAY: "reasonDateSame",
  DATE_WITHIN_3_DAYS: "reasonDate3",
  DATE_WITHIN_7_DAYS: "reasonDate7",
  DATE_WITHIN_30_DAYS: "reasonDate30",
  DOCUMENT_NUMBER_IN_TEXT: "reasonDocNumber",
  NAME_STRONG: "reasonNameStrong",
  NAME_PARTIAL: "reasonNamePartial",
  RULE_MATCH: "reasonRule",
  CLEARING_BALANCE_EQUALS_AMOUNT: "reasonClearing",
};

const KINDS: Record<SuggestionKind, Parameters<CommonTr>[0]> = {
  invoice: "kindInvoice",
  bill: "kindBill",
  journal: "kindJournal",
  receipt: "kindReceipt",
  rule: "kindRule",
  account: "kindAccount",
};

export const reasonText = (tr: CommonTr, code: ReasonCode): string => (REASONS[code] ? tr(REASONS[code]) : code);
export const kindText = (tr: CommonTr, kind: SuggestionKind): string => (KINDS[kind] ? tr(KINDS[kind]) : kind);

export type ConfidenceTone = "success" | "warning" | "danger";

export function confidenceTone(score: number): ConfidenceTone {
  if (score >= 80) return "success";
  if (score >= 60) return "warning";
  return "danger";
}

export function confidenceText(tr: CommonTr, score: number): string {
  const tone = confidenceTone(score);
  return tone === "success" ? tr("confidenceHigh") : tone === "warning" ? tr("confidenceMedium") : tr("confidenceLow");
}

const SOURCES: Record<string, Parameters<CommonTr>[0]> = {
  csv: "sourceCsv",
  ofx: "sourceOfx",
  mt940: "sourceMt940",
  camt053: "sourceCamt",
  pdf: "sourcePdf",
  feed: "sourceFeed",
};
export const sourceText = (tr: CommonTr, source: string | null | undefined): string =>
  source && SOURCES[source] ? tr(SOURCES[source]) : (source ?? "");

/**
 * A message the person can act on for any error from a banking route. Known business-rule codes get the screen's own
 * wording (in both languages); everything else (a period lock 403, a zod 400) keeps the server's message.
 */
export function bankingErrorText(tr: CommonTr, err: unknown, locale: string = "en"): string {
  if (!(err instanceof ApiError)) {
    const message = err instanceof Error ? err.message : "";
    return /failed to fetch|networkerror|load failed/i.test(message) ? tr("errNetwork") : message || tr("errGeneric");
  }
  switch (err.code) {
    case "STATEMENT_PARSE_ERROR": {
      const where = parseErrorLocation(err.details);
      if (where.line !== undefined) return tr("errParseLine", { line: where.line });
      if (where.tag) return tr("errParseTag", { tag: where.tag });
      return tr("errParse");
    }
    case "STATEMENT_EMPTY":
      return tr("errStatementEmpty");
    case "STATEMENT_CURRENCY_MISMATCH":
      return tr("errCurrencyMismatch");
    case "STATEMENT_ACCOUNT_MISMATCH":
      return tr("errAccountMismatch");
    case "STATEMENT_TOO_LARGE":
      return tr("errTooLarge");
    case "STATEMENT_ROW_INVALID":
      return tr("errRowInvalid");
    case "STATEMENT_TOO_MANY_ROWS":
      return tr("errTooManyRows");
    case "PDF_NO_TRANSACTIONS":
      return (err.details as { ai?: string } | undefined)?.ai === "not_configured" ? tr("errPdfNoneNotConfigured") : tr("errPdfNone");
    case "IMPORT_NOT_STAGED":
      return tr("errImportNotStaged");
    case "ALREADY_RECONCILED":
      return tr("errAlreadyReconciled");
    case "RECEIPT_NOT_POSTED":
      return tr("errReceiptNotPosted");
    case "FX_RATE_MISSING":
      return tr("errFxRateMissing");
    case "BANK_GL_NOT_LINKED":
      return tr("errGlNotLinked");
    case "RULE_NOT_APPLICABLE":
      return tr("errRuleNotApplicable");
    case "ACCOUNT_REQUIRES_DOCUMENT":
      return tr("errAccountRequiresDocument");
    case "BULK_MATCH_INVALID":
      return tr("errBulkInvalid", { count: bulkErrors(err.details).length });
    case "BULK_MATCH_PARTIAL":
      return tr("errBulkPartial");
    case "RECONCILIATION_NOT_BALANCED": {
      const d = reconciliationDifference(err.details);
      return tr("errNotBalanced", { difference: d === null ? "" : formatNumber(d, locale) });
    }
    case "RECONCILIATION_OUT_OF_ORDER":
      return tr("errOutOfOrder");
    case "NOT_LATEST":
      return tr("errNotLatest");
    case "BANK_TXN_IN_COMPLETED_RECONCILIATION":
      return tr("errFrozen");
    case "BANK_PROVIDER_NOT_CONFIGURED":
      return tr("errProviderNotConfigured");
    case "BANK_PROVIDER_ERROR":
      return tr("errProviderError");
    case "BANK_ENTITY_NOT_OWNED":
      return tr("errEntityNotOwned");
    case "SYNC_IN_PROGRESS":
      return tr("errSyncInProgress");
    case "ROLE_NOT_ALLOWED":
      return tr("errRoleNotAllowed");
    case "PROCEEDS_ACCOUNT_INVALID":
      return tr("errProceedsInvalid");
    case "RULE_SPLIT_INVALID":
      return tr("errRuleSplit");
    case "RULE_ACCOUNT_INVALID":
      return tr("errRuleAccount");
    case "RULE_REGEX_UNSAFE":
      return tr("errRuleRegex");
    case "RULE_VAT_INFLOW_UNSUPPORTED":
      return tr("errRuleVatInflow");
    default:
      return err.message || tr("errGeneric");
  }
}
