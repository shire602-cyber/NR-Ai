/**
 * Phase 8 D2 (purchases, projects, people): response types of the new endpoints and the pure helpers the screens
 * share. No React, no fetching: everything here is unit-tested in tests/unit/purchasing-hr-client.test.ts.
 */

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

const ROLE_RANK: Record<string, number> = { employee: 0, accountant: 1, cfo: 2, owner: 3 };

/** HR records (leave, loans, settlements) are written by an accountant, CFO or owner. */
export function canWriteHrRole(role: string | null | undefined): boolean {
  return (ROLE_RANK[role ?? ""] ?? -1) >= ROLE_RANK.accountant;
}

/** Approval rules belong to the company owner. */
export function isOwnerRole(role: string | null | undefined): boolean {
  return role === "owner";
}

// ---------------------------------------------------------------------------
// Contacts and vendors
// ---------------------------------------------------------------------------

export type ContactType = "customer" | "vendor" | "both";

export interface VendorContact {
  id: string;
  name: string;
  /** Rows from before the type existed have none: they are customers. */
  contactType?: ContactType | null;
  trnNumber?: string | null;
  email?: string | null;
}

const normalizeName = (value: string): string => value.trim().replace(/\s+/g, " ").toLowerCase();

/** Contacts that may appear in a vendor picker: vendor and both, never customer-only. */
export function vendorContactsOf<T extends VendorContact>(contacts: readonly T[]): T[] {
  return contacts.filter((c) => c.contactType === "vendor" || c.contactType === "both");
}

export function filterVendors<T extends VendorContact>(vendors: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...vendors];
  return vendors.filter((v) => [v.name, v.trnNumber, v.email].some((field) => (field ?? "").toLowerCase().includes(q)));
}

