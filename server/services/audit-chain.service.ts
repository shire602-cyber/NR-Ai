/**
 * Tamper-evident audit log (R02-17, R17-23).
 *
 * Every audit_logs row belongs to one chain: its company (`chain_key` = company id) or
 * "global" for rows with no company (sign-in events of users with no company context).
 * The BEFORE INSERT trigger from migration 0109 assigns `seq`, `prev_hash` and
 * `hash = SHA-256(canonical(row) | prev_hash)` inside the inserting transaction, under a
 * per-chain advisory transaction lock, so concurrent writers produce one unbroken chain.
 * UPDATE/DELETE are refused by a second trigger.
 *
 * This module re-implements the canonical form in Node and walks a chain, so a row
 * edited directly in the database (even by someone who can bypass the append-only
 * trigger) is reported at the first broken `seq`. Limitation (documented in
 * docs/security/audit-log.md): an operator with database superuser rights could
 * recompute every later hash; anchoring the chain head outside the database is an
 * external control.
 */
import { createHash } from "node:crypto";
import { sql } from "./security/sql";

export const GENESIS_HASH = "0".repeat(64);

export interface ChainRow {
  id: string;
  chain_key: string;
  seq: string | number;
  user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_ms: string;
  created_at: Date | string;
  prev_hash: string | null;
  hash: string | null;
  legacy: boolean;
}

function field(v: string | null | undefined): string {
  if (v === null || v === undefined) return "-1:";
  return `${Buffer.byteLength(v, "utf8")}:${v}`;
}

/** Same canonical form as the SQL function audit_log_hash (migration 0109). */
export function computeAuditHash(row: {
  chain_key: string;
  seq: string | number;
  id: string;
  user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_ms: string;
  prev_hash: string;
}): string {
  const canonical = [
    field(row.chain_key),
    field(String(row.seq)),
    field(row.id),
    field(row.user_id),
    field(row.action),
    field(row.resource_type),
    field(row.resource_id),
    field(row.details),
    field(row.ip_address),
    field(row.user_agent),
    field(row.created_ms),
    field(row.prev_hash),
  ].join("|");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function chainKeyFor(companyId: string | null | undefined): string {
  return companyId ? companyId.toLowerCase() : "global";
}

const ROW_COLUMNS = `id::text AS id, chain_key, seq::text AS seq, user_id::text AS user_id, action,
  resource_type, resource_id, details, ip_address, user_agent,
  ((extract(epoch from created_at) * 1000)::bigint)::text AS created_ms, created_at,
  prev_hash, hash, legacy`;

export type ChainBreakReason =
  | "hash_mismatch"
  | "prev_hash_mismatch"
  | "sequence_gap"
  | "missing_hash";

export interface ChainVerification {
  chainKey: string;
  ok: boolean;
  checked: number;
  legacyRows: number;
  headSeq: number;
  headHash: string | null;
  firstBroken: { seq: number; id: string; reason: ChainBreakReason } | null;
  verifiedAt: string;
}

/** Walk one chain from seq 1 and report the first broken link. */
export async function verifyAuditChain(
  companyId: string | null,
  opts: { batchSize?: number } = {}
): Promise<ChainVerification> {
  const chainKey = chainKeyFor(companyId);
  const batch = opts.batchSize ?? 1000;
  let expectedSeq = 1;
  let prev = GENESIS_HASH;
  let checked = 0;
  let legacyRows = 0;
  let headHash: string | null = null;
  let firstBroken: ChainVerification["firstBroken"] = null;
  let afterSeq = 0;

  outer: for (;;) {
    const { rows } = await sql<ChainRow>(
      `SELECT ${ROW_COLUMNS} FROM audit_logs
        WHERE chain_key = $1 AND audit_logs.seq > $2 ORDER BY audit_logs.seq LIMIT $3`,
      [chainKey, afterSeq, batch]
    );
    if (rows.length === 0) break;
    for (const row of rows) {
      const seq = Number(row.seq);
      afterSeq = seq;
      checked += 1;
      if (row.legacy) legacyRows += 1;
      if (seq !== expectedSeq) {
        firstBroken = { seq: expectedSeq, id: row.id, reason: "sequence_gap" };
        break outer;
      }
      if (!row.hash || !row.prev_hash) {
        firstBroken = { seq, id: row.id, reason: "missing_hash" };
        break outer;
      }
      if (row.prev_hash !== prev) {
        firstBroken = { seq, id: row.id, reason: "prev_hash_mismatch" };
        break outer;
      }
      const recomputed = computeAuditHash({ ...row, prev_hash: row.prev_hash });
      if (recomputed !== row.hash) {
        firstBroken = { seq, id: row.id, reason: "hash_mismatch" };
        break outer;
      }
      prev = row.hash;
      headHash = row.hash;
      expectedSeq += 1;
    }
    if (rows.length < batch) break;
  }

  return {
    chainKey,
    ok: firstBroken === null,
    checked,
    legacyRows,
    headSeq: expectedSeq - 1,
    headHash,
    firstBroken,
    verifiedAt: new Date().toISOString(),
  };
}

export interface AuditExportRow {
  seq: number;
  id: string;
  createdAt: string;
  userId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  before: unknown;
  after: unknown;
  details: string | null;
  prevHash: string | null;
  hash: string | null;
  legacy: boolean;
}

function parseDetails(details: string | null): { before: unknown; after: unknown } {
  if (!details) return { before: null, after: null };
  try {
    const parsed = JSON.parse(details) as { before?: unknown; after?: unknown };
    return { before: parsed?.before ?? null, after: parsed?.after ?? null };
  } catch {
    return { before: null, after: null };
  }
}

export async function exportAuditChain(
  companyId: string,
  range: { from?: Date | null; to?: Date | null; limit?: number } = {}
): Promise<AuditExportRow[]> {
  const params: unknown[] = [chainKeyFor(companyId)];
  const where: string[] = ["chain_key = $1"];
  if (range.from) {
    params.push(range.from);
    where.push(`created_at >= $${params.length}`);
  }
  if (range.to) {
    params.push(range.to);
    where.push(`created_at <= $${params.length}`);
  }
  params.push(Math.min(range.limit ?? 50_000, 50_000));
  const { rows } = await sql<ChainRow>(
    `SELECT ${ROW_COLUMNS} FROM audit_logs WHERE ${where.join(" AND ")}
      ORDER BY audit_logs.seq LIMIT $${params.length}`,
    params
  );
  return rows.map((row) => {
    const { before, after } = parseDetails(row.details);
    return {
      seq: Number(row.seq),
      id: row.id,
      createdAt: new Date(row.created_at).toISOString(),
      userId: row.user_id,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      before,
      after,
      details: row.details,
      prevHash: row.prev_hash,
      hash: row.hash,
      legacy: row.legacy,
    };
  });
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : JSON.stringify(value);
  // Neutralise spreadsheet formula injection, then quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function auditRowsToCsv(rows: AuditExportRow[]): string {
  const header = [
    "seq",
    "id",
    "created_at",
    "user_id",
    "action",
    "resource_type",
    "resource_id",
    "ip_address",
    "user_agent",
    "before",
    "after",
    "prev_hash",
    "hash",
    "legacy",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.seq,
        r.id,
        r.createdAt,
        r.userId,
        r.action,
        r.resourceType,
        r.resourceId,
        r.ipAddress,
        r.userAgent,
        r.before,
        r.after,
        r.prevHash,
        r.hash,
        r.legacy,
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
