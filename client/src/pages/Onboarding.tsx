import { useMemo, useState, useEffect } from 'react';
import { useLocation, Link } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest, ApiError } from '@/lib/queryClient';
import { getToken } from '@/lib/auth';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { z } from 'zod';
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
} from 'lucide-react';
import type { Company } from '@shared/schema';

const UAE_BANKS = [
  'Emirates NBD',
  'First Abu Dhabi Bank (FAB)',
  'Abu Dhabi Commercial Bank (ADCB)',
  'Dubai Islamic Bank',
  'Mashreq Bank',
  'RAKBANK',
  'Commercial Bank of Dubai',
  'Sharjah Islamic Bank',
  'United Arab Bank',
  'Other',
];

const UAE_EMIRATES = [
  { value: 'abu_dhabi', label: 'Abu Dhabi' },
  { value: 'dubai', label: 'Dubai' },
  { value: 'sharjah', label: 'Sharjah' },
  { value: 'ajman', label: 'Ajman' },
  { value: 'umm_al_quwain', label: 'Umm Al Quwain' },
  { value: 'ras_al_khaimah', label: 'Ras Al Khaimah' },
  { value: 'fujairah', label: 'Fujairah' },
];

type Step = 'welcome' | 'company' | 'accounts' | 'bank' | 'first-doc' | 'complete';

const STEPS: Step[] = ['welcome', 'company', 'accounts', 'bank', 'first-doc', 'complete'];

const STEP_LABELS: Record<Step, string> = {
  welcome: 'Welcome',
  company: 'Company Details',
  accounts: 'Chart of Accounts',
  bank: 'Bank Account',
  'first-doc': 'First Document',
  complete: 'Complete',
};

function stepIndex(step: Step): number {
  return STEPS.indexOf(step);
}

const STORAGE_KEY = (companyId: string) => `onboarding_step_${companyId}`;

/** Decode the role bits the JWT carries so we can split firm and customer flows. */
function readRoleFromToken(): { firmRole: string | null; userType: string } {
  try {
    const token = getToken();
    if (!token) return { firmRole: null, userType: 'customer' };
    const parts = token.split('.');
    if (parts.length !== 3) return { firmRole: null, userType: 'customer' };
    const payload = JSON.parse(atob(parts[1]));
    return {
      firmRole: payload.firmRole ?? null,
      userType: payload.userType ?? 'customer',
    };
  } catch {
    return { firmRole: null, userType: 'customer' };
  }
}

export default function Onboarding() {
  const role = useMemo(readRoleFromToken, []);
  // Firm owners and firm admins manage clients, not their own books — they
  // get a different onboarding tailored around staff and client setup.
  if (role.firmRole === 'firm_owner' || role.firmRole === 'firm_admin') {
    return <FirmOnboarding firmRole={role.firmRole} />;
  }
  return <CustomerOnboarding />;
}

