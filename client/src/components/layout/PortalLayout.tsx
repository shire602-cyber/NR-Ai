import { useEffect, useRef, useSyncExternalStore } from "react";
import { useLocation, Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  FileText,
  FolderOpen,
  BarChart2,
  MessageSquare,
  LogOut,
  Building2,
  Languages,
  UserRound,
  Check,
  ChevronsUpDown,
  ShieldOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ApiError, portalQuery } from "@/lib/queryClient";
import {
  clearRevokedPortalSelection,
  getPortalAccountSelection,
  PORTAL_SELECTION_REQUIRED,
  setSelectedPortalAccount,
  subscribeToPortalAccountSelection,
} from "@/lib/portal-state";
import { useSessionActions } from "@/hooks/useSessionActions";
import { PortalStatePage } from "@/components/portal/PortalStatePage";
import { PortalAccountScope } from "@/lib/portal-scope";
import { useActiveIntoView, useEdgeFade } from "@/components/ui/use-scroll-fade";
import { bidiIsolate } from "@/lib/customer-link";
import { formatMessage, useI18n, useTranslation } from "@/lib/i18n";

const NAV_ITEMS = [
  { labelKey: "shell.portalDashboard", href: "/client-portal/dashboard", icon: LayoutDashboard },
  { labelKey: "shell.portalInvoices", href: "/client-portal/invoices", icon: FileText },
  { labelKey: "shell.portalDocuments", href: "/client-portal/documents", icon: FolderOpen },
  { labelKey: "shell.portalStatements", href: "/client-portal/statements", icon: BarChart2 },
  { labelKey: "shell.portalMessages", href: "/client-portal/messages", icon: MessageSquare },
  { labelKey: "portal.account.nav", href: "/client-portal/account", icon: UserRound },
];

interface PortalAccountRow {
  id: string;
  company: { id: string; name: string; logoUrl: string | null };
  customer: { id: string; name: string; nameAr: string | null };
}

