// Phase 8 D2 (purchases, projects and people): Drizzle definitions.
//
// Two groups live here so shared/schema.ts (5,000+ lines) only needs anchored edits:
//   1. raw-SQL tables that had no typed definition (vendor bills, credit notes, expense claims, payroll),
//      defined for every live column so reports and the public API can query them typed;
//   2. the tables of migrations 0107-0109 (projects, approvals, leave, loans, settlements).
// Import this file directly; it is not re-exported from shared/schema.ts.
//
// Date-only timestamp columns use { mode: "string" } so a bill dated 2026-03-31 is never shifted
// by the server's local time zone (see the note in bill-pay.routes.ts).

import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts, companies, customerContacts, journalEntries, money, users } from "./schema";

const num = (name: string) => numeric(name, { mode: "number" });

// ===========================
// Vendor bills (migrations 0014, 0021, 0045, 0098, 0106)
// ===========================
export const vendorBills = pgTable(
  "vendor_bills",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    vendorId: uuid("vendor_id").references(() => customerContacts.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    vendorName: text("vendor_name").notNull(),
    vendorTrn: text("vendor_trn"),
    billNumber: text("bill_number"),
    billDate: timestamp("bill_date", { mode: "string" }).notNull(),
    dueDate: timestamp("due_date", { mode: "string" }),
    currency: text("currency").default("AED"),
    subtotal: money("subtotal").default(0),
    vatAmount: money("vat_amount").default(0),
    totalAmount: money("total_amount").default(0),
    amountPaid: money("amount_paid").default(0),
    // pending | pending_approval | approved | partial | paid | void
    status: text("status").default("pending"),
    category: text("category"),
    notes: text("notes"),
    attachmentUrl: text("attachment_url"),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at"),
    paidAt: timestamp("paid_at"),
    createdAt: timestamp("created_at").defaultNow(),
    reverseCharge: boolean("reverse_charge").notNull().default(false),
    retentionExpiresAt: timestamp("retention_expires_at"),
    exchangeRate: num("exchange_rate").notNull().default(1),
    isOpeningBalance: boolean("is_opening_balance").notNull().default(false),
  },
  (t) => ({
    companyVendorIdx: index("idx_vendor_bills_company_vendor").on(t.companyId, t.vendorId),
  })
);
export type VendorBillRow = typeof vendorBills.$inferSelect;

export const billLineItems = pgTable("bill_line_items", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  billId: uuid("bill_id")
    .notNull()
    .references(() => vendorBills.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantity: num("quantity").default(1),
  unitPrice: num("unit_price").notNull(),
  vatRate: num("vat_rate").default(5),
  amount: num("amount"),
  accountId: uuid("account_id").references(() => accounts.id),
  createdAt: timestamp("created_at").defaultNow(),
  reverseCharge: boolean("reverse_charge").notNull().default(false),
  // Phase 8 D2 (0107)
  projectId: uuid("project_id"),
  isBillable: boolean("is_billable").notNull().default(false),
});
export type BillLineItemRow = typeof billLineItems.$inferSelect;

export const billPayments = pgTable("bill_payments", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  billId: uuid("bill_id")
    .notNull()
    .references(() => vendorBills.id, { onDelete: "cascade" }),
  paymentDate: timestamp("payment_date", { mode: "string" }).notNull(),
  amount: money("amount").notNull(),
  paymentMethod: text("payment_method").default("bank_transfer"),
  reference: text("reference"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  retentionExpiresAt: timestamp("retention_expires_at"),
});
export type BillPaymentRow = typeof billPayments.$inferSelect;

