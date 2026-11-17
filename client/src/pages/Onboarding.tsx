import { T } from "@/components/layout/T";
import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, ApiError } from "@/lib/queryClient";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { useCatalogText } from "@/lib/reportCatalogText";
import { localizeMessage, zodErrorMap } from "@/lib/validation-messages";
import {
  getPreferredReportPersona,
  reportAutomationImpactProfiles,
  reportAutomationTriggerRuleHref,
  reportAutomationTriggerRules,
  reportAutomationStarterHref,
  reportAutomationStarters,
  reportCatalog,
  reportComparisonPresetHref,
  reportComparisonPresets,
  reportDecisionShortcutHref,
  reportDecisionShortcuts,
  reportDeliverySubscriptionHref,
  reportDeliverySubscriptions,
  reportPackTemplateHref,
  reportPackTemplates,
  reportPersonaWorkspaces,
  reportPersonaHref,
  reportQuickAccessProfiles,
  reportSavedViewHref,
  reportSavedViewProfiles,
  reportSectionHref,
  reportSuiteHref,
  reportSuiteProfiles,
  reportWorkspaceHref,
  setPreferredReportPersona,
  type ReportPersona,
} from "@/lib/reportCatalog";
import { z } from "zod";
import {
  Sparkles,
  Building2,
  BookOpen,
  Landmark,
  FileText,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  LayoutDashboard,
  Receipt,
  BarChart3,
  Users,
  Briefcase,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import type { Company } from "@shared/schema";

const UAE_BANKS = [
  "Emirates NBD",
  "First Abu Dhabi Bank (FAB)",
  "Abu Dhabi Commercial Bank (ADCB)",
  "Dubai Islamic Bank",
  "Mashreq Bank",
  "RAKBANK",
  "Commercial Bank of Dubai",
  "Sharjah Islamic Bank",
  "United Arab Bank",
  "Other",
];

const UAE_EMIRATES = [
  { value: "abu_dhabi", label: "invoices.emirate.abu_dhabi" },
  { value: "dubai", label: "invoices.emirate.dubai" },
  { value: "sharjah", label: "invoices.emirate.sharjah" },
  { value: "ajman", label: "invoices.emirate.ajman" },
  { value: "umm_al_quwain", label: "invoices.emirate.umm_al_quwain" },
  { value: "ras_al_khaimah", label: "invoices.emirate.ras_al_khaimah" },
  { value: "fujairah", label: "invoices.emirate.fujairah" },
];

type Step = "welcome" | "company" | "accounts" | "bank" | "first-doc" | "complete";

const STEPS: Step[] = ["welcome", "company", "accounts", "bank", "first-doc", "complete"];

const STEP_LABEL_KEYS: Record<Step, string> = {
  welcome: "onboarding.stepLabelWelcome",
  company: "onboarding.companyDetailsTitle",
  accounts: "onboarding.step.accounts.title",
  bank: "pageLabels.bankAccount",
  "first-doc": "onboarding.stepLabelFirstDocument",
  complete: "onboarding.stepLabelComplete",
};

function stepIndex(step: Step): number {
  return STEPS.indexOf(step);
}

const STORAGE_KEY = (companyId: string) => `onboarding_step_${companyId}`;

export default function Onboarding() {
  const { data: user, isLoading } = useCurrentUser();
  if (isLoading) return null;

  // Firm owners and firm admins manage clients, not their own books — they
  // get a different onboarding tailored around staff and client setup.
  if (user?.firmRole === "firm_owner" || user?.firmRole === "firm_admin") {
    return <FirmOnboarding firmRole={user.firmRole} />;
  }
  return <CustomerOnboarding />;
}

function CustomerOnboarding() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: companies, isLoading: companiesLoading } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });
  const company = companies?.[0];

  const [currentStep, setCurrentStep] = useState<Step>("welcome");
  const [direction, setDirection] = useState<1 | -1>(1);

  const [companyForm, setCompanyForm] = useState<CompanyFormState>({
    name: "",
    trnVatNumber: "",
    registrationNumber: "",
    businessAddress: "",
    addressCity: "",
    contactPhone: "",
    contactEmail: "",
    emirate: "dubai",
    legalStructure: "",
    vatFilingFrequency: "",
    vatPeriodStartMonth: 1,
  });

  const [bankForm, setBankForm] = useState({
    nameEn: "",
    bankName: "",
    accountNumber: "",
    iban: "",
    currency: "AED",
  });

  // Hydrate the form once per company (not on every refetch, which would wipe edits).
  const [hydratedCompanyId, setHydratedCompanyId] = useState<string | undefined>(undefined);
  if (company?.id !== hydratedCompanyId) {
    setHydratedCompanyId(company?.id);
    if (company) {
      setCompanyForm({
        name: company.name ?? "",
        trnVatNumber: company.trnVatNumber ?? "",
        registrationNumber: company.registrationNumber ?? "",
        businessAddress: company.businessAddress ?? "",
        addressCity: company.addressCity ?? "",
        contactPhone: company.contactPhone ?? "",
        contactEmail: company.contactEmail ?? "",
        emirate: company.emirate ?? "dubai",
        legalStructure: company.legalStructure ?? "",
        vatFilingFrequency: company.vatFilingFrequency ?? "",
        vatPeriodStartMonth: company.vatPeriodStartMonth ?? 1,
      });

      const saved = localStorage.getItem(STORAGE_KEY(company.id));
      if (saved && STEPS.includes(saved as Step)) {
        setCurrentStep(saved as Step);
      }
    }
  }

  const onboardingCompanyId = company?.id;
  useEffect(() => {
    if (onboardingCompanyId) {
      localStorage.setItem(STORAGE_KEY(onboardingCompanyId), currentStep);
    }
  }, [currentStep, onboardingCompanyId]);

  const { data: accountsData } = useQuery<{ id: string; nameEn: string; type: string }[]>({
    queryKey: [`/api/companies/${company?.id}/accounts`],
    enabled: !!company?.id && currentStep === "accounts",
  });

  const { data: bankAccounts } = useQuery<{ id: string; nameEn: string; bankName: string }[]>({
    queryKey: [`/api/companies/${company?.id}/bank-accounts`],
    enabled: !!company?.id && currentStep === "bank",
  });

  // Field-level validation errors surfaced from either the local Zod schema
  // or a structured 4xx response from the server. Cleared as the user retries.
  const [companyFieldErrors, setCompanyFieldErrors] = useState<
    Partial<Record<keyof CompanyFormState, string>>
  >({});
  // Top-level error (e.g. network failure, 5xx) — drives the inline retry banner.
  const [companySaveError, setCompanySaveError] = useState<string | null>(null);

  const saveCompanyMutation = useMutation({
    mutationFn: (data: Partial<typeof companyForm>) =>
      apiRequest("PATCH", `/api/companies/${company!.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      setCompanyFieldErrors({});
      setCompanySaveError(null);
    },
    // Toast-only fallback. Inline errors are handled in handleCompanyNext so we
    // can route 400/409 field hints to the right input.
    onError: () => {
      /* handled in handleCompanyNext */
    },
  });

  const createCompanyMutation = useMutation({
    mutationFn: async (data: typeof companyForm): Promise<Company> => {
      return apiRequest("POST", "/api/companies", {
        ...data,
        baseCurrency: "AED",
        locale: "en",
        companyType: "customer",
      });
    },
    onSuccess: (newCompany) => {
      queryClient.setQueryData<Company[]>(["/api/companies"], (old) =>
        old ? [...old, newCompany] : [newCompany]
      );
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
    },
    onError: (err: any) => {
      toast({
        title: t["onboarding.failedCreateCompany"],
        description: err?.message ?? t["onboarding.tryAgain"],
        variant: "destructive",
      });
    },
  });

  const createBankMutation = useMutation({
    mutationFn: (data: typeof bankForm) =>
      apiRequest("POST", `/api/companies/${company!.id}/bank-accounts`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${company!.id}/bank-accounts`] });
    },
    onError: (err: Error) => {
      toast({
        title: t["onboarding.failedCreateBank"],
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const completeMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${company!.id}/onboarding/complete`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      if (company) localStorage.removeItem(STORAGE_KEY(company.id));
    },
    onError: (err: Error) => {
      toast({
        title: t["onboarding.failedComplete"],
        description: err.message,
        variant: "destructive",
      });
    },
  });

  function goTo(step: Step, dir: 1 | -1 = 1) {
    setDirection(dir);
    setCurrentStep(step);
  }

  function goNext() {
    const idx = stepIndex(currentStep);
    if (idx < STEPS.length - 1) goTo(STEPS[idx + 1], 1);
  }

  function goBack() {
    const idx = stepIndex(currentStep);
    if (idx > 0) goTo(STEPS[idx - 1], -1);
  }

  async function handleCompanyNext() {
    // Client-side validation first so we never burn an API round-trip on
    // shapes the server will obviously reject. Empty TRN is allowed (this
    // step is partially optional), but if supplied it must be 15 digits.
    const localSchema = z.object({
      name: z.string().trim().min(1, "forms.errors.companyNameRequired").max(200),
      trnVatNumber: z
        .string()
        .trim()
        .optional()
        .refine((v) => !v || /^[0-9]{15}$/.test(v), "forms.errors.uaeTrn15Digits"),
      contactEmail: z
        .string()
        .trim()
        .optional()
        .refine(
          (v) => !v || z.string().email().safeParse(v).success,
          "forms.errors.enterValidEmail"
        ),
    });

    const parsed = localSchema.safeParse(companyForm, { error: zodErrorMap });
    if (!parsed.success) {
      const fieldErrors: Partial<Record<keyof CompanyFormState, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof CompanyFormState;
        if (!fieldErrors[key]) fieldErrors[key] = localizeMessage(issue.message);
      }
      setCompanyFieldErrors(fieldErrors);
      setCompanySaveError(null);
      return;
    }

    setCompanyFieldErrors({});
    setCompanySaveError(null);

    try {
      // First-time onboarding: a user without any company creates one here so
      // they're not stranded on the "no company selected" dead-end. Existing
      // companies just get patched with the new details.
      if (company) {
        await saveCompanyMutation.mutateAsync(companyForm);
      } else {
        await createCompanyMutation.mutateAsync(companyForm);
      }
      goNext();
    } catch (err) {
      // Server validation: a 400/409 with a `field` hint maps back to the
      // offending input so the user can fix it without guessing. 5xx and
      // network failures surface the inline retry banner instead.
      const apiErr = err as ApiError;
      const status = apiErr?.status;
      const message = apiErr?.message || t["onboarding.saveCompanyFailedBody"];

      if (status && status >= 400 && status < 500) {
        // Heuristic: route the message back to the most likely field.
        const lower = (apiErr?.rawMessage ?? message).toLowerCase();
        if (lower.includes("trn")) {
          setCompanyFieldErrors({ trnVatNumber: message });
        } else if (lower.includes("email")) {
          setCompanyFieldErrors({ contactEmail: message });
        } else if (lower.includes("name") || lower.includes("already")) {
          setCompanyFieldErrors({ name: message });
        } else {
          setCompanySaveError(message);
        }
        toast({
          title: t["onboarding.checkDetails"],
          description: message,
          variant: "destructive",
        });
      } else {
        setCompanySaveError(message);
        toast({
          title: t["onboarding.couldNotSaveCompany"],
          description: message,
          variant: "destructive",
        });
      }
    }
  }

  // Express setup: one screen → company created (chart of accounts auto-seeds
  // server-side) → onboarding marked complete → straight to the dashboard.
  const [expressSaving, setExpressSaving] = useState(false);

  async function handleExpressSetup(data: { name: string; emirate: string; trnVatNumber: string }) {
    setExpressSaving(true);
    try {
      const payload = { ...companyForm, ...data };
      let target = company;
      if (target) {
        await saveCompanyMutation.mutateAsync(payload);
      } else {
        target = await createCompanyMutation.mutateAsync(payload);
      }
      await apiRequest("POST", `/api/companies/${target.id}/onboarding/complete`, {});
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      localStorage.removeItem(STORAGE_KEY(target.id));
      toast({
        title: t["onboarding.booksReady"],
        description: t["onboarding.booksReadyBody"],
      });
      setLocation("/dashboard");
    } catch (err) {
      const message = (err as ApiError)?.message ?? t["onboarding.tryAgainDot"];
      toast({
        title: t["onboarding.expressFailed"],
        description: message,
        variant: "destructive",
      });
    } finally {
      setExpressSaving(false);
    }
  }

  async function handleBankNext() {
    if (bankForm.nameEn && bankForm.bankName) {
      await createBankMutation.mutateAsync(bankForm);
    }
    goNext();
  }

  async function handleComplete() {
    await completeMutation.mutateAsync();
    goTo("complete", 1);
  }

  if (companiesLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const progressPercent = (stepIndex(currentStep) / (STEPS.length - 1)) * 100;

  const variants = {
    enter: (dir: number) => ({ opacity: 0, x: dir > 0 ? 48 : -48 }),
    center: { opacity: 1, x: 0 },
    exit: (dir: number) => ({ opacity: 0, x: dir > 0 ? -48 : 48 }),
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Fixed background blobs */}
      <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-primary/8 rounded-full blur-[128px]" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-chart-5/8 rounded-full blur-[128px]" />
      </div>

      {/* Header */}
      <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-10 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center">
            <Briefcase className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-lg">
            {/* i18n-ignore: brand or sample data */}Muhasib.ai
          </span>
        </Link>

        {currentStep !== "welcome" && currentStep !== "complete" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              // Mark onboarding complete so the user is not bounced back here
              // by ProtectedLayout's redirect on every navigation.
              if (company) {
                try {
                  await completeMutation.mutateAsync();
                } catch {}
              }
              setLocation("/dashboard");
            }}
            disabled={completeMutation.isPending}
            className="text-muted-foreground text-sm"
          >
            <T k="pageLabels.saveContinueLater" />
          </Button>
        )}
      </header>

      {/* Progress bar */}
      {currentStep !== "complete" && (
        <div className="px-6 pt-6 max-w-2xl mx-auto w-full">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-muted-foreground">
              {formatMessage(t["onboarding.stepBadge"], {
                current: stepIndex(currentStep) + 1,
                total: STEPS.length,
              })}
            </span>
            <span className="text-sm text-muted-foreground">{t[STEP_LABEL_KEYS[currentStep]]}</span>
          </div>
          <Progress
            value={progressPercent}
            className="h-1.5"
            aria-label={t["onboarding.progress"]}
          />
          <div className="flex justify-between mt-2">
            {STEPS.map((s) => (
              <div
                key={s}
                className={`w-2 h-2 rounded-full transition-colors ${
                  stepIndex(s) <= stepIndex(currentStep) ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Step content */}
      <main className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-2xl">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={currentStep}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              {currentStep === "welcome" && (
                <WelcomeStep
                  companyName={company?.name}
                  onNext={goNext}
                  onExpress={handleExpressSetup}
                  expressSaving={expressSaving}
                />
              )}
              {currentStep === "company" && (
                <CompanyStep
                  form={companyForm}
                  fieldErrors={companyFieldErrors}
                  saveError={companySaveError}
                  onChange={(f) => {
                    // Clear any inline error for the field the user is editing.
                    setCompanyForm((p) => ({ ...p, ...f }));
                    setCompanyFieldErrors((prev) => {
                      const next = { ...prev };
                      for (const key of Object.keys(f) as (keyof CompanyFormState)[]) {
                        delete next[key];
                      }
                      return next;
                    });
                  }}
                  onNext={handleCompanyNext}
                  onBack={goBack}
                  onRetry={() => {
                    setCompanySaveError(null);
                    void handleCompanyNext();
                  }}
                  saving={saveCompanyMutation.isPending || createCompanyMutation.isPending}
                />
              )}
              {currentStep === "accounts" && (
                <AccountsStep
                  companyId={company?.id ?? null}
                  accountCount={accountsData?.length ?? 0}
                  onNext={goNext}
                  onBack={goBack}
                />
              )}
              {currentStep === "bank" && (
                <BankStep
                  form={bankForm}
                  existingAccounts={bankAccounts ?? []}
                  onChange={(f) => setBankForm((p) => ({ ...p, ...f }))}
                  onNext={handleBankNext}
                  onBack={goBack}
                  saving={createBankMutation.isPending}
                />
              )}
              {currentStep === "first-doc" && (
                <FirstDocStep
                  onComplete={handleComplete}
                  onBack={goBack}
                  completing={completeMutation.isPending}
                />
              )}
              {currentStep === "complete" && (
                <CompleteStep onGoToDashboard={() => setLocation("/dashboard")} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

// ─── Step: Welcome ──────────────────────────────────────────────────────────

function WelcomeStep({
  companyName,
  onNext,
  onExpress,
  expressSaving,
}: {
  companyName?: string;
  onNext: () => void;
  // i18n-ignore: TypeScript type, not UI text
  onExpress: (data: { name: string; emirate: string; trnVatNumber: string }) => Promise<void>;
  expressSaving: boolean;
}) {
  const { t } = useTranslation();
  const tr = t as Record<string, string>;
  const [name, setName] = useState(companyName ?? "");
  const [emirate, setEmirate] = useState("dubai");
  const [trn, setTrn] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleExpress() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(tr["forms.errors.companyNameRequired"]);
      return;
    }
    if (trn.trim() && !/^[0-9]{15}$/.test(trn.trim())) {
      setError(tr["forms.errors.uaeTrn15Digits"]);
      return;
    }
    setError(null);
    await onExpress({ name: trimmed, emirate, trnVatNumber: trn.trim() });
  }

  return (
    <div className="text-center space-y-8">
      <div className="space-y-3">
        <Badge variant="secondary" className="px-3 py-1">
          <T k="onboarding.step.welcome.title" />
        </Badge>
        <h1 className="font-display text-[34px] md:text-[40px] leading-[1.05] tracking-tight">
          {companyName
            ? formatMessage(tr["onboarding.helloCompany"], { name: companyName })
            : tr["onboarding.booksReadyTitle"]}
        </h1>
        <p className="text-muted-foreground text-lg max-w-md mx-auto">
          <T k="onboarding.expressIntro" />
        </p>
      </div>

      {/* Express setup — the 90-second path */}
      <Card className="max-w-md mx-auto text-left border-accent/30 shadow-lg">
        <CardContent className="p-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="express-name">{tr.companyNameLabel}</Label>
            <Input
              id="express-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder={t["onboarding.expressPlaceholder"]}
              disabled={expressSaving}
              data-testid="express-company-name"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{tr["onboarding.emirateFallback"]}</Label>
              <Select value={emirate} onValueChange={setEmirate} disabled={expressSaving}>
                <SelectTrigger
                  aria-label={tr["onboarding.emirateFallback"]}
                  data-testid="express-emirate"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UAE_EMIRATES.map((e) => (
                    <SelectItem key={e.value} value={e.value}>
                      {t[e.label]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="express-trn">{tr["screens.trnOptional"]}</Label>
              <Input
                id="express-trn"
                value={trn}
                onChange={(e) => {
                  setTrn(e.target.value);
                  setError(null);
                }}
                placeholder={t["onboarding.trnDigitsPlaceholder"]}
                inputMode="numeric"
                maxLength={15}
                disabled={expressSaving}
                data-testid="express-trn"
              />
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" /> {error}
            </p>
          )}
          <Button
            size="lg"
            className="w-full gap-2"
            onClick={handleExpress}
            disabled={expressSaving}
            data-testid="onboarding-express"
          >
            {expressSaving ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" /> {tr.settingUpBooks}
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" /> {tr.setUpMyBooks}
              </>
            )}
          </Button>
          <p className="text-[11.5px] text-muted-foreground text-center leading-relaxed">
            <T k="onboarding.expressSeedNote" />
          </p>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Button
          variant="ghost"
          onClick={onNext}
          className="gap-2 text-muted-foreground hover:text-foreground"
          data-testid="onboarding-start"
        >
          <T k="onboarding.guidedTourPrompt" />
          <ArrowRight className="w-4 h-4" />
        </Button>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-start">
          {[
            {
              icon: Building2,
              title: t["onboarding.cardCompanyProfile"],
              desc: t["onboarding.cardCompanyProfileDesc"],
            },
            {
              icon: BookOpen,
              title: t["onboarding.step.accounts.title"],
              desc: t["onboarding.cardAccountsDesc"],
            },
            {
              icon: Landmark,
              title: t["pageLabels.bankAccount"],
              desc: t["onboarding.bankCardDesc"],
            },
          ].map(({ icon: Icon, title, desc }) => (
            <Card key={title} className="border border-border/50">
              <CardContent className="p-4 space-y-2">
                <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center">
                  <Icon className="w-5 h-5 text-accent" />
                </div>
                <p className="font-medium text-sm">{title}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Step: Company Details ──────────────────────────────────────────────────

interface CompanyFormState {
  name: string;
  trnVatNumber: string;
  registrationNumber: string;
  businessAddress: string;
  /** X5 (J1 L2/L3): city is its own field (e-invoices and the VAT 201 need it). */
  addressCity: string;
  contactPhone: string;
  contactEmail: string;
  emirate: string;
  /** X5 (J1 L2): collected up front so the profile never blocks a later save. */
  legalStructure: string;
  vatFilingFrequency: string;
  vatPeriodStartMonth: number;
}

const LEGAL_STRUCTURE_OPTIONS = [
  { value: "Sole Proprietorship", labelKey: "pages.soleProprietorship" },
  { value: "LLC", labelKey: "onboarding.legalStructureLlc" },
  { value: "Corporation", labelKey: "pages.corporation" },
  { value: "Partnership", labelKey: "pages.partnership" },
  { value: "Other", labelKey: "pages.other" },
] as const;

const VAT_FREQUENCY_OPTIONS = [
  { value: "Quarterly", labelKey: "pages.quarterly" },
  { value: "Monthly", labelKey: "pages.monthly" },
] as const;

/** Quarterly staggers: the FTA assigns periods starting in Jan, Feb or Mar (and every 3 months). */
const VAT_STAGGER_OPTIONS = [
  { value: 1, labelKey: "onboarding.vatStaggerJan" },
  { value: 2, labelKey: "onboarding.vatStaggerFeb" },
  { value: 3, labelKey: "onboarding.vatStaggerMar" },
] as const;

function CompanyStep({
  form,
  fieldErrors,
  saveError,
  onChange,
  onNext,
  onBack,
  onRetry,
  saving,
}: {
  form: CompanyFormState;
  fieldErrors: Partial<Record<keyof CompanyFormState, string>>;
  saveError: string | null;
  onChange: (f: Partial<CompanyFormState>) => void;
  onNext: () => void;
  onBack: () => void;
  onRetry: () => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <StepHeader
        icon={Building2}
        title={t["onboarding.companyDetailsTitle"]}
        description={t["onboarding.companyDetailsDescription"]}
      />

      {saveError && (
        <div
          role="alert"
          className="flex items-start gap-3 p-3 rounded-lg border border-destructive/40 bg-destructive/5 text-destructive"
          data-testid="onboarding-company-save-error"
        >
          <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
          <div className="flex-1 space-y-2">
            <p className="text-sm font-medium">
              <T k="pageLabels.weCouldnTSaveYourCompany" />
            </p>
            <p className="text-sm text-destructive/90">{saveError}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={onRetry}
              disabled={saving}
              data-testid="onboarding-company-retry"
              className="gap-2"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${saving ? "animate-spin" : ""}`} />
              {saving ? t["onboarding.retrying"] : t["einvoicing.retry"]}
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>
              <T k="pages.companyName" />
            </Label>
            <Input
              value={form.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder={t["onboarding.companyNamePlaceholder"]}
              aria-invalid={!!fieldErrors.name}
              data-testid="onboarding-company-name"
            />
            {fieldErrors.name && (
              <p className="text-xs text-destructive" data-testid="error-company-name">
                {fieldErrors.name}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>
              <T k="pages.emirate" />
            </Label>
            <Select value={form.emirate} onValueChange={(v) => onChange({ emirate: v })}>
              <SelectTrigger
                aria-label={t["onboarding.emirateFallback"]}
                data-testid="onboarding-emirate"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UAE_EMIRATES.map((e) => (
                  <SelectItem key={e.value} value={e.value}>
                    {t[e.label]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>
              <T k="onboarding.trnLabel" />
              <span className="text-muted-foreground ms-1 text-xs">
                {t["onboarding.optionalTrn"]}
              </span>
            </Label>
            <Input
              value={form.trnVatNumber}
              onChange={(e) => onChange({ trnVatNumber: e.target.value })}
              placeholder="100123456700003"
              inputMode="numeric"
              maxLength={15}
              aria-invalid={!!fieldErrors.trnVatNumber}
              data-testid="onboarding-trn"
            />
            {fieldErrors.trnVatNumber && (
              <p className="text-xs text-destructive" data-testid="error-trn">
                {fieldErrors.trnVatNumber}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>
              <T k="pageLabels.tradeLicenseNumber" />
              <span className="text-muted-foreground ms-1 text-xs">{t["onboarding.optional"]}</span>
            </Label>
            <Input
              value={form.registrationNumber}
              onChange={(e) => onChange({ registrationNumber: e.target.value })}
              placeholder="DED-12345"
              data-testid="onboarding-trade-license"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>
              <T k="pages.businessAddress" />
            </Label>
            <Input
              value={form.businessAddress}
              onChange={(e) => onChange({ businessAddress: e.target.value })}
              placeholder={t["onboarding.addressPlaceholder"]}
              data-testid="onboarding-address"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="onboarding-city">{t["onboarding.cityLabel"]}</Label>
            <Input
              id="onboarding-city"
              value={form.addressCity}
              onChange={(e) => onChange({ addressCity: e.target.value })}
              placeholder={t["onboarding.cityPlaceholder"]}
              data-testid="onboarding-city"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>{t["onboarding.legalStructureLabel"]}</Label>
            <Select
              value={form.legalStructure || undefined}
              onValueChange={(v) => onChange({ legalStructure: v })}
            >
              <SelectTrigger
                aria-label={t["onboarding.legalStructureLabel"]}
                data-testid="onboarding-legal-structure"
              >
                <SelectValue placeholder={t["onboarding.legalStructurePlaceholder"]} />
              </SelectTrigger>
              <SelectContent>
                {LEGAL_STRUCTURE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {t[o.labelKey]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {form.trnVatNumber.trim() !== "" && (
            <div className="space-y-1.5">
              <Label>{t["onboarding.vatFrequencyLabel"]}</Label>
              <Select
                value={form.vatFilingFrequency || undefined}
                onValueChange={(v) =>
                  onChange({
                    vatFilingFrequency: v,
                    ...(v === "Monthly" ? { vatPeriodStartMonth: 1 } : {}),
                  })
                }
              >
                <SelectTrigger
                  aria-label={t["onboarding.vatFrequencyLabel"]}
                  data-testid="onboarding-vat-frequency"
                >
                  <SelectValue placeholder={t["onboarding.vatFrequencyPlaceholder"]} />
                </SelectTrigger>
                <SelectContent>
                  {VAT_FREQUENCY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {t[o.labelKey]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {form.trnVatNumber.trim() !== "" && form.vatFilingFrequency === "Quarterly" && (
          <div className="space-y-1.5">
            <Label>{t["onboarding.vatStaggerLabel"]}</Label>
            <Select
              value={String(form.vatPeriodStartMonth || 1)}
              onValueChange={(v) => onChange({ vatPeriodStartMonth: Number(v) })}
            >
              <SelectTrigger
                aria-label={t["onboarding.vatStaggerLabel"]}
                data-testid="onboarding-vat-stagger"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VAT_STAGGER_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={String(o.value)}>
                    {t[o.labelKey]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t["onboarding.vatStaggerHint"]}</p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>
              <T k="pages.phone" />
            </Label>
            <Input
              value={form.contactPhone}
              onChange={(e) => onChange({ contactPhone: e.target.value })}
              placeholder="+971 4 123 4567"
              data-testid="onboarding-phone"
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              <T k="hr.field.email" />
            </Label>
            <Input
              type="email"
              value={form.contactEmail}
              onChange={(e) => onChange({ contactEmail: e.target.value })}
              placeholder="accounts@yourcompany.ae"
              aria-invalid={!!fieldErrors.contactEmail}
              data-testid="onboarding-email"
            />
            {fieldErrors.contactEmail && (
              <p className="text-xs text-destructive" data-testid="error-contact-email">
                {fieldErrors.contactEmail}
              </p>
            )}
          </div>
        </div>
      </div>

      <StepNav
        onBack={onBack}
        onNext={onNext}
        nextLabel={t["onboarding.saveContinue"]}
        loading={saving}
      />
    </div>
  );
}

// ─── Step: Chart of Accounts ────────────────────────────────────────────────

function AccountsStep({
  companyId,
  accountCount,
  onNext,
  onBack,
}: {
  companyId: string | null;
  accountCount: number;
  onNext: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const categories = [
    { label: t["onboarding.cat.assets"], description: t["onboarding.cat.assetsDesc"] },
    { label: t["onboarding.cat.liabilities"], description: t["onboarding.cat.liabilitiesDesc"] },
    { label: t["onboarding.cat.equity"], description: t["onboarding.cat.equityDesc"] },
    { label: t["onboarding.cat.revenue"], description: t["onboarding.cat.revenueDesc"] },
    { label: t["onboarding.cat.expenses"], description: t["onboarding.cat.expensesDesc"] },
    { label: t["onboarding.cat.vat"], description: t["onboarding.cat.vatDesc"] },
  ];

  return (
    <div className="space-y-6">
      <StepHeader
        icon={BookOpen}
        title={t["onboarding.step.accounts.title"]}
        description={t["onboarding.accountsReadyDescription"]}
      />

      <Card className="border-success/30 bg-success-subtle ">
        <CardContent className="p-4 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
          <div>
            <p className="text-sm font-medium text-success-subtle-foreground ">
              {accountCount > 0
                ? formatMessage(t["onboarding.accountsConfigured"], { count: accountCount })
                : t["onboarding.presetApplied"]}
            </p>
            <p className="text-xs text-success ">{t["onboarding.standardCategories"]}</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {categories.map(({ label, description }) => (
          <div
            key={label}
            className="flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-muted/30"
          >
            <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        {t["onboarding.customiseAnytime"].split("{link}").flatMap((part, i) =>
          i === 0
            ? [part]
            : [
                <Link key="link" href="/chart-of-accounts" className="underline text-primary">
                  <T k="onboarding.step.accounts.title" />
                </Link>,
                part,
              ]
        )}
      </p>

      {companyId && <GuidedSetupExtras companyId={companyId} />}

      <StepNav onBack={onBack} onNext={onNext} nextLabel={t["onboarding.looksGoodContinue"]} />
    </div>
  );
}

// ─── W5-B (R19-18): industry COA template, TRN check, optional import ────────

const GUIDED_COPY = {
  en: {
    templateTitle: "Add accounts for your industry",
    apply: "Add accounts",
    added: "accounts added",
    trnTitle: "TRN check",
    trnValid: "TRN format is valid. Confirm it on the FTA EmaraTax TRN verification page.",
    trnMissing: "No TRN saved yet. Add it in company settings when you register for VAT.",
    importTitle: "Moving from Xero, QuickBooks, Zoho Books or Wafeq?",
    importHelp:
      "Import your chart of accounts, opening balances, contacts, items and open invoices.",
    importDone: "Data imported",
    importCta: "Open Import data",
  },
  ar: {
    templateTitle: "أضف حسابات لنشاطك",
    apply: "إضافة الحسابات",
    added: "حسابات أُضيفت",
    trnTitle: "التحقق من الرقم الضريبي",
    trnValid: "صيغة الرقم الضريبي صحيحة. تحقق منه في صفحة التحقق على منصة إمارات تاكس.",
    trnMissing:
      "لم يُحفظ رقم ضريبي بعد. أضفه في إعدادات الشركة عند التسجيل في ضريبة القيمة المضافة.",
    importTitle: "تنتقل من زيرو أو كويك بوكس أو زوهو بوكس أو وافق؟",
    importHelp:
      "استورد دليل الحسابات والأرصدة الافتتاحية وجهات الاتصال والأصناف والفواتير المفتوحة.",
    importDone: "تم استيراد البيانات",
    importCta: "فتح استيراد البيانات",
  },
};

function GuidedSetupExtras({ companyId }: { companyId: string }) {
  const { locale } = useTranslation();
  const c = GUIDED_COPY[locale === "ar" ? "ar" : "en"];
  const { toast } = useToast();
  const [templateId, setTemplateId] = useState("general");
  const { data: templates } = useQuery<
    Array<{ id: string; label: { en: string; ar: string }; accounts: number }>
  >({ queryKey: ["/api/onboarding/coa-templates"] });
  const { data: steps } = useQuery<{
    importData: { done: boolean };
    trn: { done: boolean; value: string | null; reason: string | null };
  }>({ queryKey: ["/api/onboarding/optional-steps"] });
  const apply = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/onboarding/coa-template`, { templateId }),
    onSuccess: (r: { added: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "accounts"] });
      toast({ title: `${r.added} ${c.added}` });
    },
  });
  return (
    <div className="space-y-3">
      <div className="rounded-lg border p-3 space-y-2">
        <p className="text-sm font-medium">{c.templateTitle}</p>
        <div className="flex flex-wrap gap-2">
          {(templates ?? []).map((tpl) => (
            <Button
              key={tpl.id}
              type="button"
              size="sm"
              variant={templateId === tpl.id ? "default" : "outline"}
              onClick={() => setTemplateId(tpl.id)}
              data-testid={`coa-template-${tpl.id}`}
            >
              {locale === "ar" ? tpl.label.ar : tpl.label.en}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={templateId === "general" || apply.isPending}
            onClick={() => apply.mutate()}
          >
            {c.apply}
          </Button>
        </div>
      </div>
      <div className="rounded-lg border p-3">
        <p className="text-sm font-medium">{c.trnTitle}</p>
        <p className="text-xs text-muted-foreground" data-testid="onboarding-trn-check">
          {steps?.trn.value ? (steps.trn.done ? c.trnValid : steps.trn.reason) : c.trnMissing}
        </p>
      </div>
      <div className="rounded-lg border p-3">
        <p className="text-sm font-medium">{c.importTitle}</p>
        <p className="text-xs text-muted-foreground">
          {steps?.importData.done ? c.importDone : c.importHelp}
        </p>
        <Link href="/import" className="text-xs underline text-primary">
          {c.importCta}
        </Link>
      </div>
    </div>
  );
}

// ─── Step: Bank Account ─────────────────────────────────────────────────────

interface BankFormState {
  nameEn: string;
  bankName: string;
  accountNumber: string;
  iban: string;
  currency: string;
}

function BankStep({
  form,
  existingAccounts,
  onChange,
  onNext,
  onBack,
  saving,
}: {
  form: BankFormState;
  existingAccounts: { id: string; nameEn: string; bankName: string }[];
  onChange: (f: Partial<BankFormState>) => void;
  onNext: () => void;
  onBack: () => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  if (existingAccounts.length > 0) {
    return (
      <div className="space-y-6">
        <StepHeader
          icon={Landmark}
          title={t["pageLabels.bankAccount"]}
          description={t["onboarding.bankConnectedDescription"]}
        />
        <Card className="border-success/30 bg-success-subtle ">
          <CardContent className="p-4 space-y-2">
            {existingAccounts.map((a) => (
              <div key={a.id} className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-success" />
                <span className="text-sm font-medium">{a.nameEn}</span>
                <span className="text-xs text-muted-foreground">— {a.bankName}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <StepNav onBack={onBack} onNext={onNext} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StepHeader
        icon={Landmark}
        title={t["pageLabels.bankAccount"]}
        description={t["onboarding.bankAddDescription"]}
      />

      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>
              <T k="pageLabels.accountDisplayName" />
            </Label>
            <Input
              value={form.nameEn}
              onChange={(e) => onChange({ nameEn: e.target.value })}
              placeholder={t["onboarding.bankNamePlaceholder"]}
              data-testid="onboarding-bank-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t["onboarding.bankLabel"]}</Label>
            <Select value={form.bankName} onValueChange={(v) => onChange({ bankName: v })}>
              <SelectTrigger
                aria-label={t["onboarding.bankLabel"]}
                data-testid="onboarding-bank-select"
              >
                <SelectValue placeholder={t["onboarding.selectBank"]} />
              </SelectTrigger>
              <SelectContent>
                {UAE_BANKS.map((b) => (
                  <SelectItem key={b} value={b}>
                    {t[`onboarding.bank.${b}`] ?? b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>
              <T k="pages.accountNumber" />
              <span className="text-muted-foreground ms-1 text-xs">{t["onboarding.optional"]}</span>
            </Label>
            <Input
              value={form.accountNumber}
              onChange={(e) => onChange({ accountNumber: e.target.value })}
              placeholder="1234567890"
              data-testid="onboarding-account-number"
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              {t["onboarding.ibanLabel"]}
              <span className="text-muted-foreground ms-1 text-xs">{t["onboarding.optional"]}</span>
            </Label>
            <Input
              value={form.iban}
              onChange={(e) => onChange({ iban: e.target.value })}
              placeholder="AE070331234567890123456"
              data-testid="onboarding-iban"
            />
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} className="gap-1">
          <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
          {t["components.back"]}
        </Button>
        <Button
          variant="outline"
          onClick={onNext}
          className="text-muted-foreground"
          data-testid="onboarding-skip-bank"
        >
          <T k="onboarding.skip" />
        </Button>
        <Button
          onClick={onNext}
          disabled={!form.nameEn || !form.bankName || saving}
          className="flex-1 gap-2"
          data-testid="onboarding-save-bank"
        >
          {saving ? t["forms.saving"] : t["onboarding.saveContinue"]}
          <ArrowRight className="w-4 h-4 rtl:rotate-180" />
        </Button>
      </div>
    </div>
  );
}

// ─── Step: First Document ───────────────────────────────────────────────────

function FirstDocStep({
  onComplete,
  onBack,
  completing,
}: {
  onComplete: () => void;
  onBack: () => void;
  completing: boolean;
}) {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();

  const options = [
    {
      icon: FileText,
      title: t["onboarding.docInvoiceTitle"],
      description: t["onboarding.docInvoiceDesc"],
      action: "/invoices",
      testId: "onboarding-goto-invoice",
    },
    {
      icon: Receipt,
      title: t["onboarding.docReceiptTitle"],
      description: t["onboarding.docReceiptDesc"],
      action: "/receipts",
      testId: "onboarding-goto-receipt",
    },
  ];

  const handleOptionClick = async (path: string) => {
    await onComplete();
    setLocation(path);
  };

  return (
    <div className="space-y-6">
      <StepHeader
        icon={FileText}
        title={t["onboarding.firstDocTitle"]}
        description={t["onboarding.firstDocDescription"]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {options.map(({ icon: Icon, title, description, action, testId }) => (
          <button
            key={title}
            onClick={() => handleOptionClick(action)}
            disabled={completing}
            data-testid={testId}
            className="text-start p-5 rounded-xl border border-border hover:border-primary hover:bg-primary/5 transition-all group"
          >
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3 group-hover:bg-primary/20 transition-colors">
              <Icon className="w-5 h-5 text-primary" />
            </div>
            <p className="font-semibold text-sm mb-1">{title}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
            <div className="flex items-center gap-1 mt-3 text-xs text-primary font-medium">
              <T k="pageLabels.getStarted" /> <ChevronRight className="w-3 h-3" />
            </div>
          </button>
        ))}
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} className="gap-1">
          <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
          {t["components.back"]}
        </Button>
        <Button
          variant="ghost"
          onClick={onComplete}
          disabled={completing}
          className="flex-1 text-muted-foreground"
          data-testid="onboarding-skip-doc"
        >
          {completing ? t["onboarding.firm.finishing"] : t["onboarding.doLater"]}
        </Button>
      </div>
    </div>
  );
}

// ─── Step: Complete ─────────────────────────────────────────────────────────

function CompleteStep({ onGoToDashboard }: { onGoToDashboard: () => void }) {
  const { t } = useTranslation();
  const ct = useCatalogText();
  const [showMore, setShowMore] = useState(false);
  const [, setLocation] = useLocation();
  const [selectedPersona, setSelectedPersona] = useState<ReportPersona>(
    () => getPreferredReportPersona() ?? "owner"
  );
  const selectedWorkspace =
    reportPersonaWorkspaces.find((workspace) => workspace.persona === selectedPersona) ??
    reportPersonaWorkspaces[0];
  const selectedReportPackTemplates = reportPackTemplates.filter(
    (template) => template.persona === selectedWorkspace.persona
  );
  const selectedReportSuites = reportSuiteProfiles.filter(
    (suite) => suite.persona === selectedWorkspace.persona
  );
  const selectedQuickAccessProfile = reportQuickAccessProfiles.find(
    (profile) => profile.persona === selectedWorkspace.persona
  );
  const selectedQuickAccessReports =
    selectedQuickAccessProfile?.reportIds
      .map((reportId) => reportCatalog.find((report) => report.id === reportId))
      .filter((report): report is (typeof reportCatalog)[number] => Boolean(report)) ?? [];
  const selectedSavedViews = reportSavedViewProfiles.filter(
    (view) => view.persona === selectedWorkspace.persona
  );
  const selectedAutomationImpactProfile = reportAutomationImpactProfiles.find(
    (profile) => profile.persona === selectedWorkspace.persona
  );
  const selectedDecisionShortcuts = reportDecisionShortcuts.filter(
    (shortcut) => shortcut.persona === selectedWorkspace.persona
  );
  const selectedComparisonPresets = reportComparisonPresets.filter(
    (preset) => preset.persona === selectedWorkspace.persona
  );
  const selectedTriggerRules = reportAutomationTriggerRules.filter(
    (rule) => rule.persona === selectedWorkspace.persona
  );
  const selectedDeliverySubscriptions = reportDeliverySubscriptions.filter(
    (subscription) => subscription.persona === selectedWorkspace.persona
  );
  const selectedAutomationStarters = reportAutomationStarters.filter(
    (starter) => starter.persona === selectedWorkspace.persona
  );

  const features = [
    { icon: LayoutDashboard, label: t["onboarding.featureDashboard"], href: "/dashboard" },
    { icon: FileText, label: t["onboarding.featureInvoices"], href: "/invoices" },
    { icon: Receipt, label: t["onboarding.featureReceipts"], href: "/receipts" },
    { icon: BookOpen, label: t["onboarding.step.accounts.title"], href: "/chart-of-accounts" },
    { icon: Users, label: t["onboarding.featureContacts"], href: "/contacts" },
  ];

  return (
    <div className="text-center space-y-8">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 15 }}
        className="flex justify-center"
      >
        <div className="w-24 h-24 rounded-full bg-success-subtle flex items-center justify-center">
          <CheckCircle2 className="w-12 h-12 text-success" />
        </div>
      </motion.div>

      <div className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">
          <T k="pageLabels.youReAllSet" />
        </h1>
        <p className="text-muted-foreground text-lg max-w-md mx-auto">
          {t["onboarding.completeIntro"]}
        </p>
      </div>

      <div className="space-y-3 max-w-2xl mx-auto">
        <div className="flex items-center justify-center gap-2 text-sm font-medium">
          <BarChart3 className="w-4 h-4 text-primary" />
          <T k="pageLabels.reportingWorkspace" />
        </div>
        <div
          className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-start"
          data-testid="onboarding-report-workspaces"
        >
          {reportPersonaWorkspaces.map((workspace) => {
            const selected = workspace.persona === selectedPersona;
            return (
              <button
                key={workspace.persona}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  setSelectedPersona(workspace.persona);
                  setPreferredReportPersona(workspace.persona);
                }}
                data-testid={`onboarding-report-workspace-${workspace.persona}`}
                className={`rounded-md border p-4 transition-all ${
                  selected
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-border hover:border-primary hover:bg-primary/5"
                }`}
              >
                <p className="text-sm font-semibold">
                  {ct("workspace", workspace.persona, "navLabel", workspace.navLabel)}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {ct("workspace", workspace.persona, "focus", workspace.focus)}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {ct(
                    "workspace",
                    workspace.persona,
                    "automationOutcome",
                    workspace.automationOutcome
                  )}
                </p>
                <p className="mt-3 text-[11px] font-medium text-primary">
                  {formatMessage(t["onboarding.automationLanes"], {
                    n: workspace.automations.length,
                  })}
                </p>
              </button>
            );
          })}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={showMore}
          onClick={() => setShowMore((open) => !open)}
          className="mx-auto gap-1"
          data-testid="onboarding-report-more-toggle"
        >
          {showMore ? t["onboarding.hideReportTools"] : t["onboarding.showReportTools"]}
        </Button>
        {showMore ? (
          <div className="space-y-3" data-testid="onboarding-report-more">
            <div
              className="grid grid-cols-1 gap-3 text-start sm:grid-cols-2"
              data-testid="onboarding-report-quick-access-impact"
            >
              {selectedQuickAccessProfile ? (
                <button
                  type="button"
                  onClick={() => {
                    setPreferredReportPersona(selectedWorkspace.persona);
                    setLocation(reportSectionHref(selectedWorkspace, "quick-access"));
                  }}
                  className="rounded-md border border-border p-4 transition-all hover:border-primary hover:bg-primary/5"
                  data-testid={`onboarding-report-quick-access-${selectedWorkspace.persona}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {ct.cx(selectedQuickAccessProfile.title)}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {ct.cx(selectedQuickAccessProfile.outcome)}
                      </p>
                    </div>
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                  <p className="mt-3 text-[11px] font-medium text-primary">
                    {formatMessage(t["onboarding.readyReports"], {
                      n: selectedQuickAccessProfile.reportIds.length,
                    })}
                  </p>
                </button>
              ) : null}
              {selectedAutomationImpactProfile ? (
                <button
                  type="button"
                  onClick={() => {
                    setPreferredReportPersona(selectedWorkspace.persona);
                    setLocation(reportSectionHref(selectedWorkspace, "automation-impact"));
                  }}
                  className="rounded-md border border-border p-4 transition-all hover:border-primary hover:bg-primary/5"
                  data-testid={`onboarding-report-automation-impact-${selectedWorkspace.persona}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {ct(
                          "impact",
                          selectedAutomationImpactProfile.persona,
                          "title",
                          selectedAutomationImpactProfile.title
                        )}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {ct(
                          "impact",
                          selectedAutomationImpactProfile.persona,
                          "outcome",
                          selectedAutomationImpactProfile.outcome
                        )}
                      </p>
                    </div>
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                  <p className="mt-3 text-[11px] font-medium text-primary">
                    {ct.cx(selectedAutomationImpactProfile.timeSavedLabel)} ·{" "}
                    {ct.cx(selectedAutomationImpactProfile.manualWorkLabel)}
                  </p>
                </button>
              ) : null}
            </div>
            {selectedQuickAccessReports.length > 0 ? (
              <div
                className="grid grid-cols-1 gap-3 text-start sm:grid-cols-2 lg:grid-cols-3"
                data-testid={`onboarding-report-quick-access-reports-${selectedWorkspace.persona}`}
              >
                {selectedQuickAccessReports.slice(0, 6).map((report) => (
                  <button
                    key={report.id}
                    type="button"
                    onClick={() => {
                      setPreferredReportPersona(selectedWorkspace.persona);
                      setLocation(
                        reportPersonaHref(report, selectedWorkspace.persona) ??
                          reportWorkspaceHref(selectedWorkspace)
                      );
                    }}
                    className="rounded-md border border-border p-3 transition-all hover:border-primary hover:bg-primary/5"
                    data-testid={`onboarding-report-quick-access-report-${selectedWorkspace.persona}-${report.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {ct("report", report.id, "name", report.name)}
                        </p>
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                          {ct("report", report.id, "decisionQuestion", report.decisionQuestion)}
                        </p>
                      </div>
                      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    </div>
                    <p className="mt-3 text-[11px] font-medium text-primary">
                      {ct.cx(report.comparison)}
                    </p>
                  </button>
                ))}
              </div>
            ) : null}
            <div
              className="grid grid-cols-1 gap-3 text-start sm:grid-cols-2"
              data-testid="onboarding-report-suites"
            >
              {selectedReportSuites.map((suite) => (
                <button
                  key={suite.id}
                  type="button"
                  onClick={() => {
                    setPreferredReportPersona(selectedWorkspace.persona);
                    setLocation(reportSuiteHref(suite));
                  }}
                  className="rounded-md border border-border p-4 transition-all hover:border-primary hover:bg-primary/5"
                  data-testid={`onboarding-report-suite-${suite.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {ct("suite", suite.id, "title", suite.title)}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {ct("suite", suite.id, "workflow", suite.workflow)}
                      </p>
                    </div>
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                  <p className="mt-3 text-[11px] font-medium text-primary">
                    {formatMessage(t["onboarding.reportsAction"], {
                      n: suite.reportIds.length,
                      lead: ct.cx(suite.primaryAction),
                    })}
                  </p>
                </button>
              ))}
            </div>
            <div
              className="grid grid-cols-1 gap-3 text-start sm:grid-cols-3"
              data-testid="onboarding-report-decision-shortcuts"
            >
              {selectedDecisionShortcuts.map((shortcut) => (
                <button
                  key={shortcut.id}
                  type="button"
                  onClick={() => {
                    setPreferredReportPersona(selectedWorkspace.persona);
                    setLocation(reportDecisionShortcutHref(shortcut));
                  }}
                  className="rounded-md border border-border p-4 transition-all hover:border-primary hover:bg-primary/5"
                  data-testid={`onboarding-report-decision-shortcut-${shortcut.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {ct("shortcut", shortcut.id, "question", shortcut.question)}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {ct("shortcut", shortcut.id, "answer", shortcut.answer)}
                      </p>
                    </div>
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                  <p className="mt-3 text-[11px] font-medium text-primary">
                    {formatMessage(t["onboarding.linkedReports"], { n: shortcut.reportIds.length })}
                  </p>
                </button>
              ))}
            </div>
            <div
              className="grid grid-cols-1 gap-3 text-start sm:grid-cols-2"
              data-testid="onboarding-report-comparison-presets"
            >
              {selectedComparisonPresets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    setPreferredReportPersona(selectedWorkspace.persona);
                    setLocation(reportComparisonPresetHref(preset));
                  }}
                  className="rounded-md border border-border p-4 transition-all hover:border-primary hover:bg-primary/5"
                  data-testid={`onboarding-report-comparison-preset-${preset.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {ct("preset", preset.id, "title", preset.title)}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {ct("preset", preset.id, "question", preset.question)}
                      </p>
                    </div>
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                  <p className="mt-3 text-[11px] font-medium text-primary">
                    {formatMessage(t["onboarding.baselineMetrics"], {
                      lead: ct("preset", preset.id, "baseline", preset.baseline),
                      n: preset.metricIds.length,
                    })}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {ct("preset", preset.id, "automationTrigger", preset.automationTrigger)}
                  </p>
                </button>
              ))}
            </div>
            <div
              className="grid grid-cols-1 gap-3 text-start sm:grid-cols-3"
              data-testid="onboarding-report-saved-views"
            >
              {selectedSavedViews.map((view) => (
                <button
                  key={view.id}
                  type="button"
                  onClick={() => {
                    setPreferredReportPersona(selectedWorkspace.persona);
                    setLocation(reportSavedViewHref(view));
                  }}
                  className="rounded-md border border-border p-4 transition-all hover:border-primary hover:bg-primary/5"
                  data-testid={`onboarding-report-saved-view-${view.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{ct.cx(view.title)}</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {ct.cx(view.description)}
                      </p>
                    </div>
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                  <p className="mt-3 text-[11px] font-medium text-primary">
                    {ct.cx(view.dateRangePreset)} · {ct.cx(view.comparisonPeriod)}
                  </p>
                </button>
              ))}
            </div>
            <div
              className="grid grid-cols-1 gap-3 text-start sm:grid-cols-3"
              data-testid="onboarding-report-trigger-rules"
            >
              {selectedTriggerRules.map((rule) => (
                <button
                  key={rule.id}
                  type="button"
                  onClick={() => {
                    setPreferredReportPersona(selectedWorkspace.persona);
                    setLocation(reportAutomationTriggerRuleHref(rule));
                  }}
                  className="rounded-md border border-border p-4 transition-all hover:border-primary hover:bg-primary/5"
                  data-testid={`onboarding-report-trigger-rule-${rule.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{ct.cx(rule.title)}</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {ct.cx(rule.threshold)}
                      </p>
                    </div>
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                  <p className="mt-3 text-[11px] font-medium text-primary">
                    {formatMessage(t["onboarding.cadenceReports"], {
                      lead: ct.cx(rule.cadence),
                      n: rule.reportIds.length,
                    })}
                  </p>
                </button>
              ))}
            </div>
            <div
              className="grid grid-cols-1 gap-3 text-start sm:grid-cols-2"
              data-testid="onboarding-report-delivery-subscriptions"
            >
              {selectedDeliverySubscriptions.map((subscription) => (
                <button
                  key={subscription.id}
                  type="button"
                  onClick={() => {
                    setPreferredReportPersona(selectedWorkspace.persona);
                    setLocation(reportDeliverySubscriptionHref(subscription));
                  }}
                  className="rounded-md border border-border p-4 transition-all hover:border-primary hover:bg-primary/5"
                  data-testid={`onboarding-report-delivery-subscription-${subscription.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {ct("delivery", subscription.id, "title", subscription.title)}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {ct.cx(subscription.cadence)}
                      </p>
                    </div>
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                  <p className="mt-3 text-[11px] font-medium text-primary">
                    {formatMessage(t["onboarding.cadenceReports"], {
                      lead: ct.cx(subscription.channel),
                      n: subscription.reportIds.length,
                    })}
                  </p>
                </button>
              ))}
            </div>
            <div
              className="grid grid-cols-1 gap-3 text-start sm:grid-cols-2"
              data-testid="onboarding-report-automation-starters"
            >
              {selectedAutomationStarters.map((starter) => (
                <button
                  key={starter.id}
                  type="button"
                  onClick={() => {
                    setPreferredReportPersona(selectedWorkspace.persona);
                    setLocation(reportAutomationStarterHref(starter));
                  }}
                  className="rounded-md border border-border p-4 transition-all hover:border-primary hover:bg-primary/5"
                  data-testid={`onboarding-report-automation-starter-${starter.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {ct("starter", starter.id, "title", starter.title)}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {ct("starter", starter.id, "outcome", starter.outcome)}
                      </p>
                    </div>
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                  <p className="mt-3 text-[11px] font-medium text-primary">
                    {formatMessage(t["onboarding.setupSteps"], {
                      lead: ct.cx(starter.setupTime),
                      n: starter.setupSteps.length,
                    })}
                  </p>
                </button>
              ))}
            </div>
            <div
              className="grid grid-cols-1 gap-3 text-start sm:grid-cols-2"
              data-testid="onboarding-report-pack-templates"
            >
              {selectedReportPackTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => {
                    setPreferredReportPersona(selectedWorkspace.persona);
                    setLocation(reportPackTemplateHref(template));
                  }}
                  className="rounded-md border border-border p-4 transition-all hover:border-primary hover:bg-primary/5"
                  data-testid={`onboarding-report-pack-template-${template.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {ct("pack", template.id, "title", template.title)}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {ct("pack", template.id, "outcome", template.outcome)}
                      </p>
                    </div>
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                  <p className="mt-3 text-[11px] font-medium text-primary">
                    {formatMessage(t["onboarding.cadenceReports"], {
                      lead: ct("pack", template.id, "cadence", template.cadence),
                      n: template.reportIds.length,
                    })}
                  </p>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="flex flex-col justify-center gap-2 sm:flex-row">
          <Button
            size="lg"
            onClick={() => {
              setPreferredReportPersona(selectedWorkspace.persona);
              setLocation(reportSectionHref(selectedWorkspace, "automation-operations"));
            }}
            className="gap-2 px-8"
            data-testid="onboarding-open-report-operations"
          >
            <T k="pageLabels.openReportOperations" />
            <ArrowRight className="w-4 h-4" />
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => {
              setPreferredReportPersona(selectedWorkspace.persona);
              setLocation(reportWorkspaceHref(selectedWorkspace));
            }}
            className="gap-2 px-8"
            data-testid="onboarding-open-report-workspace"
          >
            {formatMessage(t["onboarding.openWorkspace"], {
              name: ct(
                "workspace",
                selectedWorkspace.persona,
                "navLabel",
                selectedWorkspace.navLabel
              ),
            })}
            <ArrowRight className="w-4 h-4" />
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => {
              setPreferredReportPersona(selectedWorkspace.persona);
              setLocation(reportSectionHref(selectedWorkspace, "automation-command-center"));
            }}
            className="gap-2 px-8"
            data-testid="onboarding-open-automation-center"
          >
            {formatMessage(t["onboarding.openWorkspace"], {
              name: ct(
                "workspace",
                selectedWorkspace.persona,
                "automationNavLabel",
                selectedWorkspace.automationNavLabel
              ),
            })}
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-lg mx-auto">
        {features.map(({ icon: Icon, label, href }) => (
          <Link key={label} href={href}>
            <div className="p-4 rounded-xl border border-border hover:border-primary hover:bg-primary/5 transition-all cursor-pointer group">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center mb-2 mx-auto group-hover:bg-primary/20 transition-colors">
                <Icon className="w-4 h-4 text-primary" />
              </div>
              <p className="text-xs font-medium">{label}</p>
            </div>
          </Link>
        ))}
      </div>

      <Button
        variant="outline"
        onClick={onGoToDashboard}
        className="gap-2 px-8"
        data-testid="onboarding-go-dashboard"
      >
        <T k="pageLabels.goToDashboard" />
        <ArrowRight className="w-4 h-4" />
      </Button>
    </div>
  );
}

// ─── Shared primitives ───────────────────────────────────────────────────────

function StepHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-3">
      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
        <Icon className="w-6 h-6 text-primary" />
      </div>
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        <p className="text-muted-foreground mt-1">{description}</p>
      </div>
    </div>
  );
}

function StepNav({
  onBack,
  onNext,
  nextLabel,
  loading = false,
}: {
  onBack: () => void;
  onNext: () => void;
  nextLabel?: string;
  loading?: boolean;
}) {
  const { t } = useTranslation();
  const tr = t as Record<string, string>;
  return (
    <div className="flex gap-3">
      <Button variant="outline" onClick={onBack} className="gap-1">
        <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
        {tr["components.back"]}
      </Button>
      <Button
        onClick={onNext}
        disabled={loading}
        className="flex-1 gap-2"
        data-testid="onboarding-next"
      >
        {loading ? tr["forms.saving"] : (nextLabel ?? tr["onboarding.continue"])}
        {!loading && <ArrowRight className="w-4 h-4" />}
      </Button>
    </div>
  );
}

// ─── Firm-owner onboarding ──────────────────────────────────────────────────
// Firm owners and admins manage clients rather than their own books, so the
// customer flow (chart of accounts, bank, first invoice) doesn't apply. They
// land here after first login and we point them at the firm management
// surface area instead.

type FirmStep = "welcome" | "team" | "clients" | "complete";
const FIRM_STEPS: FirmStep[] = ["welcome", "team", "clients", "complete"];
const FIRM_STEP_LABEL_KEYS: Record<FirmStep, string> = {
  welcome: "onboarding.firm.stepWelcome",
  team: "onboarding.firm.stepTeam",
  clients: "onboarding.firm.stepClients",
  complete: "onboarding.firm.stepComplete",
};

export function FirmOnboarding({ firmRole }: { firmRole: "firm_owner" | "firm_admin" }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();
  const tr = t as Record<string, string>;
  const [step, setStep] = useState<FirmStep>("welcome");
  const [direction, setDirection] = useState<1 | -1>(1);

  // The auto-created company is still present (registration always seeds one),
  // but the firm flow doesn't ask the user to fill it out — we mark onboarding
  // complete on the company so ProtectedLayout stops redirecting back here.
  const { data: companies, isLoading: companiesLoading } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });
  const company = companies?.[0];

  const completeMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${company!.id}/onboarding/complete`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
    },
    onError: (err: Error) => {
      toast({
        title: tr["onboarding.firm.setupFailed"],
        description: err.message,
        variant: "destructive",
      });
    },
  });

  function goTo(next: FirmStep, dir: 1 | -1 = 1) {
    setDirection(dir);
    setStep(next);
  }

  function goNext() {
    const idx = FIRM_STEPS.indexOf(step);
    if (idx < FIRM_STEPS.length - 1) goTo(FIRM_STEPS[idx + 1], 1);
  }

  function goBack() {
    const idx = FIRM_STEPS.indexOf(step);
    if (idx > 0) goTo(FIRM_STEPS[idx - 1], -1);
  }

  async function handleComplete(redirectTo?: string) {
    if (!company) return;
    await completeMutation.mutateAsync();
    setLocation(redirectTo ?? "/firm/clients");
  }

  if (companiesLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const idx = FIRM_STEPS.indexOf(step);
  const progressPercent = (idx / (FIRM_STEPS.length - 1)) * 100;

  const variants = {
    enter: (dir: number) => ({ opacity: 0, x: dir > 0 ? 48 : -48 }),
    center: { opacity: 1, x: 0 },
    exit: (dir: number) => ({ opacity: 0, x: dir > 0 ? -48 : 48 }),
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-primary/8 rounded-full blur-[128px]" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-chart-5/8 rounded-full blur-[128px]" />
      </div>

      <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-10 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center">
            <Briefcase className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-lg">
            {/* i18n-ignore: brand or sample data */}Muhasib.ai
          </span>
        </Link>
        {step !== "welcome" && step !== "complete" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleComplete("/firm/clients")}
            className="text-muted-foreground text-sm"
            data-testid="firm-onboarding-skip"
          >
            <T k="onboarding.skip" />
          </Button>
        )}
      </header>

      {step !== "complete" && (
        <div className="px-6 pt-6 max-w-2xl mx-auto w-full">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-muted-foreground">
              {formatMessage(tr["onboarding.firm.stepCounter"], {
                n: idx + 1,
                total: FIRM_STEPS.length,
              })}
            </span>
            <span className="text-sm text-muted-foreground">{tr[FIRM_STEP_LABEL_KEYS[step]]}</span>
          </div>
          <Progress
            value={progressPercent}
            className="h-1.5"
            aria-label={t["onboarding.progress"]}
          />
        </div>
      )}

      <main className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-2xl">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              {step === "welcome" && <FirmWelcomeStep firmRole={firmRole} onNext={goNext} />}
              {step === "team" && (
                <FirmTeamStep
                  onNext={goNext}
                  onBack={goBack}
                  onGoTo={(p) => setLocation(p)}
                  canManageStaff={firmRole === "firm_owner"}
                />
              )}
              {step === "clients" && (
                <FirmClientsStep
                  onComplete={() => void handleComplete("/firm/clients")}
                  onBack={goBack}
                  onGoTo={(p) => setLocation(p)}
                  completing={completeMutation.isPending}
                />
              )}
              {step === "complete" && (
                <FirmCompleteStep onGoToFirm={() => setLocation("/firm/clients")} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

function FirmWelcomeStep({
  firmRole,
  onNext,
}: {
  firmRole: "firm_owner" | "firm_admin";
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const tr = t as Record<string, string>;
  return (
    <div className="text-center space-y-8">
      <div className="flex justify-center">
        <div className="w-20 h-20 rounded-2xl flex items-center justify-center shadow-lg">
          <Briefcase className="w-10 h-10 text-white" />
        </div>
      </div>
      <div className="space-y-3">
        <Badge variant="secondary" className="px-3 py-1">
          {firmRole === "firm_owner"
            ? tr["onboarding.firm.roleOwner"]
            : tr["onboarding.firm.roleAdmin"]}
        </Badge>
        <h1 className="text-3xl font-bold tracking-tight">
          <T k="pageLabels.welcomeToYourFirmWorkspace" />
        </h1>
        <p className="text-muted-foreground text-lg max-w-md mx-auto">
          {firmRole === "firm_owner"
            ? tr["onboarding.firm.welcomeOwner"]
            : tr["onboarding.firm.welcomeAdmin"]}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
        {[
          {
            icon: Users,
            title: tr["onboarding.firm.cardTeamTitle"],
            desc: tr["onboarding.firm.cardTeamDesc"],
          },
          {
            icon: Building2,
            title: tr["onboarding.firm.cardClientsTitle"],
            desc: tr["onboarding.firm.cardClientsDesc"],
          },
          {
            icon: BarChart3,
            title: tr["onboarding.firm.cardAnalyticsTitle"],
            desc: tr["onboarding.firm.cardAnalyticsDesc"],
          },
        ].map(({ icon: Icon, title, desc }) => (
          <Card key={title} className="border border-border/50">
            <CardContent className="p-4 space-y-2">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <Icon className="w-5 h-5 text-primary" />
              </div>
              <p className="font-medium text-sm">{title}</p>
              <p className="text-xs text-muted-foreground">{desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Button size="lg" onClick={onNext} className="gap-2 px-8" data-testid="firm-onboarding-start">
        <T k="pageLabels.getStarted2" />
        <ArrowRight className="w-4 h-4" />
      </Button>
    </div>
  );
}

function FirmTeamStep({
  onNext,
  onBack,
  onGoTo,
  canManageStaff,
}: {
  onNext: () => void;
  onBack: () => void;
  onGoTo: (path: string) => void;
  canManageStaff: boolean;
}) {
  const { t } = useTranslation();
  const tr = t as Record<string, string>;
  return (
    <div className="space-y-6">
      <StepHeader
        icon={Users}
        title={tr["onboarding.firm.stepTeam"]}
        description={
          canManageStaff ? tr["onboarding.firm.teamOwnerDesc"] : tr["onboarding.firm.teamStaffDesc"]
        }
      />

      {canManageStaff ? (
        <Card className="border border-border/50">
          <CardContent className="p-5 space-y-3">
            <p className="text-sm">{tr["onboarding.firm.teamOwnerBody"]}</p>
            <Button
              variant="outline"
              onClick={() => onGoTo("/firm/staff")}
              className="gap-2"
              data-testid="firm-onboarding-staff"
            >
              <Users className="w-4 h-4" />
              <T k="pageLabels.openStaffManagement" />
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border border-border/50">
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">{tr["onboarding.firm.teamStaffBody"]}</p>
          </CardContent>
        </Card>
      )}

      <StepNav onBack={onBack} onNext={onNext} />
    </div>
  );
}

function FirmClientsStep({
  onComplete,
  onBack,
  onGoTo,
  completing,
}: {
  onComplete: () => void;
  onBack: () => void;
  onGoTo: (path: string) => void;
  completing: boolean;
}) {
  const { t } = useTranslation();
  const tr = t as Record<string, string>;
  return (
    <div className="space-y-6">
      <StepHeader
        icon={Building2}
        title={tr["onboarding.firm.stepClients"]}
        description={tr["onboarding.firm.clientsDesc"]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          type="button"
          onClick={() => onGoTo("/firm/clients")}
          disabled={completing}
          className="text-start p-5 rounded-xl border border-border hover:border-primary hover:bg-primary/5 transition-all group"
          data-testid="firm-onboarding-add-client"
        >
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3 group-hover:bg-primary/20 transition-colors">
            <Building2 className="w-5 h-5 text-primary" />
          </div>
          <p className="font-semibold text-sm mb-1">
            <T k="pageLabels.addAClient" />
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {tr["onboarding.firm.addClientDesc"]}
          </p>
          <div className="flex items-center gap-1 mt-3 text-xs text-primary font-medium">
            <T k="firm.statusOpen" /> <ChevronRight className="w-3 h-3" />
          </div>
        </button>
        <button
          type="button"
          onClick={() => onGoTo("/firm/bulk")}
          disabled={completing}
          className="text-start p-5 rounded-xl border border-border hover:border-primary hover:bg-primary/5 transition-all group"
          data-testid="firm-onboarding-bulk"
        >
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3 group-hover:bg-primary/20 transition-colors">
            <FileText className="w-5 h-5 text-primary" />
          </div>
          <p className="font-semibold text-sm mb-1">
            <T k="pageLabels.importInBulk" />
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {tr["onboarding.firm.bulkDesc"]}
          </p>
          <div className="flex items-center gap-1 mt-3 text-xs text-primary font-medium">
            <T k="firm.statusOpen" /> <ChevronRight className="w-3 h-3" />
          </div>
        </button>
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} className="gap-1">
          <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
          {tr["components.back"]}
        </Button>
        <Button
          variant="ghost"
          onClick={onComplete}
          disabled={completing}
          className="flex-1 text-muted-foreground"
          data-testid="firm-onboarding-finish"
        >
          {completing ? tr["onboarding.firm.finishing"] : tr["onboarding.firm.later"]}
        </Button>
      </div>
    </div>
  );
}

function FirmCompleteStep({ onGoToFirm }: { onGoToFirm: () => void }) {
  const { t } = useTranslation();
  const tr = t as Record<string, string>;
  return (
    <div className="text-center space-y-8">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 15 }}
        className="flex justify-center"
      >
        <div className="w-24 h-24 rounded-full bg-success-subtle flex items-center justify-center">
          <CheckCircle2 className="w-12 h-12 text-success" />
        </div>
      </motion.div>
      <div className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">
          <T k="pageLabels.yourFirmIsSetUp" />
        </h1>
        <p className="text-muted-foreground text-lg max-w-md mx-auto">
          {tr["onboarding.firm.completeDesc"]}
        </p>
      </div>
      <Button
        size="lg"
        onClick={onGoToFirm}
        className="gap-2 px-8"
        data-testid="firm-onboarding-go"
      >
        <T k="pageLabels.goToClients" />
        <ArrowRight className="w-4 h-4" />
      </Button>
    </div>
  );
}
