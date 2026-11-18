/**
 * C2 (RM3): a credit note against the invoice that billed a fixed-asset disposal.
 *
 * The disposal moved the invoice's net proceeds out of the sales account into the disposal
 * result (B1, NH3). A later credit note (a price reduction agreed with the buyer) reduces the
 * consideration received for the asset, so it changes the gain or loss on derecognition, which
 * is the net disposal proceeds less the carrying amount (IAS 16.68, 16.71), and gains are never
 * revenue (IAS 16.68). The credit note's own entry mirrors the invoice (Dr sales / Dr output VAT /
 * Cr receivable, so the VAT return and the aging read it as any credit note); this module then
 * moves its sales debit to the disposal result in the same transaction:
 *
 *   Dr 4080 gain on disposal (up to the gain still recognised)
 *   Dr 5130 loss on disposal (the rest)
 *      Cr sales account(s) the credit note debited
 *
 * and lowers the register's disposal proceeds (and output VAT) by the credit. Voiding the credit
 * note voids that entry and restores the register. Both run through the service registry
 * ("fixedAssets.onDisposalInvoiceCredited" / "fixedAssets.onDisposalCreditVoided") because the
 * invoice service cannot import the fixed-asset module (it imports the invoice service).
 *
 * D2 (N5): a debit note on the same invoice (an extra charge agreed with the buyer) is the mirror:
 * it raises the consideration, so its sales credit moves to the disposal result too:
 *
 *   Dr sales account(s) the debit note credited
 *      Cr 5130 loss on disposal (up to the loss still recognised)
 *      Cr 4080 gain on disposal (the rest)
 *
 * and the register's proceeds (and output VAT) go up by the debit note. Voiding the debit note
 * voids that entry and restores the register (onDisposalCreditVoided serves both).
 */
import { sql } from "drizzle-orm";
import { fromFils, toFils } from "../../../shared/money";
import { postJournal, voidEntry, type LedgerTx, type PostJournalLineInput } from "../../ledger";
import { has, provide } from "../../platform/service-registry";
import { ensureAccountByCode, q } from "../inventory/store";

const SOURCE = "fixed_asset";
const GAIN = "4080";
const LOSS = "5130";

const fils = (v: unknown): number =>
  v === null || v === undefined || v === "" ? 0 : toFils(String(v), { rounding: "halfUp" });

const keyFor = (assetId: string, creditNoteId: string) =>
  `${SOURCE}:${assetId}:proceeds-adj:${creditNoteId}`;

interface DisposedAsset {
  id: string;
  company_id: string;
  asset_name: string;
  disposal_amount: string | null;
  disposal_vat: string | null;
}

async function disposedAssetFor(
  tx: LedgerTx,
  companyId: string,
  invoiceId: string
): Promise<DisposedAsset | null> {
  const rows = await q<DisposedAsset>(
    tx,
    sql`SELECT id, company_id, asset_name, disposal_amount, disposal_vat FROM fixed_assets
         WHERE company_id = ${companyId} AND disposal_invoice_id = ${invoiceId}
           AND status = 'disposed'
         LIMIT 1 FOR UPDATE`
  );
  return rows[0] ?? null;
}

/** Carrying amount at derecognition: the disposal's proceeds less its recorded gain / loss. */
async function carryingAtDisposal(tx: LedgerTx, assetId: string): Promise<number> {
  const rows = await q<{ amount: string | null; gain_loss: string | null }>(
    tx,
    sql`SELECT amount::text AS amount, details->>'gainLoss' AS gain_loss
          FROM fixed_asset_events
         WHERE asset_id = ${assetId} AND event_type = 'disposed'
         ORDER BY created_at DESC LIMIT 1`
  );
  return fils(rows[0]?.amount) - fils(rows[0]?.gain_loss);
}