/** The vendor whose name equals the typed one (case and spacing ignored), or null. */
export function exactVendorMatch<T extends VendorContact>(vendors: readonly T[], typed: string): T | null {
  const wanted = normalizeName(typed);
  if (!wanted) return null;
  return vendors.find((v) => normalizeName(v.name) === wanted) ?? null;
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export type ApprovalDocumentType = "bill" | "expense_claim" | "purchase_order" | "payroll_run" | "manual_journal";
export const APPROVAL_DOCUMENT_TYPES: readonly ApprovalDocumentType[] = ["bill", "expense_claim", "purchase_order", "payroll_run", "manual_journal"];
export type ApproverRole = "accountant" | "cfo" | "owner";

export interface ApprovalRule {
  id: string;
  documentType: ApprovalDocumentType;
  name: string;
  thresholdAed: number | string;
  approverRoles: ApproverRole[];
  isActive: boolean;
}

export interface ApprovalQueueRow {
  requestId: string | null;
  documentType: ApprovalDocumentType;
  documentId: string;
  reference: string;
  counterparty: string;
  amountAed: number;
  completedSteps: number;
  requiredSteps: number;
  nextRole: string | null;
  status: string;
  canAct: boolean;
  createdAt: string | null;
}

export interface ApprovalStep {
  stepNumber: number;
  requiredRole: string;
  decidedBy: string;
  decidedByName: string | null;
  decision: "approved" | "rejected";
  comment: string | null;
  decidedAt: string;
}

export interface ApprovalRequestHistory {
  id: string;
  status: string;
  ruleName: string;
  requiredRoles: string[];
  requiredSteps: number;
  completedSteps: number;
  amountAed: number | string;
  createdAt: string;
  steps: ApprovalStep[];
}

export interface ApprovalHistoryResponse {
  documentType: ApprovalDocumentType;
  documentId: string;
  status: string;
  requests: ApprovalRequestHistory[];
}

/** The approve action of each document type stays on that document's own route; the queue calls it. */
export function approvalActionPath(type: ApprovalDocumentType, id: string): string {
  switch (type) {
    case "bill":
      return `/api/bills/${id}/approve`;
    case "expense_claim":
      return `/api/expense-claims/${id}/approve`;
    case "purchase_order":
      return `/api/purchase-orders/${id}/approve`;
    case "payroll_run":
      return `/api/payroll-runs/${id}/approve`;
    case "manual_journal":
      return `/api/journal/${id}/post`;
  }
}

export function approvalDocumentHref(type: ApprovalDocumentType, id?: string): string {
  switch (type) {
    case "bill":
      return "/bill-pay";
    case "expense_claim":
      return "/expense-claims";
    case "purchase_order":
      return "/purchase-orders";
    case "payroll_run":
      return "/payroll";
    case "manual_journal":
      return id ? `/journal/${id}` : "/journal";
  }
}

export type ApprovalErrorKind = "required" | "alreadySigned" | "self" | "inProgress";

export function approvalErrorKind(code: string | undefined | null): ApprovalErrorKind | null {
  switch (code) {
    case "APPROVAL_REQUIRED":
      return "required";
    case "APPROVER_ALREADY_SIGNED":
      return "alreadySigned";
    case "SELF_APPROVAL":
      return "self";
    case "APPROVAL_IN_PROGRESS":
      return "inProgress";
    default:
      return null;
  }
}

export function describeRuleRoles(roles: readonly string[], roleLabel: (role: string) => string, thenWord: string): string {
  return roles.map(roleLabel).join(` ${thenWord} `);
}

/**
 * What an approve call returns when more signatures are still needed: `pending_approval` for bills, claims, purchase
 * orders and payroll runs, a journal that stays `draft` until its last signature.
 */
export interface PendingApprovalBody {
  status: string;
  approval: { requestId: string; completedSteps: number; requiredSteps: number; nextRole: string | null };
}

export function isPendingApprovalBody(body: unknown): body is PendingApprovalBody {
  if (!body || typeof body !== "object") return false;
  const approval = (body as { approval?: { completedSteps?: unknown; requiredSteps?: unknown } }).approval;
  return !!approval && typeof approval.completedSteps === "number" && typeof approval.requiredSteps === "number" && approval.completedSteps < approval.requiredSteps;
}

// ---------------------------------------------------------------------------
// Projects and time
// ---------------------------------------------------------------------------

export type ProjectStatus = "active" | "on_hold" | "completed" | "cancelled";

export interface Project {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  contactId: string | null;
  contactName: string | null;
  status: ProjectStatus;
  billingMethod: "hourly" | "non_billable";
  hourlyRate: number | null;
  currency: string;
  budgetAmount: number | null;
  budgetHours: number | null;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
}

export interface ProjectTask {
  id: string;
  projectId: string;
  name: string;
  hourlyRate: number | null;
  isBillable: boolean;
  status: "open" | "done";
}

export interface TimeEntry {
  id: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  taskId: string | null;
  taskName: string | null;
  userId: string;
  userName: string | null;
  entryDate: string;
  minutes: number;
  hours: number;
  startedAt: string | null;
  endedAt: string | null;
  isBillable: boolean;
  rate: number | null;
  notes: string | null;
  billedInvoiceId: string | null;
  billedInvoiceNumber: string | null;
  billed: boolean;
  running: boolean;
}

export interface UnbilledTime extends TimeEntry {
  amount: number;
}

export interface UnbilledExpense {
  id: string;
  sourceType: "bill_line" | "expense_claim_item";
  expenseDate: string;
  description: string;
  amountAed: number;
}

export interface UnbilledResponse {
  timeEntries: UnbilledTime[];
  expenses: UnbilledExpense[];
  unbilledHours: number;
  unbilledAmount: number;
  unbilledExpenses: number;
}

export interface ProjectProfitability {
  revenue: number;
  costs: number;
  margin: number;
  marginPct: number | null;
  hours: { total: number; billable: number; billed: number; unbilled: number };
  budget: { amount: number | null; hours: number | null; usedPct: number | null; hoursUsedPct: number | null };
}

export interface ProjectInvoiceResult {
  id: string;
  number: string;
  projectId: string;
  lineCount: number;
}

/**
 * Hours the way people type them: `1.5`, `1:30`, `90m`, `2h`, `2h 15m`. Returns whole minutes between 1 and 1440,
 * or null for anything else (a day is at most 24 hours).
 */
export function parseDurationInput(text: string): number | null {
  const value = text.trim().toLowerCase();
  if (!value) return null;
  let minutes: number | null = null;
  let m: RegExpMatchArray | null;
  if ((m = value.match(/^(\d+):([0-5]?\d)$/))) minutes = Number(m[1]) * 60 + Number(m[2]);
  else if ((m = value.match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/)) && (m[1] !== undefined || m[2] !== undefined)) {
    minutes = Math.round(Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0));
  } else if ((m = value.match(/^\d+(?:\.\d+)?$/))) minutes = Math.round(Number(value) * 60);
  if (minutes === null || !Number.isFinite(minutes) || minutes < 1 || minutes > 1440) return null;
  return minutes;
}

