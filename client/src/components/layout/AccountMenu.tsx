import { Link } from "wouter";
import { Building2, Languages, LifeBuoy, LogOut, MessageSquare, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "@/lib/i18n";
import { useSessionActions } from "@/hooks/useSessionActions";

/** Support mailbox published on the Help centre (client/src/pages/HelpCenter.tsx). */
export const SUPPORT_EMAIL = "support@muhasib.ai";

/**
 * Top-bar avatar menu (R3, CTO 23): the profile entry plus a persistent way to reach help
 * and a person — the Help centre and "Talk to an accountant" (the firm behind Muhasib.ai,
 * see /services) — from every authenticated screen.
 */
export function AccountMenu() {
  const { t } = useTranslation();
  const tt = t as Record<string, string>;
  const { signOut, toggleLanguage, locale } = useSessionActions();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* Spec 3.5: a 28 px avatar only (no "Profile" text); 44 px hit area on touch. */}
        <Button
          variant="ghost"
          size="icon"
          className="ms-0.5 rounded-full"
          data-testid="button-profile"
          aria-label={tt["shell.accountMenu"]}
          title={tt["shell.accountMenu"]}
        >
          <span
            aria-hidden
            className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-100"
          >
            <User className="!size-4" />
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56" data-testid="menu-account">
        <DropdownMenuItem asChild>
          <Link href="/settings/company" data-testid="menu-account-profile">
            <Building2 aria-hidden />
            {tt["shell.accountCompanyProfile"]}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-caption font-medium text-muted-foreground">
          {tt["shell.accountHelpHeading"]}
        </DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href="/help" data-testid="menu-account-help">
            <LifeBuoy aria-hidden />
            {tt["shell.accountHelpCentre"]}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Talk to an accountant")}`}
            data-testid="menu-account-talk-to-accountant"
          >
            <MessageSquare aria-hidden />
            <span className="flex min-w-0 flex-col">
              <span>{tt["shell.accountTalkToAccountant"]}</span>
              <span className="text-caption text-muted-foreground" dir="ltr">
                {SUPPORT_EMAIL}
              </span>
            </span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={toggleLanguage} data-testid="menu-account-language">
          <Languages aria-hidden />
          <span lang={locale === "en" ? "ar" : "en"}>
            {locale === "en" ? "العربية" : "English"}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void signOut()} data-testid="menu-account-logout">
          <LogOut aria-hidden className="rtl:-scale-x-100" />
          {t.logout}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
