import { Link } from "wouter";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Mail, MapPin, Phone } from "lucide-react";
import type { ReactNode } from "react";
import { messages as pageMessages } from "./LegalLayout.i18n";
import { useTranslation } from "@/lib/i18n";
import { CALENDAR_DATE_FORMAT, formatDate } from "@/lib/format";

interface LegalLayoutProps {
  title: string;
  /** ISO calendar date, e.g. "2026-04-26". Formatted for the active language. */
  effectiveDate: string;
  children: ReactNode;
}

export function LegalLayout({ title, effectiveDate, children }: LegalLayoutProps) {
  const tr = pageMessages.useT();
  const { locale } = useTranslation();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/">
            <div className="flex items-center gap-2 cursor-pointer">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <span className="text-white font-bold text-sm">م</span>
              </div>
              <span className="font-bold text-lg tracking-tight">Muhasib.ai</span>
            </div>
          </Link>
          <Link href="/">
            <Button variant="ghost" size="sm" data-testid="button-back-home">
              <ArrowLeft className="w-4 h-4 me-2" />
              {tr("backToHome")}
            </Button>
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 py-12 lg:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-10">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">{title}</h1>
            <p className="text-sm text-muted-foreground">
              {tr("effectiveDate")} <span className="font-medium">{formatDate(effectiveDate, locale, CALENDAR_DATE_FORMAT)}</span>
            </p>
          </div>
          <div className="prose prose-sm sm:prose-base max-w-none text-foreground [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-3 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2 [&_p]:text-muted-foreground [&_p]:leading-relaxed [&_p]:mb-4 [&_ul]:list-disc [&_ul]:ps-6 [&_ul]:mb-4 [&_ul]:text-muted-foreground [&_li]:mb-1.5 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_strong]:text-foreground">
            {children}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t bg-muted/20 py-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-6 text-sm">
            <div>
              <h4 className="font-semibold mb-2">{tr("legal")}</h4>
              <ul className="space-y-1.5 text-muted-foreground">
                <li>
                  <Link href="/privacy" className="hover:text-foreground transition-colors">
                    {tr("privacyPolicy")}
                  </Link>
                </li>
                <li>
                  <Link href="/terms" className="hover:text-foreground transition-colors">
                    {tr("termsOfService")}
                  </Link>
                </li>
                <li>
                  <Link href="/cookies" className="hover:text-foreground transition-colors">
                    {tr("cookiePolicy")}
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-2">{tr("product")}</h4>
              <ul className="space-y-1.5 text-muted-foreground">
                <li>
                  <Link href="/" className="hover:text-foreground transition-colors">
                    {tr("features")}
                  </Link>
                </li>
                <li>
                  <Link href="/pricing" className="hover:text-foreground transition-colors">
                    {tr("pricing")}
                  </Link>
                </li>
                <li>
                  <Link href="/login" className="hover:text-foreground transition-colors">
                    {tr("signIn")}
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-2">{tr("contact")}</h4>
              <ul className="space-y-1.5 text-muted-foreground">
                <li className="flex items-start gap-2">
                  <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
                  <span>{tr("dubaiUnitedArabEmirates")}</span>
                </li>
                <li className="flex items-center gap-2">
                  <Phone className="w-3.5 h-3.5 shrink-0 text-primary" />
                  <a href="tel:+97141234567" className="hover:text-foreground transition-colors">
                    +971 4 123 4567
                  </a>
                </li>
                <li className="flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5 shrink-0 text-primary" />
                  <a
                    href="mailto:hello@muhasib.ai"
                    className="hover:text-foreground transition-colors"
                  >
                    hello@muhasib.ai
                  </a>
                </li>
              </ul>
            </div>
          </div>
          <Separator className="mb-4" />
          <p className="text-xs text-muted-foreground text-center">
            {tr("muhasibAiPoweredByNajmaAl", { getFullYear: new Date().getFullYear() })}
          </p>
        </div>
      </footer>
    </div>
  );
}
