// SWIFT MT940 customer statements: one or more statements per file, each :20: ... :62F:.

import { collapse, normalizeText, round2, utcDay } from "./numbers";
import { StatementParseError, type ParsedStatement, type ParsedStatementLine } from "./types";

interface Field {
  tag: string;
  value: string;
  line: number;
}

/** :20: / :61: ... fields with their 1-based starting line. A line that does not start with ":NN:" continues the field. */
function readFields(text: string): Field[] {
  const fields: Field[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const tagged = line.match(/^:(\d{2}[A-Z]?):(.*)$/);
    if (tagged) {
      fields.push({ tag: tagged[1], value: tagged[2], line: i + 1 });
    } else if (fields.length && line.trim() !== "-" && !/^-\}?$/.test(line.trim()) && !/^\{5:/.test(line.trim())) {
      fields[fields.length - 1].value += "\n" + line;
    }
  }
  return fields;
}

const yy = (s: string): number => 2000 + Number(s);

/** :60F:/:62F: -> signed balance (C +, D -), date, currency. */
function parseBalance(f: Field): { amount: number; date: Date; currency: string } {
  const m = f.value.trim().match(/^([CD])(\d{6})([A-Z]{3})(\d+(?:,\d*)?)$/);
  if (!m) throw new StatementParseError(`Line ${f.line}: :${f.tag}: is not a balance (C/D, YYMMDD, currency, amount).`, { line: f.line });
  const date = utcDay(yy(m[2].slice(0, 2)), Number(m[2].slice(2, 4)), Number(m[2].slice(4, 6)));
  if (!date) throw new StatementParseError(`Line ${f.line}: :${f.tag}: has an impossible date.`, { line: f.line });
  const abs = Number(m[4].replace(",", "."));
  return { amount: round2(m[1] === "D" ? -abs : abs), date, currency: m[3] };
}

/** :61: -> value date, booking date, signed amount, references. */
function parseStatementLine(f: Field): Omit<ParsedStatementLine, "description" | "balance" | "externalId"> & { bankRef: string | null } {
  const first = f.value.split("\n")[0];
  const m = first.match(/^(\d{6})(\d{4})?(RC|RD|C|D)([A-Z])?(\d+(?:,\d*)?)([NFS])([A-Z0-9]{3})(.*)$/);
  if (!m) throw new StatementParseError(`Line ${f.line}: :61: statement line is malformed.`, { line: f.line });
  const valueDate = utcDay(yy(m[1].slice(0, 2)), Number(m[1].slice(2, 4)), Number(m[1].slice(4, 6)));
  if (!valueDate) throw new StatementParseError(`Line ${f.line}: :61: has an impossible value date.`, { line: f.line });

  let bookingDate = valueDate;
  if (m[2]) {
    const month = Number(m[2].slice(0, 2));
    const day = Number(m[2].slice(2, 4));
    const vMonth = valueDate.getUTCMonth() + 1;
    let year = valueDate.getUTCFullYear();
    if (month - vMonth > 6) year -= 1;
    else if (vMonth - month > 6) year += 1;
    const booked = utcDay(year, month, day);
    if (!booked) throw new StatementParseError(`Line ${f.line}: :61: has an impossible entry date.`, { line: f.line });
    bookingDate = booked;
  }

  const abs = Number(m[5].replace(",", "."));
  // C credit (+), D debit (-); RC reversal of a credit (-), RD reversal of a debit (+)
  const sign = m[3] === "C" || m[3] === "RD" ? 1 : -1;

  const rest = m[8];
  const slash = rest.indexOf("//");
  const customerRef = collapse(slash >= 0 ? rest.slice(0, slash) : rest);
  const bankRef = slash >= 0 ? collapse(rest.slice(slash + 2)) : "";
  const reference = customerRef && customerRef.toUpperCase() !== "NONREF" ? customerRef : bankRef || null;
  return { date: bookingDate, valueDate, amount: round2(sign * abs), reference, bankRef: bankRef || null };
}

