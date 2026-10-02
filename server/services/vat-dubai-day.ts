// The UAE (Dubai, UTC+4, no daylight saving) calendar day of a `timestamp` column that holds a UTC instant, as SQL.
// Every VAT read (sales, purchases, void dates, VAT journals) uses this one rule, like the ledger layer's ymdSql
// (reports/dates.ts), so a document belongs to the same day, month and quarter in the return, the VAT summary, the
// VAT Audit and the P&L. A date stored as a bare calendar day (midnight) lands on the same day: 00:00 + 4 h.

/** SQL expression: the Dubai day (date) of a timestamp column. */
export const dubaiDaySql = (col: string): string => `((${col}) + INTERVAL '4 hours')::date`;

/** SQL expression: the Dubai day as 'YYYY-MM-DD' text. */
export const dubaiDayTextSql = (col: string): string => `to_char((${col}) + INTERVAL '4 hours', 'YYYY-MM-DD')`;
