// Companies.
// Part of the shared/schema.ts barrel (R20-09); import from "@shared/schema".

import {
  boolean,
  integer,
  jsonb,
  date as pgDate,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { createInsertSchema, vatRateType } from "./columns";
import { companyPreferencesSchema } from "../schema-values";

// ===========================
// Companies
// ===========================
export const companies = pgTable("companies", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  legalName: text("legal_name"), // Registered legal name (may differ from trading name)
  baseCurrency: text("base_currency").notNull().default("AED"),
  locale: text("locale").notNull().default("en"), // 'en' or 'ar'
  dateFormat: text("date_format").notNull().default("DD/MM/YYYY"), // DD/MM/YYYY | MM/DD/YYYY | YYYY-MM-DD
  fiscalYearStartMonth: integer("fiscal_year_start_month").notNull().default(1), // 1..12
  defaultVatRate: vatRateType("default_vat_rate").notNull().default(0.05), // UAE standard rate

  // Company Type - determines access model
  companyType: text("company_type").notNull().default("customer"), // client | customer
  // client = Managed by NR Accounting, invite-only portal access
  // customer = Self-service SaaS user

  // Company Information
  legalStructure: text("legal_structure"), // Sole Proprietorship, LLC, Corporation, Partnership, Other
  industry: text("industry"),
  registrationNumber: text("registration_number"),
  businessAddress: text("business_address"), // Free-text legacy single-line address
  addressStreet: text("address_street"),
  addressCity: text("address_city"),
  addressCountry: text("address_country").default("AE"),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  websiteUrl: text("website_url"),
  logoUrl: text("logo_url"),
  // W2-D (migration 0093): logo stored through fileStorage (storage key), served by /api/companies/:id/logo.
  logoPath: text("logo_path"),

  // Tax & Compliance
  trnVatNumber: text("trn_vat_number"),
  taxRegistrationType: text("tax_registration_type"), // Standard, Flat Rate, Non-registered, Other
  vatFilingFrequency: text("vat_filing_frequency"), // Monthly, Quarterly, Annually
  taxRegistrationDate: timestamp("tax_registration_date"),
  corporateTaxId: text("corporate_tax_id"),
  // No default: Box 1a–1g of the VAT 201 attributes supplies by emirate, so a
  // guessed value silently misfiles a non-Dubai company's whole turnover.
  // Onboarding asks for this; VAT 201 generation refuses until it is set.
  emirate: text("emirate"), // abu_dhabi | dubai | sharjah | ajman | umm_al_quwain | ras_al_khaimah | fujairah

  // WPS / Payroll — MOHRE establishment ID and employer bank fields used to
  // build the SCR (Salary Control Record) line of the SIF file. Distinct from
  // `registrationNumber` (trade-license number).
  mohreEstablishmentId: text("mohre_establishment_id"),
  wpsEmployerBankName: text("wps_employer_bank_name"),
  wpsEmployerIban: text("wps_employer_iban"),
  wpsEmployerRoutingCode: text("wps_employer_routing_code"),
  // W3-D (migration 0098): WPS agent / salary-transfer provider id (bank or exchange house).
  wpsAgentId: text("wps_agent_id"),
  // W4-C (migration 0102): e-invoicing identity. Peppol participant id is the
  // TIN (first 10 TRN digits) under scheme 0235 unless the ASP registered
  // another; the trade licence is the PINT AE seller legal registration
  // (BTAE-15 "TL") with its issuing authority (BTAE-12). City reuses
  // address_city. Scope / go-live drive when e-invoicing is mandatory.
  peppolParticipantId: text("peppol_participant_id"),
  peppolScheme: text("peppol_scheme"),
  tradeLicenceNo: text("trade_licence_no"),
  tradeLicenceAuthority: text("trade_licence_authority"),
  einvoicePayeeIban: text("einvoice_payee_iban"),
  einvoicePaymentMeansCode: text("einvoice_payment_means_code"),
  einvoiceScope: text("einvoice_scope"), // b2b | b2g | b2b_b2g | none
  einvoiceTurnoverBand: text("einvoice_turnover_band"), // large | standard | government
  einvoiceGoLiveDate: pgDate("einvoice_go_live_date"),
  // Partial exemption: fraction of supplies that are exempt (0..1). When > 0, input VAT
  // is reduced by this ratio per FTA partial-exemption rules.
  exemptSupplyRatio: vatRateType("exempt_supply_ratio").notNull().default(0),
  // VAT autopilot configuration. periodStartMonth is the calendar month (1-12)
  // that the VAT period cycle starts on — defaults to January but FTA assigns
  // each registrant a stagger so quarterly periods may begin in Feb or Mar.
  vatAutoCalculate: boolean("vat_auto_calculate").notNull().default(true),
  vatPeriodStartMonth: integer("vat_period_start_month").notNull().default(1),

  // Soft delete — UAE FTA requires 5-year retention; hard deletes are disallowed
  deletedAt: timestamp("deleted_at"),
  isActive: boolean("is_active").notNull().default(true),

  // Invoice Customization
  invoiceShowLogo: boolean("invoice_show_logo").notNull().default(true),
  invoiceShowAddress: boolean("invoice_show_address").notNull().default(true),
  invoiceShowPhone: boolean("invoice_show_phone").notNull().default(true),
  invoiceShowEmail: boolean("invoice_show_email").notNull().default(true),
  invoiceShowWebsite: boolean("invoice_show_website").notNull().default(false),
  invoiceCustomTitle: text("invoice_custom_title"), // Custom invoice title, defaults to "Tax Invoice" for VAT registered
  invoiceFooterNote: text("invoice_footer_note"),

  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),

  // Phase 2: Receipt Autopilot — per-company classifier config.
  // mode: 'hybrid' uses internal classifier first with OpenAI fallback; 'openai_only' bypasses internal model.
  // accuracyThreshold: when internal accuracy drops below this, the company is auto-switched to openai_only.
  // autopilotEnabled: when true, high-confidence receipts are auto-posted to the GL without user review.
  classifierConfig: jsonb("classifier_config")
    .notNull()
    .default(sql`'{"mode":"hybrid","accuracyThreshold":0.8,"autopilotEnabled":false}'::jsonb`)
    .$type<{
      mode: "hybrid" | "openai_only";
      accuracyThreshold: number;
      autopilotEnabled: boolean;
    }>(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCompanySchema = createInsertSchema(companies).omit({
  id: true,
  createdAt: true,
});

export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companies.$inferSelect;

// Defined in shared/schema-values.ts so client pages can import it without
// loading the drizzle schema (R17-27); re-exported through the barrel.
export { companyPreferencesSchema };

export type CompanyPreferences = z.infer<typeof companyPreferencesSchema>;
