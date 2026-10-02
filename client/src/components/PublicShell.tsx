import type { ReactNode } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { LanguageToggle } from "@/components/LanguageToggle";
import { messages as pageMessages } from "./PublicShell.i18n";

/** Header and main landmark for the public documentation pages (help centre, articles, API docs). */
export function PublicShell({ children }: { children: ReactNode }) {
  const tr = pageMessages.useT();
  return (
    <div className="min-h-screen bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow"
      >
        {tr("skipToContent")}
      </a>
      <header className="border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2">
          <Link href="/" className="inline-flex min-h-[44px] items-center text-lg font-bold">
            {/* i18n-ignore: product name */}
            Muhasib.ai
          </Link>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground" aria-label={tr("help")}>
            <Link href="/pricing" className="hidden hover:text-foreground sm:inline">
              {tr("pricing")}
            </Link>
            <Link href="/trust" className="hidden hover:text-foreground sm:inline">
              {tr("trust")}
            </Link>
            <Link href="/help" className="inline-flex min-h-[44px] items-center hover:text-foreground">
              {tr("help")}
            </Link>
            <Link href="/developers/api" className="inline-flex min-h-[44px] items-center hover:text-foreground">
              {tr("apiDocs")}
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            <LanguageToggle />
            <a href="mailto:support@muhasib.ai?subject=Muhasib.ai%20support" className="hidden sm:block">
              <Button size="sm" variant="outline">
                {tr("contactSupport")}
              </Button>
            </a>
          </div>
        </div>
      </header>
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
