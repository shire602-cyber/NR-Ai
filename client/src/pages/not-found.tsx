import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";

/**
 * 404 inside the app shell (WP-A, Fable spec 3.1): the shell (sidebar, top bar) stays, the
 * body is the same calm pattern as the public 404 — eyebrow, one headline, one sentence and
 * two actions — over the ledger-ruling motif.
 */
export default function NotFound() {
  const { t } = useTranslation();
  return (
    <section
      className="relative isolate mx-auto flex min-h-[60vh] max-w-reading flex-col justify-center overflow-hidden py-16"
      aria-labelledby="not-found-title"
      data-testid="page-not-found"
    >
      <div className="bg-ledger-ruling pointer-events-none absolute inset-0 -z-10" aria-hidden />
      <div className="eyebrow text-accent" dir="ltr">
        404
      </div>
      <h1 id="not-found-title" className="mt-3 text-display text-foreground">
        {t["components.ui.notFoundTitle"]}
      </h1>
      <p className="mt-3 max-w-md text-lead text-muted-foreground">
        {t["components.ui.notFoundBody"]}
      </p>
      <div className="mt-8 flex flex-wrap items-center gap-2">
        <Button asChild>
          <Link href="/dashboard" data-testid="link-not-found-dashboard">
            {t["components.ui.notFoundDashboard"]}
          </Link>
        </Button>
        <Button variant="ghost" onClick={() => window.history.back()}>
          <ArrowLeft className="rtl:rotate-180" aria-hidden />
          {t["components.ui.notFoundBack"]}
        </Button>
      </div>
    </section>
  );
}
