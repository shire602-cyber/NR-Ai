import { useState } from "react";
import { EInvoiceReadinessCard } from "@/components/einvoice/EInvoiceReadinessCard";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Building2,
  FileText,
  Landmark,
  LayoutDashboard,
  Receipt,
  Repeat,
  Scale,
  Sprout,
  UserRoundCheck,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Segmented } from "@/components/marketing/Segmented";
import { useActiveCompany } from "@/components/ActiveCompanyProvider";
import { queryClient, apiRequest, type ApiError } from "@/lib/queryClient";
import { canRunCompanyOnboarding, withoutBlankValues } from "@/lib/companyRole";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { useSubscription } from "@/hooks/useSubscription";
import type { Company } from "@shared/schema";
import {
  Field,
  OnboardingShell,
  STEP_FORM_ID,
  StepActions,
  StepForm,
  StepHeading,
} from "./OnboardingShell";
import { isEmail, sendTeamInvite } from "./invite";
import {
  FIRST_TASK_HREF,
  openingBalancesHref,
  saveOnboardingProgress,
  useOnboardingProgress,
  type FirstTask,
  type OnboardingProgress,
  type OnboardingProgressPatch,
  type StartingPoint,
} from "./first-task";

/*
 * Customer onboarding (WP-B, spec 3.4): three screens, under two minutes, every field says why
 * it is asked. 1 Company (saved on Continue) · 2 Starting point (skippable) · 3 First task
 * (choosing one finishes onboarding and deep-links there). Always the ACTIVE company; only its
 * owner runs it (X1/J4).
 */

const TOTAL = 3;

const UAE_EMIRATES = [
  "abu_dhabi",
  "dubai",
  "sharjah",
  "ajman",
  "umm_al_quwain",
  "ras_al_khaimah",
  "fujairah",
] as const;

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

type VatAnswer = "yes" | "no" | "later";

/** Industry charts served by GET /api/onboarding/coa-templates (migration-import/coa-templates). */
interface CoaTemplate {
  id: string;
  label: { en: string; ar: string };
  accounts: number;
}

/** Save progress on the server; a failure never blocks the wizard (it only costs the resume). */
function saveProgress(companyId: string | undefined, patch: OnboardingProgressPatch): void {
  if (!companyId) return;
  void saveOnboardingProgress(companyId, patch).catch(() => undefined);
}

export function CustomerOnboarding() {
  const { company, isLoading } = useActiveCompany();
  const progress = useOnboardingProgress(company?.id);
  if (isLoading || (company?.id && progress.isLoading)) {
    return <OnboardingShell total={TOTAL}>{null}</OnboardingShell>;
  }
  if (company && !canRunCompanyOnboarding(company)) {
    return <OwnerStillSettingUp companyName={company.name} />;
  }
  // Keyed by company so switching companies never carries step/form state across tenants.
  return (
    <Wizard key={company?.id ?? "new"} company={company ?? null} progress={progress.data ?? null} />
  );
}

function OwnerStillSettingUp({ companyName }: { companyName: string }) {
  const { t } = useTranslation();
  return (
    <OnboardingShell total={TOTAL}>
      <div data-testid="onboarding-owner-setting-up">
        <span className="grid h-10 w-10 place-items-center rounded-lg bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
          <Building2 aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
        </span>
        <p className="mt-5 text-small text-muted-foreground">{companyName}</p>
        <StepHeading
          title={t["onboarding.ownerSettingUpTitle"]}
          lead={t["onboarding.ownerSettingUpBody"]}
        />
        <Button asChild>
          <Link href="/dashboard" data-testid="onboarding-owner-setting-up-continue">
            {t["onboarding.ownerSettingUpAction"]}
          </Link>
        </Button>
      </div>
    </OnboardingShell>
  );
}

/** Resume at the step saved on the server (1.10: survives a device change). */
function stepFromProgress(progress: OnboardingProgress | null): 1 | 2 | 3 {
  if (progress?.step === "starting-point") return 2;
  if (progress?.step === "first-task") return 3;
  return 1;
}