// ===========================
// Vendor credit notes (migration 0098, 0106)
// ===========================
export const vendorCreditNotes = pgTable(
  "vendor_credit_notes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    vendorId: uuid("vendor_id").references(() => customerContacts.id, { onDelete: "set null" }),
    vendorName: text("vendor_name").notNull(),
    vendorTrn: text("vendor_trn"),
    billId: uuid("bill_id").references(() => vendorBills.id, { onDelete: "set null" }),
    number: text("number").notNull(),
    vendorReference: text("vendor_reference"),
    date: date("date", { mode: "string" }).notNull(),
    currency: text("currency").notNull().default("AED"),
    exchangeRate: num("exchange_rate").notNull().default(1),
    subtotal: money("subtotal").notNull().default(0),
    vatAmount: money("vat_amount").notNull().default(0),
    total: money("total").notNull().default(0),
    reverseCharge: boolean("reverse_charge").notNull().default(false),
    // draft | approved | partial | applied | void
    status: text("status").notNull().default("draft"),
    remainingAmount: money("remaining_amount").notNull().default(0),
    notes: text("notes"),
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
    voidJournalEntryId: uuid("void_journal_entry_id").references(() => journalEntries.id),
    createdBy: uuid("created_by").references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at"),
    voidedAt: timestamp("voided_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    companyVendorIdx: index("idx_vendor_credit_notes_company_vendor").on(t.companyId, t.vendorId),
  })
);
export type VendorCreditNoteRow = typeof vendorCreditNotes.$inferSelect;

