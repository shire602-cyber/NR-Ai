import { useEffect, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Loader2, Lock } from "lucide-react";
import { UPGRADE_CONTACT_EMAIL } from "@shared/trial";
import { BrandMark } from "@/components/BrandMark";
import { CompanySwitcher } from "@/components/CompanySwitcher";
import { Button } from "@/components/ui/button";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useSessionActions } from "@/hooks/useSessionActions";
import { useCompanySubscription } from "@/hooks/useSubscription";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { planPhraseKey } from "@/lib/plan-state";
import { PLAN_LIMIT_EVENT, type PlanLimitDetail } from "@/lib/plan-limit";

export function TrialAccessGate({
  children,
  billing,
}: {
  children: ReactNode;
  billing?: ReactNode;
}) {
  const [location] = useLocation();
  const { t } = useTranslation();
  const { companyId, isLoading, error } = useDefaultCompany();
  const { data: user } = useCurrentUser();
  const exempt = user?.isAdmin === true || !!user?.firmRole;
  const { data, isPending, refetch } = useCompanySubscription(true, !exempt);
  const queryClient = useQueryClient();
  const lockedCompany = useRef<string>();
  const isLocked = data?.trialLocked === true;

  useEffect(() => {
    if (!companyId || exempt) return;
    const confirmLock = (event: Event) => {
      const { code, companyId: deniedCompanyId } = (event as CustomEvent<PlanLimitDetail>).detail;
      if (code === "PLAN_REQUIRED" && (!deniedCompanyId || deniedCompanyId === companyId)) {
        void refetch();
      }
    };
    window.addEventListener(PLAN_LIMIT_EVENT, confirmLock);
    return () => window.removeEventListener(PLAN_LIMIT_EVENT, confirmLock);
  }, [companyId, exempt, refetch]);

  useEffect(() => {
    if (isLocked) {
      lockedCompany.current = companyId;
    } else if (data && companyId && lockedCompany.current === companyId) {
      lockedCompany.current = undefined;
      void queryClient.invalidateQueries({ queryKey: ["/api/companies"], exact: true });
    }
  }, [companyId, data, isLocked, queryClient]);

  if (exempt) return <>{children}</>;
  if (isLoading || (companyId && isPending)) {
    return (
      <div role="status" className="grid min-h-dvh place-items-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
        <span className="sr-only">{t["common.loading"]}</span>
      </div>
    );
  }
  // A missing billing endpoint resolves to null. An unresolved subscription has no data yet.
  if (error || (companyId && data === undefined)) {
    return (
      <TrialRecoveryLayout>
        <div className="mx-auto max-w-md space-y-4 rounded-xl border bg-card p-6 text-start">
          <h1 className="text-xl font-semibold">{t["components.trialAccessUnavailable"]}</h1>
          <Button onClick={() => window.location.reload()}>
            {t["components.trialAccessRetry"]}
          </Button>
        </div>
      </TrialRecoveryLayout>
    );
  }
  if (!data || !isLocked) return <>{children}</>;

  if (location.split(/[?#]/)[0] === "/subscription" && billing) {
    return <TrialRecoveryLayout billing>{billing}</TrialRecoveryLayout>;
  }

  const chosen = data.entitlement?.chosenPlan;
  const plan = chosen ? t[planPhraseKey(chosen.planId)] : "";
  const requested = !!data.entitlement?.activationRequestedAt;
  const billingHref = chosen
    ? data.checkoutAvailable
      ? `/subscription?choose=${chosen.planId}&cycle=${chosen.billingCycle}`
      : "/subscription#after-trial"
    : "/subscription";

  return (
    <TrialRecoveryLayout>
      <section
        className="mx-auto w-full max-w-xl rounded-2xl border bg-card p-6 text-start shadow-sm sm:p-9"
        aria-labelledby="trial-lock-title"
        data-testid="trial-lock-screen"
      >
        <div className="mb-5 grid size-12 place-items-center rounded-xl bg-muted text-foreground">
          <Lock className="size-6" aria-hidden />
        </div>
        <h1 id="trial-lock-title" className="text-2xl font-semibold sm:text-3xl">
          {t["components.planLockTrialEndedTitle"]}
        </h1>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          {requested
            ? t["components.planLockBodyRequestedPage"]
            : chosen
              ? formatMessage(t["components.planLockBodyChosen"], { plan })
              : t["components.planLockTrialEndedBody"]}
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Button asChild className="min-h-11 whitespace-normal">
            <Link href={billingHref}>
              {requested
                ? t["marketing.trialSeePlan"]
                : chosen
                  ? formatMessage(t["components.planLockActivate"], { plan })
                  : t["components.planLockChoosePlan"]}
            </Link>
          </Button>
          <Button asChild variant="outline" className="min-h-11">
            <a href={`mailto:${UPGRADE_CONTACT_EMAIL}`}>{t["components.trialAccessSupport"]}</a>
          </Button>
        </div>
      </section>
    </TrialRecoveryLayout>
  );
}

function TrialRecoveryLayout({
  children,
  billing = false,
}: {
  children: ReactNode;
  billing?: boolean;
}) {
  const { t } = useTranslation();
  const { signOut, toggleLanguage, locale } = useSessionActions();
  const { companies } = useDefaultCompany();

  return (
    <div className="flex min-h-dvh flex-col bg-background" data-testid="trial-recovery-layout">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 sm:px-6">
        <BrandMark size="sm" />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" onClick={toggleLanguage}>
            <span lang={locale === "ar" ? "en" : "ar"}>
              {locale === "ar" ? "English" : "العربية"}
            </span>
          </Button>
          <Button type="button" variant="ghost" onClick={() => void signOut()}>
            {t.logout}
          </Button>
        </div>
        {companies.length > 1 && (
          <div className="w-full sm:max-w-56">
            <CompanySwitcher variant="compact" allowCreate={false} />
          </div>
        )}
      </header>
      <main
        id="main-content"
        className={
          billing
            ? "page-container min-w-0 overflow-x-clip py-6"
            : "grid flex-1 place-items-center px-4 py-8"
        }
      >
        {children}
      </main>
    </div>
  );
}
