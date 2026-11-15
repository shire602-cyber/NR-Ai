/**
 * ZATCA Phase 2 orchestration: EGS onboarding (CSR → compliance CSID →
 * compliance invoices → production CSID), the per-EGS hash chain (ICV
 * counter + previous invoice hash), signing, clearance (standard) / reporting
 * (simplified), statuses and retry. Private keys and CSID secrets are stored
 * with the secret vault (AES-256-GCM).
 */
import crypto from "node:crypto";
import type { Company, Invoice, InvoiceLine } from "../../../shared/schema";
import { classifySupply } from "../../../shared/vat-classification";
import { pool } from "../../db";
import { DomainError } from "../../errors";
import { storage } from "../../storage";
import { decryptSecret, encryptSecret } from "../secret-vault";
import { nextRetryAt } from "../einvoice-status";
import { validateUblXsd } from "../einvoice/validate";
import {
  buildZatcaCsr,
  certificateFromBinarySecurityToken,
  generateEgsKeyPair,
  type ZatcaEnvironment,
} from "./keys";
import { signZatcaInvoice, verifyZatcaSignedXml } from "./sign";
import { runZatcaRules } from "./rules";
import {
  ZATCA_INITIAL_PIH,
  type ZatcaAddress,
  type ZatcaInvoiceInput,
  type ZatcaInvoiceLine,
} from "./ubl";
import {
  ZatcaTransportError,
  type ZatcaClient,
  type ZatcaCredentials,
  type ZatcaResponse,
  type SubmissionResponse,
} from "./client";

export interface EgsSellerProfile {
  nameAr: string;
  nameEn?: string | null;
  crn?: string | null;
  address: ZatcaAddress;
}

export interface CreateEgsInput {
  name: string;
  vatNumber: string;
  organizationName: string;
  organizationUnit: string;
  invoiceTypes: string;
  locationAddress: string;
  industry: string;
  seller: EgsSellerProfile;
}

interface EgsRow {
  id: string;
  company_id: string;
  name: string;
  environment: ZatcaEnvironment;
  vat_number: string;
  organization_name: string;
  organization_unit: string;
  common_name: string;
  serial_number: string;
  invoice_types: string;
  location_address: string;
  industry: string;
  seller_profile: EgsSellerProfile;
  private_key_enc: string;
  csr_pem: string;
  compliance_request_id: string | null;
  compliance_csid: string | null;
  compliance_secret_enc: string | null;
  production_csid: string | null;
  production_secret_enc: string | null;
  status: string;
  status_detail: string | null;
  icv: number;
  last_invoice_hash: string;
  created_at: Date;
  updated_at: Date;
}

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };

