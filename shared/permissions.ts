/**
 * Company roles and the permission matrix (R01-02, R01-03, R01-14).
 *
 * Single source of truth shared by the server (companyRolePolicy middleware,
 * requirePermission, team routes, migration 0092's role check constraint) and
 * the client (role picker, UI gating). Roles are per company membership
 * (company_users.role); NR firm roles (users.firm_role) and platform admins
 * are a separate axis handled by shared/access.ts.
 */
import { z } from "zod";

export const COMPANY_ROLES = [
  "owner",
  "admin",
  "accountant",
  "bookkeeper",
  "approver",
  "employee",
  "viewer",
] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

export const PERMISSIONS = [
  "reports.read",
  "documents.write",
  "documents.approve",
  "ledger.post",
  "payments.release",
  "payroll.manage",
  "payroll.approve",
  "tax.submit",
  "settings.company",
  "company.delete",
  "team.manage",
  "billing.manage",
  "backups.manage",
  "period.lock",
  "period.unlock",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = PERMISSIONS;

/**
 * Role → permissions. Keep this table small and explicit; a permission a role
 * does not list is denied.
 */
export const ROLE_PERMISSIONS: Record<CompanyRole, readonly Permission[]> = {
  owner: ALL,
  admin: ALL.filter((p) => p !== "billing.manage" && p !== "company.delete"),
  accountant: [
    "reports.read",
    "documents.write",
    "documents.approve",
    "ledger.post",
    "payroll.manage",
    "tax.submit",
    "period.lock",
  ],
  bookkeeper: ["reports.read", "documents.write", "ledger.post"],
  approver: ["reports.read", "documents.approve", "payments.release", "payroll.approve"],
  employee: ["reports.read", "documents.write"],
  viewer: ["reports.read"],
};

export const zCompanyRole = z.enum(COMPANY_ROLES, {
  errorMap: () => ({ message: `Role must be one of: ${COMPANY_ROLES.join(", ")}` }),
});

export function isCompanyRole(value: unknown): value is CompanyRole {
  return typeof value === "string" && (COMPANY_ROLES as readonly string[]).includes(value);
}

/**
 * Map a stored role string (including pre-0092 free text) onto the enum.
 * Mirrors the CASE expression in migrations/0092_w2c_identity.sql: `cfo` was
 * the old finance-lead role and becomes `admin`; anything unknown becomes the
 * least-privileged writing role, `employee`.
 */
export function normalizeCompanyRole(raw: string | null | undefined): CompanyRole {
  const value = (raw ?? "").trim().toLowerCase();
  if (isCompanyRole(value)) return value;
  if (value === "cfo" || value === "manager") return "admin";
  if (value === "readonly" || value === "read_only" || value === "read-only") return "viewer";
  return "employee";
}

export function roleHasPermission(
  role: string | null | undefined,
  permission: Permission
): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[normalizeCompanyRole(role)].includes(permission);
}

export function roleHasAnyPermission(
  role: string | null | undefined,
  permissions: readonly Permission[]
): boolean {
  return permissions.some((p) => roleHasPermission(role, p));
}

export function permissionsForRole(role: string | null | undefined): Permission[] {
  if (!role) return [];
  return [...ROLE_PERMISSIONS[normalizeCompanyRole(role)]];
}

/** Roles a member holding `actorRole` may grant. Only owners create owners. */
export function grantableRoles(actorRole: string | null | undefined): CompanyRole[] {
  const role = actorRole ? normalizeCompanyRole(actorRole) : null;
  if (role === "owner") return [...COMPANY_ROLES];
  if (role && roleHasPermission(role, "team.manage")) {
    return COMPANY_ROLES.filter((r) => r !== "owner");
  }
  return [];
}

export const COMPANY_ROLE_LABELS: Record<CompanyRole, { en: string; ar: string }> = {
  owner: { en: "Owner", ar: "المالك" },
  admin: { en: "Admin", ar: "مسؤول" },
  accountant: { en: "Accountant", ar: "محاسب" },
  bookkeeper: { en: "Bookkeeper", ar: "ماسك دفاتر" },
  approver: { en: "Approver", ar: "معتمِد" },
  employee: { en: "Employee", ar: "موظف" },
  viewer: { en: "Viewer (read-only)", ar: "مشاهد (قراءة فقط)" },
};

export const COMPANY_ROLE_DESCRIPTIONS: Record<CompanyRole, { en: string; ar: string }> = {
  owner: {
    en: "Full access, including billing and deleting the company.",
    ar: "وصول كامل، بما في ذلك الفوترة وحذف الشركة.",
  },
  admin: {
    en: "Manages settings, team, backups and every accounting task.",
    ar: "يدير الإعدادات والفريق والنسخ الاحتياطية وكل المهام المحاسبية.",
  },
  accountant: {
    en: "Posts to the ledger, approves documents, runs payroll and VAT, locks periods.",
    ar: "يرحّل القيود ويعتمد المستندات ويدير الرواتب وضريبة القيمة المضافة ويقفل الفترات.",
  },
  bookkeeper: {
    en: "Records documents and posts entries; cannot approve.",
    ar: "يسجل المستندات ويرحّل القيود؛ لا يمكنه الاعتماد.",
  },
  approver: {
    en: "Approves documents, payroll and payment releases; read-only otherwise.",
    ar: "يعتمد المستندات والرواتب وإصدار المدفوعات؛ قراءة فقط فيما عدا ذلك.",
  },
  employee: {
    en: "Creates receipts, expense claims and drafts; cannot post or approve.",
    ar: "ينشئ الإيصالات ومطالبات المصروفات والمسودات؛ لا يمكنه الترحيل أو الاعتماد.",
  },
  viewer: {
    en: "Reads reports and records; cannot change anything.",
    ar: "يطلع على التقارير والسجلات؛ لا يمكنه تغيير أي شيء.",
  },
};
