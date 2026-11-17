/**
 * Recurring and auto-reversing journals (R02-16a).
 *
 *   - journal_templates rows generate an entry on next_run_on and advance by
 *     their frequency (weekly | monthly | quarterly | yearly; "none" runs once).
 *     Each run uses idempotencyKey "template:<id>:<date>", so a re-run of the
 *     same date (two schedulers, a retry) returns the first entry.
 *   - autoReverseDays on a template, or autoReverseOn on a manual entry, sets
 *     journal_entries.auto_reverse_on; the "ledger.autoReverse" job reverses the
 *     entry on that date (today if that period is locked).
 *
 * Both jobs are registered with the platform job registry
 * (server/platform/job-registry.ts) by registerLedgerJobs().
 */
import { and, eq, sql } from "drizzle-orm";
import { journalTemplates, type JournalTemplate } from "../../shared/schema";
import { db } from "../db";
import { AppError } from "../errors";
import { createLogger } from "../config/logger";
import { listJobs, registerJob } from "../platform/job-registry";
import { postJournal, reverseEntry } from "./kernel";
import { parseLedgerDate, todayIso } from "./normalize";
import { rowsOf } from "./tx";
import type { PostJournalLineInput, PostJournalResult } from "./types";

const log = createLogger("ledger-jobs");

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Next run date; month-based steps clamp to the month end (31 Jan -> 28/29 Feb). */
export function advanceRunDate(iso: string, frequency: string): string | null {
  const [y, m, d] = iso.split("-").map(Number);
  const months =
    frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : frequency === "yearly" ? 12 : 0;
  if (frequency === "weekly") return addDaysIso(iso, 7);
  if (!months) return null;
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const dim = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, dim));
  return target.toISOString().slice(0, 10);
}

interface TemplateLine {
  accountId: string;
  debit?: string | number | null;
  credit?: string | number | null;
  description?: string | null;
  costCenterId?: string | null;
}

/** Post one occurrence of a template dated `runDate` (idempotent per date). */
export async function runJournalTemplate(
  template: JournalTemplate,
  runDate: string,
  actorId: string
): Promise<PostJournalResult> {
  const { iso } = parseLedgerDate(runDate, "runDate");
  const lines = (template.lines as TemplateLine[]).map(
    (l): PostJournalLineInput => ({
      accountId: l.accountId,
      debit: l.debit ?? null,
      credit: l.credit ?? null,
      description: l.description ?? null,
      costCenterId: l.costCenterId ?? null,
    })
  );
  const result = await postJournal(
    {
      companyId: template.companyId,
      date: iso,
      memo: template.memo ?? template.name,
      source: "journal_template",
      sourceId: template.id,
      idempotencyKey: `template:${template.id}:${iso}`,
      status: template.postAs === "draft" ? "draft" : "posted",
      autoReverseOn: template.autoReverseDays ? addDaysIso(iso, template.autoReverseDays) : null,
      lines,
    },
    { actorId }
  );
  // A manual run dated before the schedule does not move the schedule back.
  const next =
    template.nextRunOn && iso < template.nextRunOn
      ? template.nextRunOn
      : advanceRunDate(iso, template.frequency);
  const stillActive = !!next && (!template.endOn || next <= template.endOn);
  await db
    .update(journalTemplates)
    .set({
      lastRunOn: iso,
      lastEntryId: result.entry.id,
      nextRunOn: next,
      isActive: template.isActive && stillActive,
      updatedAt: new Date(),
    })
    .where(eq(journalTemplates.id, template.id));
  return result;
}

