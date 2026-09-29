// Derivation of the stored `vat_supply_type` for invoice / quote / credit-note
// lines. The VAT return classifies by rate, so the return was always right,
// but the column used to default to "standard_rated" for every line — even at
// 0% — leaving wrong data at rest. Pure module (no imports).

export type VatSupplyType = "standard_rated" | "zero_rated" | "exempt" | "out_of_scope";

const KNOWN: readonly string[] = ["standard_rated", "zero_rated", "exempt", "out_of_scope"];

/**
 * The RATE decides. Both VAT engines skip output VAT for exempt /
 * out_of_scope lines whatever their rate, so a line that charges VAT must
 * never carry one of those types (the ledger would post VAT Payable while the
 * VAT 201 showed nothing).
 * - Rate > 0: always standard_rated, whatever was sent.
 * - Rate 0: keep an explicit zero_rated / exempt / out_of_scope; with nothing
 *   (or standard_rated, or nonsense) sent, store zero_rated.
 */
export function deriveVatSupplyType(
  vatRate: number,
  explicit: string | null | undefined
): VatSupplyType {
  if (vatRate > 0) return "standard_rated";
  const requested = typeof explicit === "string" && KNOWN.includes(explicit) ? explicit : null;
  if (requested === "zero_rated" || requested === "exempt" || requested === "out_of_scope") {
    return requested;
  }
  return "zero_rated";
}

/** Which VAT 201 box family a sales line feeds. */
export type VatReturnClass = "standard" | "zero_rated" | "exempt" | "excluded";

/**
 * The ONE rule every VAT engine (VAT 201 generator, autopilot, firm workpaper
 * pull) uses to place a sales line, so they cannot drift apart:
 * - rate > 0            -> standard (VAT on a tax invoice is payable, whatever type was stored);
 * - rate 0, out_of_scope -> excluded (in none of Boxes 1-5);
 * - rate 0, exempt       -> exempt (Box 5);
 * - anything else at 0%  -> zero_rated (Box 4).
 * A missing rate counts as the standard rate, as the engines always treated it.
 */
export function classifyVatLineForReturn(line: {
  rate: number | string | null | undefined;
  supplyType: string | null | undefined;
}): VatReturnClass {
  if (line.rate === null || line.rate === undefined || line.rate === "") return "standard";
  const rate = Number(line.rate);
  if (!Number.isFinite(rate) || rate > 0) return "standard";
  if (line.supplyType === "out_of_scope") return "excluded";
  if (line.supplyType === "exempt") return "exempt";
  return "zero_rated";
}
