// OFX / QFX (SGML 1.x and XML 2.x). Tags are read flat with a regular expression, never through an XML parser,
// so a DOCTYPE or entity declaration cannot expand into anything: they are refused outright.

import {
  collapse,
  decodeEntities,
  normalizeText,
  parseDecimal,
  round2,
  utcDay,
} from "./numbers";
import { StatementParseError, type ParsedStatement, type ParsedStatementLine } from "./types";

/** First 8 digits of an OFX date (YYYYMMDD[HHMMSS[.XXX]][TZ]) as the statement day. */
export function parseOfxDate(raw: string | undefined): Date | null {
  const m = raw?.trim().match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? utcDay(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

function field(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, "i"));
  return m ? decodeEntities(m[1]).trim() : undefined;
}

export function parseOfx(raw: string): ParsedStatement {
  const text = normalizeText(raw);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) {
    throw new StatementParseError("The OFX file declares a DOCTYPE or entity, which is not accepted.", { tag: "DOCTYPE" });
  }
  if (!/<OFX>/i.test(text) && !/OFXHEADER/i.test(text)) {
    throw new StatementParseError("Not an OFX file: the <OFX> element is missing.", { tag: "OFX" });
  }

  const warnings: string[] = [];
  const lines: ParsedStatementLine[] = [];
  const blockRe = /<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>|<\/STMTRS>|<\/CCSTMTRS>|$)/gi;
  let m: RegExpExecArray | null;
  const seenFitIds = new Set<string>();
  let index = 0;
  while ((m = blockRe.exec(text)) !== null) {
    index++;
    const block = m[1];
    const posted = parseOfxDate(field(block, "DTPOSTED"));
    if (!posted) throw new StatementParseError(`Transaction ${index}: DTPOSTED is missing or not a date.`, { tag: "DTPOSTED" });
    const amountRaw = field(block, "TRNAMT");
    const amount = parseDecimal(amountRaw);
    if (amount === null) throw new StatementParseError(`Transaction ${index}: TRNAMT is missing or not a number.`, { tag: "TRNAMT" });

    const name = field(block, "NAME");
    const memo = field(block, "MEMO");
    const description = collapse([name, memo && memo !== name ? memo : ""].filter(Boolean).join(" - ")) || field(block, "TRNTYPE") || "Bank transaction";
    const fitId = field(block, "FITID") || null;
    let externalId = fitId;
    if (fitId) {
      if (seenFitIds.has(fitId)) {
        warnings.push(`FITID ${fitId} repeats inside the file; the repeat is matched by day and amount only.`);
        externalId = null;
      }
      seenFitIds.add(fitId);
    }
    lines.push({
      date: posted,
      valueDate: parseOfxDate(field(block, "DTUSER")),
      amount,
      description,
      reference: field(block, "CHECKNUM") || field(block, "REFNUM") || null,
      externalId,
      balance: null,
    });
  }

  if (lines.length === 0 && !/<STMTTRN/i.test(text)) {
    // an empty but valid statement is allowed to have no transactions; the import service decides what that means
    warnings.push("The OFX file has no transactions.");
  }

  const ledger = text.match(/<LEDGERBAL>([\s\S]*?)(?=<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>|<\/CCSTMTRS>|$)/i)?.[1] ?? "";
  const closing = parseDecimal(field(ledger, "BALAMT"));
  const asOf = parseOfxDate(field(ledger, "DTASOF"));
  const start = parseOfxDate(field(text, "DTSTART"));
  const end = parseOfxDate(field(text, "DTEND"));
  const dates = lines.map((l) => l.date.getTime());
  const accountId = field(text, "ACCTID") || null;

  return {
    format: "ofx",
    lines,
    accountId,
    currency: field(text, "CURDEF")?.toUpperCase() || null,
    openingBalance: null,
    closingBalance: closing === null ? null : round2(closing),
    statementFrom: start ?? (dates.length ? new Date(Math.min(...dates)) : null),
    statementTo: end ?? asOf ?? (dates.length ? new Date(Math.max(...dates)) : null),
    warnings,
  };
}
