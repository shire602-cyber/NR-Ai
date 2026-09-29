// The ONE place a foreign-currency sales document gets its AED rate.
//
// Invoice creation, quote -> invoice conversion and the recurring-invoice
// generator all call this, so a document is never booked at a different rate
// (or, worse, silently at 1) depending on how it was created.
//
// Convention: the rate is AED per 1 unit of the document currency, looked up as
// getLatestRate(currency, "AED", date, companyId) - the company's own trusted
// rate first, then the system rate, then the inverse pair. An explicit positive
// rate supplied by the caller wins; AED is always 1.

export type DocumentFxResult =
  | { ok: true; rate: number }
  | { ok: false; code: "NO_EXCHANGE_RATE"; message: string };

export type RateLookup = (
  from: string,
  to: string,
  asOf: Date,
  companyId: string
) => Promise<number | null | undefined>;

export async function resolveDocumentExchangeRate(args: {
  currency: string | null | undefined;
  date: Date;
  companyId: string;
  /** Rate the caller sent explicitly (only manual invoice creation has one). */
  suppliedRate?: unknown;
  /** Injected for tests; defaults to the exchange-rate service lookup. */
  lookup?: RateLookup;
  /** Tail of the "no rate" message, e.g. "then convert the quote again". */
  hint?: string;
}): Promise<DocumentFxResult> {
  const currency = (args.currency || "AED").toUpperCase();
  if (currency === "AED") return { ok: true, rate: 1 };

  const supplied = Number(args.suppliedRate);
  if (Number.isFinite(supplied) && supplied > 0) return { ok: true, rate: supplied };

  const lookup: RateLookup =
    args.lookup ?? (await import("./exchange-rate.service")).getLatestRate;
  const stored = Number(await lookup(currency, "AED", args.date, args.companyId));
  if (!Number.isFinite(stored) || stored <= 0) {
    return {
      ok: false,
      code: "NO_EXCHANGE_RATE",
      message: `No ${currency}→AED exchange rate available. ${args.hint ?? "Add one under Exchange Rates or pass exchangeRate."}`,
    };
  }
  return { ok: true, rate: stored };
}
