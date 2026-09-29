#!/usr/bin/env node
// READ-ONLY diagnostic. THIS SCRIPT CHANGES NOTHING: it issues SELECT statements
// only and opens its connection with `SET default_transaction_read_only = on`
// as a safety net. It does not re-activate templates and does not create invoices.
//
// Background: from commit 301ac5c3 (2026-04-30) until the Phase 1 fix, the daily
// recurring-invoice run (06:00 UTC) read rows under the wrong field names, threw,
// and its catch block set is_active = false on every due template, generating
// nothing. Production therefore holds templates that were wrongly deactivated
// and invoices that were never generated.
//
// For each company it lists the inactive recurring templates that have not
// naturally finished (end date empty or in the future), the due dates missed
// between next_run_date and today, and a summary of what was not billed.
//
// LIMITS you must read before acting on the output:
//  * It cannot tell a template the user deliberately paused from one the bug
//    disabled. recurring_invoices has no updated_at column (and the toggle is not
//    audited), so the "updated_at near 06:00 UTC" hint is NOT available. The
//    column `likelyBugDisabled` uses the evidence that IS stored: the template
//    is inactive and its next_run_date (never advanced, because the bug generated
//    nothing) fell on or after 2026-04-30 and is not in the future, i.e. it was
//    due while the bug was live. A template paused by hand while already overdue
//    would look the same, so confirm with the customer/owner.
//  * invoices has no column linking an invoice to its recurring template, so
//    "was an invoice already generated for this date" cannot be determined. As a
//    hint only, invoices of the same customer name dated on that day are listed.
//
// Usage:
//   DATABASE_URL=postgres://... node scripts/find-disabled-recurring-templates.mjs [--json]

import pg from "pg";

const BUG_START = "2026-04-30";
const MAX_MISSED_DATES = 60;
const DEFAULT_VAT_RATE = 0.05;
const NOTICE =
  "READ-ONLY: this report changes nothing. It cannot distinguish a template the user deliberately " +
  "paused from one the bug disabled (recurring_invoices has no updated_at); likelyBugDisabled is a hint only.";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is required.\n" +
      "Usage: DATABASE_URL=postgres://... node scripts/find-disabled-recurring-templates.mjs [--json]\n" +
      "Read-only: lists wrongly deactivated recurring templates and the invoices they missed; changes nothing."
  );
  process.exit(1);
}
const asJson = process.argv.includes("--json");

const ymd = (d) => d.toISOString().slice(0, 10);
const round2 = (v) => Math.round(v * 100) / 100;

