import { and, eq, or, sql } from "drizzle-orm";
import { vatReturns, type VatReturn } from "../../shared/schema";
import { isUuid } from "./normalize";
import { ledgerQueryable, rowsOf } from "./tx";
import type { LedgerTx } from "./types";

export interface VatGroupInfo {
  groupId: string;
  name: string;
  groupTrn: string;
  memberIds: string[];
}

type ReturnScope = Pick<
  VatReturn,
  "id" | "companyId" | "status" | "amendsReturnId" | "vatGroupId" | "reconciliationSnapshot"
>;

function memberIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.length || !value.every(isUuid)) return undefined;
  return [...new Set(value.map((id: string) => id.toLowerCase()))].sort();
}

/** Undefined identifies an older return whose filing scope was not captured. */
export function getFilingVatGroup(snapshot: unknown): VatGroupInfo | null | undefined {
  const group = (snapshot as { filingVatGroup?: Partial<VatGroupInfo> | null } | null)
    ?.filingVatGroup;
  if (group === null) return null;
  if (
    !group ||
    !isUuid(group.groupId) ||
    typeof group.name !== "string" ||
    typeof group.groupTrn !== "string"
  )
    return undefined;
  const members = memberIds(group.memberIds);
  if (members) {
    return {
      groupId: group.groupId,
      name: group.name,
      groupTrn: group.groupTrn,
      memberIds: members,
    };
  }
}

/** The filing scope is independent of the reconciliation evidence in the rest of this object. */
export function withFilingVatGroup(snapshot: unknown, group: VatGroupInfo | null) {
  return { ...(snapshot as Record<string, unknown> | null), filingVatGroup: group };
}

export async function loadVatGroupForRepresentative(
  companyId: string,
  tx?: LedgerTx
): Promise<VatGroupInfo | null> {
  const q = ledgerQueryable(tx);
  const {
    rows: [table],
  } = await q.query("SELECT to_regclass('public.vat_groups') AS t");
  if (!table?.t) return null;
  const {
    rows: [group],
  } = await q.query(
    `SELECT g.id, g.name, g.group_trn, ARRAY(
         SELECT m.company_id FROM vat_group_members m WHERE m.group_id = g.id
       ) AS members
       FROM vat_groups g WHERE g.representative_company_id = $1`,
    [companyId]
  );
  if (!group) return null;
  return {
    groupId: group.id,
    name: group.name,
    groupTrn: group.group_trn,
    memberIds: [...new Set<string>([companyId.toLowerCase(), ...group.members])].sort(),
  };
}

/** Use the recorded transition time, which is independent of the user's FTA filing date. */
async function recoverFilingVatGroup(
  tx: LedgerTx,
  vatReturn: ReturnScope,
  current: VatGroupInfo
): Promise<VatGroupInfo> {
  const [event] = rowsOf<{ details: string | null }>(
    await tx.execute(sql`
    WITH first_close AS (
      SELECT created_at, chain_key, seq
        FROM audit_logs
       WHERE company_id = ${vatReturn.companyId}
         AND resource_type = 'vat_return' AND resource_id = ${vatReturn.id}
         AND action IN ('vat_return.submitted', 'vat_return.filed')
       ORDER BY (action = 'vat_return.submitted') DESC, seq NULLS LAST, created_at
       LIMIT 1
    )
    SELECT change.details
      FROM first_close c
      CROSS JOIN LATERAL (
        SELECT details FROM audit_logs
         WHERE company_id = ${vatReturn.companyId}
           AND resource_type = 'vat_group' AND resource_id = ${current.groupId}
           AND action = 'vat.group.upsert'
           AND CASE WHEN chain_key = c.chain_key AND seq IS NOT NULL AND c.seq IS NOT NULL
                 THEN seq < c.seq ELSE created_at <= c.created_at END
         ORDER BY CASE WHEN c.seq IS NOT NULL THEN seq END DESC NULLS LAST, created_at DESC
         LIMIT 1
      ) change
  `)
  );
  if (event?.details) {
    try {
      const { after } = JSON.parse(event.details) as {
        after?: { name?: unknown; groupTrn?: unknown; members?: unknown };
      };
      const members = memberIds(after?.members);
      if (members?.includes(vatReturn.companyId)) {
        return {
          groupId: current.groupId,
          name: typeof after?.name === "string" ? after.name : current.name,
          groupTrn: typeof after?.groupTrn === "string" ? after.groupTrn : current.groupTrn,
          memberIds: members,
        };
      }
    } catch {
      // Some older audit rows lack readable evidence.
    }
  }
  // The original membership cannot be inferred without evidence. Use currently associated
  // members, and snapshot this fallback before the next edit so it cannot drift further.
  return current;
}

function wasClosed(vatReturn: ReturnScope) {
  return ["submitted", "filed", "amended"].includes(vatReturn.status);
}

/** Older amendments could omit group membership and the group ID. Follow their original return. */
export async function resolveFilingVatGroup(
  tx: LedgerTx,
  vatReturn: ReturnScope,
  current: VatGroupInfo | null
): Promise<VatGroupInfo | null> {
  const seen = new Set<string>();
  let row: ReturnScope | undefined = vatReturn;
  while (row && !seen.has(row.id)) {
    seen.add(row.id);
    const frozen = getFilingVatGroup(row.reconciliationSnapshot);
    if (frozen !== undefined) return frozen;
    if (wasClosed(row) && current?.groupId === row.vatGroupId && current) {
      return recoverFilingVatGroup(tx, row, current);
    }
    if (!row.amendsReturnId) return wasClosed(row) ? null : current;
    const [original]: VatReturn[] = await tx
      .select()
      .from(vatReturns)
      .where(and(eq(vatReturns.id, row.amendsReturnId), eq(vatReturns.companyId, row.companyId)));
    row = original;
  }
  return null;
}

/** Resolve older scopes while membership is frozen, then persist them before its next edit. */
export async function legacyFilingVatGroups(
  tx: LedgerTx,
  representativeId: string,
  current: VatGroupInfo
) {
  const rows: VatReturn[] = await tx
    .select()
    .from(vatReturns)
    .where(
      and(
        eq(vatReturns.companyId, representativeId),
        sql`${vatReturns.status} IN ('submitted', 'filed', 'amended')`,
        sql`NOT COALESCE(${vatReturns.reconciliationSnapshot} ? 'filingVatGroup', false)`,
        or(
          eq(vatReturns.vatGroupId, current.groupId),
          sql`${vatReturns.vatGroupId} IS NULL AND ${vatReturns.amendsReturnId} IS NOT NULL`
        )
      )
    );
  const scopes = [];
  for (const row of rows) {
    const group = await resolveFilingVatGroup(tx, row, current);
    if (group?.groupId === current.groupId) scopes.push({ row, group });
  }
  return scopes;
}
