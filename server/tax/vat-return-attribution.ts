/**
 * Which VAT return a date lands in, for read-only screens (the bad-debt relief list).
 *
 * The answer is read from the returns that were actually recorded, never guessed from today's
 * filing settings:
 *   1. A submitted / filed return that covers the company (its own, or a VAT group return whose
 *      frozen filing scope lists the company: membership as at the filing, not today's members).
 *      Decided by `listVatClosures`, the same evidence the posting lock uses. A return under a
 *      pending amendment is still the return that carries the date (status "amendment"); it is
 *      not "locked" here, the server decides locks when something is posted.
 *   2. An open return (draft / pending review / ready): the company's own, or a group
 *      representative's draft built from the group's current membership (drafts are generated
 *      from current members).
 *   3. Nothing recorded for the date: the period the company's CURRENT stagger would give,
 *      marked "forecast".
 * A date inside a return whose group membership cannot be verified gets no attribution (null)
 * rather than a guess. Cost: one closure read, at most two draft reads and one settings read for
 * the whole batch of dates, plus the per-return scope checks inside `listVatClosures`.
 */
import { db, pool } from "../db";
import { loadVatGroupForRepresentative } from "../ledger/vat-group-scope";
import { listVatClosures } from "../ledger/vat-lock";
import { loadVatCompany } from "./vat-engine";
import { periodContaining } from "./vat-periods";

export type ReturnAttributionStatus = "open" | "filed" | "amendment" | "forecast";

export interface ReturnAttribution {
  from: string;
  to: string;
  status: ReturnAttributionStatus;
  /** "group" when a VAT group representative's return carries the date. */
  source: "company" | "group" | "forecast";
}

export async function attributeDatesToReturns(
  companyId: string,
  dates: string[]
): Promise<Map<string, ReturnAttribution | null>> {
  const out = new Map<string, ReturnAttribution | null>();
  const unique = [...new Set(dates)].sort();
  if (!unique.length) return out;
  const min = unique[0];
  const max = unique[unique.length - 1];
  const within = (date: string, from: string, to: string) => from <= date && date <= to;

  const { closures, unresolvedPeriods } = await listVatClosures(db, companyId, min, max);

  const pending = unique.filter((date) => {
    const hit = closures.find((c) => within(date, c.periodStart, c.periodEnd));
    if (!hit) return true;
    out.set(date, {
      from: hit.periodStart,
      to: hit.periodEnd,
      status: hit.underAmendment ? "amendment" : "filed",
      source: hit.ownReturn ? "company" : "group",
    });
    return false;
  });
  if (!pending.length) return out;

  type Draft = { ownerId: string; ps: string; pe: string; createdAt: number };
  const drafts: Draft[] = [];
  const ownQ = await pool.query(
    `SELECT company_id, period_start::date::text AS ps, period_end::date::text AS pe, created_at
       FROM vat_returns
      WHERE company_id = $1 AND amends_return_id IS NULL
        AND status IN ('draft', 'pending_review', 'ready')
        AND period_end::date >= $2::date AND period_start::date <= $3::date`,
    [companyId, min, max]
  );
  for (const r of ownQ.rows) {
    drafts.push({
      ownerId: r.company_id,
      ps: r.ps,
      pe: r.pe,
      createdAt: new Date(r.created_at).getTime(),
    });
  }

  // Drafts are generated from the group's current membership, so current membership decides
  // which representative drafts carry this company.
  const repsQ = await pool.query(
    `SELECT g.id, g.representative_company_id
       FROM vat_group_members m JOIN vat_groups g ON g.id = m.group_id
      WHERE m.company_id = $1 AND g.representative_company_id <> $1`,
    [companyId]
  );
  const groupIds: string[] = [];
  const repIds: string[] = [];
  for (const rep of repsQ.rows) {
    const group = await loadVatGroupForRepresentative(rep.representative_company_id);
    if (
      group &&
      group.groupId === rep.id &&
      group.memberAuthority === "settings.company" &&
      group.memberIds.includes(companyId.toLowerCase())
    ) {
      groupIds.push(rep.id);
      repIds.push(rep.representative_company_id);
    }
  }
  if (groupIds.length) {
    const groupQ = await pool.query(
      `SELECT company_id, period_start::date::text AS ps, period_end::date::text AS pe, created_at
         FROM vat_returns
        WHERE company_id = ANY($1::uuid[]) AND vat_group_id = ANY($2::uuid[])
          AND amends_return_id IS NULL AND status IN ('draft', 'pending_review', 'ready')
          AND period_end::date >= $3::date AND period_start::date <= $4::date`,
      [repIds, groupIds, min, max]
    );
    for (const r of groupQ.rows) {
      drafts.push({
        ownerId: r.company_id,
        ps: r.ps,
        pe: r.pe,
        createdAt: new Date(r.created_at).getTime(),
      });
    }
  }

  const left: string[] = [];
  for (const date of pending) {
    const hits = drafts
      .filter((d) => within(date, d.ps, d.pe))
      .sort((a, b) => (a.pe < b.pe ? 1 : a.pe > b.pe ? -1 : b.createdAt - a.createdAt));
    if (hits.length) {
      out.set(date, {
        from: hits[0].ps,
        to: hits[0].pe,
        status: "open",
        source: hits[0].ownerId.toLowerCase() === companyId.toLowerCase() ? "company" : "group",
      });
    } else if (unresolvedPeriods.some((p) => within(date, p.periodStart, p.periodEnd))) {
      out.set(date, null);
    } else {
      left.push(date);
    }
  }
  if (!left.length) return out;

  const company = await loadVatCompany(companyId);
  for (const date of left) {
    const p = periodContaining(date, company.frequency, company.startMonth);
    out.set(date, { from: p.from, to: p.to, status: "forecast", source: "forecast" });
  }
  return out;
}
