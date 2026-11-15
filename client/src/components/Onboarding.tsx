import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { formatMessage, useTranslation } from "@/lib/i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useLocation } from "wouter";
import {
  Sparkles,
  Building2,
  BookOpen,
  FileText,
  Receipt,
  BarChart3,
  Bot,
  Bell,
  CheckCircle,
  ArrowRight,
  X,
} from "lucide-react";
import type { UserOnboarding } from "@shared/schema";

interface OnboardingStep {
  key: string;
  field: keyof UserOnboarding;
  title: string;
  description: string;
  icon: any;
  action: string;
  path: string;
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    key: "welcome",
    field: "hasCompletedWelcome",
    title: "Welcome to Muhasib.ai",
    description: "Set up UAE accounting workflows, VAT tracking, and reporting for your business",
    icon: Sparkles,
    action: "Continue",
    path: "/dashboard",
  },
  {
    key: "company",
    field: "hasCreatedCompany",
    title: "Set Up Your Company",
    description: "Add your company details and tax information",
    icon: Building2,
    action: "Set Up Company",
    path: "/company-profile",
  },
  {
    key: "accounts",
    field: "hasSetupChartOfAccounts",
    title: "Chart of Accounts",
    description: "Review and customize your UAE-focused chart of accounts",
    icon: BookOpen,
    action: "View Accounts",
    path: "/chart-of-accounts",
  },
  {
    key: "invoice",
    field: "hasCreatedFirstInvoice",
    title: "Create Your First Invoice",
    description: "Generate professional VAT-ready invoices",
    icon: FileText,
    action: "Create Invoice",
    path: "/invoices",
  },
  {
    key: "receipt",
    field: "hasUploadedFirstReceipt",
    title: "Upload a Receipt",
    description: "Let AI extract and categorize your expenses",
    icon: Receipt,
    action: "Upload Receipt",
    path: "/receipts",
  },
  {
    key: "reports",
    field: "hasViewedReports",
    title: "Explore Reports",
    description: "View financial statements and VAT summaries",
    icon: BarChart3,
    action: "View Reports",
    path: "/reports",
  },
  {
    key: "ai",
    field: "hasExploredAI",
    title: "Meet Your AI CFO",
    description: "Get insights and recommendations from your AI financial advisor",
    icon: Bot,
    action: "Explore AI Features",
    path: "/ai",
  },
  {
    key: "reminders",
    field: "hasConfiguredReminders",
    title: "Set Up Reminders",
    description: "Configure automatic payment reminders",
    icon: Bell,
    action: "Configure Reminders",
    path: "/reminders",
  },
];

const TOUR_DISMISSED_KEY = (userId: string) => `muhasib_tour_dismissed:${userId}`;

/** localStorage fallback used when the server column is unavailable (R18-03). */
function readLocalTourDismissed(userId: string | undefined): boolean {
  if (!userId) return false;
  try {
    return localStorage.getItem(TOUR_DISMISSED_KEY(userId)) === "1";
  } catch {
    return false;
  }
}

function writeLocalTourDismissed(userId: string | undefined): void {
  if (!userId) return;
  try {
    localStorage.setItem(TOUR_DISMISSED_KEY(userId), "1");
  } catch {
    /* storage unavailable */
  }
}

