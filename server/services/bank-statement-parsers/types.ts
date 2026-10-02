// Shared shapes for every statement parser. Amounts are signed (credit = inflow = positive) and rounded to 2 dp;
// dates are UTC midnight of the statement day (the bank's calendar day, never shifted by a time zone).

export type StatementFormat = "csv" | "ofx" | "mt940" | "camt053" | "pdf";

export interface ParsedStatementLine {
  date: Date;
  valueDate: Date | null;
  amount: number;
  description: string;
  reference: string | null;
  /** The bank's own id for the line (FITID, AcctSvcrRef, ...) when it is trustworthy as a unique key. */
  externalId: string | null;
  /** Running balance after the line, when the file carries one. */
  balance: number | null;
}

export interface ParsedStatement {
  format: StatementFormat;
  lines: ParsedStatementLine[];
  /** IBAN or account number the file says it belongs to. */
  accountId: string | null;
  currency: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  statementFrom: Date | null;
  statementTo: Date | null;
  warnings: string[];
}

/** A file the parsers refuse: 422 STATEMENT_PARSE_ERROR with the line (text formats) or tag (XML) at fault. */
export class StatementParseError extends Error {
  readonly code = "STATEMENT_PARSE_ERROR";
  constructor(
    message: string,
    readonly where: { line?: number; tag?: string } = {}
  ) {
    super(message);
    this.name = "StatementParseError";
  }
}
