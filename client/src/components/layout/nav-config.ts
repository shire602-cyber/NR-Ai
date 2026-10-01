import {
  TrendingUp,
  ShoppingCart,
  BookMarked,
  BarChart3,
  Banknote,
  Settings,
  Briefcase,
  Shield,
  FolderArchive,
  ClipboardList,
  Landmark,
  MoreHorizontal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Sidebar navigation for SaaS customers, firm staff and platform admins.
 *
 * Kept in its own module (no React components) so a unit test can assert the
 * shape of the menu: no duplicate destinations, every destination is a real
 * route, and nothing points at a feature that has been switched off.
 *
 * Design: about ten top-level entries for the day-to-day workflow; everything
 * that used to have its own sidebar entry but is used less often lives under
 * one collapsed "More" group so nothing became unreachable.
 */

export interface SubItem {
  key?: string;
  titleKey: string;
  url: string;
  title?: string;
  description?: string;
  testId?: string;
}

export interface NavGroup {
  key: string;
  titleKey: string;
  icon: LucideIcon;
  items: SubItem[];
  /** A group with a url is a direct link (no sub-items). */
  url?: string;
}

export const CUSTOMER_GROUPS: NavGroup[] = [
  {
    key: "sales",
    titleKey: "sales",
    icon: TrendingUp,
    items: [
      { titleKey: "invoices", url: "/invoices" },
      { titleKey: "quotes", url: "/quotes" },
      { titleKey: "creditNotes", url: "/credit-notes" },
      { titleKey: "recurringInvoices", url: "/recurring-invoices" },
      { titleKey: "contacts", url: "/contacts" },
    ],
  },
  {
    key: "purchases",
    titleKey: "purchases",
    icon: ShoppingCart,
    items: [
      { titleKey: "billPay", url: "/bill-pay" },
      { titleKey: "vendorCredits", url: "/vendor-credits" },
      { titleKey: "expenseClaims", url: "/expense-claims" },
      { titleKey: "purchaseOrders", url: "/purchase-orders" },
      { titleKey: "receipts", url: "/receipts" },
    ],
  },
  {
    key: "banking",
    titleKey: "banking",
    icon: Landmark,
    items: [
      { titleKey: "bankReconciliation", url: "/bank-reconciliation" },
      { titleKey: "autoReconcile", url: "/auto-reconcile" },
    ],
  },
  {
    key: "accounting",
    titleKey: "accounting",
    icon: BookMarked,
    items: [
      { titleKey: "chartOfAccounts", url: "/chart-of-accounts" },
      { titleKey: "journal", url: "/journal" },
      { titleKey: "fixedAssets", url: "/fixed-assets" },
      { titleKey: "monthEndClose", url: "/month-end" },
      { titleKey: "exchangeRates", url: "/exchange-rates" },
    ],
  },
  {
    key: "compliance",
    titleKey: "compliance",
    icon: ClipboardList,
    items: [
      { titleKey: "vatFiling", url: "/vat-filing" },
      { titleKey: "vatAutopilot", url: "/vat-autopilot" },
      { titleKey: "corporateTax", url: "/corporate-tax" },
      { titleKey: "taxReturnArchive", url: "/tax-return-archive" },
    ],
  },
  {
    key: "payroll",
    titleKey: "hrPayroll",
    icon: Banknote,
    url: "/payroll",
    items: [],
  },
  {
    key: "reports",
    titleKey: "reportsSection",
    icon: BarChart3,
    url: "/reports",
    items: [],
  },
  {
    key: "documents",
    titleKey: "documentVault",
    icon: FolderArchive,
    url: "/document-vault",
    items: [],
  },
  {
    key: "settings",
    titleKey: "settings",
    icon: Settings,
    items: [
      { titleKey: "companySettings", url: "/settings/company" },
      { titleKey: "teamManagement", url: "/team" },
      { titleKey: "subscription", url: "/subscription" },
      { titleKey: "integrations", url: "/integrations" },
    ],
  },
];

/**
 * Everything that has a sidebar entry but is not part of the daily workflow.
 * One collapsed group at the bottom; it opens by itself when the current page
 * lives inside it.
 */
export const MORE_GROUP: NavGroup = {
  key: "more",
  titleKey: "navMore",
  icon: MoreHorizontal,
  items: [
    { titleKey: "aiCfo", url: "/ai-cfo" },
    { titleKey: "paymentChasing", url: "/payment-chasing" },
    { titleKey: "invoiceTemplates", url: "/invoice-templates" },
    { titleKey: "receiptAutopilot", url: "/receipt-autopilot" },
    { titleKey: "inventory", url: "/inventory" },
    { titleKey: "reconciliationRules", url: "/reconciliation-rules" },
    { titleKey: "costCenters", url: "/cost-centers" },
    { titleKey: "complianceCalendar", url: "/compliance-calendar" },
    { titleKey: "documentVersions", url: "/document-versions" },
    { titleKey: "companyProfile", url: "/company-profile" },
    { titleKey: "notificationPreferences", url: "/notification-preferences" },
    { titleKey: "webhooks", url: "/developer-settings" },
    { titleKey: "backupRestore", url: "/backup-restore" },
    { titleKey: "history", url: "/history" },
  ],
};

export const NRA_GROUP: NavGroup = {
  key: "nra",
  titleKey: "nraCenter",
  icon: Briefcase,
  items: [
    { titleKey: "firmCommandCenter", url: "/firm/command-center" },
    { titleKey: "valueOps", url: "/firm/value-ops" },
    { titleKey: "clientPortfolio", url: "/firm/clients" },
    { titleKey: "staffManagement", url: "/firm/staff" },
    { titleKey: "healthDashboard", url: "/firm/health" },
    { titleKey: "communications", url: "/firm/comms" },
    { titleKey: "documentChasing", url: "/firm/document-chasing" },
    { titleKey: "emailIntake", url: "/firm/email-intake" },
  ],
};

export const ADMIN_GROUP: NavGroup = {
  key: "admin",
  titleKey: "adminPanel",
  icon: Shield,
  items: [
    { titleKey: "adminDashboard", url: "/admin/dashboard" },
    { titleKey: "clientManagement", url: "/admin/clients" },
    { titleKey: "clientDocuments", url: "/admin/documents" },
    { titleKey: "userInvitations", url: "/admin/invitations" },
    { titleKey: "clientImport", url: "/admin/import" },
    { titleKey: "userManagement", url: "/admin/users" },
    { titleKey: "activityLogs", url: "/admin/activity-logs" },
    { titleKey: "systemSettings", url: "/admin" },
  ],
};

/** The always-visible Dashboard entry above the groups. */
export const DASHBOARD_URL = "/dashboard";

/**
 * Routes of features that are switched off. No navigation entry may point at
 * one of them (enforced by tests/unit/navigation-config.test.ts). Add a path
 * here when a feature is hidden; remove it when the feature ships.
 */
export const HIDDEN_FEATURE_ROUTES: readonly string[] = [
  "/api-keys", // API keys: no public API verifies them (POST returns 501)
  "/ecommerce", // Shopify / WooCommerce sync: not built (returns 501)
];

/** Destinations of one group (a direct-link group counts as one). */
export function destinationsOf(group: NavGroup): string[] {
  return group.url ? [group.url] : group.items.map((item) => item.url);
}

/** Every visible destination for a customer, excluding the "More" group. */
export function primaryCustomerDestinations(): string[] {
  return [DASHBOARD_URL, ...CUSTOMER_GROUPS.flatMap(destinationsOf)];
}
