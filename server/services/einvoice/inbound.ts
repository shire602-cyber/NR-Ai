/**
 * Inbound supplier e-invoices (R04-23): the ASP (Peppol corner 3) posts a
 * UBL invoice or credit note addressed to one of our companies. We verify the
 * HMAC, parse and validate it, archive the XML, reject duplicates by document
 * id, and create a DRAFT vendor bill through the bills module
 * (service "bills.prepareDraftFromInbound"). Nothing is approved or posted.
 */
import crypto from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  einvoiceInboundDocuments,
  vendorBills,
  type EInvoiceInboundDocument,
} from "../../../shared/schema";
import { allocate } from "../../../shared/money";
import { DomainError } from "../../errors";
import { db, pool } from "../../db";
import { withLedgerTx } from "../../ledger/tx";
import type { LedgerTx } from "../../ledger/types";
import { has, resolve } from "../../platform/service-registry";
import { all, children, fils, first, parseXml, textAt, type XNode } from "./dom";
import { summariseValidation, validateEInvoiceXml } from "./validate";
import {
  archiveEInvoiceXml,
  findInboundDuplicate,
  insertInboundDocument,
  sha256Hex,
  updateInboundDocument,
} from "./store";

export const INBOUND_SIGNATURE_HEADER = "x-einvoice-signature";
export const INBOUND_TIMESTAMP_HEADER = "x-einvoice-timestamp";
const MAX_SKEW_MS = 5 * 60_000;

export function inboundWebhookSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const s = env.EINVOICE_INBOUND_WEBHOOK_SECRET;
  return s && s.length >= 16 ? s : null;
}

/**
 * HMAC-SHA256 over "<timestamp>.<companyId>.<raw body>", hex, sent as
 * "sha256=<hex>". Binding the company id stops a delivery for one company
 * being replayed against another company's URL.
 */