export async function onDisposalInvoiceCredited(
  tx: LedgerTx,
  args: {
    companyId: string;
    originalInvoiceId: string;
    creditNoteId: string;
    creditNoteNumber?: string | null;
    entryId: string;
    date: string;
    userId: string;
  }
): Promise<{ adjusted: boolean; entryId?: string }> {
  const asset = await disposedAssetFor(tx, args.companyId, args.originalInvoiceId);
  if (!asset) return { adjusted: false };
  // The credit note's sales debits (net of any credit on the same account) and its VAT debit.
  const lines = await q<{ account_id: string; type: string; is_vat: boolean; f: string }>(
    tx,
    sql`SELECT jl.account_id, ac.type, COALESCE(ac.is_vat_account, false) AS is_vat,
               SUM(ROUND(jl.debit * 100) - ROUND(jl.credit * 100))::text AS f
          FROM journal_lines jl JOIN accounts ac ON ac.id = jl.account_id
         WHERE jl.entry_id = ${args.entryId}
         GROUP BY jl.account_id, ac.type, ac.is_vat_account`
  );
  const sales = lines
    .filter((l) => l.type === "income" && Number(l.f) > 0)
    .map((l) => ({ accountId: l.account_id, fils: Number(l.f) }));
  const creditFils = sales.reduce((t, l) => t + l.fils, 0);
  if (creditFils <= 0) return { adjusted: false };
  const vatFils = lines
    .filter((l) => l.is_vat && Number(l.f) > 0)
    .reduce((t, l) => t + Number(l.f), 0);

  const proceedsBefore = fils(asset.disposal_amount);
  const gainBefore = proceedsBefore - (await carryingAtDisposal(tx, asset.id));
  const gainPart = Math.max(0, Math.min(creditFils, gainBefore));
  const lossPart = creditFils - gainPart;
  const ref = args.creditNoteNumber ?? "credit note";
  const jl: PostJournalLineInput[] = [];
  if (gainPart > 0) {
    jl.push({
      accountId: await ensureAccountByCode(tx, args.companyId, GAIN),
      debitFils: gainPart,
      description: `Disposal proceeds reduced by ${ref} - ${asset.asset_name}`,
    });
  }
  if (lossPart > 0) {
    jl.push({
      accountId: await ensureAccountByCode(tx, args.companyId, LOSS),
      debitFils: lossPart,
      description: `Loss on disposal increased by ${ref} - ${asset.asset_name}`,
    });
  }
  for (const l of sales) {
    jl.push({
      accountId: l.accountId,
      creditFils: l.fils,
      description: `${ref} on a disposal invoice moved to the disposal result`,
    });
  }
  const { entry } = await postJournal(
    {
      companyId: args.companyId,
      date: args.date,
      memo: `Disposal proceeds adjusted: ${asset.asset_name} (${ref})`.slice(0, 500),
      status: "posted",
      source: SOURCE,
      sourceId: asset.id,
      idempotencyKey: keyFor(asset.id, args.creditNoteId),
      allowFutureDate: true,
      lines: jl,
    },
    { actorId: args.userId, tx }
  );
  await tx.execute(
    sql`UPDATE fixed_assets
           SET disposal_amount = ${fromFils(proceedsBefore - creditFils)},
               disposal_vat = GREATEST(0, COALESCE(disposal_vat, 0) - ${fromFils(vatFils)}::numeric)
         WHERE id = ${asset.id}`
  );
  await tx.execute(
    sql`INSERT INTO fixed_asset_events (company_id, asset_id, event_type, event_date, amount, journal_entry_id, details, actor_id, created_at)
        VALUES (${args.companyId}, ${asset.id}, 'disposal_proceeds_adjusted', ${args.date},
                ${fromFils(-creditFils)}, ${entry.id},
                ${JSON.stringify({
                  creditNoteId: args.creditNoteId,
                  vat: fromFils(vatFils),
                  gainReduced: fromFils(gainPart),
                  lossIncreased: fromFils(lossPart),
                })}::jsonb, ${args.userId}, clock_timestamp())`
  );
  return { adjusted: true, entryId: entry.id };
}

