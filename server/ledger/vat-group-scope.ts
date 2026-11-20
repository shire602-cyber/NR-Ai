import { and, eq, or, sql } from "drizzle-orm";
import { vatReturns, type VatReturn } from "../../shared/schema";
import { validateUaeTrn } from "../../shared/receipt-ocr-parser";
import { DomainError } from "../errors";
import { isUuid } from "./normalize";
import { ledgerQueryable, rowsOf } from "./tx";
import type { LedgerTx } from "./types";

export interface VatGroupInfo {
  groupId: string;
  name: string;
  groupTrn: string;
  memberIds: string[];
}

export interface VerifiedVatGroup extends VatGroupInfo {
  provenance: "recorded" | "audit";
}

export const UNVERIFIED_VAT_GROUP = Symbol("unverified VAT group membership");
export type ResolvedVatGroup = VerifiedVatGroup | null | typeof UNVERIFIED_VAT_GROUP;

export function vatGroupVerificationRequiredError(): DomainError {
  return new DomainError(
    "VAT_GROUP_MEMBERSHIP_VERIFICATION_REQUIRED",
    409,
    undefined,
    "VAT group membership for this period must be verified before VAT changes can be recorded."
  );
}

export function assertVerifiedVatGroup(
  group: ResolvedVatGroup
): asserts group is VerifiedVatGroup | null {
  if (group === UNVERIFIED_VAT_GROUP) throw vatGroupVerificationRequiredError();
}

type ReturnScope = Pick<
  VatReturn,
  "id" | "companyId" | "status" | "amendsReturnId" | "vatGroupId" | "reconciliationSnapshot"
>;

function memberIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.length || !value.every(isUuid)) return undefined;
  return [...new Set(value.map((id: string) => id.toLowerCase()))].sort();
}

/** An unlabelled legacy snapshot may contain a guess. Recover it from audit evidence. */
export function getFilingVatGroup(snapshot: unknown): VerifiedVatGroup | undefined {
  const group = (snapshot as { filingVatGroup?: Partial<VerifiedVatGroup> | null } | null)
    ?.filingVatGroup;
  if (
    !group ||
    (group.provenance !== "recorded" && group.provenance !== "audit") ||
    !isUuid(group.groupId) ||
    typeof group.name !== "string" ||
    typeof group.groupTrn !== "string" ||
    !validateUaeTrn(group.groupTrn).valid
  )
    return undefined;
  const members = memberIds(group.memberIds);
  if (members) {
    return {
      groupId: group.groupId,
      name: group.name,
      groupTrn: group.groupTrn,
      memberIds: members,
      provenance: group.provenance,
    };
  }
}