export function signInbound(
  rawBody: Buffer | string,
  timestamp: string,
  companyId: string,
  secret: string
): string {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8");
  const mac = crypto
    .createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.${companyId}.`, "utf8"), body]))
    .digest("hex");
  return `sha256=${mac}`;
}

export function verifyInboundSignature(
  rawBody: Buffer,
  signature: string | undefined,
  timestamp: string | undefined,
  companyId: string,
  secret: string,
  now: Date = new Date()
): boolean {
  if (!signature || !timestamp || !/^\d{10,13}$/.test(timestamp)) return false;
  const tsMs = timestamp.length === 13 ? Number(timestamp) : Number(timestamp) * 1000;
  if (Math.abs(now.getTime() - tsMs) > MAX_SKEW_MS) return false;
  const expected = Buffer.from(signInbound(rawBody, timestamp, companyId, secret), "utf8");
  const given = Buffer.from(signature.trim(), "utf8");
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

// ─── Parsing ────────────────────────────────────────────────────────────

export interface ParsedInboundLine {
  description: string;
  quantity: number;
  unitPriceFils: number;
  netFils: number;
  category: string;
  rate: number;
}

export interface ParsedInboundDocument {
  root: "Invoice" | "CreditNote";
  typeCode: string | null;
  documentNumber: string;
  uuid: string | null;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  exchangeRate: string | null;
  supplierName: string;
  supplierTrn: string | null;
  supplierEndpoint: string | null;
  buyerTrn: string | null;
  buyerEndpoint: string | null;
  lines: ParsedInboundLine[];
  payableFils: number;
}

const bad = (message: string) =>
  new DomainError("EINVOICE_INBOUND_UNPARSEABLE", 400, undefined, message);

export function parseInboundUbl(xml: string): ParsedInboundDocument {
  let doc: Document;
  try {
    doc = parseXml(xml);
  } catch (err) {
    throw bad(`Inbound document is not well-formed XML: ${(err as Error).message}`);
  }
  const root = doc.documentElement as unknown as XNode;
  if (root.localName !== "Invoice" && root.localName !== "CreditNote") {
    throw bad("Inbound document must be a UBL Invoice or CreditNote");
  }
  const isCredit = root.localName === "CreditNote";
  const seller = first(root, "cac:AccountingSupplierParty/cac:Party");
  const buyer = first(root, "cac:AccountingCustomerParty/cac:Party");
  const documentNumber = textAt(root, "cbc:ID");
  const issueDate = textAt(root, "cbc:IssueDate");
  if (!documentNumber || !issueDate || !seller) {
    throw bad("Inbound document is missing its ID, IssueDate or supplier party");
  }
  const vatOf = (p: XNode | null) =>
    p
      ? (all(p, "cac:PartyTaxScheme").find((t) => textAt(t, "cac:TaxScheme/cbc:ID") === "VAT") ??
        null)
      : null;
  const currency = (textAt(root, "cbc:DocumentCurrencyCode") ?? "AED").toUpperCase();

  const lineNodes = children(root, isCredit ? "cac:CreditNoteLine" : "cac:InvoiceLine");
  const rawLines = lineNodes.map((l) => {
    const category = textAt(l, "cac:Item/cac:ClassifiedTaxCategory/cbc:ID") ?? "S";
    const percent = Number(textAt(l, "cac:Item/cac:ClassifiedTaxCategory/cbc:Percent") ?? 0);
    const qty = Number(textAt(l, isCredit ? "cbc:CreditedQuantity" : "cbc:InvoicedQuantity") ?? 1);
    return {
      description:
        textAt(l, "cac:Item/cbc:Name") ?? textAt(l, "cac:Item/cbc:Description") ?? "E-invoice line",
      quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
      unitPriceFils: fils(textAt(l, "cac:Price/cbc:PriceAmount")),
      lineExtFils: fils(textAt(l, "cbc:LineExtensionAmount")),
      category,
      rate: percent / 100,
    };
  });
  if (rawLines.length === 0) throw bad("Inbound document has no lines");

  // Document-level allowances/charges are allocated over the lines of their
  // tax category so the draft bill total equals the supplier's total.
  const adjustments = new Map<string, number>();
  for (const ac of children(root, "cac:AllowanceCharge")) {
    const cat = textAt(ac, "cac:TaxCategory/cbc:ID") ?? "S";
    const sign = textAt(ac, "cbc:ChargeIndicator") === "true" ? 1 : -1;
    adjustments.set(cat, (adjustments.get(cat) ?? 0) + sign * fils(textAt(ac, "cbc:Amount")));
  }
  const netFils = rawLines.map((l) => l.lineExtFils);
  for (const [cat, delta] of adjustments) {
    const idx = rawLines.map((l, i) => (l.category === cat ? i : -1)).filter((i) => i >= 0);
    if (idx.length === 0 || delta === 0) continue;
    const shares = allocate(
      Math.abs(delta),
      idx.map((i) => Math.max(rawLines[i].lineExtFils, 1))
    );
    idx.forEach((i, k) => {
      netFils[i] += Math.sign(delta) * shares[k];
    });
  }

  return {
    root: isCredit ? "CreditNote" : "Invoice",
    typeCode: textAt(root, isCredit ? "cbc:CreditNoteTypeCode" : "cbc:InvoiceTypeCode"),
    documentNumber,
    uuid: textAt(root, "cbc:UUID"),
    issueDate,
    dueDate: textAt(root, "cbc:DueDate"),
    currency,
    exchangeRate:
      currency === "AED" ? null : textAt(root, "cac:TaxExchangeRate/cbc:CalculationRate"),
    supplierName:
      textAt(seller, "cac:PartyLegalEntity/cbc:RegistrationName") ??
      textAt(seller, "cac:PartyName/cbc:Name") ??
      "Unknown supplier",
    supplierTrn: vatOf(seller) ? textAt(vatOf(seller) as XNode, "cbc:CompanyID") : null,
    supplierEndpoint: textAt(seller, "cbc:EndpointID"),
    buyerTrn: buyer && vatOf(buyer) ? textAt(vatOf(buyer) as XNode, "cbc:CompanyID") : null,
    buyerEndpoint: buyer ? textAt(buyer, "cbc:EndpointID") : null,
    lines: rawLines.map((l, i) => ({
      description: l.description,
      quantity: l.quantity,
      unitPriceFils: l.unitPriceFils,
      netFils: netFils[i],
      category: l.category,
      rate: l.rate,
    })),
    payableFils: fils(textAt(root, "cac:LegalMonetaryTotal/cbc:PayableAmount")),
  };
}

const SUPPLY_FOR_CATEGORY: Record<string, string> = {
  S: "standard_rated",
  Z: "zero_rated",
  E: "exempt",
  O: "out_of_scope",
  AE: "reverse_charge",
};

const major = (f: number) => (f / 100).toFixed(2);

/** Raw input for service "bills.prepareDraftFromInbound" (validated there by inboundBillSchema). */
export function toInboundBill(p: ParsedInboundDocument): Record<string, unknown> {
  const reverseCharge = p.lines.some((l) => l.category === "AE");
  return {
    vendorName: p.supplierName.slice(0, 255),
    vendorTrn: p.supplierTrn && /^\d{15}$/.test(p.supplierTrn) ? p.supplierTrn : null,
    billNumber: p.documentNumber.slice(0, 64),
    billDate: p.issueDate,
    dueDate: p.dueDate,
    currency: p.currency,
    exchangeRate: p.exchangeRate,
    reverseCharge,
    origin: "einvoice",
    originRef: (p.uuid ?? p.documentNumber).slice(0, 255),
    lines: p.lines.map((l) => {
      const exact = l.netFils === Math.round(l.quantity * l.unitPriceFils);
      return {
        description: (exact
          ? l.description
          : `${l.description} (${l.quantity} x ${major(l.unitPriceFils)})`
        ).slice(0, 500),
        quantity: exact ? l.quantity : 1,
        unitPrice: major(exact ? l.unitPriceFils : Math.max(l.netFils, 0)),
        vatRate: l.category === "S" || l.category === "AE" ? 5 : 0,
        supplyType: SUPPLY_FOR_CATEGORY[l.category] ?? "standard_rated",
      };
    }),
  };
}

// ─── Processing ─────────────────────────────────────────────────────────

export interface InboundCompany {
  id: string;
  trnVatNumber: string | null;
  peppolParticipantId?: string | null;
}

export interface InboundResult {
  status: number;
  body: Record<string, unknown>;
}

async function companyOwnerId(companyId: string): Promise<string | null> {
  const r: { rows: Array<{ user_id: string }> } = await pool.query(
    `SELECT user_id FROM company_users WHERE company_id = $1
      ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at
      LIMIT 1`,
    [companyId]
  );
  return r.rows[0]?.user_id ?? null;
}

type PrepareDraft = (
  companyId: string,
  actorId: string,
  raw: unknown
) => Promise<(tx: LedgerTx) => Promise<{ bill: { id: string } }>>;

function completedInbound(row: EInvoiceInboundDocument, isCredit: boolean): boolean {
  return (
    (row.status === "bill_created" && Boolean(row.billId)) ||
    (row.status === "credit_created" && Boolean(row.debitNoteId)) ||
    (Boolean(row.archiveId) &&
      (row.status === "invalid" || (isCredit && row.status === "received")))
  );
}

function duplicateInbound(row: EInvoiceInboundDocument): InboundResult {
  if (row.status === "invalid") {
    return {
      status: 422,
      body: {
        code: "EINVOICE_INBOUND_INVALID",
        duplicate: true,
        id: row.id,
        status: row.status,
        billId: null,
        validation: row.validation,
      },
    };
  }
  return {
    status: 200,
    body: { duplicate: true, id: row.id, status: row.status, billId: row.billId },
  };
}

function assertSameInboundSource(row: EInvoiceInboundDocument, hash: string): void {
  if (row.sha256 !== hash) {
    throw new DomainError(
      "EINVOICE_INBOUND_INVALID",
      422,
      undefined,
      "The source XML does not match the original inbound document."
    );
  }
}

/** Repair the linkage left by a bill committed separately by an older worker. */
async function findLegacyInboundBill(
  companyId: string,
  parsed: ParsedInboundDocument,
  tx: LedgerTx
): Promise<string | null> {
  const draft = toInboundBill(parsed);
  const rows = await tx
    .select({
      id: vendorBills.id,
      number: vendorBills.billNumber,
      date: vendorBills.billDate,
      currency: vendorBills.currency,
      vendorTrn: vendorBills.vendorTrn,
      vendorName: vendorBills.vendorName,
    })
    .from(vendorBills)
    .where(
      and(
        eq(vendorBills.companyId, companyId),
        eq(vendorBills.origin, "einvoice"),
        eq(vendorBills.originRef, String(draft.originRef))
      )
    )
    .limit(2);
  if (!rows.length) return null;
  const [bill] = rows;
  const sameSupplier =
    typeof draft.vendorTrn === "string"
      ? bill.vendorTrn === draft.vendorTrn
      : parsed.uuid !== null && bill.vendorTrn === null && bill.vendorName === draft.vendorName;
  if (
    rows.length !== 1 ||
    !sameSupplier ||
    bill.number !== draft.billNumber ||
    bill.date.toISOString().slice(0, 10) !== parsed.issueDate ||
    bill.currency !== parsed.currency
  ) {
    throw new Error("The existing bill cannot be matched unambiguously to the inbound document.");
  }
  return bill.id;
}

export async function processInboundEInvoice(args: {
  company: InboundCompany;
  xml: string;
  provider?: string | null;
  providerMessageId?: string | null;
  now?: Date;
}): Promise<InboundResult> {
  const { company, xml } = args;
  const now = args.now ?? new Date();
  if (!has("bills.prepareDraftFromInbound")) {
    throw new DomainError(
      "SERVICE_UNAVAILABLE",
      503,
      { service: "bills.prepareDraftFromInbound" },
      "The bills module is not available to receive e-invoices"
    );
  }
  const parsed = parseInboundUbl(xml);
  const tin = company.trnVatNumber?.slice(0, 10) ?? null;
  const addressedToUs =
    (parsed.buyerTrn && parsed.buyerTrn === company.trnVatNumber) ||
    (parsed.buyerEndpoint &&
      (parsed.buyerEndpoint === company.peppolParticipantId || parsed.buyerEndpoint === tin));
  if (!addressedToUs) {
    throw new DomainError(
      "EINVOICE_INBOUND_WRONG_RECIPIENT",
      422,
      undefined,
      "The document's buyer TRN / endpoint does not match this company"
    );
  }

  const isCredit = parsed.root === "CreditNote";
  const hash = sha256Hex(xml);
  const supplierKey = parsed.supplierTrn || parsed.supplierEndpoint || parsed.supplierName;
  const find = (tx?: LedgerTx) =>
    findInboundDuplicate(company.id, supplierKey, parsed.documentNumber, tx);
  const existing = await find();
  if (existing && completedInbound(existing, isCredit)) return duplicateInbound(existing);
  if (existing) assertSameInboundSource(existing, hash);

  const validation = summariseValidation(await validateEInvoiceXml(xml, { now }));
  // Persist the inbound receipt and archive first. Failed bill preparation can then be retried
  // against the same immutable source, and a finished credit note stays available for review.
  const captured = await withLedgerTx(async (tx): Promise<InboundResult | { id: string }> => {
    const prior = await find(tx);
    const row =
      prior ??
      (await insertInboundDocument(
        {
          companyId: company.id,
          supplierKey,
          supplierName: parsed.supplierName,
          supplierTrn: parsed.supplierTrn,
          documentNumber: parsed.documentNumber,
          documentType: parsed.typeCode,
          uuid: parsed.uuid,
          sha256: hash,
          validation,
          receivedAt: now,
        },
        tx
      )) ??
      (await find(tx));
    if (!row) throw new Error("Inbound receipt could not be acquired.");
    if (completedInbound(row, isCredit)) return duplicateInbound(row);
    assertSameInboundSource(row, hash);

    const archiveId =
      row.archiveId ??
      (
        await archiveEInvoiceXml(
          {
            companyId: company.id,
            direction: "inbound",
            kind: "received",
            documentNumber: parsed.documentNumber,
            documentType: parsed.typeCode,
            uuid: parsed.uuid,
            xml,
            provider: args.provider,
            providerMessageId: args.providerMessageId,
            now,
          },
          tx
        )
      ).id;

    if (!isCredit && (prior || existing)) {
      const billId = await findLegacyInboundBill(company.id, parsed, tx);
      if (billId) {
        const repaired = {
          status: "bill_created",
          archiveId,
          billId,
          validation: row.validation ?? validation,
          error: null,
        };
        await updateInboundDocument(company.id, row.id, repaired, tx);
        return duplicateInbound({ ...row, ...repaired });
      }
    }
    if (!validation.xsd.available || !validation.schematron.available) {
      await updateInboundDocument(
        company.id,
        row.id,
        {
          status: "failed",
          archiveId,
          validation,
          error: "E-invoice validation is unavailable",
        },
        tx
      );
      return {
        status: 503,
        body: { code: "EINVOICE_VALIDATION_UNAVAILABLE", id: row.id, status: "failed" },
      };
    }
    if (!validation.valid) {
      await updateInboundDocument(
        company.id,
        row.id,
        {
          status: "invalid",
          archiveId,
          validation,
          error: "Document failed PINT AE validation",
        },
        tx
      );
      return {
        status: 422,
        body: { code: "EINVOICE_INBOUND_INVALID", id: row.id, status: "invalid", validation },
      };
    }
    if (isCredit) {
      await updateInboundDocument(
        company.id,
        row.id,
        {
          status: "received",
          archiveId,
          validation,
          error: "Supplier credit note received; review it and record the vendor credit",
        },
        tx
      );
      return { status: 202, body: { id: row.id, status: "received", billId: null, validation } };
    }

    await updateInboundDocument(
      company.id,
      row.id,
      {
        status: "received",
        archiveId,
        validation,
        error: null,
      },
      tx
    );
    return { id: row.id };
  });
  if ("status" in captured) return captured;

  try {
    const actorId = await companyOwnerId(company.id);
    if (!actorId) throw new DomainError("EINVOICE_INBOUND_NO_OWNER", 409);
    const prepare = resolve<PrepareDraft>("bills.prepareDraftFromInbound");
    const write = await prepare(company.id, actorId, toInboundBill(parsed));
    return await withLedgerTx(async (tx) => {
      const row = await find(tx);
      if (!row) throw new Error("Inbound receipt no longer exists.");
      if (completedInbound(row, false)) return duplicateInbound(row);
      assertSameInboundSource(row, hash);
      const legacyBillId = await findLegacyInboundBill(company.id, parsed, tx);
      const billId = legacyBillId ?? (await write(tx)).bill.id;
      await updateInboundDocument(
        company.id,
        row.id,
        {
          status: "bill_created",
          billId,
          error: null,
        },
        tx
      );
      if (legacyBillId) return duplicateInbound({ ...row, status: "bill_created", billId });
      return {
        status: 201,
        body: { id: row.id, status: "bill_created", billId, validation },
      };
    });
  } catch (err) {
    const note =
      err instanceof DomainError && err.code === "EINVOICE_INBOUND_NO_OWNER"
        ? "Company has no member to own the draft bill"
        : "Inbound draft bill could not be created";
    await db
      .update(einvoiceInboundDocuments)
      .set({ status: "failed", error: note })
      .where(
        and(
          eq(einvoiceInboundDocuments.companyId, company.id),
          eq(einvoiceInboundDocuments.id, captured.id),
          inArray(einvoiceInboundDocuments.status, ["failed", "received"]),
          isNull(einvoiceInboundDocuments.billId)
        )
      );
    throw err;
  }
}
