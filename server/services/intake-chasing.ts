// Bridge: completeness gaps → document-chasing requirements.
//
// A completeness gap (a bank line with no supporting document) is exactly the
// thing to chase the client for. This maps gaps onto the existing
// document-chasing model (document_requirements), tagging each with a stable
// marker so re-running the completeness check never creates duplicate chases for
// the same bank line.
//
// Pure functions here (mapping + dedup) are unit-tested; the persistence wrapper
// lives in document-chasing.service via createRequirement. See
// docs/EMAIL_INTAKE_PILOT.md §4.

import type { EvidenceGap } from "./intake-completeness";
import { listRequirements, createRequirement } from "./document-chasing.service";

/** Stable marker written into a requirement's notes so we can dedup re-runs. */
export const GAP_REQUIREMENT_MARKER = "intake-gap";

export function markerFor(bankTransactionId: string): string {
  return `${GAP_REQUIREMENT_MARKER}:${bankTransactionId}`;
}

/** Map a gap kind to the chasing document type. */
export function gapToDocumentType(kind: EvidenceGap["kind"]): string {
  return kind === "missing_purchase_evidence" ? "purchase_invoice" : "sales_invoice";
}

export interface RequirementInput {
  documentType: string;
  description: string;
  dueDate: Date;
  notes: string; // carries the dedup marker
  bankTransactionId: string;
}

function formatAmount(amount: number, currency = "AED"): string {
  return `${currency} ${amount.toFixed(2)}`;
}

/**
 * Turn completeness gaps into requirement inputs. `dueDate` is when the client
 * is asked to provide the document by (caller decides, e.g. period end + N days).
 */
export function gapsToRequirementInputs(
  gaps: EvidenceGap[],
  opts: { dueDate: Date; currency?: string }
): RequirementInput[] {
  return gaps.map((g) => {
    const what = g.kind === "missing_purchase_evidence" ? "purchase invoice/receipt" : "sales invoice";
    const dateStr = g.date.toISOString().slice(0, 10);
    const descPart = g.description ? ` — "${g.description}"` : "";
    return {
      documentType: gapToDocumentType(g.kind),
      description: `Missing ${what} for ${formatAmount(g.amount, opts.currency)} on ${dateStr}${descPart}`,
      dueDate: opts.dueDate,
      notes: markerFor(g.bankTransactionId),
      bankTransactionId: g.bankTransactionId,
    };
  });
}

/**
 * Drop requirement inputs whose bank line is already being chased. `existingNotes`
 * is the notes field of every currently-open requirement for the company; a match
 * on the marker means we've already raised this one.
 */
export function filterNewGapRequests(
  inputs: RequirementInput[],
  existingNotes: Array<string | null | undefined>
): RequirementInput[] {
  const seen = new Set(
    existingNotes
      .filter((n): n is string => typeof n === "string" && n.includes(GAP_REQUIREMENT_MARKER))
      .map((n) => n.trim())
  );
  // De-dup within the incoming batch too (a bank id should map to one request).
  const batchSeen = new Set<string>();
  const out: RequirementInput[] = [];
  for (const inp of inputs) {
    if (seen.has(inp.notes) || batchSeen.has(inp.notes)) continue;
    batchSeen.add(inp.notes);
    out.push(inp);
  }
  return out;
}

export interface ChaseCreationResult {
  created: number;
  skipped: number; // already being chased
  requirementIds: string[];
}

/**
 * Persist document-chasing requirements for the given gaps, skipping any bank
 * line already being chased. Idempotent: safe to call after every completeness
 * check. Open (not received/waived) requirements count toward dedup.
 */
export async function createChaseRequestsFromGaps(
  companyId: string,
  gaps: EvidenceGap[],
  opts: { dueDate: Date; currency?: string }
): Promise<ChaseCreationResult> {
  const inputs = gapsToRequirementInputs(gaps, opts);
  const existing = await listRequirements(companyId);
  const openNotes = existing
    .filter((r) => r.status !== "received" && r.status !== "waived")
    .map((r) => r.notes);
  const toCreate = filterNewGapRequests(inputs, openNotes);

  const requirementIds: string[] = [];
  for (const inp of toCreate) {
    const row = await createRequirement({
      companyId,
      documentType: inp.documentType,
      description: inp.description,
      dueDate: inp.dueDate,
      notes: inp.notes,
    });
    requirementIds.push(row.id);
  }
  return { created: toCreate.length, skipped: inputs.length - toCreate.length, requirementIds };
}
