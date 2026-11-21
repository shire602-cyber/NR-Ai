/**
 * A1 (C6): post the irrecoverable input VAT of a partially exempt period to the GL.
 *
 * Exec. Reg. Art. 55: input VAT that is not recoverable is part of the cost of the supplies
 * received. The VAT engine computes it (server/tax/partial-exemption.ts); this service posts the
 * difference between that figure and what is already posted for the period:
 *     Dr 5160 Irrecoverable Input VAT / Cr 1050 Input VAT     (a negative difference reverses)
 * dated on the last day of the period, source "vat_partial_exemption". It runs when the return
 * is made ready or submitted, before the VAT-to-GL gate, so Box 9 / Box 10 tie to 1050.
 */
import { journalLine, journalMemo } from "@shared/journal-memo";
import { DomainError } from "../errors";
import { and, eq } from "drizzle-orm";
import { accounts } from "../../shared/schema";
import { postJournal, type LedgerTx } from "../ledger";
import { loadVatAccounts, type VatComputation } from "./vat-engine";

export const IRRECOVERABLE_VAT_ACCOUNT_CODE = "5160";
export const PARTIAL_EXEMPTION_SOURCE = "vat_partial_exemption";

async function irrecoverableVatAccountId(companyId: string, tx: LedgerTx): Promise<string> {
  const [found] = await tx
    .select()
    .from(accounts)
    .where(
      and(eq(accounts.companyId, companyId), eq(accounts.code, IRRECOVERABLE_VAT_ACCOUNT_CODE))
    );
  if (found && found.isActive !== false && !found.isArchived) return found.id;
  const [created] = await tx
    .insert(accounts)
    .values({
      companyId,
      code: IRRECOVERABLE_VAT_ACCOUNT_CODE,
      nameEn: "Irrecoverable Input VAT (Partial Exemption)",
      nameAr: "ضريبة المدخلات غير القابلة للاسترداد (الإعفاء الجزئي)",
      description:
        "Input VAT not recoverable under partial exemption (Executive Regulation Art. 55)",
      type: "expense",
      subType: "operating_expense",
    })
    .returning({ id: accounts.id });
  return created.id;
}

export interface PartialExemptionPosting {
  posted: boolean;
  deltaFils: number;
  journalEntryId: string | null;
  computation: VatComputation;
}

export async function postPartialExemptionForPeriod(input: {
  companyId: string;
  from: string;
  to: string;
  actorId: string;
  vatReturnId: string;
  computation: VatComputation;
  tx: LedgerTx;
}): Promise<PartialExemptionPosting> {
  const { computation } = input;
  const delta = computation.partialExemption.unpostedFils ?? 0;
  if (delta === 0) return { posted: false, deltaFils: 0, journalEntryId: null, computation };
  const vatAccounts = await loadVatAccounts(input.companyId, input.tx);
  const inputVat =
    vatAccounts.find((a) => a.vatType === "input" && a.code === "1050") ??
    vatAccounts.find((a) => a.vatType === "input");
  if (!inputVat) throw new DomainError("VAT_ACCOUNTS_MISSING", 422);
  const costAccountId = await irrecoverableVatAccountId(input.companyId, input.tx);
  const amount = Math.abs(delta);
  const { entry } = await postJournal(
    {
      companyId: input.companyId,
      date: input.to,
      ...journalMemo("partialExemption", { from: input.from, to: input.to }),
      status: "posted",
      source: PARTIAL_EXEMPTION_SOURCE,
      sourceId: input.vatReturnId,
      lines:
        delta > 0
          ? [
              {
                accountId: costAccountId,
                debitFils: amount,
                ...journalLine("irrecoverableInputVat"),
              },
              {
                accountId: inputVat.id,
                creditFils: amount,
                systemVat: true,
                ...journalLine("inputVatApportioned"),
              },
            ]
          : [
              {
                accountId: inputVat.id,
                debitFils: amount,
                systemVat: true,
                ...journalLine("inputVatApportioned"),
              },
              {
                accountId: costAccountId,
                creditFils: amount,
                ...journalLine("irrecoverableInputVat"),
              },
            ],
    },
    { actorId: input.actorId, tx: input.tx }
  );
  return { posted: true, deltaFils: delta, journalEntryId: entry.id, computation };
}
