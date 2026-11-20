/**
 * Canonical firm access model — single source of truth shared by the server
 * middleware (requireNraAccess / requireFirmAccess) and the client UI
 * (sidebar, routes, command palette) so the two can never disagree about who
 * sees the firm workspace.
 *
 * Two axes (W5-D, R15-12 / R15-13):
 *
 * - NR firm staff carry `users.firm_role` (legacy column, mirrored into
 *   `firm_members`). Only NR staff ever have it set, so every synchronous
 *   check below that reads `firmRole` is an *NR* check. NR-only surfaces
 *   (WhatsApp, document chasing, email intake, SaaS prospects, growth ops)
 *   stay keyed on it.
 * - Staff of other accounting firms live in `firm_members` only (their
 *   `users.firm_role` stays NULL), so they can never pick up a legacy NR
 *   bypass. The practice tools resolve them with requireFirmAccess().
 *
 * Firm roles and their permissions are the table below. firm_owner sees every
 * client of the firm; every other role sees only the clients it is assigned
 * to (firm_staff_assignments).
 */

export const FIRM_ROLES = ["firm_owner", "firm_admin", "preparer", "reviewer", "viewer"] as const;
export type FirmRole = (typeof FIRM_ROLES)[number];

/** Legacy full-privilege NR staff roles (bypass company role checks). */
export const NRA_FIRM_ROLES = ["firm_owner", "firm_admin"] as const;
export type NraFirmRole = (typeof NRA_FIRM_ROLES)[number];

export const FIRM_PERMISSIONS = [
  "firm.clients.read",
  "firm.clients.all",
  "firm.clients.create",
  "firm.clients.write",
  "firm.clients.archive",
  "firm.clients.link",
  "firm.staff.manage",
  "firm.bulk.run",
  "firm.workpapers.prepare",
  "firm.workpapers.review",
  "firm.workflow.manage",
  "firm.time.track",
  "firm.billing.manage",
  "firm.leads.manage",
  "firm.filing.record",
] as const;
export type FirmPermission = (typeof FIRM_PERMISSIONS)[number];

/**
 * Named handles for the permissions the firm UI gates controls on, so client code reads these
 * (typed, one source) instead of repeating the permission strings.
 */
export const FIRM_UI_PERMISSIONS = {
  seesAllClients: "firm.clients.all",
  createClient: "firm.clients.create",
  linkClient: "firm.clients.link",
  manageStaff: "firm.staff.manage",
} as const satisfies Record<string, FirmPermission>;

/** Role → permissions. A permission a role does not list is denied. */
export const FIRM_ROLE_PERMISSIONS: Record<FirmRole, readonly FirmPermission[]> = {
  firm_owner: FIRM_PERMISSIONS,
  firm_admin: [
    "firm.clients.read",
    "firm.clients.create",
    "firm.clients.write",
    "firm.workpapers.prepare",
    "firm.workpapers.review",
    "firm.workflow.manage",
    "firm.time.track",
    "firm.billing.manage",
    "firm.leads.manage",
    "firm.filing.record",
  ],
  preparer: [
    "firm.clients.read",
    "firm.clients.write",
    "firm.workpapers.prepare",
    "firm.time.track",
  ],
  reviewer: [
    "firm.clients.read",
    "firm.workpapers.review",
    "firm.time.track",
    "firm.filing.record",
  ],
  viewer: ["firm.clients.read"],
};

/**
 * Company role a firm staff member receives in a client's books when they are
 * assigned (company_users row created by the assignment service). The core
 * company RBAC then enforces what they may do inside the client file.
 */
export const FIRM_ROLE_COMPANY_ROLE: Record<FirmRole, "accountant" | "bookkeeper" | "viewer"> = {
  firm_owner: "accountant",
  firm_admin: "accountant",
  preparer: "bookkeeper",
  reviewer: "accountant",
  viewer: "viewer",
};

export const FIRM_ROLE_LABELS: Record<FirmRole, { en: string; ar: string }> = {
  firm_owner: { en: "Firm owner", ar: "مالك المكتب" },
  firm_admin: { en: "Firm admin", ar: "مسؤول المكتب" },
  preparer: { en: "Preparer", ar: "مُعِدّ" },
  reviewer: { en: "Reviewer", ar: "مراجِع" },
  viewer: { en: "Viewer (read-only)", ar: "مشاهد (قراءة فقط)" },
};

export interface NraAccessUser {
  isAdmin?: boolean | null;
  firmRole?: string | null;
}

export function isFirmRole(role: string | null | undefined): role is FirmRole {
  return FIRM_ROLES.includes((role ?? "") as FirmRole);
}

/** Legacy full-privilege NR role (firm_owner / firm_admin). */
export function isNraFirmRole(role: string | null | undefined): role is NraFirmRole {
  return NRA_FIRM_ROLES.includes((role ?? "") as NraFirmRole);
}

export function firmRoleHasPermission(
  role: string | null | undefined,
  permission: FirmPermission
): boolean {
  if (!isFirmRole(role)) return false;
  return FIRM_ROLE_PERMISSIONS[role].includes(permission);
}

export function firmPermissionsForRole(role: string | null | undefined): FirmPermission[] {
  return isFirmRole(role) ? [...FIRM_ROLE_PERMISSIONS[role]] : [];
}

/** True when the role may change anything at all (viewer is read-only). */
export function firmRoleCanWrite(role: string | null | undefined): boolean {
  return firmPermissionsForRole(role).some((p) => p !== "firm.clients.read");
}

/** firm_owner sees every client of the firm; other roles only assigned ones. */
export function firmRoleSeesAllClients(role: string | null | undefined): boolean {
  return firmRoleHasPermission(role, "firm.clients.all");
}

/** Maker side of the VAT workpaper maker-checker (prepare rows, submit). */
export function canPrepareFirmWorkpaper(role: string | null | undefined): boolean {
  return firmRoleHasPermission(role, "firm.workpapers.prepare");
}

/** Checker side of the VAT workpaper maker-checker (review, approve, file). */
export function canReviewFirmWorkpaper(role: string | null | undefined): boolean {
  return firmRoleHasPermission(role, "firm.workpapers.review");
}

/** NR firm workspace (platform admins and NR staff with any firm role). */
export function canAccessNraCenter(user: NraAccessUser | null | undefined): boolean {
  if (!user) return false;
  return user.isAdmin === true || isFirmRole(user.firmRole);
}

/**
 * Whether the NRA Center group should appear in the sidebar right now.
 *
 * Access (canAccessNraCenter) says the user is *allowed* into the firm
 * workspace; this adds the active-context rule: the firm-level group is hidden
 * while the user has drilled into a specific client company's file, because
 * those tools belong at the firm level, not inside a single client. The user
 * returns to the firm via the "Firm workspace" entry in the company switcher.
 *
 * This does NOT replace server-side authorization (requireNraAccess) — it only
 * controls visibility. The API stays protected regardless of context.
 */
export function shouldShowNraCenterNav(
  user: NraAccessUser | null | undefined,
  opts: { inClientContext: boolean }
): boolean {
  return canAccessNraCenter(user) && !opts.inClientContext;
}

/**
 * True when the user may see/manage ALL client companies (platform admin or
 * firm_owner). firm_admin, preparer, reviewer and viewer see only assigned
 * clients.
 */
export function hasFullNraScope(user: NraAccessUser | null | undefined): boolean {
  if (!user) return false;
  return user.isAdmin === true || user.firmRole === "firm_owner";
}
