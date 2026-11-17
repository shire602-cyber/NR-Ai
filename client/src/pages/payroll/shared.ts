import { useTranslation, formatMessage } from "@/lib/i18n";
import { getAuthHeaders } from "@/lib/auth";
import { apiUrl } from "@/lib/api";

// ─── Row types (snake_case, as the payroll API returns them) ─────────────────

export interface Employee {
  id: string;
  employee_number: string | null;
  full_name: string;
  full_name_ar: string | null;
  nationality: string | null;
  email: string | null;
  passport_number: string | null;
  passport_expiry: string | null;
  visa_number: string | null;
  visa_expiry: string | null;
  labor_card_number: string | null;
  labor_card_expiry: string | null;
  mol_person_id: string | null;
  emirates_id: string | null;
  emirates_id_expiry: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  iban: string | null;
  routing_code: string | null;
  department: string | null;
  designation: string | null;
  contract_type: string | null;
  contract_start: string | null;
  contract_end: string | null;
  join_date: string | null;
  salary_currency: string | null;
  basic_salary: string;
  housing_allowance: string;
  transport_allowance: string;
  other_allowance: string;
  opening_gratuity_provision?: string | null;
  opening_gratuity_as_of?: string | null;
  pension_scheme?: string | null;
  total_salary: string;
  status: string;
  archived_at: string | null;
  termination_date: string | null;
}

export interface PayrollRun {
  id: string;
  created_by?: string | null;
  calculated_by?: string | null;
  period_month: number;
  period_year: number;
  status: string;
  total_basic: string;
  total_allowances: string;
  total_deductions: string;
  total_net: string;
  employee_count: number;
  journal_entry_id: string | null;
  payment_journal_entry_id: string | null;
  sif_file_content: string | null;
  sif_file_name: string | null;
  wps_status: string;
  wps_status_notes: string | null;
}

export interface PayrollItem {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_number: string | null;
  basic_salary: string;
  housing_allowance: string;
  transport_allowance: string;
  other_allowance: string;
  overtime: string;
  overtime_hours: string;
  deductions: string;
  deduction_notes: string | null;
  pension_employee: string;
  gratuity_accrual: string;
  unpaid_leave_days: string;
  paid_leave_days: string;
  unpaid_leave_deduction: string;
  net_salary: string;
  salary_currency: string;
  status: string;
}

export interface SifIssue {
  scope: "employer" | "employee";
  employeeId?: string;
  employeeName?: string;
  field: string;
  message: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Translate an "hr.*" key; `values` fills {placeholders}. */
export function useHr() {
  const { t, locale } = useTranslation();
  const tx = (key: string, values?: Record<string, string | number>) => {
    const raw = t[key] ?? key;
    return values ? formatMessage(raw, values) : raw;
  };
  return { tx, locale };
}

export function monthName(month: number, locale: string): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-AE", { month: "long" }).format(
    new Date(Date.UTC(2000, month - 1, 1))
  );
}

export function dayOnly(value: string | null | undefined): string {
  return value ? String(value).slice(0, 10) : "";
}

/** Download an authenticated file endpoint; returns the server error message on failure. */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const response = await fetch(apiUrl(path), { headers: getAuthHeaders(), credentials: "include" });
  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = await response.json();
      message = body?.message ?? message;
    } catch {
      // not JSON
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const match = response.headers.get("Content-Disposition")?.match(/filename="(.+)"/);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = match ? match[1] : fallbackName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Accounts a salary or settlement can be paid from: cash / bank only, like bill payments (X4/J3). */
export function isCashOrBankAccount(a: {
  type: string;
  subType?: string | null;
  code: string;
  isArchived?: boolean;
  isActive?: boolean;
}): boolean {
  return (
    a.type === "asset" &&
    !a.isArchived &&
    a.isActive !== false &&
    (a.subType === "cash" || a.subType === "bank" || ["1010", "1020", "1030"].includes(a.code))
  );
}