export const vendorCreditNoteLines = pgTable("vendor_credit_note_lines", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  creditNoteId: uuid("credit_note_id")
    .notNull()
    .references(() => vendorCreditNotes.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantity: num("quantity").notNull().default(1),
  unitPrice: num("unit_price").notNull(),
  vatRate: num("vat_rate").notNull().default(5),
  vatSupplyType: text("vat_supply_type").notNull().default("standard"),
  accountId: uuid("account_id").references(() => accounts.id),
  lineTotal: money("line_total").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type VendorCreditNoteLineRow = typeof vendorCreditNoteLines.$inferSelect;

export const vendorCreditApplications = pgTable("vendor_credit_applications", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  creditNoteId: uuid("credit_note_id")
    .notNull()
    .references(() => vendorCreditNotes.id, { onDelete: "cascade" }),
  billId: uuid("bill_id")
    .notNull()
    .references(() => vendorBills.id, { onDelete: "cascade" }),
  amount: money("amount").notNull(),
  appliedAt: timestamp("applied_at").defaultNow().notNull(),
  appliedBy: uuid("applied_by").references(() => users.id),
});
export type VendorCreditApplicationRow = typeof vendorCreditApplications.$inferSelect;

// ===========================
// Expense claims (migration 0013)
// ===========================
export const expenseClaims = pgTable("expense_claims", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  submittedBy: uuid("submitted_by")
    .notNull()
    .references(() => users.id),
  claimNumber: text("claim_number"),
  title: text("title").notNull(),
  description: text("description"),
  totalAmount: money("total_amount").default(0),
  currency: text("currency").default("AED"),
  // draft | submitted | pending_approval | approved | rejected | paid
  status: text("status").default("draft"),
  submittedAt: timestamp("submitted_at"),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  paidAt: timestamp("paid_at"),
  paymentReference: text("payment_reference"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type ExpenseClaimRow = typeof expenseClaims.$inferSelect;

export const expenseClaimItems = pgTable("expense_claim_items", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  claimId: uuid("claim_id")
    .notNull()
    .references(() => expenseClaims.id, { onDelete: "cascade" }),
  expenseDate: timestamp("expense_date", { mode: "string" }).notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  amount: money("amount").notNull(),
  vatAmount: money("vat_amount").default(0),
  receiptUrl: text("receipt_url"),
  merchantName: text("merchant_name"),
  createdAt: timestamp("created_at").defaultNow(),
  // Phase 8 D2 (0107)
  projectId: uuid("project_id"),
  isBillable: boolean("is_billable").notNull().default(false),
});
export type ExpenseClaimItemRow = typeof expenseClaimItems.$inferSelect;

// ===========================
// Payroll (migrations 0012, 0043, 0066)
// ===========================
export const employees = pgTable("employees", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  employeeNumber: text("employee_number"),
  fullName: text("full_name").notNull(),
  fullNameAr: text("full_name_ar"),
  nationality: text("nationality"),
  passportNumber: text("passport_number"),
  visaNumber: text("visa_number"),
  laborCardNumber: text("labor_card_number"),
  bankName: text("bank_name"),
  bankAccountNumber: text("bank_account_number"),
  iban: text("iban"),
  routingCode: text("routing_code"),
  department: text("department"),
  designation: text("designation"),
  joinDate: timestamp("join_date", { mode: "string" }),
  basicSalary: money("basic_salary").notNull().default(0),
  housingAllowance: money("housing_allowance").notNull().default(0),
  transportAllowance: money("transport_allowance").notNull().default(0),
  otherAllowance: money("other_allowance").notNull().default(0),
  totalSalary: money("total_salary").notNull().default(0),
  // active | inactive | terminated
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // Phase 8 D2 (0109)
  terminationDate: date("termination_date", { mode: "string" }),
  // Phase 9 (0125): the login this employee record belongs to (an employee-role user sees only their own records).
  userId: uuid("user_id"),
  // Phase 9 (0126)
  molPersonId: text("mol_person_id"),
  openingGratuityProvision: money("opening_gratuity_provision").notNull().default(0),
  // Teardown 7 (0128): what the company already held for this employee when payroll started here, as of a date
  openingLeaveDays: num("opening_leave_days").notNull().default(0),
  openingLeaveProvision: money("opening_leave_provision").notNull().default(0),
  openingProvisionsAsOf: date("opening_provisions_as_of", { mode: "string" }),
  priorServiceCatchupAt: timestamp("prior_service_catchup_at"),
});
export type EmployeeRow = typeof employees.$inferSelect;

export const payrollRuns = pgTable("payroll_runs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  periodMonth: integer("period_month").notNull(),
  periodYear: integer("period_year").notNull(),
  runDate: timestamp("run_date").defaultNow(),
  totalBasic: money("total_basic").notNull().default(0),
  totalAllowances: money("total_allowances").notNull().default(0),
  totalDeductions: money("total_deductions").notNull().default(0),
  totalNet: money("total_net").notNull().default(0),
  employeeCount: integer("employee_count").notNull().default(0),
  // draft | calculated | pending_approval | approved | paid
  status: text("status").notNull().default("draft"),
  sifFileContent: text("sif_file_content"),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  totalPensionEmployee: money("total_pension_employee").notNull().default(0),
  totalPensionEmployer: money("total_pension_employer").notNull().default(0),
  totalGratuityAccrual: money("total_gratuity_accrual").notNull().default(0),
  journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
  notes: text("notes"),
  // Phase 8 D2 (0109)
  totalLeaveDeductions: money("total_leave_deductions").notNull().default(0),
  totalLoanDeductions: money("total_loan_deductions").notNull().default(0),
  // Phase 9 (0126): who prepared the run
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
});
export type PayrollRunRow = typeof payrollRuns.$inferSelect;

export const payrollItems = pgTable("payroll_items", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  payrollRunId: uuid("payroll_run_id")
    .notNull()
    .references(() => payrollRuns.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id),
  basicSalary: money("basic_salary").notNull().default(0),
  housingAllowance: money("housing_allowance").notNull().default(0),
  transportAllowance: money("transport_allowance").notNull().default(0),
  otherAllowance: money("other_allowance").notNull().default(0),
  overtime: money("overtime").notNull().default(0),
  deductions: money("deductions").notNull().default(0),
  deductionNotes: text("deduction_notes"),
  netSalary: money("net_salary").notNull().default(0),
  paymentMode: text("payment_mode").notNull().default("bank_transfer"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  pensionEmployee: money("pension_employee").notNull().default(0),
  pensionEmployer: money("pension_employer").notNull().default(0),
  gratuityAccrual: money("gratuity_accrual").notNull().default(0),
  manuallyEdited: boolean("manually_edited").notNull().default(false),
  journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
  // Phase 8 D2 (0109): what leave and loan instalments take off the pay
  leaveDeduction: money("leave_deduction").notNull().default(0),
  loanDeduction: money("loan_deduction").notNull().default(0),
  unpaidLeaveDays: num("unpaid_leave_days").notNull().default(0),
  halfPayLeaveDays: num("half_pay_leave_days").notNull().default(0),
  // Phase 9 (0126): days paid on a 30-day basis in a joining or leaving month; null = the full month
  daysWorked: num("days_worked"),
});
export type PayrollItemRow = typeof payrollItems.$inferSelect;

