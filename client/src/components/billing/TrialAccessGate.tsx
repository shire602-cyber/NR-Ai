import { useEffect, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Loader2, Lock } from "lucide-react";
import { UPGRADE_CONTACT_EMAIL } from "@shared/trial";
import { BrandMark } from "@/components/BrandMark";
import { BillingUnloaded, PlanLoadState } from "@/components/billing/PlanLoadState";
import { useIsOnline } from "@/hooks/useIsOnline";
import { CompanySwitcher } from "@/components/CompanySwitcher";
import { Button } from "@/components/ui/button";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useSessionActions } from "@/hooks/useSessionActions";
import { useCompanySubscription } from "@/hooks/useSubscription";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { planPhraseKey } from "@/lib/plan-state";
import { PLAN_LIMIT_EVENT, type PlanLimitDetail } from "@/lib/plan-limit";
import { TrialReadOnlyContext } from "@/lib/trial-access";

export function TrialAccessGate({
  children,
  billing,
}: {
  children: ReactNode | ((notice: ReactNode) => ReactNode);
  billing?: ReactNode;
}) {
  const [location] = useLocation();
  const { t } = useTranslation();
  const { companyId, isLoading, error } = useDefaultCompany();
  const { data: user } = useCurrentUser();
  const exempt = user?.isAdmin === true || !!user?.firmRole;
  const {
    data,
    isPending,
    fetchStatus,
    error: subscriptionError,
    isLoadingError,
    refetch,
  } = useCompanySubscription(true, !exempt);
  const online = useIsOnline();
  const queryClient = useQueryClient();
  const lockedCompany = useRef<string>();
  const isLocked = data?.trialLocked === true;
  const workspace = (notice: ReactNode = null) =>
    typeof children === "function" ? (
      children(notice)
    ) : (
      <>
        {notice}
        {children}
      </>
    );

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

  if (exempt) return workspace();
  const onBilling = location.split(/[?#]/)[0] === "/subscription";
  // A paused first fetch stays pending for as long as the device is offline: say so.
  const offline = !!companyId && data === undefined && fetchStatus === "paused" && !online;
  if (isLoading || (companyId && isPending && !offline)) {
    return (
      <div role="status" className="grid min-h-dvh place-items-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
        <span className="sr-only">{t["common.loading"]}</span>
      </div>
    );
  }
  // A failed refresh of the company list keeps the cached selection, so it does not close the gate.
  const companyFailed = !!error && !companyId;
  // A missing billing endpoint resolves to null. An unresolved subscription has no data yet.
  // The workspace stays closed; Billing (and any route while offline) says why and retries the query.
  if (!companyFailed && companyId && data === undefined && (offline || (onBilling && billing))) {
    const state = {
      error: !offline && isLoadingError ? subscriptionError : null,
      online,
      onRetry: () => void refetch(),
    };
    return (
      <TrialRecoveryLayout billing={onBilling}>
        {onBilling ? <BillingUnloaded {...state} /> : <PlanLoadState {...state} />}
      </TrialRecoveryLayout>
    );
  }
  if (companyFailed || (companyId && data === undefined)) {
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
  if (!data || !isLocked) return workspace();

  if (onBilling && billing) {
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

  const notice = (
    <section
      className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b bg-warning/10 px-3 py-2 text-start md:px-6"
      aria-labelledby="trial-readonly-title"
      data-testid="trial-readonly-banner"
    >
      <Lock className="size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <h2 id="trial-readonly-title" className="text-sm font-semibold">
          {t["components.planLockTrialEndedTitle"]}
        </h2>
        <p className="text-sm text-muted-foreground">
          {requested
            ? t["components.planLockBodyRequestedPage"]
            : chosen
              ? formatMessage(t["components.planLockBodyChosen"], { plan })
              : t["components.planLockTrialEndedBody"]}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link href={billingHref}>
            {requested
              ? t["marketing.trialSeePlan"]
              : chosen
                ? formatMessage(t["components.planLockActivate"], { plan })
                : t["components.planLockChoosePlan"]}
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <a href={`mailto:${UPGRADE_CONTACT_EMAIL}`}>{t["components.trialAccessSupport"]}</a>
        </Button>
      </div>
    </section>
  );
  return <TrialReadOnlyContext.Provider value>{workspace(notice)}</TrialReadOnlyContext.Provider>;
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
