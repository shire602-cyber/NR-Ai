// UAE e-invoicing (PINT AE / ASP) and ZATCA (W4-C).
// Part of the shared/schema.ts barrel (R20-09); import from "@shared/schema".

import {
  index,
  integer,
  jsonb,
  date as pgDate,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";

// ===========================
// W4-C (migration 0102): UAE e-invoicing (PINT AE / ASP) and ZATCA (KSA)
// ===========================

/** Per-invoice e-invoice state: validation, ASP lifecycle, retries. */
export const einvoiceDocuments = pgTable(
  "einvoice_documents",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id").notNull(),
    status: text("status").notNull().default("generated"),
    documentType: text("document_type"),
    uuid: text("uuid"),
    xmlHash: text("xml_hash"),
    validation: jsonb("validation"),
    validatedAt: timestamp("validated_at"),
    provider: text("provider"),
    providerMessageId: text("provider_message_id"),
    attempts: integer("attempts").notNull().default(0),
    nextRetryAt: timestamp("next_retry_at"),
    lastError: text("last_error"),
    rejectionReasons: jsonb("rejection_reasons"),
    clearedAt: timestamp("cleared_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    invoiceUnique: unique("einvoice_documents_invoice_unique").on(table.invoiceId),
    companyStatusIdx: index("idx_einvoice_documents_company_status").on(
      table.companyId,
      table.status
    ),
    retryIdx: index("idx_einvoice_documents_retry").on(table.nextRetryAt),
  })
);
export type EInvoiceDocument = typeof einvoiceDocuments.$inferSelect;

/**
 * Five-year archive of submitted / cleared / received XML. Rows are immutable:
 * a trigger (migration 0102) rejects UPDATE and DELETE.
 */
export const einvoiceArchive = pgTable(
  "einvoice_archive",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    invoiceId: uuid("invoice_id"),
    direction: text("direction").notNull(), // outbound | inbound
    kind: text("kind").notNull(), // submitted | cleared | received
    documentNumber: text("document_number").notNull(),
    documentType: text("document_type"),
    uuid: text("uuid"),
    xml: text("xml").notNull(),
    sha256: text("sha256").notNull(),
    provider: text("provider"),
    providerMessageId: text("provider_message_id"),
    retainUntil: pgDate("retain_until").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    contentUnique: unique("einvoice_archive_content_unique").on(
      table.companyId,
      table.direction,
      table.kind,
      table.sha256
    ),
    companyCreatedIdx: index("idx_einvoice_archive_company_created").on(
      table.companyId,
      table.createdAt
    ),
  })
);
export type EInvoiceArchiveRow = typeof einvoiceArchive.$inferSelect;

/** Supplier e-invoices received through the ASP (inbound webhook). */
export const einvoiceInboundDocuments = pgTable(
  "einvoice_inbound_documents",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    supplierKey: text("supplier_key").notNull().default(""),
    supplierName: text("supplier_name"),
    supplierTrn: text("supplier_trn"),
    documentNumber: text("document_number").notNull(),
    documentType: text("document_type"),
    uuid: text("uuid"),
    sha256: text("sha256").notNull(),
    validation: jsonb("validation"),
    // received | bill_created | credit_created (S2: vendor debit note) | invalid | failed
    status: text("status").notNull().default("received"),
    billId: uuid("bill_id"),
    debitNoteId: uuid("debit_note_id"),
    archiveId: uuid("archive_id"),
    error: text("error"),
    receivedAt: timestamp("received_at").defaultNow().notNull(),
  },
  (table) => ({
    duplicateUnique: unique("einvoice_inbound_duplicate_unique").on(
      table.companyId,
      table.supplierKey,
      table.documentNumber
    ),
  })
);
export type EInvoiceInboundDocument = typeof einvoiceInboundDocuments.$inferSelect;

/** Buyer Peppol participant ids (BT-49) keyed by customer contact. */
export const einvoiceBuyerEndpoints = pgTable(
  "einvoice_buyer_endpoints",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull(),
    participantId: text("participant_id"),
    scheme: text("scheme"),
    legalId: text("legal_id"),
    legalIdType: text("legal_id_type"),
    legalAuthority: text("legal_authority"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    contactUnique: unique("einvoice_buyer_endpoints_contact_unique").on(
      table.companyId,
      table.contactId
    ),
  })
);
export type EInvoiceBuyerEndpoint = typeof einvoiceBuyerEndpoints.$inferSelect;

/** ZATCA e-invoice generation solution (EGS) unit: keys, CSIDs and hash chain. */
export const zatcaEgsUnits = pgTable(
  "zatca_egs_units",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    environment: text("environment").notNull(), // sandbox | simulation | production
    vatNumber: text("vat_number").notNull(),
    organizationName: text("organization_name").notNull(),
    organizationUnit: text("organization_unit").notNull(),
    commonName: text("common_name").notNull(),
    serialNumber: text("serial_number").notNull(),
    invoiceTypes: text("invoice_types").notNull().default("1100"),
    locationAddress: text("location_address").notNull(),
    industry: text("industry").notNull(),
    /** Seller block for the ZATCA UBL (Arabic name, CRN, national address). */
    sellerProfile: jsonb("seller_profile").notNull(),
    privateKeyEnc: text("private_key_enc").notNull(),
    csrPem: text("csr_pem").notNull(),
    complianceRequestId: text("compliance_request_id"),
    complianceCsid: text("compliance_csid"),
    complianceSecretEnc: text("compliance_secret_enc"),
    productionCsid: text("production_csid"),
    productionSecretEnc: text("production_secret_enc"),
    status: text("status").notNull().default("created"), // created | compliance | production | failed
    statusDetail: text("status_detail"),
    icv: integer("icv").notNull().default(0),
    lastInvoiceHash: text("last_invoice_hash").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdx: index("idx_zatca_egs_units_company").on(table.companyId),
  })
);
export type ZatcaEgsUnit = typeof zatcaEgsUnits.$inferSelect;

/** Every ZATCA document in an EGS chain (ICV order), with its clearance/reporting outcome. */
export const zatcaDocuments = pgTable(
  "zatca_documents",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    egsUnitId: uuid("egs_unit_id")
      .notNull()
      .references(() => zatcaEgsUnits.id, { onDelete: "restrict" }),
    invoiceId: uuid("invoice_id"),
    icv: integer("icv").notNull(),
    uuid: text("uuid").notNull(),
    profile: text("profile").notNull(), // standard | simplified
    invoiceHash: text("invoice_hash").notNull(),
    previousHash: text("previous_hash").notNull(),
    signedXml: text("signed_xml").notNull(),
    qr: text("qr").notNull(),
    status: text("status").notNull().default("signed"), // signed | cleared | reported | rejected | failed
    response: jsonb("response"),
    attempts: integer("attempts").notNull().default(0),
    nextRetryAt: timestamp("next_retry_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    chainUnique: unique("zatca_documents_chain_unique").on(table.egsUnitId, table.icv),
    invoiceIdx: index("idx_zatca_documents_invoice").on(table.invoiceId),
  })
);
export type ZatcaDocument = typeof zatcaDocuments.$inferSelect;