// ===========================
// Approvals (migration 0108)
// ===========================
export const APPROVAL_DOCUMENT_TYPES = ["bill", "expense_claim", "purchase_order", "payroll_run", "manual_journal", "final_settlement"] as const;
export type ApprovalDocumentType = (typeof APPROVAL_DOCUMENT_TYPES)[number];
export const APPROVER_ROLES = ["accountant", "cfo", "owner"] as const;
export type ApproverRole = (typeof APPROVER_ROLES)[number];

export const approvalRules = pgTable(
  "approval_rules",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    documentType: text("document_type").notNull(),
    name: text("name").notNull(),
    thresholdAed: money("threshold_aed").notNull().default(0),
    approverRoles: text("approver_roles").array().notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    companyTypeIdx: index("idx_approval_rules_company_type_active").on(t.companyId, t.documentType),
  })
);
export type ApprovalRuleRow = typeof approvalRules.$inferSelect;

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    documentType: text("document_type").notNull(),
    documentId: uuid("document_id").notNull(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => approvalRules.id, { onDelete: "restrict" }),
    ruleName: text("rule_name").notNull(),
    requiredRoles: text("required_roles").array().notNull(),
    amountAed: money("amount_aed").notNull().default(0),
    requiredSteps: integer("required_steps").notNull(),
    completedSteps: integer("completed_steps").notNull().default(0),
    // pending | approved | rejected | cancelled
    status: text("status").notNull().default("pending"),
    previousStatus: text("previous_status"),
    requestedBy: uuid("requested_by").references(() => users.id),
    // true when a step was signed by the document's own creator as the sole possible approver (0126)
    selfApproved: boolean("self_approved").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    decidedAt: timestamp("decided_at"),
  },
  (t) => ({
    companyStatusIdx: index("idx_approval_requests_company_status").on(t.companyId, t.status),
    documentIdx: index("idx_approval_requests_document").on(t.documentType, t.documentId),
  })
);
export type ApprovalRequestRow = typeof approvalRequests.$inferSelect;

export const approvalSteps = pgTable(
  "approval_steps",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    requestId: uuid("request_id")
      .notNull()
      .references(() => approvalRequests.id, { onDelete: "cascade" }),
    stepNumber: integer("step_number").notNull(),
    requiredRole: text("required_role").notNull(),
    decidedBy: uuid("decided_by")
      .notNull()
      .references(() => users.id),
    // approved | rejected
    decision: text("decision").notNull(),
    comment: text("comment"),
    selfApproved: boolean("self_approved").notNull().default(false),
    decidedAt: timestamp("decided_at").defaultNow().notNull(),
  },
  (t) => ({
    requestIdx: index("idx_approval_steps_request").on(t.requestId),
  })
);
export type ApprovalStepRow = typeof approvalSteps.$inferSelect;

// ===========================
// Projects and time (migration 0107)
// ===========================
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    contactId: uuid("contact_id").references(() => customerContacts.id, { onDelete: "set null" }),
    // active | on_hold | completed | cancelled
    status: text("status").notNull().default("active"),
    // hourly | non_billable
    billingMethod: text("billing_method").notNull().default("hourly"),
    hourlyRate: money("hourly_rate"),
    currency: text("currency").notNull().default("AED"),
    budgetAmount: money("budget_amount"),
    budgetHours: num("budget_hours"),
    startDate: date("start_date", { mode: "string" }),
    endDate: date("end_date", { mode: "string" }),
    description: text("description"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    companyCodeUnique: unique("projects_company_code_unique").on(t.companyId, t.code),
    companyStatusIdx: index("idx_projects_company_status").on(t.companyId, t.status),
  })
);
export type ProjectRow = typeof projects.$inferSelect;

