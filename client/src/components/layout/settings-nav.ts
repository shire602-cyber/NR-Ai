export interface SettingsNavItem {
  key: string;
  /** i18n key of the label. */
  labelKey: string;
  href: string;
  /** Other routes that belong to this section (highlight the item when on them). */
  matches?: string[];
  testId?: string;
}

/**
 * Spec 3.5 / 3.15: one settings area with a left sub-nav instead of 12 sidebar children.
 * Routes are the existing ones (no route changes); the sidebar's single "Settings" entry opens
 * `/settings/company`.
 */
export const SETTINGS_NAV: SettingsNavItem[] = [
  {
    key: "company",
    labelKey: "components.ui.settingsNav.company",
    href: "/settings/company",
    matches: ["/company-profile"],
  },
  { key: "team", labelKey: "components.ui.settingsNav.team", href: "/team" },
  { key: "security", labelKey: "components.ui.settingsNav.security", href: "/settings/security" },
  {
    key: "documents",
    labelKey: "components.ui.settingsNav.documents",
    href: "/invoice-templates",
  },
  {
    key: "numbering",
    labelKey: "components.ui.settingsNav.numbering",
    href: "/settings/numbering",
  },
  {
    key: "approvals",
    labelKey: "components.ui.settingsNav.approvals",
    href: "/settings/approvals",
  },
  {
    key: "notifications",
    labelKey: "components.ui.settingsNav.notifications",
    href: "/notification-preferences",
  },
  {
    key: "integrations",
    labelKey: "components.ui.settingsNav.integrations",
    href: "/integrations-hub",
    matches: ["/integrations"],
  },
  { key: "billing", labelKey: "components.ui.settingsNav.billing", href: "/subscription" },
  {
    key: "data",
    labelKey: "components.ui.settingsNav.data",
    href: "/import",
    matches: ["/backup-restore", "/document-vault"],
  },
  {
    key: "developer",
    labelKey: "components.ui.settingsNav.developer",
    href: "/developer-settings",
  },
  { key: "firm", labelKey: "components.ui.settingsNav.firm", href: "/firm-relationship" },
];

/** Every route that renders inside the settings area (the sidebar highlights "Settings"). */
export const SETTINGS_ROUTES: string[] = SETTINGS_NAV.flatMap((i) => [
  i.href,
  ...(i.matches ?? []),
]);

export function isSettingsNavActive(location: string, item: SettingsNavItem) {
  const path = location.split("?")[0];
  return [item.href, ...(item.matches ?? [])].some((r) => path === r || path.startsWith(r + "/"));
}