export function PortalLayout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const { t, locale } = useTranslation();
  const { setLocale } = useI18n();
  const queryClient = useQueryClient();
  const { signOut } = useSessionActions();
  const selection = useSyncExternalStore(
    subscribeToPortalAccountSelection,
    getPortalAccountSelection
  );
  const selectionRequired = selection === PORTAL_SELECTION_REQUIRED;
  const mobileNav = useRef<HTMLElement>(null);
  const mobileNavFade = useEdgeFade(mobileNav);
  useActiveIntoView(mobileNav);

  const { data: boundCompany, error: companyError } = useQuery({
    ...portalQuery("/api/client-portal/company", selection),
    enabled: !selectionRequired,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    retry: false,
  });
  const {
    data: accounts = [],
    isSuccess: accountsAvailable,
    isFetchedAfterMount: accountsChecked,
  } = useQuery<PortalAccountRow[]>({
    ...portalQuery("/api/client-portal/accounts", selection),
    staleTime: selectionRequired ? 0 : 5 * 60 * 1000,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });
  const missingSelection =
    !!selection &&
    !selectionRequired &&
    accountsAvailable &&
    accountsChecked &&
    !accounts.some((a) => a.id === selection);

  useEffect(() => {
    // Pin the server's first-visit default before mounting any supplier-scoped pages.
    if (
      selection === null &&
      !companyError &&
      boundCompany?.portalAccountId &&
      getPortalAccountSelection() === null
    ) {
      queryClient.setQueryData(["portal-company", boundCompany.portalAccountId], boundCompany);
      setSelectedPortalAccount(boundCompany.portalAccountId);
    }
  }, [selection, boundCompany, companyError, queryClient]);

  useEffect(() => {
    if (missingSelection) clearRevokedPortalSelection(selection);
  }, [selection, missingSelection]);

  useEffect(() => {
    if (selectionRequired && getPortalAccountSelection() === PORTAL_SELECTION_REQUIRED) {
      queryClient.removeQueries({
        predicate: (q) =>
          String(q.queryKey[0]).startsWith("portal-") &&
          q.queryKey[1] !== PORTAL_SELECTION_REQUIRED,
      });
    }
  }, [selectionRequired, queryClient]);

  async function handleLogout() {
    // Clears the httpOnly session cookies on the server, not just local state (G4).
    await signOut();
    navigate("/login");
  }

  function switchSupplier(id: string) {
    setSelectedPortalAccount(id);
    navigate("/client-portal/dashboard");
  }

  const removed =
    selectionRequired ||
    missingSelection ||
    (companyError instanceof ApiError &&
      (companyError.body?.code === "PORTAL_ACCESS_REVOKED" ||
        companyError.body?.code === "PORTAL_CONTACT_NOT_LINKED"));
  const company = selection && !removed ? boundCompany : undefined;

  const title =
    t[NAV_ITEMS.find((n) => location.startsWith(n.href))?.labelKey ?? "shell.portalFallbackTitle"];
  const companyName = company?.name ?? t["shell.myCompany"];
  // The browser tab, history and screen readers name the page ("Invoices · Al Noor Trading").
  const pageTitle = company?.name
    ? `${title} · ${locale === "ar" ? bidiIsolate(company.name) : company.name}`
    : title;
  const customerName =
    (locale === "ar" ? company?.customer?.nameAr : null) || company?.customer?.name;
  useEffect(() => {
    if (!pageTitle) return;
    const before = document.title;
    document.title = pageTitle;
    return () => {
      document.title = before;
    };
  }, [pageTitle]);
  const companyMark = company?.logoUrl ? (
    <img
      src={company.logoUrl}
      alt={t["shell.logoAlt"]}
      className="h-9 w-9 shrink-0 rounded-lg object-cover"
    />
  ) : (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
      <Building2 className="h-5 w-5" aria-hidden />
    </div>
  );

  return (
    <div className="flex h-screen w-full bg-background supports-[height:100dvh]:h-dvh">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-60 flex-shrink-0 flex-col border-e border-border bg-sidebar md:flex">
        {/* Company header */}
        <div className="border-b border-border px-5 py-5">
          <div className="flex items-center gap-3">
            {companyMark}
            <div className="min-w-0">
              <p
                className="truncate text-small font-semibold text-foreground"
                dir="auto"
                translate={company?.name ? "no" : undefined}
                title={company?.name}
              >
                {companyName}
              </p>
              <p className="text-caption text-muted-foreground">{t["portal.doc.clientPortal"]}</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 px-3 py-4" aria-label={t["portal.doc.clientPortal"]}>
          {NAV_ITEMS.map(({ labelKey, href, icon: Icon }) => {
            const label = t[labelKey];
            const active = location === href || location.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={[
                  "flex h-9 items-center gap-3 rounded-md px-3 text-small font-medium transition-colors duration-fast",
                  active
                    ? "bg-sidebar-accent text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                ].join(" ")}
              >
                <Icon
                  className={[
                    "h-4 w-4 shrink-0",
                    active ? "text-accent" : "text-muted-foreground",
                  ].join(" ")}
                  aria-hidden
                />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-border px-3 py-4">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground hover:text-foreground"
            onClick={handleLogout}
            data-testid="portal-sign-out-side"
          >
            <LogOut className="me-2 h-4 w-4" aria-hidden />
            {t["portal.doc.signOut"]}
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 md:px-8">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="md:hidden">{companyMark}</div>
            {/* Not a heading: each page's PageHeader owns the single h1. */}
            <p className="truncate text-body font-semibold text-foreground">
              <span
                className="block truncate md:hidden"
                dir="auto"
                translate={company?.name ? "no" : undefined}
                title={company?.name}
              >
                {companyName}
              </span>
              <span className="hidden md:inline">{title}</span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden max-w-[280px] truncate text-caption text-muted-foreground sm:inline">
              {company?.firmName ? (
                <>
                  <bdi translate="no">{company.firmName}</bdi> · {t["portal.doc.clientPortal"]}
                </>
              ) : (
                t["portal.doc.clientPortal"]
              )}
            </span>
            {company && accounts.length > 1 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="max-w-[clamp(6rem,32vw,10rem)] gap-1.5"
                    aria-label={t["portal.switcher.label"]}
                    data-testid="portal-supplier-switcher"
                  >
                    <span
                      className="min-w-0 truncate"
                      dir="auto"
                      translate="no"
                      title={company.name}
                    >
                      {company.name}
                    </span>
                    <ChevronsUpDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60 max-w-[calc(100vw-2rem)]">
                  <DropdownMenuLabel>{t["portal.switcher.title"]}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {accounts.map((a) => (
                    <DropdownMenuItem key={a.id} onSelect={() => switchSupplier(a.id)}>
                      <span
                        className="min-w-0 flex-1 truncate"
                        dir="auto"
                        translate="no"
                        title={a.company.name}
                      >
                        {a.company.name}
                      </span>
                      {a.id === selection && <Check className="h-4 w-4" aria-hidden />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  aria-label={t["portal.doc.account"]}
                  data-testid="portal-account-menu"
                >
                  <UserRound aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 max-w-[calc(100vw-2rem)]">
                {customerName && (
                  <>
                    <DropdownMenuLabel
                      className="truncate font-medium"
                      dir="auto"
                      translate="no"
                      title={customerName}
                    >
                      {customerName}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem onSelect={() => navigate("/client-portal/account")}>
                  <UserRound className="h-4 w-4" aria-hidden />
                  {t["portal.account.nav"]}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setLocale(locale === "en" ? "ar" : "en")}>
                  <Languages className="h-4 w-4" aria-hidden />
                  <span lang={locale === "en" ? "ar" : "en"}>
                    {locale === "en" ? "العربية" : "English"}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={handleLogout} data-testid="portal-sign-out">
                  <LogOut className="h-4 w-4" aria-hidden />
                  {t["portal.doc.signOut"]}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Section switcher (mobile): one scrollable row of pills, 44px touch targets. */}
        <nav
          ref={mobileNav}
          className="flex min-w-0 shrink-0 snap-x snap-proximity gap-1 overflow-x-auto border-b border-border bg-card px-3 py-1.5 [scrollbar-width:none] md:hidden"
          aria-label={t["portal.doc.clientPortal"]}
          style={mobileNavFade}
        >
          {NAV_ITEMS.map(({ labelKey, href, icon: Icon }) => {
            const active = location === href || location.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={[
                  "flex h-11 shrink-0 snap-start items-center gap-2 whitespace-nowrap rounded-md px-3 text-small font-medium",
                  active ? "bg-muted text-foreground" : "text-muted-foreground",
                ].join(" ")}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {t[labelKey]}
              </Link>
            );
          })}
        </nav>

        <main className="flex-1 overflow-auto">
          <div className="page-container">
            {removed ? (
              <div className="mx-auto max-w-md py-16" data-testid="portal-access-removed">
                <PortalStatePage
                  icon={ShieldOff}
                  tone="danger"
                  title={t["portal.states.removedTitle"]}
                  body={formatMessage(t["portal.states.removedBody"], {
                    supplier: t["portal.join.theSupplier"],
                  })}
                  actions={
                    <>
                      {accounts.length > 0 && (
                        <div
                          className="flex flex-col gap-2"
                          role="group"
                          aria-label={t["portal.states.useOther"]}
                        >
                          {accounts.map((account) => (
                            <Button
                              key={account.id}
                              className="min-h-11"
                              onClick={() => switchSupplier(account.id)}
                            >
                              <bdi>{account.company.name}</bdi>
                            </Button>
                          ))}
                        </div>
                      )}
                      <Button
                        className="h-11"
                        variant="outline"
                        onClick={() => void handleLogout()}
                      >
                        {t["portal.doc.signOut"]}
                      </Button>
                    </>
                  }
                />
              </div>
            ) : company ? (
              <PortalAccountScope.Provider key={selection} value={selection}>
                {children}
              </PortalAccountScope.Provider>
            ) : companyError ? (
              <p className="mx-auto max-w-md py-16 text-center" role="alert">
                {companyError.message}
              </p>
            ) : (
              <div className="mx-auto max-w-[960px] space-y-4" role="status" aria-busy="true">
                <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
                <div className="h-24 w-full animate-pulse rounded-md bg-muted" />
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