export const projectTasks = pgTable("project_tasks", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  hourlyRate: money("hourly_rate"),
  isBillable: boolean("is_billable").notNull().default(true),
  // open | done
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type ProjectTaskRow = typeof projectTasks.$inferSelect;

export const timeEntries = pgTable(
  "time_entries",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    taskId: uuid("task_id").references(() => projectTasks.id, { onDelete: "set null" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    entryDate: date("entry_date", { mode: "string" }).notNull(),
    minutes: integer("minutes").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    isBillable: boolean("is_billable").notNull().default(true),
    rate: money("rate"),
    notes: text("notes"),
    billedInvoiceId: uuid("billed_invoice_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    projectDateIdx: index("idx_time_entries_company_project_date").on(t.companyId, t.projectId, t.entryDate),
  })
);
export type TimeEntryRow = typeof timeEntries.$inferSelect;

export const projectExpenses = pgTable(
  "project_expenses",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    // bill_line | expense_claim_item
    sourceType: text("source_type").notNull(),
    billLineItemId: uuid("bill_line_item_id").references(() => billLineItems.id, { onDelete: "cascade" }),
    expenseClaimItemId: uuid("expense_claim_item_id").references(() => expenseClaimItems.id, { onDelete: "cascade" }),
    expenseDate: date("expense_date", { mode: "string" }).notNull(),
    description: text("description").notNull(),
    amountAed: money("amount_aed").notNull(),
    isBillable: boolean("is_billable").notNull().default(false),
    billedInvoiceId: uuid("billed_invoice_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    projectIdx: index("idx_project_expenses_project").on(t.companyId, t.projectId),
  })
);
export type ProjectExpenseRow = typeof projectExpenses.$inferSelect;

// ===========================
// Leave, loans and final settlement (migration 0109)
// ===========================
export const leaveTypes = pgTable(
  "leave_types",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    // full | sick_tiered | half | unpaid | manual
    payPolicy: text("pay_policy").notNull().default("full"),
    annualDays: num("annual_days").notNull().default(0),
    // monthly_service | annual | none
    accrual: text("accrual").notNull().default("annual"),
    carryForwardMaxDays: num("carry_forward_max_days").notNull().default(0),
    allowNegative: boolean("allow_negative").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    companyCodeUnique: unique("leave_types_company_code_unique").on(t.companyId, t.code),
  })
);
export type LeaveTypeRow = typeof leaveTypes.$inferSelect;

export const leaveBalances = pgTable(
  "leave_balances",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "cascade" }),
    leaveYear: integer("leave_year").notNull(),
    openingDays: num("opening_days"),
    adjustmentDays: num("adjustment_days").notNull().default(0),
    note: text("note"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    unique: unique("leave_balances_unique").on(t.employeeId, t.leaveTypeId, t.leaveYear),
  })
);
export type LeaveBalanceOverrideRow = typeof leaveBalances.$inferSelect;

export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "restrict" }),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    days: num("days").notNull(),
    // pending | approved | rejected | cancelled
    status: text("status").notNull().default("pending"),
    reason: text("reason"),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    employeeIdx: index("idx_leave_requests_employee").on(t.companyId, t.employeeId, t.startDate),
  })
);
export type LeaveRequestRow = typeof leaveRequests.$inferSelect;

