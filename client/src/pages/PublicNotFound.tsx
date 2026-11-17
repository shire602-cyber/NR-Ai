import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";
import { hasAuthHint } from "@/lib/authHint";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";

/**
 * Public 404 (WP-B, spec 3.1): an unknown URL for a signed-out visitor renders this on the
 * public layout instead of the sign-in screen. The router wiring (and the in-app 404 inside
 * the shell, pages/not-found.tsx) belongs to WP-A.
 */
export default function PublicNotFound() {
  const { t } = useTranslation();
  const signedIn = hasAuthHint();
  return (
    <MarketingLayout titleKey="marketing.nfSeoTitle" descriptionKey="marketing.nfBody">
      <section className="mk-section mk-ruling mk-notfound" aria-labelledby="mk-nf-title">
        <div className="mk-container">
          <p className="mk-eyebrow">{"404"}</p>
          <h1 id="mk-nf-title" className="mk-h2 mk-notfound__title" data-testid="public-404">
            {t["marketing.nfTitle"]}
          </h1>
          <p className="mk-lead">{t["marketing.nfBody"]}</p>
          <div className="mk-actions">
            <Button asChild size="lg">
              <Link href="/" data-testid="button-404-home">
                <ArrowLeft className="mk-flip" aria-hidden="true" />
                {t["marketing.nfHome"]}
              </Link>
            </Button>
            {signedIn ? (
              <Button asChild variant="outline" size="lg">
                <Link href="/dashboard" data-testid="button-404-dashboard">
                  {t["marketing.nfDashboard"]}
                </Link>
              </Button>
            ) : (
              <Button asChild variant="ghost" size="lg">
                <Link href="/help">{t["marketing.nfHelp"]}</Link>
              </Button>
            )}
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