/** EGS view without key material or secrets. */
export function publicEgs(row: EgsRow) {
  return {
    id: row.id,
    name: row.name,
    environment: row.environment,
    vatNumber: row.vat_number,
    organizationName: row.organization_name,
    organizationUnit: row.organization_unit,
    commonName: row.common_name,
    serialNumber: row.serial_number,
    invoiceTypes: row.invoice_types,
    status: row.status,
    statusDetail: row.status_detail,
    icv: row.icv,
    lastInvoiceHash: row.last_invoice_hash,
    hasComplianceCsid: !!row.compliance_csid,
    hasProductionCsid: !!row.production_csid,
    csrPem: row.csr_pem,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getEgs(
  q: Queryable,
  companyId: string,
  egsId: string,
  lock = false
): Promise<EgsRow> {
  if (!/^[0-9a-f-]{36}$/i.test(egsId)) throw new DomainError("NOT_FOUND", 404);
  const r = await q.query(
    `SELECT * FROM zatca_egs_units WHERE id = $1 AND company_id = $2${lock ? " FOR UPDATE" : ""}`,
    [egsId, companyId]
  );
  const row = r.rows[0] as EgsRow | undefined;
  if (!row) throw new DomainError("NOT_FOUND", 404, undefined, "EGS unit not found");
  return row;
}

export async function listEgsUnits(companyId: string) {
  const r = await pool.query(
    `SELECT * FROM zatca_egs_units WHERE company_id = $1 ORDER BY created_at`,
    [companyId]
  );
  return (r.rows as EgsRow[]).map(publicEgs);
}

export async function listZatcaDocuments(companyId: string, limit = 100) {
  const r = await pool.query(
    `SELECT id, egs_unit_id, invoice_id, icv, uuid, profile, invoice_hash, previous_hash, status,
            response, attempts, next_retry_at, created_at
       FROM zatca_documents WHERE company_id = $1 ORDER BY egs_unit_id, icv DESC LIMIT $2`,
    [companyId, Math.min(Math.max(limit, 1), 500)]
  );
  return r.rows;
}

export async function createEgsUnit(
  companyId: string,
  input: CreateEgsInput,
  environment: ZatcaEnvironment
) {
  const keys = generateEgsKeyPair();
  const serialNumber = `1-Muhasib|2-1.0|3-${crypto.randomUUID()}`;
  const commonName = `EGS-${input.name}`.slice(0, 64);
  const csr = buildZatcaCsr(
    {
      commonName,
      organizationName: input.organizationName,
      organizationUnit: input.organizationUnit,
      serialNumber,
      vatNumber: input.vatNumber,
      invoiceTypes: input.invoiceTypes,
      locationAddress: input.locationAddress,
      industry: input.industry,
    },
    keys.privateKeyPem,
    environment
  );
  const r = await pool.query(
    `INSERT INTO zatca_egs_units (company_id, name, environment, vat_number, organization_name,
        organization_unit, common_name, serial_number, invoice_types, location_address, industry,
        seller_profile, private_key_enc, csr_pem, last_invoice_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [
      companyId,
      input.name,
      environment,
      input.vatNumber,
      input.organizationName,
      input.organizationUnit,
      commonName,
      serialNumber,
      input.invoiceTypes,
      input.locationAddress,
      input.industry,
      JSON.stringify(input.seller),
      encryptSecret(keys.privateKeyPem),
      csr.pem,
      ZATCA_INITIAL_PIH,
    ]
  );
  return publicEgs(r.rows[0] as EgsRow);
}

function messages(res: ZatcaResponse<unknown>): string {
  const v = res.body.validationResults;
  const errs = [...(v?.errorMessages ?? []), ...(v?.warningMessages ?? [])]
    .map((m) => `${m.code ?? ""} ${m.message ?? ""}`.trim())
    .filter(Boolean);
  return errs.join("; ") || `HTTP ${res.httpStatus}`;
}

function sampleInput(
  egs: EgsRow,
  profile: "standard" | "simplified",
  kind: ZatcaInvoiceInput["kind"],
  icv: number,
  pih: string
): ZatcaInvoiceInput {
  const now = new Date();
  return {
    profile,
    kind,
    number: `COMPLIANCE-${profile.toUpperCase()}-${kind.toUpperCase()}-${icv}`,
    uuid: crypto.randomUUID(),
    issueDate: now.toISOString().slice(0, 10),
    issueTime: now.toISOString().slice(11, 19),
    icv,
    previousHash: pih,
    billingReference: kind === "invoice" ? null : "COMPLIANCE-ORIGINAL-1",
    noteReason: kind === "invoice" ? null : "Compliance check adjustment",
    seller: { ...egs.seller_profile, vatNumber: egs.vat_number },
    buyer:
      profile === "standard"
        ? {
            name: "شركة اختبار الامتثال",
            vatNumber: "300000000000003",
            address: {
              street: "King Fahd Road",
              buildingNumber: "1111",
              district: "Olaya",
              city: "Riyadh",
              postalZone: "12211",
            },
          }
        : null,
    lines: [
      {
        name: "Compliance sample item",
        nameAr: "صنف اختبار",
        quantity: 1,
        unitPrice: "100.00",
        vatRate: 0.15,
        category: "S",
      },
    ],
  };
}

/**
 * Onboard an EGS unit with the taxpayer's Fatoora OTP:
 * compliance CSID → one compliance invoice per enabled type → production CSID.
 */
export async function onboardEgsUnit(
  companyId: string,
  egsId: string,
  otp: string,
  client: ZatcaClient
) {
  const egs = await getEgs(pool, companyId, egsId);
  if (egs.status === "production") throw new DomainError("ZATCA_ALREADY_ONBOARDED", 409);
  const csrB64 = Buffer.from(egs.csr_pem, "utf8").toString("base64");
  const fail = async (detail: string, code: string, status = 502) => {
    await pool.query(
      `UPDATE zatca_egs_units SET status = 'failed', status_detail = $3, updated_at = now() WHERE id = $1 AND company_id = $2`,
      [egsId, companyId, detail.slice(0, 1000)]
    );
    throw new DomainError(code, status, undefined, detail);
  };

  const ccsid = await client.complianceCsid(csrB64, otp);
  if (!ccsid.ok || !ccsid.body.binarySecurityToken || !ccsid.body.secret || !ccsid.body.requestID) {
    return fail(
      `Compliance CSID refused: ${messages(ccsid)}`,
      "ZATCA_COMPLIANCE_CSID_FAILED",
      ccsid.httpStatus === 400 ? 422 : 502
    );
  }
  const complianceCreds: ZatcaCredentials = {
    binarySecurityToken: ccsid.body.binarySecurityToken,
    secret: ccsid.body.secret,
  };
  await pool.query(
    `UPDATE zatca_egs_units SET compliance_request_id = $3, compliance_csid = $4, compliance_secret_enc = $5,
            status = 'compliance', status_detail = NULL, updated_at = now()
      WHERE id = $1 AND company_id = $2`,
    [
      egsId,
      companyId,
      String(ccsid.body.requestID),
      complianceCreds.binarySecurityToken,
      encryptSecret(complianceCreds.secret),
    ]
  );

  const privateKeyPem = decryptSecret(egs.private_key_enc) as string;
  const cert = certificateFromBinarySecurityToken(complianceCreds.binarySecurityToken);
  const profiles: Array<"standard" | "simplified"> = [];
  if (egs.invoice_types[0] === "1") profiles.push("standard");
  if (egs.invoice_types[1] === "1") profiles.push("simplified");
  let pih = ZATCA_INITIAL_PIH;
  let icv = 0;
  const results: Array<{ profile: string; kind: string; status: string }> = [];
  for (const profile of profiles) {
    for (const kind of ["invoice", "credit_note", "debit_note"] as const) {
      icv += 1;
      const signed = signZatcaInvoice({
        input: sampleInput(egs, profile, kind, icv, pih),
        privateKeyPem,
        certificateDer: cert,
      });
      const res = await client.complianceInvoice(complianceCreds, {
        invoiceHash: signed.invoiceHash,
        uuid: /<cbc:UUID>([^<]+)</.exec(signed.xml)?.[1] ?? "",
        invoice: Buffer.from(signed.xml, "utf8").toString("base64"),
      });
      const status =
        res.body.clearanceStatus ??
        res.body.reportingStatus ??
        res.body.validationResults?.status ??
        "";
      results.push({ profile, kind, status });
      if (!res.ok) {
        return fail(
          `Compliance invoice ${profile}/${kind} rejected: ${messages(res)}`,
          "ZATCA_COMPLIANCE_INVOICE_FAILED",
          422
        );
      }
      pih = signed.invoiceHash;
    }
  }

  const pcsid = await client.productionCsid(complianceCreds, String(ccsid.body.requestID));
  if (!pcsid.ok || !pcsid.body.binarySecurityToken || !pcsid.body.secret) {
    return fail(`Production CSID refused: ${messages(pcsid)}`, "ZATCA_PRODUCTION_CSID_FAILED");
  }
  const r = await pool.query(
    `UPDATE zatca_egs_units SET production_csid = $3, production_secret_enc = $4, status = 'production',
            status_detail = NULL, updated_at = now()
      WHERE id = $1 AND company_id = $2 RETURNING *`,
    [egsId, companyId, pcsid.body.binarySecurityToken, encryptSecret(pcsid.body.secret)]
  );
  return { egs: publicEgs(r.rows[0] as EgsRow), complianceChecks: results };
}

/** Map a stored invoice to the ZATCA document model. */
export function zatcaInputFromInvoice(args: {
  invoice: Invoice;
  lines: InvoiceLine[];
  egs: Pick<EgsRow, "vat_number" | "seller_profile">;
  icv: number;
  previousHash: string;
  uuid: string;
  buyer?: ZatcaInvoiceInput["buyer"];
  originalNumber?: string | null;
}): ZatcaInvoiceInput {
  const inv = args.invoice as Invoice & {
    invoiceType?: string;
    notes?: string | null;
    supplyDate?: Date | null;
  };
  const kind: ZatcaInvoiceInput["kind"] =
    inv.invoiceType === "credit_note"
      ? "credit_note"
      : inv.invoiceType === "debit_note"
        ? "debit_note"
        : "invoice";
  const date = new Date(inv.date);
  const lines: ZatcaInvoiceLine[] = args.lines.map((l) => {
    const c = classifySupply({ supplyType: l.vatSupplyType, vatRate: l.vatRate });
    const category = c.ublCategory === "AE" ? "S" : c.ublCategory;
    return {
      name: l.description,
      quantity: Math.abs(Number(l.quantity)),
      unitPrice: Math.abs(Number(l.unitPrice)).toFixed(2),
      vatRate: category === "S" ? Number(l.vatRate) : 0,
      category,
      exemptionCode: category === "S" ? null : (c.exemptionReasonCode ?? null),
      exemptionReason: category === "S" ? null : c.vat201Family,
    };
  });
  const buyer =
    args.buyer ??
    (inv.customerName ? { name: inv.customerName, vatNumber: inv.customerTrn ?? null } : null);
  return {
    profile: buyer?.vatNumber ? "standard" : "simplified",
    kind,
    number: inv.number,
    uuid: args.uuid,
    issueDate: date.toISOString().slice(0, 10),
    issueTime: date.toISOString().slice(11, 19),
    supplyDate: inv.supplyDate ? new Date(inv.supplyDate).toISOString().slice(0, 10) : null,
    currency: inv.currency || "SAR",
    icv: args.icv,
    previousHash: args.previousHash,
    billingReference: args.originalNumber ?? null,
    noteReason: kind === "invoice" ? null : inv.notes || "Adjustment",
    seller: { ...args.egs.seller_profile, vatNumber: args.egs.vat_number },
    buyer,
    lines,
  };
}

/** Sign the next document in the EGS chain (row-locked ICV/PIH advance). */
export async function stampInvoice(args: {
  companyId: string;
  egsId: string;
  invoice: Invoice;
  lines: InvoiceLine[];
  originalNumber?: string | null;
  now?: Date;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const egs = await getEgs(client, args.companyId, args.egsId, true);
    if (egs.status !== "production" || !egs.production_csid) {
      throw new DomainError(
        "ZATCA_EGS_NOT_ONBOARDED",
        409,
        undefined,
        "EGS unit is not onboarded: requires a Fatoora OTP"
      );
    }
    const icv = egs.icv + 1;
    const input = zatcaInputFromInvoice({
      invoice: args.invoice,
      lines: args.lines,
      egs,
      icv,
      previousHash: egs.last_invoice_hash,
      uuid: crypto.randomUUID(),
      originalNumber: args.originalNumber,
    });
    const signed = signZatcaInvoice({
      input,
      privateKeyPem: decryptSecret(egs.private_key_enc) as string,
      certificateDer: certificateFromBinarySecurityToken(egs.production_csid),
      signingTime: args.now,
    });
    const problems = runZatcaRules(signed.xml);
    const xsd = await validateUblXsd(signed.xml);
    if (
      problems.length > 0 ||
      (xsd.available && !xsd.valid) ||
      !verifyZatcaSignedXml(signed.xml).valid
    ) {
      throw new DomainError("ZATCA_DOCUMENT_INVALID", 422, {
        rules: problems,
        xsd: xsd.errors.slice(0, 10),
      });
    }
    const ins = await client.query(
      `INSERT INTO zatca_documents (company_id, egs_unit_id, invoice_id, icv, uuid, profile, invoice_hash,
          previous_hash, signed_xml, qr, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'signed') RETURNING *`,
      [
        args.companyId,
        egs.id,
        args.invoice.id,
        icv,
        input.uuid,
        input.profile,
        signed.invoiceHash,
        input.previousHash,
        signed.xml,
        signed.qr,
      ]
    );
    await client.query(
      `UPDATE zatca_egs_units SET icv = $2, last_invoice_hash = $3, updated_at = now() WHERE id = $1`,
      [egs.id, icv, signed.invoiceHash]
    );
    await client.query("COMMIT");
    return ins.rows[0] as ZatcaDocumentRow;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export interface ZatcaDocumentRow {
  id: string;
  company_id: string;
  egs_unit_id: string;
  invoice_id: string | null;
  icv: number;
  uuid: string;
  profile: "standard" | "simplified";
  invoice_hash: string;
  previous_hash: string;
  signed_xml: string;
  qr: string;
  status: string;
  response: unknown;
  attempts: number;
  next_retry_at: Date | null;
}

/** Send a stamped document: clearance (standard) or reporting (simplified). */
export async function transmitDocument(
  companyId: string,
  docId: string,
  client: ZatcaClient,
  now = new Date()
) {
  if (!/^[0-9a-f-]{36}$/i.test(docId)) throw new DomainError("NOT_FOUND", 404);
  const r = await pool.query(`SELECT * FROM zatca_documents WHERE id = $1 AND company_id = $2`, [
    docId,
    companyId,
  ]);
  const doc = r.rows[0] as ZatcaDocumentRow | undefined;
  if (!doc) throw new DomainError("NOT_FOUND", 404);
  if (["cleared", "reported"].includes(doc.status)) return doc;
  if (doc.status === "rejected")
    throw new DomainError(
      "ZATCA_DOCUMENT_REJECTED",
      409,
      undefined,
      "Rejected documents need a new invoice or credit note"
    );
  const egs = await getEgs(pool, companyId, doc.egs_unit_id);
  const creds: ZatcaCredentials = {
    binarySecurityToken: egs.production_csid as string,
    secret: decryptSecret(egs.production_secret_enc) as string,
  };
  const payload = {
    invoiceHash: doc.invoice_hash,
    uuid: doc.uuid,
    invoice: Buffer.from(doc.signed_xml, "utf8").toString("base64"),
  };
  let status: string;
  let response: unknown;
  try {
    const res: ZatcaResponse<SubmissionResponse> =
      doc.profile === "standard"
        ? await client.clearance(creds, payload)
        : await client.reporting(creds, payload);
    response = { httpStatus: res.httpStatus, ...res.body };
    if (res.ok) status = doc.profile === "standard" ? "cleared" : "reported";
    else if (res.httpStatus === 400) status = "rejected";
    else status = "failed";
  } catch (err) {
    if (!(err instanceof ZatcaTransportError)) throw err;
    status = "failed";
    response = { transportError: err.message };
  }
  const attempts = doc.attempts + 1;
  const u = await pool.query(
    `UPDATE zatca_documents SET status = $3, response = $4, attempts = $5, next_retry_at = $6
      WHERE id = $1 AND company_id = $2 RETURNING *`,
    [
      docId,
      companyId,
      status,
      JSON.stringify(response),
      attempts,
      status === "failed" ? nextRetryAt(attempts, now) : null,
    ]
  );
  return u.rows[0] as ZatcaDocumentRow;
}

/** Stamp + transmit an invoice through an onboarded EGS unit. */
export async function submitInvoiceToZatca(args: {
  company: Company;
  invoiceId: string;
  egsId: string;
  client: ZatcaClient;
  now?: Date;
}) {
  if (!/^[0-9a-f-]{36}$/i.test(args.invoiceId)) throw new DomainError("INVOICE_NOT_FOUND", 404);
  const invoice = await storage.getInvoice(args.invoiceId, args.company.id);
  if (!invoice) throw new DomainError("INVOICE_NOT_FOUND", 404);
  const existing = await pool.query(
    `SELECT id, status FROM zatca_documents WHERE invoice_id = $1 AND company_id = $2 ORDER BY icv DESC LIMIT 1`,
    [invoice.id, args.company.id]
  );
  const prior = existing.rows[0] as { id: string; status: string } | undefined;
  if (prior && ["cleared", "reported"].includes(prior.status)) {
    throw new DomainError("ZATCA_ALREADY_SUBMITTED", 409);
  }
  if (prior && ["signed", "failed"].includes(prior.status)) {
    return transmitDocument(args.company.id, prior.id, args.client, args.now);
  }
  const lines = await storage.getInvoiceLinesByInvoiceId(invoice.id);
  let originalNumber: string | null = null;
  if (invoice.originalInvoiceId) {
    originalNumber =
      (await storage.getInvoice(invoice.originalInvoiceId, args.company.id))?.number ?? null;
  }
  const doc = await stampInvoice({
    companyId: args.company.id,
    egsId: args.egsId,
    invoice,
    lines,
    originalNumber,
    now: args.now,
  });
  return transmitDocument(args.company.id, doc.id, args.client, args.now);
}