export function OnboardingWizard() {
  const { t } = useTranslation();
  const [location, setLocation] = useLocation();
  const [showWizard, setShowWizard] = useState(false);
  // The /api/onboarding query refetches on focus and after unrelated
  // mutations. Auto-open must fire at most once per mount or the wizard
  // re-opens over the app every refetch, and its overlay swallows every
  // click — the user can see the sidebar but nothing responds.
  const [hasAutoShown, setHasAutoShown] = useState(false);

  const { data: onboarding, isLoading } = useQuery<UserOnboarding>({
    queryKey: ["/api/onboarding"],
  });

  const completeMutation = useMutation({
    mutationFn: (step: string) => apiRequest("POST", "/api/onboarding/complete-step", { step }),
    onMutate: async (step: string) => {
      await queryClient.cancelQueries({ queryKey: ["/api/onboarding"] });
      const previousOnboarding = queryClient.getQueryData<UserOnboarding>(["/api/onboarding"]);

      const stepToField: Record<string, keyof UserOnboarding> = {
        welcome: "hasCompletedWelcome",
        company: "hasCreatedCompany",
        accounts: "hasSetupChartOfAccounts",
        invoice: "hasCreatedFirstInvoice",
        receipt: "hasUploadedFirstReceipt",
        reports: "hasViewedReports",
        ai: "hasExploredAI",
        reminders: "hasConfiguredReminders",
      };

      if (previousOnboarding) {
        const field = stepToField[step];
        const newData = { ...previousOnboarding, [field]: true };
        let newCurrentStep = 0;
        if (newData.hasCompletedWelcome) newCurrentStep++;
        if (newData.hasCreatedCompany) newCurrentStep++;
        if (newData.hasSetupChartOfAccounts) newCurrentStep++;
        if (newData.hasCreatedFirstInvoice) newCurrentStep++;
        if (newData.hasUploadedFirstReceipt) newCurrentStep++;
        if (newData.hasViewedReports) newCurrentStep++;
        if (newData.hasExploredAI) newCurrentStep++;
        if (newData.hasConfiguredReminders) newCurrentStep++;
        newData.currentStep = newCurrentStep;
        newData.isOnboardingComplete = newCurrentStep >= 8;
        queryClient.setQueryData(["/api/onboarding"], newData);
      }
      return { previousOnboarding };
    },
    onError: (_err, _step, context) => {
      if (context?.previousOnboarding) {
        queryClient.setQueryData(["/api/onboarding"], context.previousOnboarding);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding"] });
    },
  });

  const skipMutation = useMutation({
    // R18-03: persist "tour shown / dismissed" server-side once per user
    // (user_onboarding.tour_dismissed_at) so it never re-appears on later
    // pages, sessions or devices. localStorage is only a fallback.
    mutationFn: () => apiRequest("PATCH", "/api/onboarding", { tourDismissed: true }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["/api/onboarding"] });
      const previousOnboarding = queryClient.getQueryData<UserOnboarding>(["/api/onboarding"]);
      writeLocalTourDismissed(previousOnboarding?.userId);
      if (previousOnboarding) {
        queryClient.setQueryData(["/api/onboarding"], {
          ...previousOnboarding,
          showTour: false,
          tourDismissedAt: new Date(),
        });
      }
      return { previousOnboarding };
    },
    // On error the local fallback flag stays set, so the tour is not re-shown.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding"] });
    },
  });

  const tourDismissed =
    Boolean(onboarding?.tourDismissedAt) || readLocalTourDismissed(onboarding?.userId);
  const onOnboardingPage = location.split("?")[0] === "/onboarding";

  useEffect(() => {
    if (
      !hasAutoShown &&
      onboarding &&
      !onboarding.isOnboardingComplete &&
      onboarding.showTour &&
      !tourDismissed &&
      !onOnboardingPage
    ) {
      setShowWizard(true);
      setHasAutoShown(true);
      // Showing the tour counts as the user's one tour: record it immediately
      // so a reload or the next page never shows it again.
      writeLocalTourDismissed(onboarding.userId);
      skipMutation.mutate();
    }
  }, [onboarding, hasAutoShown, tourDismissed, onOnboardingPage, skipMutation]);

  const handleStepAction = (step: OnboardingStep) => {
    completeMutation.mutate(step.key);
    setShowWizard(false);
    setLocation(step.path);
  };

  const handleSkip = () => {
    setShowWizard(false);
    skipMutation.mutate();
  };

  if (isLoading || !onboarding || onboarding.isOnboardingComplete || onOnboardingPage) {
    return null;
  }
  if (!showWizard) {
    return null;
  }

  const currentStep = onboarding.currentStep || 0;
  const totalSteps = ONBOARDING_STEPS.length;
  const progress = (currentStep / totalSteps) * 100;
  const nextStep = ONBOARDING_STEPS.find((step) => !onboarding[step.field as keyof UserOnboarding]);

  if (!nextStep) {
    return null;
  }

  const Icon = nextStep.icon;

  return (
    <Dialog
      open={showWizard}
      onOpenChange={(open) => {
        setShowWizard(open);
        // Closing by any means (X, Esc, outside click) is a dismissal —
        // persist it so the tour doesn't ambush the user again next load.
        if (!open) skipMutation.mutate();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center">
            <Badge variant="secondary">
              {formatMessage(t["onboarding.stepBadge"], {
                current: Math.min(currentStep + 1, totalSteps),
                total: totalSteps,
              })}
            </Badge>
          </div>
          <div className="pt-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Icon className="w-8 h-8 text-primary" />
            </div>
            <DialogTitle className="text-center text-xl">
              {t[`onboarding.step.${nextStep.key}.title`] || nextStep.title}
            </DialogTitle>
            <DialogDescription className="text-center">
              {t[`onboarding.step.${nextStep.key}.description`] || nextStep.description}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="py-4">
          <div className="flex justify-between text-sm text-muted-foreground mb-2">
            <span>{t["onboarding.progress"]}</span>
            <span>
              {formatMessage(t["onboarding.completedCount"], {
                done: currentStep,
                total: totalSteps,
              })}
            </span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        <div className="flex gap-3 justify-center">
          <Button variant="outline" onClick={handleSkip} data-testid="button-skip-onboarding">
            {t["onboarding.skip"]}
          </Button>
          <Button
            onClick={() => handleStepAction(nextStep)}
            data-testid="button-continue-onboarding"
          >
            {t[`onboarding.step.${nextStep.key}.action`] || nextStep.action}
            <ArrowRight className="w-4 h-4 ms-2 rtl:rotate-180" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function OnboardingProgress() {
  const [, setLocation] = useLocation();
  const { t } = useTranslation();

  const { data: onboarding, isLoading } = useQuery<UserOnboarding>({
    queryKey: ["/api/onboarding"],
  });

  const completeMutation = useMutation({
    mutationFn: (step: string) => apiRequest("POST", "/api/onboarding/complete-step", { step }),
    onMutate: async (step: string) => {
      await queryClient.cancelQueries({ queryKey: ["/api/onboarding"] });
      const previousOnboarding = queryClient.getQueryData<UserOnboarding>(["/api/onboarding"]);

      const stepToField: Record<string, keyof UserOnboarding> = {
        welcome: "hasCompletedWelcome",
        company: "hasCreatedCompany",
        accounts: "hasSetupChartOfAccounts",
        invoice: "hasCreatedFirstInvoice",
        receipt: "hasUploadedFirstReceipt",
        reports: "hasViewedReports",
        ai: "hasExploredAI",
        reminders: "hasConfiguredReminders",
      };

      if (previousOnboarding) {
        const field = stepToField[step];
        const newData = { ...previousOnboarding, [field]: true };
        let newCurrentStep = 0;
        if (newData.hasCompletedWelcome) newCurrentStep++;
        if (newData.hasCreatedCompany) newCurrentStep++;
        if (newData.hasSetupChartOfAccounts) newCurrentStep++;
        if (newData.hasCreatedFirstInvoice) newCurrentStep++;
        if (newData.hasUploadedFirstReceipt) newCurrentStep++;
        if (newData.hasViewedReports) newCurrentStep++;
        if (newData.hasExploredAI) newCurrentStep++;
        if (newData.hasConfiguredReminders) newCurrentStep++;
        newData.currentStep = newCurrentStep;
        newData.isOnboardingComplete = newCurrentStep >= 8;
        queryClient.setQueryData(["/api/onboarding"], newData);
      }
      return { previousOnboarding };
    },
    onError: (_err, _step, context) => {
      if (context?.previousOnboarding) {
        queryClient.setQueryData(["/api/onboarding"], context.previousOnboarding);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding"] });
    },
  });

  if (isLoading || !onboarding || onboarding.isOnboardingComplete) {
    return null;
  }

  const currentStep = onboarding.currentStep || 0;
  const totalSteps = ONBOARDING_STEPS.length;
  const progress = (currentStep / totalSteps) * 100;

  return (
    <Card className="mb-6 ">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="font-medium">{t["onboarding.gettingStarted"]}</span>
          </div>
          <Badge variant="outline">
            {formatMessage(t["onboarding.completedCount"], {
              done: currentStep,
              total: totalSteps,
            })}
          </Badge>
        </div>

        <Progress value={progress} className="h-2 mb-4" />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {ONBOARDING_STEPS.slice(0, 8).map((step) => {
            const Icon = step.icon;
            const isCompleted = onboarding[step.field as keyof UserOnboarding];
            return (
              <button
                key={step.key}
                onClick={() => {
                  if (!isCompleted) {
                    completeMutation.mutate(step.key);
                  }
                  setLocation(step.path);
                }}
                className={`flex items-center gap-2 p-2 rounded-lg text-sm transition-colors ${
                  isCompleted ? "bg-success/10 text-success" : "bg-background hover:bg-accent"
                }`}
                data-testid={`onboarding-step-${step.key}`}
              >
                {isCompleted ? (
                  <CheckCircle className="w-4 h-4 text-success shrink-0" />
                ) : (
                  <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                )}
                <span className="truncate">
                  {t[`onboarding.step.${step.key}.title`] || step.title}
                </span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export function HelpTip({ tipKey, children }: { tipKey: string; children: React.ReactNode }) {
  const { t } = useTranslation();
  const { data: onboarding } = useQuery<UserOnboarding>({
    queryKey: ["/api/onboarding"],
  });

  const dismissMutation = useMutation({
    mutationFn: (tipId: string) => apiRequest("POST", "/api/onboarding/dismiss-tip", { tipId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding"] });
    },
  });

  if (!onboarding?.showTips) {
    return null;
  }

  const dismissedTips = onboarding.dismissedTips ? JSON.parse(onboarding.dismissedTips) : [];
  if (dismissedTips.includes(tipKey)) {
    return null;
  }

  return (
    <div className="relative group">
      {children}
      <Button
        variant="ghost"
        size="sm"
        className="absolute -top-2 -end-2 opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label={t["common.close"]}
        onClick={() => dismissMutation.mutate(tipKey)}
      >
        <X className="w-3 h-3" />
      </Button>
    </div>
  );
}