/** The filing scope is independent of the reconciliation evidence in the rest of this object. */
export function withFilingVatGroup(snapshot: unknown, group: VerifiedVatGroup | null) {
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
  groupId: string
): Promise<VerifiedVatGroup | typeof UNVERIFIED_VAT_GROUP> {
  const [event] = rowsOf<{
    action: string;
    closingDetails: string | null;
    membershipDetails: string | null;
  }>(
    await tx.execute(sql`
    WITH first_close AS (
      SELECT action, details, created_at, chain_key, seq
        FROM audit_logs
       WHERE company_id = ${vatReturn.companyId}
         AND resource_type = 'vat_return' AND resource_id = ${vatReturn.id}
         AND action IN ('vat_return.submitted', 'vat_return.filed')
       ORDER BY (action = 'vat_return.submitted') DESC, seq NULLS LAST, created_at
       LIMIT 1
    )
    SELECT c.action, c.details AS "closingDetails", change.details AS "membershipDetails"
      FROM first_close c
      CROSS JOIN LATERAL (
        SELECT candidate.details, candidate.created_at,
               bool_and(candidate.comparable) OVER () AS all_comparable,
               bool_or(candidate.comparable) OVER () AS any_comparable,
               count(*) OVER (PARTITION BY candidate.created_at) AS same_time_count
          FROM (
            SELECT details, seq, created_at,
                   COALESCE(chain_key = c.chain_key AND seq IS NOT NULL AND c.seq IS NOT NULL, false) AS comparable
              FROM audit_logs
             WHERE company_id = ${vatReturn.companyId}
               AND resource_type = 'vat_group' AND resource_id = ${groupId}
               AND action = 'vat.group.upsert'
          ) candidate
         WHERE CASE WHEN candidate.comparable THEN candidate.seq < c.seq
                    ELSE candidate.created_at <= c.created_at END
         ORDER BY CASE WHEN candidate.comparable THEN candidate.seq END DESC NULLS LAST,
                  candidate.created_at DESC
         LIMIT 1
      ) change
     WHERE change.all_comparable
        OR (NOT change.any_comparable AND change.same_time_count = 1 AND change.created_at < c.created_at)
  `)
  );
  if (event?.membershipDetails) {
    try {
      if (event.action === "vat_return.filed") {
        // Without a submission event, a later administrative filing cannot prove the first closure.
        const closing = JSON.parse(event.closingDetails ?? "null") as {
          before?: { status?: string };
        } | null;
        if (!["draft", "pending_review", "ready"].includes(closing?.before?.status ?? "")) {
          return UNVERIFIED_VAT_GROUP;
        }
      }
      const { after } = JSON.parse(event.membershipDetails) as {
        after?: { name?: unknown; groupTrn?: unknown; members?: unknown };
      };
      const members = memberIds(after?.members);
      if (
        members?.includes(vatReturn.companyId) &&
        typeof after?.name === "string" &&
        typeof after.groupTrn === "string" &&
        validateUaeTrn(after.groupTrn).valid
      ) {
        return {
          groupId,
          name: after.name,
          groupTrn: after.groupTrn,
          memberIds: members,
          provenance: "audit",
        };
      }
    } catch {
      // Some older audit rows lack readable evidence.
    }
  }
  return UNVERIFIED_VAT_GROUP;
}

function wasClosed(vatReturn: ReturnScope) {
  return ["submitted", "filed", "amended"].includes(vatReturn.status);
}

/** Older amendments could omit group membership and the group ID. Follow their original return. */
export async function resolveFilingVatGroup(
  tx: LedgerTx,
  vatReturn: ReturnScope | undefined,
  current: VatGroupInfo | null
): Promise<ResolvedVatGroup> {
  const configured = current ? { ...current, provenance: "recorded" as const } : null;
  if (!vatReturn) return configured;
  const seen = new Set<string>();
  let row: ReturnScope | undefined = vatReturn;
  while (row && !seen.has(row.id)) {
    seen.add(row.id);
    const frozen = getFilingVatGroup(row.reconciliationSnapshot);
    if (
      frozen?.memberIds.includes(row.companyId) &&
      (!row.vatGroupId || frozen.groupId === row.vatGroupId)
    ) {
      return frozen;
    }
    if (!row.amendsReturnId) {
      if (wasClosed(row)) {
        return row.vatGroupId ? recoverFilingVatGroup(tx, row, row.vatGroupId) : null;
      }
      return row.id === vatReturn.id ? configured : UNVERIFIED_VAT_GROUP;
    }
    const [original]: VatReturn[] = await tx
      .select()
      .from(vatReturns)
      .where(and(eq(vatReturns.id, row.amendsReturnId), eq(vatReturns.companyId, row.companyId)));
    row = original;
  }
  return UNVERIFIED_VAT_GROUP;
}

/** Recover older scopes from evidence before a group edit. Unverified returns remain unresolved. */
export async function legacyFilingVatGroups(
  tx: LedgerTx,
  representativeId: string,
  groupId: string
) {
  const rows: VatReturn[] = await tx
    .select()
    .from(vatReturns)
    .where(
      and(
        eq(vatReturns.companyId, representativeId),
        sql`${vatReturns.status} IN ('submitted', 'filed', 'amended')`,
        sql`NOT COALESCE(${vatReturns.reconciliationSnapshot} #>> '{filingVatGroup,provenance}' IN ('recorded', 'audit'), false)`,
        or(
          eq(vatReturns.vatGroupId, groupId),
          sql`${vatReturns.vatGroupId} IS NULL AND ${vatReturns.amendsReturnId} IS NOT NULL`
        )
      )
    );
  const scopes = [];
  for (const row of rows) {
    const group = await resolveFilingVatGroup(tx, row, null);
    if (group !== UNVERIFIED_VAT_GROUP && group?.groupId === groupId) scopes.push({ row, group });
  }
  return scopes;
}
