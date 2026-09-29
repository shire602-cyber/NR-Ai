// Upper bounds for document line quantity and unit price. They mirror the
// database columns (quantity numeric(15,4), unit_price numeric(19,6)) so an
// oversized value is rejected with a clear 400 instead of a Postgres overflow.
//
// Held as decimal STRINGS on purpose: 9,999,999,999,999.999999 is not exactly
// representable as a JS number (it rounds up to 1e13, which would overflow the
// column). Compare with Decimal, never with number literals.
export const MAX_LINE_QUANTITY = "9999999999.9999";
export const MAX_UNIT_PRICE = "9999999999999.999999";
