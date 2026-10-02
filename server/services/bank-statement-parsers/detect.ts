// Pick the parser for a file from its content. Explicit format wins, "auto" looks at the content.

import { normalizeText } from "./numbers";
import { parseCamt053 } from "./camt053";
import { parseCsv } from "./csv";
import { parseMt940 } from "./mt940";
import { parseOfx } from "./ofx";
import { StatementParseError, type ParsedStatement, type StatementFormat } from "./types";

export type RequestedFormat = "auto" | "csv" | "ofx" | "mt940" | "camt053";

export function detectStatementFormat(content: string): "csv" | "ofx" | "mt940" | "camt053" {
  const head = normalizeText(content).slice(0, 4000);
  if (/OFXHEADER|<OFX[\s>]/i.test(head)) return "ofx";
  if (/<(?:\w+:)?(?:BkToCstmrStmt|Document)[\s>]/.test(head) && /camt\.0?5[23]|BkToCstmrStmt|<(?:\w+:)?Stmt>/.test(content.slice(0, 20000))) return "camt053";
  if (/^\s*\{1:/.test(head) || /^\s*:20:/m.test(head)) return "mt940";
  if (/^\s*<\?xml|^\s*<Document/i.test(head)) return "camt053";
  return "csv";
}

export function parseStatement(content: string, requested: RequestedFormat = "auto"): ParsedStatement & { format: StatementFormat } {
  if (typeof content !== "string" || !content.trim()) {
    throw new StatementParseError("The statement file is empty.", { line: 1 });
  }
  const format = requested === "auto" ? detectStatementFormat(content) : requested;
  switch (format) {
    case "ofx":
      return parseOfx(content);
    case "mt940":
      return parseMt940(content);
    case "camt053":
      return parseCamt053(content);
    default:
      return parseCsv(content);
  }
}