/** Job body: run every due template occurrence up to today (bounded catch-up). */
export async function runDueJournalTemplates(today: string = todayIso()): Promise<number> {
  let posted = 0;
  const due: JournalTemplate[] = await db
    .select()
    .from(journalTemplates)
    .where(
      and(eq(journalTemplates.isActive, true), sql`${journalTemplates.nextRunOn} <= ${today}::date`)
    );
  for (const t of due) {
    let current: JournalTemplate | undefined = t;
    for (
      let i = 0;
      i < 24 && current?.isActive && current.nextRunOn && current.nextRunOn <= today;
      i++
    ) {
      if (current.endOn && current.nextRunOn > current.endOn) break;
      try {
        await runJournalTemplate(current, current.nextRunOn, current.createdBy);
        posted++;
      } catch (err) {
        log.error({ templateId: t.id, err: (err as Error).message }, "journal template run failed");
        break;
      }
      [current] = await db.select().from(journalTemplates).where(eq(journalTemplates.id, t.id));
    }
  }
  return posted;
}

/**
 * L8 (A4): an accrual posted with an auto-reverse date that has already arrived (a back-dated
 * accrual) is reversed straight away, on its planned date (today when that period is locked),
 * instead of waiting for the next 01:27 job, so reports in between never show it unreversed.
 * Returns the reversal entry id, or null when nothing was due.
 */
export async function reverseIfAutoReverseDue(
  entryId: string,
  actorId: string,
  today: string = todayIso()
): Promise<string | null> {
  const res = await db.execute(sql`
    SELECT id, company_id, to_char(auto_reverse_on, 'YYYY-MM-DD') AS on_date
      FROM journal_entries
     WHERE id = ${entryId} AND auto_reverse_on IS NOT NULL AND auto_reverse_on <= ${today}::date
       AND status = 'posted' AND reversed_by_entry_id IS NULL AND entry_kind <> 'reversal'
  `);
  const row = rowsOf<{ id: string; company_id: string; on_date: string }>(res)[0];
  if (!row) return null;
  const ctx = { actorId, companyId: row.company_id };
  const reason = "Automatic reversal (accrual)";
  try {
    return (await reverseEntry(row.id, { date: row.on_date, reason }, ctx)).reversal.id;
  } catch (err) {
    if (!(err instanceof AppError) || err.statusCode !== 403) throw err;
    return (await reverseEntry(row.id, { date: today, reason }, ctx)).reversal.id;
  }
}

/** Job body: reverse posted entries whose auto_reverse_on has arrived. */
export async function runDueAutoReversals(today: string = todayIso()): Promise<number> {
  const res = await db.execute(sql`
    SELECT id, company_id, created_by, to_char(auto_reverse_on, 'YYYY-MM-DD') AS on_date
      FROM journal_entries
     WHERE auto_reverse_on IS NOT NULL AND auto_reverse_on <= ${today}::date
       AND status = 'posted' AND reversed_by_entry_id IS NULL AND entry_kind <> 'reversal'
     ORDER BY auto_reverse_on
     LIMIT 500
  `);
  let reversed = 0;
  for (const row of rowsOf<{ id: string; company_id: string; created_by: string; on_date: string }>(
    res
  )) {
    const ctx = { actorId: row.created_by, companyId: row.company_id };
    const reason = "Automatic reversal (accrual)";
    try {
      try {
        await reverseEntry(row.id, { date: row.on_date, reason }, ctx);
      } catch (err) {
        // Period of the planned date is locked: reverse today instead.
        if (!(err instanceof AppError) || err.statusCode !== 403) throw err;
        await reverseEntry(row.id, { date: today, reason }, ctx);
      }
      reversed++;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "ALREADY_REVERSED") {
        log.error({ entryId: row.id, err: (err as Error).message }, "auto-reversal failed");
      }
    }
  }
  return reversed;
}

/** Register the ledger jobs once (safe to call on every app build). */
export function registerLedgerJobs(): void {
  const names = new Set(listJobs().map((j) => j.name));
  if (!names.has("ledger.recurringJournals")) {
    registerJob({
      name: "ledger.recurringJournals",
      cron: "17 1 * * *",
      description: "Post due recurring journal templates",
      run: async () => {
        await runDueJournalTemplates();
      },
    });
  }
  if (!names.has("ledger.autoReverse")) {
    registerJob({
      name: "ledger.autoReverse",
      cron: "27 1 * * *",
      description: "Reverse accruals whose auto-reverse date has arrived",
      run: async () => {
        await runDueAutoReversals();
      },
    });
  }
}