/** Next occurrence, mirroring the scheduler's interval rule (in UTC). */
function advance(date, frequency) {
  const next = new Date(date);
  if (frequency === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  else if (frequency === "monthly") next.setUTCMonth(next.getUTCMonth() + 1);
  else if (frequency === "quarterly") next.setUTCMonth(next.getUTCMonth() + 3);
  else if (frequency === "yearly") next.setUTCFullYear(next.getUTCFullYear() + 1);
  else return null; // unknown frequency: cannot project
  return next;
}

/** Due dates from nextRunDate up to today (and the end date), at most MAX_MISSED_DATES. */
export function missedDueDates(nextRunDate, frequency, endDate, today) {
  const dates = [];
  let truncated = false;
  let cursor = new Date(nextRunDate);
  while (cursor <= today && (!endDate || cursor <= endDate)) {
    if (dates.length >= MAX_MISSED_DATES) {
      truncated = true;
      break;
    }
    dates.push(ymd(cursor));
    cursor = advance(cursor, frequency);
    if (!cursor) break;
  }
  return { dates, truncated };
}

/** Subtotal + VAT of one generated invoice, the way the scheduler computes it. */
function totalPerInvoice(linesJson) {
  try {
    const lines = JSON.parse(linesJson);
    if (!Array.isArray(lines)) return null;
    let subtotal = 0;
    let vat = 0;
    for (const l of lines) {
      const lineTotal = Number(l.quantity) * Number(l.unitPrice);
      subtotal += lineTotal;
      vat += lineTotal * (l.vatRate ?? DEFAULT_VAT_RATE);
    }
    return round2(round2(subtotal) + round2(vat));
  } catch {
    return null;
  }
}

async function main() {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("SET default_transaction_read_only = on");
    const now = new Date();
    const today = new Date(`${ymd(now)}T23:59:59.999Z`);

    const templates = (
      await client.query(
        `SELECT r.id, r.company_id, c.name AS company_name, r.customer_name, r.currency, r.frequency,
                r.next_run_date, r.end_date, r.lines_json, r.total_generated, r.created_at
           FROM recurring_invoices r
           JOIN companies c ON c.id = r.company_id
          WHERE r.is_active = false AND (r.end_date IS NULL OR r.end_date > now())
          ORDER BY c.name, r.next_run_date`
      )
    ).rows;

    const companies = new Map();
    const totalsByCurrency = {};
    let invoicesMissed = 0;

    for (const t of templates) {
      const nextRun = new Date(t.next_run_date);
      const end = t.end_date ? new Date(t.end_date) : null;
      const { dates, truncated } = missedDueDates(nextRun, t.frequency, end, today);
      const perInvoice = totalPerInvoice(t.lines_json);

      // Hint only: no column links an invoice to its template.
      let sameCustomerByDate = {};
      if (dates.length > 0) {
        const from = new Date(`${dates[0]}T00:00:00.000Z`);
        const to = new Date(`${dates[dates.length - 1]}T23:59:59.999Z`);
        const rows = (
          await client.query(
            `SELECT number, date::date::text AS d FROM invoices
              WHERE company_id = $1 AND lower(customer_name) = lower($2)
                AND invoice_type <> 'credit_note' AND date >= $3 AND date <= $4`,
            [t.company_id, t.customer_name, from, to]
          )
        ).rows;
        for (const r of rows) (sameCustomerByDate[r.d] ??= []).push(r.number);
      }

      const nextRunDay = ymd(nextRun);
      const entry = {
        templateId: t.id,
        customer: t.customer_name,
        currency: t.currency,
        frequency: t.frequency,
        nextRunDate: nextRunDay,
        endDate: end ? ymd(end) : null,
        updatedAt: null, // the table has no updated_at column
        createdAt: ymd(new Date(t.created_at)),
        totalGenerated: t.total_generated,
        totalPerInvoice: perInvoice,
        likelyBugDisabled: nextRunDay >= BUG_START && nextRun <= today,
        missedDueDates: dates.map((d) => ({
          date: d,
          generatedInvoiceExists: "cannot determine",
          sameCustomerInvoicesThatDay: sameCustomerByDate[d] ?? [],
        })),
        missedCount: dates.length,
        missedTruncatedAt: truncated ? MAX_MISSED_DATES : null,
        missedValue: perInvoice === null ? null : round2(perInvoice * dates.length),
      };
      invoicesMissed += dates.length;
      if (entry.missedValue !== null) {
        totalsByCurrency[t.currency] = round2((totalsByCurrency[t.currency] ?? 0) + entry.missedValue);
      }
      if (!companies.has(t.company_id)) {
        companies.set(t.company_id, { companyId: t.company_id, companyName: t.company_name, templates: [] });
      }
      companies.get(t.company_id).templates.push(entry);
    }

    const result = {
      notice: NOTICE,
      generatedAt: now.toISOString(),
      companies: [...companies.values()],
      summary: {
        companiesAffected: companies.size,
        templatesAffected: templates.length,
        invoicesMissed,
        valueMissedByCurrency: totalsByCurrency,
      },
    };

    if (asJson) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    printText(result);
  } finally {
    await client.end();
  }
}

function printText(result) {
  console.log(`NOTE: ${result.notice}\n`);
  for (const c of result.companies) {
    console.log(`Company ${c.companyId}  ${c.companyName}`);
    for (const t of c.templates) {
      console.log(
        `  template ${t.templateId}  customer: ${t.customer}  ${t.currency}  ${t.frequency}` +
          `  next_run: ${t.nextRunDate}  end: ${t.endDate ?? "none"}  updated_at: n/a (no column)` +
          `  per invoice: ${t.totalPerInvoice ?? "?"}  likelyBugDisabled: ${t.likelyBugDisabled}`
      );
      const shown = t.missedDueDates.map((m) => m.date).join(", ") || "none";
      console.log(
        `    missed ${t.missedCount}${t.missedTruncatedAt ? "+ (listing capped at " + t.missedTruncatedAt + ")" : ""}` +
          `: ${shown}`
      );
      for (const m of t.missedDueDates) {
        if (m.sameCustomerInvoicesThatDay.length > 0) {
          console.log(
            `    ${m.date}: generated invoice exists = ${m.generatedInvoiceExists} (no link column); ` +
              `same customer invoiced that day: ${m.sameCustomerInvoicesThatDay.join(", ")}`
          );
        }
      }
    }
    console.log("");
  }
  const s = result.summary;
  const money = Object.entries(s.valueMissedByCurrency)
    .map(([cur, v]) => `${v.toFixed(2)} ${cur}`)
    .join(", ");
  console.log("SUMMARY (read-only, nothing was changed)");
  console.log(`  companies affected: ${s.companiesAffected}`);
  console.log(`  templates affected: ${s.templatesAffected}`);
  console.log(`  invoices missed:    ${s.invoicesMissed}`);
  console.log(`  value missed:       ${money || "0"}`);
  console.log(
    "  Per date, whether a generated invoice already exists cannot be determined (no template link on invoices)."
  );
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