function CustomerOnboarding() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: companies, isLoading: companiesLoading } = useQuery<Company[]>({
    queryKey: ['/api/companies'],
  });
  const company = companies?.[0];

  const [currentStep, setCurrentStep] = useState<Step>('welcome');
  const [direction, setDirection] = useState<1 | -1>(1);

  const [companyForm, setCompanyForm] = useState({
    name: '',
    trnVatNumber: '',
    registrationNumber: '',
    businessAddress: '',
    contactPhone: '',
    contactEmail: '',
    emirate: 'dubai',
  });

  const [bankForm, setBankForm] = useState({
    nameEn: '',
    bankName: '',
    accountNumber: '',
    iban: '',
    currency: 'AED',
  });

  useEffect(() => {
    if (company) {
      setCompanyForm({
        name: company.name ?? '',
        trnVatNumber: company.trnVatNumber ?? '',
        registrationNumber: company.registrationNumber ?? '',
        businessAddress: company.businessAddress ?? '',
        contactPhone: company.contactPhone ?? '',
        contactEmail: company.contactEmail ?? '',
        emirate: company.emirate ?? 'dubai',
      });

      const saved = localStorage.getItem(STORAGE_KEY(company.id));
      if (saved && STEPS.includes(saved as Step)) {
        setCurrentStep(saved as Step);
      }
    }
  }, [company?.id]);

  useEffect(() => {
    if (company) {
      localStorage.setItem(STORAGE_KEY(company.id), currentStep);
    }
  }, [currentStep, company?.id]);

  const { data: accountsData } = useQuery<{ id: string; nameEn: string; type: string }[]>({
    queryKey: [`/api/companies/${company?.id}/accounts`],
    enabled: !!company?.id && currentStep === 'accounts',
  });

  const { data: bankAccounts } = useQuery<{ id: string; nameEn: string; bankName: string }[]>({
    queryKey: [`/api/companies/${company?.id}/bank-accounts`],
    enabled: !!company?.id && currentStep === 'bank',
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
      apiRequest('PATCH', `/api/companies/${company!.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies'] });
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
      return apiRequest('POST', '/api/companies', {
        ...data,
        baseCurrency: 'AED',
        locale: 'en',
        companyType: 'customer',
      });
    },
    onSuccess: (newCompany) => {
      queryClient.setQueryData<Company[]>(['/api/companies'], (old) =>
        old ? [...old, newCompany] : [newCompany],
      );
      queryClient.invalidateQueries({ queryKey: ['/api/companies'] });
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to create company',
        description: err?.message ?? 'Please try again',
        variant: 'destructive',
      });
    },
  });

  const createBankMutation = useMutation({
    mutationFn: (data: typeof bankForm) =>
      apiRequest('POST', `/api/companies/${company!.id}/bank-accounts`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${company!.id}/bank-accounts`] });
    },
    onError: (err: Error) => {
      toast({
        title: 'Failed to create bank account',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const completeMutation = useMutation({
    mutationFn: () =>
      apiRequest('POST', `/api/companies/${company!.id}/onboarding/complete`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies'] });
      if (company) localStorage.removeItem(STORAGE_KEY(company.id));
    },
    onError: (err: Error) => {
      toast({
        title: 'Failed to complete onboarding',
        description: err.message,
        variant: 'destructive',
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
      name: z.string().trim().min(1, 'Company name is required').max(200),
      trnVatNumber: z
        .string()
        .trim()
        .optional()
        .refine(
          (v) => !v || /^[0-9]{15}$/.test(v),
          'UAE TRN must be exactly 15 digits',
        ),
      contactEmail: z
        .string()
        .trim()
        .optional()
        .refine(
          (v) => !v || z.string().email().safeParse(v).success,
          'Enter a valid email',
        ),
    });

    const parsed = localSchema.safeParse(companyForm);
    if (!parsed.success) {
      const fieldErrors: Partial<Record<keyof CompanyFormState, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof CompanyFormState;
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
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
      const message =
        apiErr?.message || 'We could not save your company details. Please try again.';

      if (status && status >= 400 && status < 500) {
        // Heuristic: route the message back to the most likely field.
        const lower = message.toLowerCase();
        if (lower.includes('trn')) {
          setCompanyFieldErrors({ trnVatNumber: message });
        } else if (lower.includes('email')) {
          setCompanyFieldErrors({ contactEmail: message });
        } else if (lower.includes('name') || lower.includes('already')) {
          setCompanyFieldErrors({ name: message });
        } else {
          setCompanySaveError(message);
        }
        toast({
          title: 'Please check your details',
          description: message,
          variant: 'destructive',
        });
      } else {
        setCompanySaveError(message);
        toast({
          title: 'Could not save company details',
          description: message,
          variant: 'destructive',
        });
      }
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
    goTo('complete', 1);
  }

  if (companiesLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const progressPercent = ((stepIndex(currentStep)) / (STEPS.length - 1)) * 100;

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
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-violet-500/8 rounded-full blur-[128px]" />
      </div>

      {/* Header */}
      <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-10 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-violet-600 flex items-center justify-center">
            <Briefcase className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-lg">Muhasib.ai</span>
        </Link>

        {currentStep !== 'welcome' && currentStep !== 'complete' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              // Mark onboarding complete so the user is not bounced back here
              // by ProtectedLayout's redirect on every navigation.
              if (company) {
                try { await completeMutation.mutateAsync(); } catch {}
              }
              setLocation('/dashboard');
            }}
            disabled={completeMutation.isPending}
            className="text-muted-foreground text-sm"
          >
            Save & continue later
          </Button>
        )}
      </header>

      {/* Progress bar */}
      {currentStep !== 'complete' && (
        <div className="px-6 pt-6 max-w-2xl mx-auto w-full">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-muted-foreground">
              Step {stepIndex(currentStep) + 1} of {STEPS.length}
            </span>
            <span className="text-sm text-muted-foreground">
              {STEP_LABELS[currentStep]}
            </span>
          </div>
          <Progress value={progressPercent} className="h-1.5" />
          <div className="flex justify-between mt-2">
            {STEPS.map((s) => (
              <div
                key={s}
                className={`w-2 h-2 rounded-full transition-colors ${
                  stepIndex(s) <= stepIndex(currentStep)
                    ? 'bg-primary'
                    : 'bg-muted'
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
              transition={{ duration: 0.25, ease: 'easeOut' }}
            >
              {currentStep === 'welcome' && (
                <WelcomeStep companyName={company?.name} onNext={goNext} />
              )}
              {currentStep === 'company' && (
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
              {currentStep === 'accounts' && (
                <AccountsStep
                  accountCount={accountsData?.length ?? 0}
                  onNext={goNext}
                  onBack={goBack}
                />
              )}
              {currentStep === 'bank' && (
                <BankStep
                  form={bankForm}
                  existingAccounts={bankAccounts ?? []}
                  onChange={(f) => setBankForm((p) => ({ ...p, ...f }))}
                  onNext={handleBankNext}
                  onBack={goBack}
                  saving={createBankMutation.isPending}
                />
              )}
              {currentStep === 'first-doc' && (
                <FirstDocStep
                  onComplete={handleComplete}
                  onBack={goBack}
                  completing={completeMutation.isPending}
                />
              )}
              {currentStep === 'complete' && (
                <CompleteStep onGoToDashboard={() => setLocation('/dashboard')} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

// ─── Step: Welcome ──────────────────────────────────────────────────────────

function WelcomeStep({ companyName, onNext }: { companyName?: string; onNext: () => void }) {
  return (
    <div className="text-center space-y-8">
      <div className="flex justify-center">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-violet-600 flex items-center justify-center shadow-lg">
          <Sparkles className="w-10 h-10 text-white" />
        </div>
      </div>

      <div className="space-y-3">
        <Badge variant="secondary" className="px-3 py-1">
          Welcome to Muhasib.ai
        </Badge>
        <h1 className="text-3xl font-bold tracking-tight">
          {companyName ? `Hello, ${companyName}!` : "Let's get you set up"}
        </h1>
        <p className="text-muted-foreground text-lg max-w-md mx-auto">
          UAE-compliant accounting, VAT filing, and AI-powered insights — all in one place.
          This quick setup takes about 3 minutes.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
        {[
          { icon: Building2, title: 'Company Profile', desc: 'Add your TRN and business details' },
          { icon: BookOpen, title: 'Chart of Accounts', desc: 'UAE-standard accounts pre-configured' },
          { icon: Landmark, title: 'Bank Account', desc: 'Connect for easy reconciliation' },
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

      <Button size="lg" onClick={onNext} className="gap-2 px-8" data-testid="onboarding-start">
        Get Started
        <ArrowRight className="w-4 h-4" />
      </Button>
    </div>
  );
}

// ─── Step: Company Details ──────────────────────────────────────────────────

interface CompanyFormState {
  name: string;
  trnVatNumber: string;
  registrationNumber: string;
  businessAddress: string;
  contactPhone: string;
  contactEmail: string;
  emirate: string;
}

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
  return (
    <div className="space-y-6">
      <StepHeader
        icon={Building2}
        title="Company Details"
        description="Add your official business information for UAE compliance."
      />

      {saveError && (
        <div
          role="alert"
          className="flex items-start gap-3 p-3 rounded-lg border border-destructive/40 bg-destructive/5 text-destructive"
          data-testid="onboarding-company-save-error"
        >
          <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
          <div className="flex-1 space-y-2">
            <p className="text-sm font-medium">We couldn't save your company.</p>
            <p className="text-sm text-destructive/90">{saveError}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={onRetry}
              disabled={saving}
              data-testid="onboarding-company-retry"
              className="gap-2"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${saving ? 'animate-spin' : ''}`} />
              {saving ? 'Retrying…' : 'Try again'}
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Company Name</Label>
            <Input
              value={form.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="Acme Trading LLC"
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
            <Label>Emirate</Label>
            <Select value={form.emirate} onValueChange={(v) => onChange({ emirate: v })}>
              <SelectTrigger data-testid="onboarding-emirate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UAE_EMIRATES.map((e) => (
                  <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>
              TRN — Tax Registration Number
              <span className="text-muted-foreground ml-1 text-xs">(optional, 15 digits)</span>
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
              Trade License Number
              <span className="text-muted-foreground ml-1 text-xs">(optional)</span>
            </Label>
            <Input
              value={form.registrationNumber}
              onChange={(e) => onChange({ registrationNumber: e.target.value })}
              placeholder="DED-12345"
              data-testid="onboarding-trade-license"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Business Address</Label>
          <Input
            value={form.businessAddress}
            onChange={(e) => onChange({ businessAddress: e.target.value })}
            placeholder="Office 401, Business Bay, Dubai, UAE"
            data-testid="onboarding-address"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input
              value={form.contactPhone}
              onChange={(e) => onChange({ contactPhone: e.target.value })}
              placeholder="+971 4 123 4567"
              data-testid="onboarding-phone"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
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
        nextLabel="Save & Continue"
        loading={saving}
      />
    </div>
  );
}


// ─── Step: Chart of Accounts ────────────────────────────────────────────────

function AccountsStep({
  accountCount,
  onNext,
  onBack,
}: {
  accountCount: number;
  onNext: () => void;
  onBack: () => void;
}) {
  const categories = [
    { label: 'Assets', description: 'Cash, receivables, inventory, fixed assets' },
    { label: 'Liabilities', description: 'Payables, VAT payable, loans' },
    { label: 'Equity', description: "Owner's capital and retained earnings" },
    { label: 'Revenue', description: 'Sales, service income' },
    { label: 'Expenses', description: 'COGS, operating expenses, payroll' },
    { label: 'VAT Accounts', description: 'Input VAT 5%, Output VAT 5%, VAT control' },
  ];

  return (
    <div className="space-y-6">
      <StepHeader
        icon={BookOpen}
        title="Chart of Accounts"
        description="Your UAE-standard chart of accounts has been pre-configured and is ready to use."
      />

      <Card className="border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-900">
        <CardContent className="p-4 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
          <div>
            <p className="text-sm font-medium text-green-800 dark:text-green-200">
              {accountCount > 0 ? `${accountCount} accounts configured` : 'UAE preset applied'}
            </p>
            <p className="text-xs text-green-600 dark:text-green-400">
              All standard categories with VAT input/output accounts are included.
            </p>
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
        You can customise accounts anytime from{' '}
        <Link href="/chart-of-accounts" className="underline text-primary">
          Chart of Accounts
        </Link>
        .
      </p>

      <StepNav onBack={onBack} onNext={onNext} nextLabel="Looks good, continue" />
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
  if (existingAccounts.length > 0) {
    return (
      <div className="space-y-6">
        <StepHeader
          icon={Landmark}
          title="Bank Account"
          description="Your bank account is already connected for reconciliation."
        />
        <Card className="border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-900">
          <CardContent className="p-4 space-y-2">
            {existingAccounts.map((a) => (
              <div key={a.id} className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <span className="text-sm font-medium">{a.nameEn}</span>
                <span className="text-xs text-muted-foreground">— {a.bankName}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <StepNav onBack={onBack} onNext={onNext} nextLabel="Continue" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StepHeader
        icon={Landmark}
        title="Bank Account"
        description="Add your bank account to enable statement import and reconciliation."
      />

      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Account Display Name</Label>
            <Input
              value={form.nameEn}
              onChange={(e) => onChange({ nameEn: e.target.value })}
              placeholder="Emirates NBD Current"
              data-testid="onboarding-bank-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Bank</Label>
            <Select value={form.bankName} onValueChange={(v) => onChange({ bankName: v })}>
              <SelectTrigger data-testid="onboarding-bank-select">
                <SelectValue placeholder="Select bank" />
              </SelectTrigger>
              <SelectContent>
                {UAE_BANKS.map((b) => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>
              Account Number
              <span className="text-muted-foreground ml-1 text-xs">(optional)</span>
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
              IBAN
              <span className="text-muted-foreground ml-1 text-xs">(optional)</span>
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
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <Button
          variant="outline"
          onClick={onNext}
          className="text-muted-foreground"
          data-testid="onboarding-skip-bank"
        >
          Skip for now
        </Button>
        <Button
          onClick={onNext}
          disabled={!form.nameEn || !form.bankName || saving}
          className="flex-1 gap-2"
          data-testid="onboarding-save-bank"
        >
          {saving ? 'Saving…' : 'Save & Continue'}
          <ArrowRight className="w-4 h-4" />
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
  const [, setLocation] = useLocation();

  const options = [
    {
      icon: FileText,
      title: 'Create an Invoice',
      description: 'Issue a VAT-compliant tax invoice to your first customer.',
      action: '/invoices',
      testId: 'onboarding-goto-invoice',
    },
    {
      icon: Receipt,
      title: 'Upload a Receipt',
      description: 'Let AI extract and categorise an expense from a photo or PDF.',
      action: '/receipts',
      testId: 'onboarding-goto-receipt',
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
        title="Create Your First Document"
        description="Kick off your bookkeeping by creating an invoice or uploading an expense receipt."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {options.map(({ icon: Icon, title, description, action, testId }) => (
          <button
            key={title}
            onClick={() => handleOptionClick(action)}
            disabled={completing}
            data-testid={testId}
            className="text-left p-5 rounded-xl border border-border hover:border-primary hover:bg-primary/5 transition-all group"
          >
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3 group-hover:bg-primary/20 transition-colors">
              <Icon className="w-5 h-5 text-primary" />
            </div>
            <p className="font-semibold text-sm mb-1">{title}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
            <div className="flex items-center gap-1 mt-3 text-xs text-primary font-medium">
              Get started <ChevronRight className="w-3 h-3" />
            </div>
          </button>
        ))}
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} className="gap-1">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <Button
          variant="ghost"
          onClick={onComplete}
          disabled={completing}
          className="flex-1 text-muted-foreground"
          data-testid="onboarding-skip-doc"
        >
          {completing ? 'Finishing…' : "I'll do this later"}
        </Button>
      </div>
    </div>
  );
}

// ─── Step: Complete ─────────────────────────────────────────────────────────

function CompleteStep({ onGoToDashboard }: { onGoToDashboard: () => void }) {
  const features = [
    { icon: LayoutDashboard, label: 'Dashboard', href: '/dashboard' },
    { icon: FileText, label: 'Invoices', href: '/invoices' },
    { icon: Receipt, label: 'Receipts', href: '/receipts' },
    { icon: BarChart3, label: 'Reports', href: '/reports' },
    { icon: BookOpen, label: 'Chart of Accounts', href: '/chart-of-accounts' },
    { icon: Users, label: 'Contacts', href: '/contacts' },
  ];

  return (
    <div className="text-center space-y-8">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        className="flex justify-center"
      >
        <div className="w-24 h-24 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
          <CheckCircle2 className="w-12 h-12 text-green-600" />
        </div>
      </motion.div>

      <div className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">You're all set!</h1>
        <p className="text-muted-foreground text-lg max-w-md mx-auto">
          Muhasib.ai is configured for your business. Here's what you can explore next:
        </p>
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

      <Button size="lg" onClick={onGoToDashboard} className="gap-2 px-8" data-testid="onboarding-go-dashboard">
        Go to Dashboard
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
  nextLabel = 'Continue',
  loading = false,
}: {
  onBack: () => void;
  onNext: () => void;
  nextLabel?: string;
  loading?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <Button variant="outline" onClick={onBack} className="gap-1">
        <ArrowLeft className="w-4 h-4" />
        Back
      </Button>
      <Button
        onClick={onNext}
        disabled={loading}
        className="flex-1 gap-2"
        data-testid="onboarding-next"
      >
        {loading ? 'Saving…' : nextLabel}
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

type FirmStep = 'welcome' | 'team' | 'clients' | 'complete';
const FIRM_STEPS: FirmStep[] = ['welcome', 'team', 'clients', 'complete'];
const FIRM_STEP_LABELS: Record<FirmStep, string> = {
  welcome: 'Welcome',
  team: 'Invite your team',
  clients: 'Add your first client',
  complete: 'Ready to go',
};

function FirmOnboarding({ firmRole }: { firmRole: 'firm_owner' | 'firm_admin' }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState<FirmStep>('welcome');
  const [direction, setDirection] = useState<1 | -1>(1);

  // The auto-created company is still present (registration always seeds one),
  // but the firm flow doesn't ask the user to fill it out — we mark onboarding
  // complete on the company so ProtectedLayout stops redirecting back here.
  const { data: companies, isLoading: companiesLoading } = useQuery<Company[]>({
    queryKey: ['/api/companies'],
  });
  const company = companies?.[0];

  const completeMutation = useMutation({
    mutationFn: () =>
      apiRequest('POST', `/api/companies/${company!.id}/onboarding/complete`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies'] });
    },
    onError: (err: Error) => {
      toast({
        title: 'Could not finish setup',
        description: err.message,
        variant: 'destructive',
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
    setLocation(redirectTo ?? '/firm/clients');
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
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-violet-500/8 rounded-full blur-[128px]" />
      </div>

      <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-10 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-violet-600 flex items-center justify-center">
            <Briefcase className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-lg">Muhasib.ai</span>
        </Link>
        {step !== 'welcome' && step !== 'complete' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleComplete('/firm/clients')}
            className="text-muted-foreground text-sm"
            data-testid="firm-onboarding-skip"
          >
            Skip for now
          </Button>
        )}
      </header>

      {step !== 'complete' && (
        <div className="px-6 pt-6 max-w-2xl mx-auto w-full">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-muted-foreground">
              Step {idx + 1} of {FIRM_STEPS.length}
            </span>
            <span className="text-sm text-muted-foreground">{FIRM_STEP_LABELS[step]}</span>
          </div>
          <Progress value={progressPercent} className="h-1.5" />
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
              transition={{ duration: 0.25, ease: 'easeOut' }}
            >
              {step === 'welcome' && (
                <FirmWelcomeStep firmRole={firmRole} onNext={goNext} />
              )}
              {step === 'team' && (
                <FirmTeamStep
                  onNext={goNext}
                  onBack={goBack}
                  onGoTo={(p) => setLocation(p)}
                  canManageStaff={firmRole === 'firm_owner'}
                />
              )}
              {step === 'clients' && (
                <FirmClientsStep
                  onComplete={() => void handleComplete('/firm/clients')}
                  onBack={goBack}
                  onGoTo={(p) => setLocation(p)}
                  completing={completeMutation.isPending}
                />
              )}
              {step === 'complete' && (
                <FirmCompleteStep onGoToFirm={() => setLocation('/firm/clients')} />
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
  firmRole: 'firm_owner' | 'firm_admin';
  onNext: () => void;
}) {
  return (
    <div className="text-center space-y-8">
      <div className="flex justify-center">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-violet-600 flex items-center justify-center shadow-lg">
          <Briefcase className="w-10 h-10 text-white" />
        </div>
      </div>
      <div className="space-y-3">
        <Badge variant="secondary" className="px-3 py-1">
          {firmRole === 'firm_owner' ? 'Firm Owner' : 'Firm Admin'}
        </Badge>
        <h1 className="text-3xl font-bold tracking-tight">Welcome to your firm workspace</h1>
        <p className="text-muted-foreground text-lg max-w-md mx-auto">
          {firmRole === 'firm_owner'
            ? 'Invite your team, onboard your clients, and manage their books from one place.'
            : 'Onboard your assigned clients and start managing their books.'}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
        {[
          { icon: Users, title: 'Team', desc: 'Invite staff with the right permissions' },
          { icon: Building2, title: 'Clients', desc: 'Onboard companies you manage' },
          { icon: BarChart3, title: 'Analytics', desc: 'Firm-wide health and KPIs' },
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
        Get Started
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
  return (
    <div className="space-y-6">
      <StepHeader
        icon={Users}
        title="Invite your team"
        description={
          canManageStaff
            ? 'Add your accountants and assign them to client portfolios.'
            : 'Your firm owner manages staff. You can move on to onboarding clients.'
        }
      />

      {canManageStaff ? (
        <Card className="border border-border/50">
          <CardContent className="p-5 space-y-3">
            <p className="text-sm">
              Open Staff Management in a new tab to send invites — your team gets an email
              link to set their password and join.
            </p>
            <Button
              variant="outline"
              onClick={() => onGoTo('/firm/staff')}
              className="gap-2"
              data-testid="firm-onboarding-staff"
            >
              <Users className="w-4 h-4" />
              Open Staff Management
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border border-border/50">
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">
              Staff invitations are managed by the firm owner. Skip ahead to add clients.
            </p>
          </CardContent>
        </Card>
      )}

      <StepNav onBack={onBack} onNext={onNext} nextLabel="Continue" />
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
  return (
    <div className="space-y-6">
      <StepHeader
        icon={Building2}
        title="Add your first client"
        description="Onboard a client company so you can start managing their books."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          type="button"
          onClick={() => onGoTo('/firm/clients')}
          disabled={completing}
          className="text-left p-5 rounded-xl border border-border hover:border-primary hover:bg-primary/5 transition-all group"
          data-testid="firm-onboarding-add-client"
        >
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3 group-hover:bg-primary/20 transition-colors">
            <Building2 className="w-5 h-5 text-primary" />
          </div>
          <p className="font-semibold text-sm mb-1">Add a client</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Create a new client workspace and invite their team to the portal.
          </p>
          <div className="flex items-center gap-1 mt-3 text-xs text-primary font-medium">
            Open <ChevronRight className="w-3 h-3" />
          </div>
        </button>
        <button
          type="button"
          onClick={() => onGoTo('/firm/bulk')}
          disabled={completing}
          className="text-left p-5 rounded-xl border border-border hover:border-primary hover:bg-primary/5 transition-all group"
          data-testid="firm-onboarding-bulk"
        >
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3 group-hover:bg-primary/20 transition-colors">
            <FileText className="w-5 h-5 text-primary" />
          </div>
          <p className="font-semibold text-sm mb-1">Import in bulk</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Migrating from another tool? Bring your client list across with a CSV.
          </p>
          <div className="flex items-center gap-1 mt-3 text-xs text-primary font-medium">
            Open <ChevronRight className="w-3 h-3" />
          </div>
        </button>
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} className="gap-1">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <Button
          variant="ghost"
          onClick={onComplete}
          disabled={completing}
          className="flex-1 text-muted-foreground"
          data-testid="firm-onboarding-finish"
        >
          {completing ? 'Finishing…' : "I'll add clients later"}
        </Button>
      </div>
    </div>
  );
}

function FirmCompleteStep({ onGoToFirm }: { onGoToFirm: () => void }) {
  return (
    <div className="text-center space-y-8">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        className="flex justify-center"
      >
        <div className="w-24 h-24 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
          <CheckCircle2 className="w-12 h-12 text-green-600" />
        </div>
      </motion.div>
      <div className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">Your firm is set up</h1>
        <p className="text-muted-foreground text-lg max-w-md mx-auto">
          Jump straight into the client portfolio to start managing books.
        </p>
      </div>
      <Button size="lg" onClick={onGoToFirm} className="gap-2 px-8" data-testid="firm-onboarding-go">
        Go to clients
        <ArrowRight className="w-4 h-4" />
      </Button>
    </div>
  );
}