export function splitDuration(totalMinutes: number): { hours: number; minutes: number } {
  const safe = Math.max(0, Math.floor(totalMinutes));
  return { hours: Math.floor(safe / 60), minutes: safe % 60 };
}

/** Whole minutes a timer has run (never negative). */
export function timerElapsedMinutes(startedAtMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - startedAtMs) / 60_000));
}

export function clampPct(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

// ---------------------------------------------------------------------------
// Vendor statement and ageing detail
// ---------------------------------------------------------------------------

export interface VendorStatementLine {
  date: string;
  type: "bill" | "vendor_credit" | "payment";
  reference: string;
  currency: string;
  documentAmount: number;
  debit: number;
  credit: number;
  balance: number;
}

export interface StatementAgingTotals {
  current: number;
  days1to30: number;
  days31to60: number;
  days61to90: number;
  over90: number;
  total: number;
}

export interface VendorStatementResponse {
  from: string;
  to: string;
  openingBalance: number;
  lines: VendorStatementLine[];
  totalDebits: number;
  totalCredits: number;
  closingBalance: number;
  aging: StatementAgingTotals;
  contact: { id: string; name: string; email?: string | null };
}

export interface AgeingDetailRow {
  type: "bill" | "credit";
  billId: string | null;
  creditId: string | null;
  number: string | null;
  billDate: string;
  dueDate: string | null;
  currency: string;
  outstanding: number;
  outstandingAed: number;
  daysPastDue: number;
  bucket: string;
}

export interface AgeingDetailResponse {
  asOf: string;
  vendors: Array<{ vendorId: string | null; name: string; rows: AgeingDetailRow[]; totals: StatementAgingTotals }>;
  totals: StatementAgingTotals;
}

// ---------------------------------------------------------------------------
// Leave, loans, settlement, register
// ---------------------------------------------------------------------------

export interface LeaveType {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  payPolicy: "full" | "sick_tiered" | "half" | "unpaid" | "manual";
  annualDays: number;
  accrual: "monthly_service" | "annual" | "none";
  carryForwardMaxDays: number;
  allowNegative: boolean;
  isActive: boolean;
}

export interface LeaveBalance {
  employeeId: string;
  employeeName: string;
  leaveTypeId: string;
  code: string;
  year: number;
  opening: number;
  accrued: number;
  adjustment: number;
  taken: number;
  pending: number;
  balance: number;
  available: number;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  leaveTypeId: string;
  typeCode: string;
  typeNameEn: string;
  typeNameAr: string;
  payPolicy: string;
  startDate: string;
  endDate: string;
  days: number;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reason: string | null;
}

export interface LoanInstalment {
  id?: string;
  sequence: number;
  periodYear: number;
  periodMonth: number;
  amount: number;
  deductedAmount?: number;
  status?: string;
}

export interface LoanPreview {
  employeeId: string;
  monthlyWage: number;
  maxInstalment: number;
  instalmentAmount: number;
  withinCap: boolean;
  schedule: Array<{ sequence: number; periodYear: number; periodMonth: number; amount: number }>;
}

export interface EmployeeLoan {
  id: string;
  employeeId: string;
  employeeName: string;
  loanNumber: string;
  kind: "loan" | "advance";
  principal: number;
  instalmentCount: number;
  instalmentAmount: number;
  firstPeriodYear: number;
  firstPeriodMonth: number;
  disbursementDate: string;
  status: "active" | "settled" | "cancelled";
  outstanding?: number;
  instalments?: LoanInstalment[];
}

export type SettlementStatus = "draft" | "posted" | "paid" | "void";

export interface SettlementAmounts {
  gratuityAmount: number;
  provisionUsed: number;
  gratuityTrueUp: number;
  leaveEncashment: number;
  loanRecovered: number;
  otherDeductions: number;
  netPayable: number;
}

export interface SettlementPreview extends SettlementAmounts {
  employeeId: string;
  employeeName: string;
  terminationDate: string;
  reason: string;
  isGccNational: boolean;
  basicSalary: number;
  totalWage: number;
  yearsOfService: number;
  gratuityEligible: boolean;
  leaveDays: number;
  provisionAccrued: number;
  provisionBalance: number;
  warnings: string[];
}

export interface FinalSettlement extends SettlementAmounts {
  id: string;
  employeeId: string;
  employeeName: string;
  terminationDate: string;
  reason: string;
  basicSalary: number;
  totalWage: number;
  yearsOfService: number;
  leaveDays: number;
  status: SettlementStatus;
  paidDate: string | null;
}

export interface RegisterRow {
  employeeId: string;
  employeeNumber: string | null;
  employeeName: string;
  department: string | null;
  basic: number;
  housing: number;
  transport: number;
  other: number;
  overtime: number;
  gross: number;
  leaveDeduction: number;
  loanDeduction: number;
  deductions: number;
  pensionEmployee: number;
  net: number;
  pensionEmployer: number;
  gratuityAccrual: number;
  unpaidLeaveDays: number;
  halfPayLeaveDays: number;
}

export interface PayrollRegister {
  runId: string;
  periodMonth: number;
  periodYear: number;
  status: string;
  rows: RegisterRow[];
  totals: Omit<RegisterRow, "employeeId" | "employeeNumber" | "employeeName" | "department">;
  journalTieOut: {
    available: boolean;
    entryId: string | null;
    ok: boolean;
    checks: Array<{ label: string; account: string; side: "debit" | "credit"; register: number; ledger: number; ok: boolean }>;
  };
}

export interface LedgerAccountLite {
  id: string;
  code: string;
  nameEn: string;
  nameAr?: string | null;
  type: string;
  subType?: string | null;
  isActive?: boolean;
  isArchived?: boolean;
}

/** Accounts a loan, a settlement or a repayment may be paid from: active cash and bank accounts (same test as the server's reports). */
export function isCashOrBankAccount(a: LedgerAccountLite): boolean {
  if (a.type !== "asset" || a.isActive === false || a.isArchived === true) return false;
  if (a.subType === "cash" || a.subType === "bank") return true;
  if (a.code >= "1010" && a.code <= "1039") return true;
  const name = a.nameEn.toLowerCase();
  return name.includes("cash") || name.includes("bank") || name.includes("petty");
}

/** Calendar days from start to end inclusive: the default length of a leave request. 0 when the range is not valid. */
export function inclusiveCalendarDays(startYmd: string, endYmd: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(endYmd)) return 0;
  const start = Date.parse(`${startYmd}T00:00:00Z`);
  const end = Date.parse(`${endYmd}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}

export function periodLabel(year: number, month: number): string {
  return `${String(month).padStart(2, "0")}/${year}`;
}