const STEP_NAME = { 1: "company", 2: "starting-point", 3: "first-task" } as const;

function Wizard({
  company,
  progress,
}: {
  company: Company | null;
  progress: OnboardingProgress | null;
}) {
  const { t, locale } = useTranslation();
  // STEP4: the plan chosen at sign-up, named under the first heading (hidden when none).
  const { chosenPlan } = useSubscription();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [step, setStepState] = useState<1 | 2 | 3>(() => stepFromProgress(progress));
  const [target, setTarget] = useState<Company | null>(company);

  const setStep = (next: 1 | 2 | 3, id = target?.id) => {
    setStepState(next);
    saveProgress(id, { step: STEP_NAME[next] });
  };

  // ── Step 1 state ───────────────────────────────────────────────────────────
  const [name, setName] = useState(company?.name ?? "");
  const [emirate, setEmirate] = useState<string>(company?.emirate || "dubai");
  // Prefilled from the company so registering with a TRN keeps it (X4/J3).
  const [vat, setVat] = useState<VatAnswer | null>(company?.trnVatNumber ? "yes" : null);
  const [trn, setTrn] = useState(company?.trnVatNumber ?? "");
  const [vatPeriod, setVatPeriod] = useState<"Quarterly" | "Monthly">(
    company?.vatFilingFrequency === "Monthly" ? "Monthly" : "Quarterly"
  );
  const [errors, setErrors] = useState<{ name?: string; trn?: string; vat?: string }>({});
  // 1.2: the industry seeds the chart of accounts (POST /companies/:id/onboarding/coa-template).
  const [industry, setIndustry] = useState<string>(progress?.industry ?? "general");
  const templates = useQuery<CoaTemplate[]>({ queryKey: ["/api/onboarding/coa-templates"] });
  const [saving, setSaving] = useState(false);

  // ── Step 2 state ───────────────────────────────────────────────────────────
  const [start, setStart] = useState<StartingPoint | null>(progress?.startingPoint ?? null);
  const [goLive, setGoLive] = useState(progress?.cutoverDate ?? "");
  const [accountant, setAccountant] = useState("");
  const [fyStart, setFyStart] = useState<number>(company?.fiscalYearStartMonth ?? 1);
  const [step2Error, setStep2Error] = useState<string | null>(null);

  const trnDigits = trn.replace(/\s/g, "");
  const trnLive =
    vat === "yes" && trnDigits.length > 0 && !/^[0-9]{15}$/.test(trnDigits)
      ? formatMessage(t["onboarding.v3TrnProgress"], { n: trnDigits.length })
      : null;

  const createCompany = useMutation({
    mutationFn: (data: Record<string, unknown>): Promise<Company> =>
      apiRequest("POST", "/api/companies", {
        ...data,
        baseCurrency: "AED",
        locale: "en",
        companyType: "customer",
      }),
    onSuccess: (created) => {
      queryClient.setQueryData<Company[]>(["/api/companies"], (old) =>
        old ? [...old, created] : [created]
      );
    },
  });

  async function saveCompany() {
    const trimmed = name.trim();
    const next: typeof errors = {};
    if (!trimmed) next.name = t["forms.errors.companyNameRequired"];
    // E1 (J1-r2): "Yes, registered" needs a real TRN: 15 digits starting with 100 (FTA format).
    if (vat === "yes" && !/^100[0-9]{12}$/.test(trnDigits)) {
      next.trn = !trnDigits
        ? t["onboarding.trnRequiredVatRegistered"]
        : /^[0-9]{15}$/.test(trnDigits)
          ? t["forms.errors.uaeTrnPrefix100"]
          : t["forms.errors.uaeTrn15Digits"];
    }
    setErrors(next);
    if (Object.keys(next).length) return;

    const payload = withoutBlankValues({
      name: trimmed,
      emirate,
      // A blank answer never clears a TRN the company already has (X4/J3).
      trnVatNumber: vat === "yes" ? trnDigits : (company?.trnVatNumber ?? ""),
      vatFilingFrequency: vat === "yes" ? vatPeriod : "",
      taxRegistrationType: vat === "yes" ? "Standard" : vat ? "Non-registered" : "",
    });
    setSaving(true);
    try {
      let saved = target;
      if (saved) {
        await apiRequest("PATCH", `/api/companies/${saved.id}`, payload);
      } else {
        saved = await createCompany.mutateAsync(payload);
        setTarget(saved);
      }
      // Seed the industry's accounts once (idempotent server-side: existing codes are kept).
      if (industry !== "general" && industry !== progress?.industry) {
        await apiRequest("POST", `/api/companies/${saved.id}/onboarding/coa-template`, {
          templateId: industry,
        });
        void queryClient.invalidateQueries({ queryKey: ["/api/companies", saved.id, "accounts"] });
      }
      saveProgress(saved.id, { industry });
      await queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      setStep(2, saved.id);
    } catch (err) {
      const message = (err as ApiError)?.message || t["onboarding.saveCompanyFailedBody"];
      const lower = ((err as ApiError)?.rawMessage ?? message).toLowerCase();
      if (lower.includes("trn")) setErrors({ trn: message });
      else if (lower.includes("name") || lower.includes("already")) setErrors({ name: message });
      else
        toast({
          title: t["onboarding.couldNotSaveCompany"],
          description: message,
          variant: "destructive",
        });
    } finally {
      setSaving(false);
    }
  }

  async function saveStartingPoint() {
    if (!target) return setStep(3);
    if (start === "accountant" && accountant.trim() && !isEmail(accountant)) {
      setStep2Error(t["forms.errors.enterValidEmail"]);
      return;
    }
    if (start === "opening-balances" && !goLive) {
      setStep2Error(t["onboarding.wq7CutoverRequired"]);
      return;
    }
    setSaving(true);
    setStep2Error(null);
    try {
      if (fyStart !== (target.fiscalYearStartMonth ?? 1)) {
        await apiRequest("PATCH", `/api/companies/${target.id}`, {
          fiscalYearStartMonth: fyStart,
        });
        await queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      }
      if (start === "accountant" && accountant.trim()) {
        await sendTeamInvite(target.id, accountant.trim(), "accountant");
      }
      const cutover =
        (start === "migrating" || start === "opening-balances") && goLive ? goLive : null;
      await saveOnboardingProgress(target.id, { startingPoint: start, cutoverDate: cutover });
      if (start === "opening-balances") {
        // 1.4: opening balances are D1's go-live import; finish here and open it at the date.
        await completeOnboarding(target.id, null);
        setLocation(openingBalancesHref(cutover));
        return;
      }
      setStep(3);
    } catch (err) {
      setStep2Error((err as Error)?.message || t["onboarding.v3SaveFailed"]);
    } finally {
      setSaving(false);
    }
  }

  /** Mark onboarding complete on the server and in the cache (so the shell never bounces back). */
  async function completeOnboarding(companyId: string, task: FirstTask | null) {
    await apiRequest("POST", `/api/companies/${companyId}/onboarding/complete`, {});
    saveProgress(companyId, task ? { firstTask: task, step: "done" } : { step: "done" });
    queryClient.setQueryData<Company[]>(["/api/companies"], (old) =>
      old?.map((c) => (c.id === companyId ? { ...c, onboardingCompleted: true } : c))
    );
    void queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
  }

  const finish = useMutation({
    mutationFn: async (task: FirstTask) => {
      if (!target) throw new Error(t["onboarding.v3SaveFailed"]);
      await completeOnboarding(target.id, task);
      return task;
    },
    onSuccess: (task) => {
      setLocation(FIRST_TASK_HREF[task]);
    },
    onError: (err: Error) =>
      toast({
        title: t["onboarding.failedComplete"],
        description: err.message,
        variant: "destructive",
      }),
  });

  if (step === 1) {
    const companyLabel = name.trim() || company?.name;
    return (
      <OnboardingShell
        step={1}
        total={TOTAL}
        actions={
          <StepActions
            primary={
              <Button
                type="submit"
                form={STEP_FORM_ID}
                disabled={saving}
                data-testid="onboarding-express"
              >
                {saving ? t["onboarding.v3Saving"] : t["onboarding.v3Continue"]}
              </Button>
            }
          />
        }
      >
        <StepHeading
          title={
            companyLabel
              ? formatMessage(t["onboarding.v3CompanyTitle"], { name: companyLabel })
              : t["onboarding.v3CompanyTitleNew"]
          }
          lead={t["onboarding.v3CompanyLead"]}
        />
        {chosenPlan ? (
          <p
            className="-mt-4 mb-6 text-caption text-muted-foreground"
            data-testid="onboarding-trial-note"
          >
            {formatMessage(t["onboarding.trialStartedNote"], {
              plan: t[`marketing.prPlan_${chosenPlan.planId}`],
            })}
          </p>
        ) : null}
        <StepForm onSubmit={() => void saveCompany()}>
          <Field
            label={t["onboarding.v3CompanyName"]}
            htmlFor="ob-name"
            help={t["onboarding.v3CompanyNameHelp"]}
            error={errors.name}
          >
            <Input
              id="ob-name"
              className="h-10"
              autoComplete="organization"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setErrors((x) => ({ ...x, name: undefined }));
              }}
              aria-invalid={!!errors.name}
              aria-describedby="ob-name-help"
              disabled={saving}
              data-testid="express-company-name"
            />
          </Field>
          <Field label={t["onboarding.wq7Industry"]} help={t["onboarding.wq7IndustryHelp"]}>
            <Select value={industry} onValueChange={setIndustry} disabled={saving}>
              <SelectTrigger
                className="h-10"
                aria-label={t["onboarding.wq7Industry"]}
                data-testid="onboarding-industry"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(templates.data?.length
                  ? templates.data
                  : [
                      {
                        id: "general",
                        label: {
                          en: t["onboarding.wq7IndustryGeneral"],
                          ar: t["onboarding.wq7IndustryGeneral"],
                        },
                        accounts: 0,
                      },
                    ]
                ).map((tpl) => (
                  <SelectItem key={tpl.id} value={tpl.id} data-testid={`industry-${tpl.id}`}>
                    {locale === "ar" ? tpl.label.ar : tpl.label.en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t["onboarding.v3Emirate"]} help={t["onboarding.v3EmirateHelp"]}>
            <Select value={emirate} onValueChange={setEmirate} disabled={saving}>
              <SelectTrigger
                className="h-10"
                aria-label={t["onboarding.v3Emirate"]}
                data-testid="express-emirate"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UAE_EMIRATES.map((e) => (
                  <SelectItem key={e} value={e}>
                    {t[`invoices.emirate.${e}`]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t["onboarding.v3VatQuestion"]} help={t["onboarding.v3VatHelp"]}>
            <Segmented
              value={vat}
              onChange={(v) => {
                setVat(v);
                setErrors((x) => ({ ...x, trn: undefined }));
              }}
              label={t["onboarding.v3VatQuestion"]}
              testId="express-vat-registered"
              optionTestId={(v) => `express-vat-${v}`}
              disabled={saving}
              options={[
                { value: "yes", label: t["onboarding.v3VatYes"] },
                { value: "no", label: t["onboarding.v3VatNo"] },
                { value: "later", label: t["onboarding.v3VatLater"] },
              ]}
            />
          </Field>
          {vat === "yes" ? (
            <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_11rem]">
              <Field
                label={t["onboarding.v3Trn"]}
                htmlFor="express-trn"
                help={trnLive ?? t["onboarding.v3TrnHelp"]}
                error={errors.trn}
              >
                <Input
                  id="express-trn"
                  className="h-10 text-start tabular-nums"
                  dir="ltr"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={15}
                  placeholder="100XXXXXXXXXXX3"
                  value={trn}
                  onChange={(e) => {
                    setTrn(e.target.value.replace(/[^0-9]/g, ""));
                    setErrors((x) => ({ ...x, trn: undefined }));
                  }}
                  aria-invalid={!!errors.trn}
                  aria-describedby="express-trn-help"
                  disabled={saving}
                  data-testid="express-trn"
                />
              </Field>
              <Field label={t["onboarding.v3VatPeriod"]} help={t["onboarding.v3VatPeriodHelp"]}>
                <Segmented
                  value={vatPeriod}
                  onChange={setVatPeriod}
                  label={t["onboarding.v3VatPeriod"]}
                  testId="express-vat-period"
                  disabled={saving}
                  options={[
                    { value: "Quarterly", label: t["onboarding.v3Quarterly"] },
                    { value: "Monthly", label: t["onboarding.v3Monthly"] },
                  ]}
                />
              </Field>
            </div>
          ) : null}
        </StepForm>
      </OnboardingShell>
    );
  }

  if (step === 2) {
    const choices: { id: StartingPoint; icon: LucideIcon; title: string; body: string }[] = [
      {
        id: "fresh",
        icon: Sprout,
        title: t["onboarding.v3StartFresh"],
        body: t["onboarding.v3StartFreshBody"],
      },
      {
        id: "migrating",
        icon: Repeat,
        title: t["onboarding.v3StartMoving"],
        body: t["onboarding.v3StartMovingBody"],
      },
      {
        id: "opening-balances",
        icon: Scale,
        title: t["onboarding.wq7StartOpening"],
        body: t["onboarding.wq7StartOpeningBody"],
      },
      {
        id: "accountant",
        icon: UserRoundCheck,
        title: t["onboarding.v3StartAccountant"],
        body: t["onboarding.v3StartAccountantBody"],
      },
    ];
    return (
      <OnboardingShell
        step={2}
        total={TOTAL}
        actions={
          <StepActions
            onBack={() => setStep(1)}
            secondary={
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep(3)}
                disabled={saving}
                data-testid="onboarding-skip"
              >
                {t["onboarding.v3Skip"]}
              </Button>
            }
            primary={
              <Button
                type="submit"
                form={STEP_FORM_ID}
                disabled={saving}
                data-testid="onboarding-next"
              >
                {saving ? t["onboarding.v3Saving"] : t["onboarding.v3Continue"]}
              </Button>
            }
          />
        }
      >
        <StepHeading title={t["onboarding.v3StartTitle"]} lead={t["onboarding.v3StartLead"]} />
        <StepForm onSubmit={() => void saveStartingPoint()}>
          <div
            role="radiogroup"
            aria-label={t["onboarding.v3StartTitle"]}
            className="space-y-2"
            data-testid="onboarding-starting-point"
          >
            {choices.map(({ id, icon: Icon, title, body }) => {
              const active = start === id;
              return (
                <div key={id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setStart(id)}
                    data-testid={`onboarding-start-${id}`}
                    className={cn(
                      "flex min-h-16 w-full items-center gap-4 rounded-lg border bg-card px-4 py-3 text-start transition-colors duration-fast",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "border-primary ring-1 ring-primary"
                        : "border-border hover:border-border-strong"
                    )}
                  >
                    <Icon
                      aria-hidden="true"
                      strokeWidth={1.5}
                      className={cn(
                        "h-5 w-5 flex-none",
                        active ? "text-accent" : "text-muted-foreground"
                      )}
                    />
                    <span className="min-w-0">
                      <span className="block text-[0.9375rem] font-semibold">{title}</span>
                      <span className="block text-small text-muted-foreground">{body}</span>
                    </span>
                  </button>
                  {active && id === "opening-balances" ? (
                    <div className="mb-4 mt-3 ps-4">
                      <Field
                        label={t["onboarding.wq7Cutover"]}
                        htmlFor="ob-cutover"
                        help={t["onboarding.wq7CutoverHelp"]}
                      >
                        <DatePicker
                          id="ob-cutover"
                          value={goLive}
                          onChange={setGoLive}
                          placeholder={t["onboarding.v3GoLivePlaceholder"]}
                          data-testid="onboarding-cutover"
                        />
                      </Field>
                    </div>
                  ) : null}
                  {active && id === "migrating" ? (
                    <div className="mb-4 mt-3 ps-4">
                      <Field
                        label={t["onboarding.v3GoLive"]}
                        htmlFor="ob-go-live"
                        help={t["onboarding.v3GoLiveHelp"]}
                      >
                        <DatePicker
                          id="ob-go-live"
                          value={goLive}
                          onChange={setGoLive}
                          placeholder={t["onboarding.v3GoLivePlaceholder"]}
                          data-testid="onboarding-go-live"
                        />
                      </Field>
                    </div>
                  ) : null}
                  {active && id === "accountant" ? (
                    <div className="mb-4 mt-3 ps-4">
                      <Field
                        label={t["onboarding.v3AccountantEmail"]}
                        htmlFor="ob-accountant"
                        help={t["onboarding.v3AccountantHelp"]}
                        optional
                      >
                        <Input
                          id="ob-accountant"
                          type="email"
                          dir="ltr"
                          className="h-10 text-start"
                          value={accountant}
                          onChange={(e) => setAccountant(e.target.value)}
                          data-testid="onboarding-accountant-email"
                        />
                      </Field>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <Field label={t["onboarding.v3FyStart"]} help={t["onboarding.v3FyStartHelp"]}>
            <Select value={String(fyStart)} onValueChange={(v) => setFyStart(Number(v))}>
              <SelectTrigger
                className="h-10"
                aria-label={t["onboarding.v3FyStart"]}
                data-testid="onboarding-fy-start"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {t[`onboarding.v3Month${m}`]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {step2Error ? (
            <p role="alert" className="text-small text-danger">
              {step2Error}
            </p>
          ) : null}
        </StepForm>
      </OnboardingShell>
    );
  }

  const tasks: { id: FirstTask; icon: LucideIcon; title: string; body: string }[] = [
    {
      id: "invoice",
      icon: FileText,
      title: t["onboarding.v3TaskInvoice"],
      body: t["onboarding.v3TaskInvoiceBody"],
    },
    {
      id: "bank",
      icon: Landmark,
      title: t["onboarding.v3TaskBank"],
      body: t["onboarding.v3TaskBankBody"],
    },
    {
      id: "bill",
      icon: Receipt,
      title: t["onboarding.v3TaskBill"],
      body: t["onboarding.v3TaskBillBody"],
    },
    {
      id: "explore",
      icon: LayoutDashboard,
      title: t["onboarding.v3TaskExplore"],
      body: t["onboarding.v3TaskExploreBody"],
    },
  ];
  return (
    <OnboardingShell step={3} total={TOTAL} actions={<StepActions onBack={() => setStep(2)} />}>
      <StepHeading title={t["onboarding.v3TaskTitle"]} lead={t["onboarding.v3TaskLead"]} />
      <div className="grid gap-3 sm:grid-cols-2" data-testid="onboarding-first-task">
        {tasks.map(({ id, icon: Icon, title, body }) => (
          <button
            key={id}
            type="button"
            onClick={() => finish.mutate(id)}
            disabled={finish.isPending}
            data-testid={`onboarding-task-${id}`}
            className={cn(
              "group flex flex-col items-start rounded-lg border border-border bg-card p-4 text-start",
              "transition-[border-color,box-shadow] duration-fast hover:border-border-strong hover:shadow-card-soft",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            )}
          >
            <Icon aria-hidden="true" strokeWidth={1.5} className="h-5 w-5 text-accent" />
            <span className="mt-3 text-[0.9375rem] font-semibold">{title}</span>
            <span className="mt-1 text-small text-muted-foreground">{body}</span>
            <ArrowRight
              aria-hidden="true"
              className="mt-3 h-4 w-4 text-muted-foreground transition-colors group-hover:text-accent rtl:rotate-180"
            />
          </button>
        ))}
      </div>
      {/* Spec 3.4 step 3 (Fable P13): X6d's readiness card, compact, under the task grid. */}
      <EInvoiceReadinessCard companyId={company?.id} compact className="mt-6" />
    </OnboardingShell>
  );
}