export const employeeLoans = pgTable("employee_loans", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "restrict" }),
  loanNumber: text("loan_number").notNull(),
  // loan | advance
  kind: text("kind").notNull().default("loan"),
  principal: money("principal").notNull(),
  instalmentCount: integer("instalment_count").notNull(),
  instalmentAmount: money("instalment_amount").notNull(),
  firstPeriodYear: integer("first_period_year").notNull(),
  firstPeriodMonth: integer("first_period_month").notNull(),
  disbursementDate: date("disbursement_date", { mode: "string" }).notNull(),
  paymentAccountId: uuid("payment_account_id")
    .notNull()
    .references(() => accounts.id),
  // active | settled | cancelled
  status: text("status").notNull().default("active"),
  notes: text("notes"),
  journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
  cancelJournalEntryId: uuid("cancel_journal_entry_id").references(() => journalEntries.id),
  repaymentJournalEntryId: uuid("repayment_journal_entry_id").references(() => journalEntries.id),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type EmployeeLoanRow = typeof employeeLoans.$inferSelect;

export const employeeLoanInstallments = pgTable(
  "employee_loan_installments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    loanId: uuid("loan_id")
      .notNull()
      .references(() => employeeLoans.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),
    amount: money("amount").notNull(),
    deductedAmount: money("deducted_amount").notNull().default(0),
    // scheduled | reserved | deducted | settled | cancelled
    status: text("status").notNull().default("scheduled"),
    payrollRunId: uuid("payroll_run_id").references(() => payrollRuns.id, { onDelete: "set null" }),
    payrollItemId: uuid("payroll_item_id").references(() => payrollItems.id, { onDelete: "set null" }),
    settledBySettlementId: uuid("settled_by_settlement_id"),
  },
  (t) => ({
    loanSequenceUnique: unique("employee_loan_installments_unique").on(t.loanId, t.sequence),
  })
);
export type EmployeeLoanInstallmentRow = typeof employeeLoanInstallments.$inferSelect;

export const employeeFinalSettlements = pgTable("employee_final_settlements", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "restrict" }),
  terminationDate: date("termination_date", { mode: "string" }).notNull(),
  // resignation | termination | end_of_contract
  reason: text("reason").notNull().default("resignation"),
  basicSalary: money("basic_salary").notNull().default(0),
  totalWage: money("total_wage").notNull().default(0),
  isGccNational: boolean("is_gcc_national").notNull().default(false),
  yearsOfService: num("years_of_service").notNull().default(0),
  gratuityAmount: money("gratuity_amount").notNull().default(0),
  provisionUsed: money("provision_used").notNull().default(0),
  provisionOverridden: boolean("provision_overridden").notNull().default(false),
  gratuityTrueUp: money("gratuity_true_up").notNull().default(0),
  leaveDays: num("leave_days").notNull().default(0),
  leaveEncashment: money("leave_encashment").notNull().default(0),
  loanRecovered: money("loan_recovered").notNull().default(0),
  otherDeductions: money("other_deductions").notNull().default(0),
  netPayable: money("net_payable").notNull().default(0),
  // draft | posted | paid | void
  status: text("status").notNull().default("draft"),
  notes: text("notes"),
  paymentAccountId: uuid("payment_account_id").references(() => accounts.id),
  paidDate: date("paid_date", { mode: "string" }),
  journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
  paymentJournalEntryId: uuid("payment_journal_entry_id").references(() => journalEntries.id),
  voidJournalEntryId: uuid("void_journal_entry_id").references(() => journalEntries.id),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  // 0128: when a draft was last recalculated
  calculatedAt: timestamp("calculated_at"),
});
export type EmployeeFinalSettlementRow = typeof employeeFinalSettlements.$inferSelect;

// ===========================
// Leave-pay provision per employee (migration 0126): accruals positive, uses and releases negative
// ===========================
export const employeeLeaveProvisions = pgTable(
  "employee_leave_provisions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    payrollRunId: uuid("payroll_run_id").references(() => payrollRuns.id, { onDelete: "set null" }),
    settlementId: uuid("settlement_id").references(() => employeeFinalSettlements.id, { onDelete: "set null" }),
    amount: money("amount").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    employeeIdx: index("idx_employee_leave_provisions_employee").on(t.companyId, t.employeeId),
  })
);
