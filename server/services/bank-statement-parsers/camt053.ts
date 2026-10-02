// ISO 20022 camt.053 (bank-to-customer statement), versions 2 to 8. One bank line per <Ntry>: a batch entry is one
// bank movement of the batch total, which is what the bank statement shows and what a reconciliation matches.

import { collapse, parseDecimal, round2, utcDay } from "./numbers";
import { StatementParseError, type ParsedStatement, type ParsedStatementLine } from "./types";
import { child, childText, childrenNamed, descendants, parseXmlLite, type XmlNode } from "./xml-lite";

function isoDay(raw: string | undefined): Date | null {
  const m = raw?.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? utcDay(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

function signedAmount(node: XmlNode, label: string): number {
  const amt = child(node, "Amt");
  if (!amt) throw new StatementParseError(`${label}: the <Amt> element is missing.`, { tag: "Amt" });
  const value = parseDecimal(amt.text);
  if (value === null) throw new StatementParseError(`${label}: <Amt> is not a number.`, { tag: "Amt" });
  const ind = childText(node, "CdtDbtInd");
  if (ind !== "CRDT" && ind !== "DBIT") throw new StatementParseError(`${label}: <CdtDbtInd> must be CRDT or DBIT.`, { tag: "CdtDbtInd" });
  return ind === "DBIT" ? -Math.abs(value) : Math.abs(value);
}

function entryStatus(entry: XmlNode): string {
  const sts = child(entry, "Sts");
  if (!sts) return "BOOK";
  return (sts.children.find((c) => c.name === "Cd")?.text ?? sts.text).trim().toUpperCase() || "BOOK";
}

function describeEntry(entry: XmlNode): { description: string; reference: string | null } {
  const parts: string[] = [];
  let reference: string | null = null;
  for (const tx of descendants(entry, "TxDtls")) {
    const party = childText(tx, "RltdPties/Cdtr/Nm") || childText(tx, "RltdPties/Dbtr/Nm") || childText(tx, "RltdPties/Cdtr/Pty/Nm") || childText(tx, "RltdPties/Dbtr/Pty/Nm");
    if (party) parts.push(party);
    for (const u of descendants(tx, "Ustrd")) if (u.text.trim()) parts.push(u.text.trim());
    const strd = childText(tx, "RmtInf/Strd/CdtrRefInf/Ref");
    if (strd) parts.push(strd);
    const info = childText(tx, "AddtlTxInf");
    if (info) parts.push(info);
    const e2e = childText(tx, "Refs/EndToEndId");
    if (!reference && e2e && e2e.toUpperCase() !== "NOTPROVIDED") reference = e2e;
  }
  const entryInfo = childText(entry, "AddtlNtryInf");
  if (!parts.length && entryInfo) parts.push(entryInfo);
  const description = collapse(Array.from(new Set(parts)).join(" - "));
  return { description, reference: reference ?? childText(entry, "NtryRef") ?? null };
}

export function parseCamt053(raw: string): ParsedStatement {
  const doc = parseXmlLite(raw.replace(/^\uFEFF/, ""));
  const stmts = descendants(doc, "Stmt");
  if (stmts.length === 0) {
    throw new StatementParseError("Not a camt.053 file: no <Stmt> element was found.", { tag: "Stmt" });
  }

  const warnings: string[] = [];
  const lines: ParsedStatementLine[] = [];
  const seen = new Set<string>();
  let accountId: string | null = null;
  let currency: string | null = null;
  let opening: { amount: number; date: Date | null } | null = null;
  let closing: { amount: number; date: Date | null } | null = null;
  let pending = 0;

  stmts.forEach((stmt, s) => {
    const acctId = childText(stmt, "Acct/Id/IBAN") || childText(stmt, "Acct/Id/Othr/Id") || null;
    if (acctId && !accountId) accountId = acctId;
    else if (acctId && accountId && accountId.replace(/\s/g, "") !== acctId.replace(/\s/g, "")) warnings.push(`The file holds statements for more than one account (${accountId}, ${acctId}).`);
    currency = currency ?? (childText(stmt, "Acct/Ccy") || null);

    for (const bal of childrenNamed(stmt, "Bal")) {
      const code = childText(bal, "Tp/CdOrPrtry/Cd");
      if (code !== "OPBD" && code !== "CLBD" && code !== "PRCD") continue;
      const amount = round2(signedAmount(bal, `Statement ${s + 1} balance ${code}`));
      const date = isoDay(childText(bal, "Dt/Dt") || childText(bal, "Dt/DtTm"));
      currency = currency ?? (child(bal, "Amt")?.attrs.Ccy || null);
      if (code === "CLBD") closing = { amount, date };
      else if (!opening) opening = { amount, date };
    }

    childrenNamed(stmt, "Ntry").forEach((entry, e) => {
      const label = `Statement ${s + 1}, entry ${e + 1}`;
      const status = entryStatus(entry);
      if (status === "PDNG") {
        pending++;
        return;
      }
      if (status === "INFO") return;
      let amount = signedAmount(entry, label);
      if (childText(entry, "RvslInd") === "true") amount = -amount;
      const booked = isoDay(childText(entry, "BookgDt/Dt") || childText(entry, "BookgDt/DtTm"));
      const valued = isoDay(childText(entry, "ValDt/Dt") || childText(entry, "ValDt/DtTm"));
      const date = booked ?? valued;
      if (!date) throw new StatementParseError(`${label}: <BookgDt> is missing.`, { tag: "BookgDt" });

      const { description, reference } = describeEntry(entry);
      const bankRef = childText(entry, "AcctSvcrRef") || childText(entry, "NtryRef") || descendants(entry, "AcctSvcrRef")[0]?.text.trim() || null;
      let externalId: string | null = null;
      if (bankRef) {
        const key = `${bankRef}|${date.toISOString().slice(0, 10)}|${round2(amount).toFixed(2)}`;
        if (seen.has(key)) warnings.push(`Bank reference ${bankRef} repeats with the same day and amount.`);
        else {
          seen.add(key);
          externalId = key;
        }
      }
      lines.push({ date, valueDate: valued, amount: round2(amount), description: description || reference || "Bank transaction", reference, externalId, balance: null });
    });
  });

  if (pending > 0) warnings.push(`${pending} pending (not yet booked) entr${pending === 1 ? "y was" : "ies were"} skipped.`);
  if (stmts.length > 1) warnings.push(`${stmts.length} statements were read from one file.`);

  const dates = lines.map((l) => l.date.getTime());
  const o = opening as { amount: number; date: Date | null } | null;
  const c = closing as { amount: number; date: Date | null } | null;
  return {
    format: "camt053",
    lines,
    accountId,
    currency,
    openingBalance: o ? o.amount : null,
    closingBalance: c ? c.amount : null,
    statementFrom: o?.date ?? (dates.length ? new Date(Math.min(...dates)) : null),
    statementTo: c?.date ?? (dates.length ? new Date(Math.max(...dates)) : null),
    warnings,
  };
}