export async function onDisposalInvoiceDebited(
  tx: LedgerTx,
  args: {
    companyId: string;
    originalInvoiceId: string;
    debitNoteId: string;
    debitNoteNumber?: string | null;
    entryId: string;
    date: string;
    userId: string;
  }
): Promise<{ adjusted: boolean; entryId?: string }> {
  const asset = await disposedAssetFor(tx, args.companyId, args.originalInvoiceId);
  if (!asset) return { adjusted: false };
  // The debit note's sales credits (net of any debit on the same account) and its VAT credit.
  const lines = await q<{ account_id: string; type: string; is_vat: boolean; f: string }>(
    tx,
    sql`SELECT jl.account_id, ac.type, COALESCE(ac.is_vat_account, false) AS is_vat,
               SUM(ROUND(jl.credit * 100) - ROUND(jl.debit * 100))::text AS f
          FROM journal_lines jl JOIN accounts ac ON ac.id = jl.account_id
         WHERE jl.entry_id = ${args.entryId}
         GROUP BY jl.account_id, ac.type, ac.is_vat_account`
  );
  const sales = lines
    .filter((l) => l.type === "income" && Number(l.f) > 0)
    .map((l) => ({ accountId: l.account_id, fils: Number(l.f) }));
  const debitFils = sales.reduce((t, l) => t + l.fils, 0);
  if (debitFils <= 0) return { adjusted: false };
  const vatFils = lines
    .filter((l) => l.is_vat && Number(l.f) > 0)
    .reduce((t, l) => t + Number(l.f), 0);

  const proceedsBefore = fils(asset.disposal_amount);
  const gainBefore = proceedsBefore - (await carryingAtDisposal(tx, asset.id));
  const lossPart = Math.max(0, Math.min(debitFils, -gainBefore));
  const gainPart = debitFils - lossPart;
  const ref = args.debitNoteNumber ?? "debit note";
  const jl: PostJournalLineInput[] = sales.map((l) => ({
    accountId: l.accountId,
    debitFils: l.fils,
    description: `${ref} on a disposal invoice moved to the disposal result`,
  }));
  if (lossPart > 0) {
    jl.push({
      accountId: await ensureAccountByCode(tx, args.companyId, LOSS),
      creditFils: lossPart,
      description: `Loss on disposal reduced by ${ref} - ${asset.asset_name}`,
    });
  }
  if (gainPart > 0) {
    jl.push({
      accountId: await ensureAccountByCode(tx, args.companyId, GAIN),
      creditFils: gainPart,
      description: `Disposal proceeds increased by ${ref} - ${asset.asset_name}`,
    });
  }
  const { entry } = await postJournal(
    {
      companyId: args.companyId,
      date: args.date,
      memo: `Disposal proceeds adjusted: ${asset.asset_name} (${ref})`.slice(0, 500),
      status: "posted",
      source: SOURCE,
      sourceId: asset.id,
      idempotencyKey: keyFor(asset.id, args.debitNoteId),
      allowFutureDate: true,
      lines: jl,
    },
    { actorId: args.userId, tx }
  );
  await tx.execute(
    sql`UPDATE fixed_assets
           SET disposal_amount = ${fromFils(proceedsBefore + debitFils)},
               disposal_vat = COALESCE(disposal_vat, 0) + ${fromFils(vatFils)}::numeric
         WHERE id = ${asset.id}`
  );
  // Stored with the credit-note sign convention (amount and vat negative for a reduction), so
  // onDisposalCreditVoided restores either kind.
  await tx.execute(
    sql`INSERT INTO fixed_asset_events (company_id, asset_id, event_type, event_date, amount, journal_entry_id, details, actor_id, created_at)
        VALUES (${args.companyId}, ${asset.id}, 'disposal_proceeds_adjusted', ${args.date},
                ${fromFils(debitFils)}, ${entry.id},
                ${JSON.stringify({
                  debitNoteId: args.debitNoteId,
                  vat: fromFils(-vatFils),
                  lossReduced: fromFils(lossPart),
                  gainIncreased: fromFils(gainPart),
                })}::jsonb, ${args.userId}, clock_timestamp())`
  );
  return { adjusted: true, entryId: entry.id };
}

export async function onDisposalCreditVoided(
  tx: LedgerTx,
  args: {
    companyId: string;
    originalInvoiceId: string | null;
    creditNoteId: string;
    userId: string;
  }
): Promise<{ restored: boolean }> {
  if (!args.originalInvoiceId) return { restored: false };
  const asset = await disposedAssetFor(tx, args.companyId, args.originalInvoiceId);
  if (!asset) return { restored: false };
  const rows = await q<{ id: string; amount: string | null; vat: string | null }>(
    tx,
    sql`SELECT je.id, ev.amount::text AS amount, ev.details->>'vat' AS vat
          FROM journal_entries je
          JOIN fixed_asset_events ev ON ev.journal_entry_id = je.id
                                    AND ev.event_type = 'disposal_proceeds_adjusted'
         WHERE je.company_id = ${args.companyId}
           AND je.idempotency_key = ${keyFor(asset.id, args.creditNoteId)}
           AND je.status = 'posted' AND je.reversed_by_entry_id IS NULL
         LIMIT 1`
  );
  const adj = rows[0];
  if (!adj) return { restored: false };
  await voidEntry(adj.id, { reason: "Credit note voided" }, { actorId: args.userId, tx });
  const creditFils = -fils(adj.amount);
  await tx.execute(
    sql`UPDATE fixed_assets
           SET disposal_amount = COALESCE(disposal_amount, 0) + ${fromFils(creditFils)}::numeric,
               disposal_vat = GREATEST(0, COALESCE(disposal_vat, 0) + ${fromFils(fils(adj.vat))}::numeric)
         WHERE id = ${asset.id}`
  );
  await tx.execute(
    sql`INSERT INTO fixed_asset_events (company_id, asset_id, event_type, event_date, amount, journal_entry_id, details, actor_id, created_at)
        VALUES (${args.companyId}, ${asset.id}, 'disposal_proceeds_restored', NULL,
                ${fromFils(creditFils)}, ${adj.id},
                ${JSON.stringify({ creditNoteId: args.creditNoteId })}::jsonb, ${args.userId},
                clock_timestamp())`
  );
  return { restored: true };
}

if (!has("fixedAssets.onDisposalInvoiceCredited"))
  provide("fixedAssets.onDisposalInvoiceCredited", onDisposalInvoiceCredited);
if (!has("fixedAssets.onDisposalInvoiceDebited"))
  provide("fixedAssets.onDisposalInvoiceDebited", onDisposalInvoiceDebited);
if (!has("fixedAssets.onDisposalCreditVoided"))
  provide("fixedAssets.onDisposalCreditVoided", onDisposalCreditVoided);