/** :86: -> readable description. Handles ?NN subfields (German style), /TAG/ values (SEPA style) and plain text. */
export function describeMt940Info(info: string): { description: string; reference: string | null } {
  const text = info.replace(/\n/g, "");
  if (/\?\d{2}/.test(text)) {
    const parts = new Map<string, string>();
    for (const part of text.split("?").slice(1)) {
      const code = part.slice(0, 2);
      parts.set(code, (parts.get(code) ?? "") + part.slice(2));
    }
    const pick = (codes: string[]) => codes.map((c) => parts.get(c)).filter(Boolean).join(" ");
    const description = collapse([pick(["20", "21", "22", "23", "24", "25", "26", "27", "28", "29"]), pick(["32", "33"])].filter(Boolean).join(" "));
    return { description, reference: null };
  }
  if (text.startsWith("/") && /\/[A-Z]{3,5}\//.test(text)) {
    const tokens = text.split(/\/([A-Z]{3,5})\//).slice(1);
    const values = new Map<string, string>();
    for (let i = 0; i + 1 < tokens.length; i += 2) values.set(tokens[i], collapse(tokens[i + 1].replace(/\/$/, "")));
    const description = collapse(["NAME", "ORDP", "BENM", "REMI", "ADDINFO"].map((k) => values.get(k)).filter(Boolean).join(" "));
    return { description: description || collapse(text.replace(/\//g, " ")), reference: values.get("EREF") ?? null };
  }
  return { description: collapse(info), reference: null };
}

export function parseMt940(raw: string): ParsedStatement {
  const text = normalizeText(raw);
  const fields = readFields(text);
  if (!fields.some((f) => f.tag === "20")) {
    throw new StatementParseError("Not an MT940 file: the :20: transaction reference is missing.", { line: 1 });
  }

  const warnings: string[] = [];
  const lines: ParsedStatementLine[] = [];
  const seenRefs = new Set<string>();
  let accountId: string | null = null;
  let currency: string | null = null;
  let opening: { amount: number; date: Date } | null = null;
  let closing: { amount: number; date: Date } | null = null;
  let statementCount = 0;
  let inStatement = false;
  let sawClosing = false;
  let last61: ParsedStatementLine | null = null;
  let lastStart = 1;

  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    switch (f.tag) {
      case "20":
        if (inStatement && !sawClosing) {
          throw new StatementParseError(`Line ${f.line}: the previous statement has no closing balance (:62F:).`, { line: f.line });
        }
        inStatement = true;
        sawClosing = false;
        statementCount++;
        lastStart = f.line;
        last61 = null;
        break;
      case "25": {
        const acct = collapse(f.value);
        const id = acct.includes("/") ? acct.split("/").pop()! : acct;
        if (!accountId) accountId = id;
        else if (accountId.replace(/\s/g, "") !== id.replace(/\s/g, "")) warnings.push(`The file holds statements for more than one account (${accountId}, ${id}).`);
        break;
      }
      case "60F":
      case "60M": {
        const b = parseBalance(f);
        currency = currency ?? b.currency;
        if (!opening) opening = { amount: b.amount, date: b.date };
        break;
      }
      case "61": {
        const parsed = parseStatementLine(f);
        const line: ParsedStatementLine = {
          date: parsed.date,
          valueDate: parsed.valueDate,
          amount: parsed.amount,
          description: "",
          reference: parsed.reference,
          externalId: null,
          balance: null,
        };
        // the supplementary line after the first :61: line carries details when there is no :86:
        const extra = f.value.split("\n").slice(1).join(" ");
        if (extra.trim()) line.description = collapse(extra);
        if (parsed.bankRef) {
          const key = `${parsed.bankRef}|${parsed.date.toISOString().slice(0, 10)}|${parsed.amount.toFixed(2)}`;
          if (seenRefs.has(key)) warnings.push(`Bank reference ${parsed.bankRef} repeats with the same day and amount.`);
          else {
            seenRefs.add(key);
            line.externalId = key;
          }
        }
        lines.push(line);
        last61 = line;
        break;
      }
      case "86":
        if (last61) {
          const info = describeMt940Info(f.value);
          last61.description = info.description || last61.description;
          if (info.reference && !last61.reference) last61.reference = info.reference;
          last61 = null;
        }
        break;
      case "62F":
      case "62M": {
        const b = parseBalance(f);
        currency = currency ?? b.currency;
        closing = { amount: b.amount, date: b.date }; // the last statement's closing balance wins
        sawClosing = true;
        break;
      }
      default:
        break;
    }
  }

  if (inStatement && !sawClosing) {
    throw new StatementParseError(`Line ${lastStart}: the statement ends without a closing balance (:62F:); the file looks truncated.`, { line: lastStart });
  }
  for (const l of lines) if (!l.description) l.description = l.reference || "Bank transaction";
  if (statementCount > 1) warnings.push(`${statementCount} statements were read from one file.`);

  const dates = lines.map((l) => l.date.getTime());
  return {
    format: "mt940",
    lines,
    accountId,
    currency,
    openingBalance: opening ? opening.amount : null,
    closingBalance: closing ? closing.amount : null,
    statementFrom: opening ? opening.date : dates.length ? new Date(Math.min(...dates)) : null,
    statementTo: closing ? closing.date : dates.length ? new Date(Math.max(...dates)) : null,
    warnings,
  };
}
