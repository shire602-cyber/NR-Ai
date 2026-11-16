import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  FileText,
  FolderOpen,
  BarChart2,
  MessageSquare,
  LogOut,
  Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { removeToken } from "@/lib/auth";
import { useTranslation } from "@/lib/i18n";

const NAV_ITEMS = [
  { labelKey: "shell.portalDashboard", href: "/client-portal/dashboard", icon: LayoutDashboard },
  { labelKey: "shell.portalInvoices", href: "/client-portal/invoices", icon: FileText },
  { labelKey: "shell.portalDocuments", href: "/client-portal/documents", icon: FolderOpen },
  { labelKey: "shell.portalStatements", href: "/client-portal/statements", icon: BarChart2 },
  { labelKey: "shell.portalMessages", href: "/client-portal/messages", icon: MessageSquare },
];

export function PortalLayout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const { t } = useTranslation();

  const { data: company } = useQuery({
    queryKey: ["portal-company"],
    queryFn: () => apiRequest("GET", "/api/client-portal/company"),
    staleTime: 5 * 60 * 1000,
  });

  function handleLogout() {
    removeToken();
    navigate("/login");
  }

  const title =
    t[NAV_ITEMS.find((n) => location.startsWith(n.href))?.labelKey ?? "shell.portalFallbackTitle"];
  const companyName = company?.name ?? t["shell.myCompany"];
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
    <div className="flex h-screen w-full bg-background">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-60 flex-shrink-0 flex-col border-e border-border bg-sidebar md:flex">
        {/* Company header */}
        <div className="border-b border-border px-5 py-5">
          <div className="flex items-center gap-3">
            {companyMark}
            <div className="min-w-0">
              <p className="truncate text-small font-semibold text-foreground" dir="auto">
                {companyName}
              </p>
              <p className="text-caption text-muted-foreground">{t["shell.clientPortal"]}</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 px-3 py-4" aria-label={t["shell.clientPortal"]}>
          {NAV_ITEMS.map(({ labelKey, href, icon: Icon }) => {
            const label = t[labelKey];
            const active = location === href || location.startsWith(href + "/");
            return (
              <Link key={href} href={href}>
                <a
                  aria-current={active ? "page" : undefined}
                  className={[
                    "flex h-9 items-center gap-3 rounded-md px-3 text-small font-medium transition-colors duration-fast",
                    active
                      ? "bg-sidebar-accent text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  ].join(" ")}
                >
                  <Icon
                    className={["h-4 w-4", active ? "text-accent" : "text-muted-foreground"].join(
                      " "
                    )}
                    aria-hidden
                  />
                  {label}
                </a>
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
          >
            <LogOut className="w-4 h-4 me-2 rtl:-scale-x-100" aria-hidden />
            {t["shell.signOut"]}
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 md:px-8">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="md:hidden">{companyMark}</div>
            <h1 className="truncate text-body font-semibold text-foreground">
              <span className="md:hidden" dir="auto">
                {companyName}
              </span>
              <span className="hidden md:inline">{title}</span>
            </h1>
          </div>
          <span className="hidden text-caption text-muted-foreground sm:inline">
            {t["shell.portalFooter"]}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground md:hidden"
            onClick={handleLogout}
            aria-label={t["shell.signOut"]}
          >
            <LogOut className="rtl:-scale-x-100" aria-hidden />
          </Button>
        </header>

        {/* Section switcher (mobile): one scrollable row of pills, 44px touch targets. */}
        <nav
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-card px-3 py-1.5 [scrollbar-width:none] md:hidden"
          aria-label={t["shell.clientPortal"]}
        >
          {NAV_ITEMS.map(({ labelKey, href, icon: Icon }) => {
            const active = location === href || location.startsWith(href + "/");
            return (
              <Link key={href} href={href}>
                <a
                  aria-current={active ? "page" : undefined}
                  className={[
                    "flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 text-small font-medium",
                    active ? "bg-muted text-foreground" : "text-muted-foreground",
                  ].join(" ")}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {t[labelKey]}
                </a>
              </Link>
            );
          })}
        </nav>

        <main className="flex-1 overflow-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={location}
              className="page-container"
              initial={false}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
