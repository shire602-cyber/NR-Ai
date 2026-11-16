import { T } from "@/components/layout/T";
import { SectionCard } from "@/components/ui/section-card";
import { FormActions, FormErrorSummary } from "@/components/ui/form-layout";
import { useTranslation } from "@/lib/i18n";
import { PageHeader } from "@/components/ui/page-header";
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { companyLogoFileError, companyLogoSrc, uploadCompanyLogo } from "@/lib/company-logo";
import type { Company, CompanyPreferences } from "@shared/schema";
import { companyPreferencesSchema } from "@shared/schema-values";
import { Building2, FileText, Save, Upload } from "lucide-react";
import { WpsSettingsCard } from "./payroll/WpsTab";

const CURRENCY_OPTIONS = [
  { value: "AED", label: "AED — UAE Dirham" },
  { value: "USD", label: "USD — US Dollar" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "GBP", label: "GBP — British Pound" },
  { value: "SAR", label: "SAR — Saudi Riyal" },
  { value: "QAR", label: "QAR — Qatari Riyal" },
  { value: "KWD", label: "KWD — Kuwaiti Dinar" },
  { value: "BHD", label: "BHD — Bahraini Dinar" },
  { value: "OMR", label: "OMR — Omani Rial" },
  { value: "INR", label: "INR — Indian Rupee" },
];

const MONTH_OPTIONS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const VAT_RATE_OPTIONS = [
  { value: "0", label: "0% — Zero-rated / Out of scope" },
  { value: "0.05", label: "5% — UAE Standard rate" },
  { value: "0.15", label: "15% — KSA Standard rate" },
];

const EMIRATE_OPTIONS = [
  { value: "abu_dhabi", label: "Abu Dhabi" },
  { value: "dubai", label: "Dubai" },
  { value: "sharjah", label: "Sharjah" },
  { value: "ajman", label: "Ajman" },
  { value: "umm_al_quwain", label: "Umm Al Quwain" },
  { value: "ras_al_khaimah", label: "Ras Al Khaimah" },
  { value: "fujairah", label: "Fujairah" },
];

const COUNTRY_OPTIONS = [
  { value: "AE", label: "United Arab Emirates" },
  { value: "SA", label: "Saudi Arabia" },
  { value: "QA", label: "Qatar" },
  { value: "KW", label: "Kuwait" },
  { value: "BH", label: "Bahrain" },
  { value: "OM", label: "Oman" },
  { value: "GB", label: "United Kingdom" },
  { value: "US", label: "United States" },
  { value: "IN", label: "India" },
];

const DATE_FORMAT_OPTIONS = [
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY (e.g. 27/04/2026)" },
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY (e.g. 04/27/2026)" },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD (e.g. 2026-04-27)" },
];

type FormValues = CompanyPreferences;

/** Option label in the UI locale (catalog key `pageLabels.companySettings.<group>.<value>`). */
function optionLabel(t: Record<string, string>, group: string, value: string, fallback: string) {
  return t[`pageLabels.companySettings.${group}.${value.replace(/[./]/g, "_")}`] ?? fallback;
}

/** Month name in the UI locale (ar-AE month names). */
function monthLabel(index: number, locale: string, fallback: string) {
  try {
    return new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", {
      month: "long",
    }).format(new Date(2026, index, 1));
  } catch {
    return fallback;
  }
}

export default function CompanySettings() {
  const { toast } = useToast();
  const { t: tr, locale } = useTranslation();
  const t = tr as Record<string, string>;
  const { companyId } = useDefaultCompany();
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const { data: company, isLoading } = useQuery<Company>({
    queryKey: ["/api/companies", companyId],
    enabled: !!companyId,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(companyPreferencesSchema),
    defaultValues: {
      name: "",
      legalName: "",
      trnVatNumber: "",
      baseCurrency: "AED",
      fiscalYearStartMonth: 1,
      defaultVatRate: 0.05,
      addressStreet: "",
      addressCity: "",
      emirate: "dubai",
      addressCountry: "AE",
      contactPhone: "",
      contactEmail: "",
      industry: "",
      logoUrl: "",
      dateFormat: "DD/MM/YYYY",
      locale: "en",
    },
  });

  useEffect(() => {
    if (!company) return;
    form.reset({
      name: company.name ?? "",
      legalName: company.legalName ?? "",
      trnVatNumber: company.trnVatNumber ?? "",
      baseCurrency: (company.baseCurrency ?? "AED") as FormValues["baseCurrency"],
      fiscalYearStartMonth: company.fiscalYearStartMonth ?? 1,
      defaultVatRate: company.defaultVatRate ?? 0.05,
      addressStreet: company.addressStreet ?? "",
      addressCity: company.addressCity ?? "",
      emirate: (company.emirate as FormValues["emirate"]) ?? "dubai",
      addressCountry: company.addressCountry ?? "AE",
      contactPhone: company.contactPhone ?? "",
      contactEmail: company.contactEmail ?? "",
      industry: company.industry ?? "",
      logoUrl: company.logoUrl ?? "",
      dateFormat: (company.dateFormat as FormValues["dateFormat"]) ?? "DD/MM/YYYY",
      locale: (company.locale as FormValues["locale"]) ?? "en",
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates local form state from fetched data
    setLogoPreview(companyLogoSrc(company));
  }, [company, form]);

  const updateMutation = useMutation({
    mutationFn: (data: FormValues) =>
      apiRequest("PATCH", `/api/companies/${companyId}/preferences`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({
        title: t["pageLabels.companySettings.savedTitle"],
        description: t["pageLabels.companySettings.savedBody"],
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: t["pageLabels.companySettings.saveFailed"],
        description: error?.message || "Please try again.",
      });
    },
  });

  const onSubmit = (data: FormValues) => updateMutation.mutate(data);

  // S1 (R14-13): the logo is uploaded to /api/companies/:id/logo (stored file, served
  // endpoint), never saved as an inline data: URL on the company row.
  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !companyId) return;
    const problem = companyLogoFileError(file);
    if (problem) {
      toast({
        variant: "destructive",
        title: t["pageLabels.companySettings.invalidLogo"],
        description: problem,
      });
      e.target.value = "";
      return;
    }
    try {
      await uploadCompanyLogo(companyId, file);
      setLogoPreview(URL.createObjectURL(file));
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: t["pageLabels.companySettings.logoUploaded"] });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: t["pageLabels.companySettings.logoUploadFailed"],
        description: error?.message || "Please try again.",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-narrow space-y-8">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!company) {
    return (
      <div className="space-y-8 max-w-4xl">
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <Building2 className="w-12 h-12 mx-auto mb-4" />
              <p>
                <T k="pages.noCompanySelected" />
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <PageHeader
        eyebrow="Settings"
        title={t["pageLabels.companySettings.title"]}
        description={t["pageLabels.companySettings.description"]}
      />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
          <FormErrorSummary />
          {/* Identity */}
          <SectionCard
            title={<T k="pageLabels.companyIdentity" />}
            description={<T k="pageLabels.namesRegistrationAndLogoShownOnInvoices" />}
          >
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t["pageLabels.companySettings.companyName"]}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ""}
                          placeholder="Acme Trading"
                          data-testid="input-company-name"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="legalName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <T k="pageLabels.legalName" />
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ""}
                          placeholder="Acme Trading L.L.C"
                          data-testid="input-legal-name"
                        />
                      </FormControl>
                      <FormDescription>
                        <T k="pageLabels.registeredNameUsedOnTaxInvoices" />
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="trnVatNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t["pageLabels.companySettings.trn"]}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ""}
                          placeholder="100123456789012"
                          inputMode="numeric"
                          maxLength={15}
                          ltr
                          data-testid="input-trn"
                        />
                      </FormControl>
                      <FormDescription>{t["pageLabels.companySettings.trnHelp"]}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="industry"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <T k="pages.industry" />
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ""}
                          placeholder="Retail, Construction, Software…"
                          data-testid="input-industry"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormItem>
                <FormLabel>
                  <T k="pages.companyLogo" />
                </FormLabel>
                <div className="flex items-center gap-4">
                  {logoPreview && (
                    <div className="w-16 h-16 rounded border overflow-hidden flex-shrink-0 bg-muted">
                      <img
                        src={logoPreview}
                        alt="Logo preview"
                        className="w-full h-full object-contain"
                      />
                    </div>
                  )}
                  <div className="flex-1">
                    <label
                      htmlFor="logo-upload"
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-input bg-background hover:bg-muted cursor-pointer text-sm"
                    >
                      <Upload className="w-4 h-4" />
                      <T k="pageLabels.chooseImage" />
                    </label>
                    <input
                      id="logo-upload"
                      type="file"
                      accept="image/*"
                      onChange={handleLogoChange}
                      className="hidden"
                      data-testid="input-logo-upload"
                    />
                    <FormDescription className="mt-2">
                      {t["pageLabels.companySettings.logoHelp"]}
                    </FormDescription>
                  </div>
                </div>
              </FormItem>
            </div>
          </SectionCard>

          {/* Localization & Finance */}
          <SectionCard
            title={<T k="pageLabels.localizationAndFinance" />}
            description={<T k="pageLabels.currencyFiscalYearVATLanguageAndDateFormat" />}
          >
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="baseCurrency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>
                        {t["pageLabels.companySettings.preferredCurrency"]}
                      </FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? "AED"}>
                        <FormControl>
                          <SelectTrigger data-testid="select-base-currency">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {CURRENCY_OPTIONS.map((c) => (
                            <SelectItem key={c.value} value={c.value}>
                              {optionLabel(t, "currency", c.value, c.label)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="fiscalYearStartMonth"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <T k="pageLabels.financialYearStarts" />
                      </FormLabel>
                      <Select
                        onValueChange={(v) => field.onChange(parseInt(v, 10))}
                        value={String(field.value ?? 1)}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-fiscal-year-start">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {MONTH_OPTIONS.map((label, idx) => (
                            <SelectItem key={idx + 1} value={String(idx + 1)}>
                              {monthLabel(idx, locale, label)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="defaultVatRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <T k="pageLabels.defaultVATRate" />
                      </FormLabel>
                      <Select
                        onValueChange={(v) => field.onChange(parseFloat(v))}
                        value={String(field.value ?? 0.05)}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-default-vat-rate">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {VAT_RATE_OPTIONS.map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                              {optionLabel(t, "vat", r.value, r.label)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        <T k="pageLabels.appliedToNewInvoiceLinesByDefault" />
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="dateFormat"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <T k="pageLabels.dateFormat" />
                      </FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? "DD/MM/YYYY"}>
                        <FormControl>
                          <SelectTrigger data-testid="select-date-format">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {DATE_FORMAT_OPTIONS.map((d) => (
                            <SelectItem key={d.value} value={d.value}>
                              {optionLabel(t, "dateFormat", d.value, d.label)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="locale"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <T k="pages.language" />
                      </FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? "en"}>
                        <FormControl>
                          <SelectTrigger data-testid="select-locale">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="en">
                            <T k="pageLabels.english" />
                          </SelectItem>
                          <SelectItem value="ar">
                            {t["pageLabels.companySettings.arabicOption"]}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        <T k="pageLabels.usedForInvoiceTemplatesAndTheUI" />
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
          </SectionCard>

          {/* Address & Contact */}
          <SectionCard
            title={<T k="pageLabels.addressAndContact" />}
            description={<T k="pageLabels.usedOnInvoicesStatementsAndTaxFilings" />}
          >
            <div className="space-y-6">
              <FormField
                control={form.control}
                name="addressStreet"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <T k="pageLabels.streetAddress" />
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ""}
                        placeholder="Office 101, Building 7, Sheikh Zayed Rd"
                        data-testid="input-address-street"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-3">
                <FormField
                  control={form.control}
                  name="addressCity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t["pageLabels.companySettings.city"]}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ""}
                          placeholder="Dubai"
                          data-testid="input-address-city"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="emirate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t["pageLabels.companySettings.emirate"]}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? "dubai"}>
                        <FormControl>
                          <SelectTrigger data-testid="select-emirate">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {EMIRATE_OPTIONS.map((e) => (
                            <SelectItem key={e.value} value={e.value}>
                              {optionLabel(t, "emirate", e.value, e.label)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="addressCountry"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <T k="pageLabels.country" />
                      </FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? "AE"}>
                        <FormControl>
                          <SelectTrigger data-testid="select-address-country">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {COUNTRY_OPTIONS.map((c) => (
                            <SelectItem key={c.value} value={c.value}>
                              {optionLabel(t, "country", c.value, c.label)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="contactPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <T k="pages.phone" />
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ""}
                          type="tel"
                          placeholder="+971 4 123 4567"
                          data-testid="input-contact-phone"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="contactEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <T k="pages.email" />
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ""}
                          type="email"
                          placeholder="hello@acme.ae"
                          data-testid="input-contact-email"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
          </SectionCard>

          <FormActions sticky variant="page">
            <Button
              type="button"
              variant="outline"
              onClick={() => company && form.reset()}
              disabled={!form.formState.isDirty || updateMutation.isPending}
              data-testid="button-reset"
            >
              <T k="pages.reset" />
            </Button>
            <Button
              type="submit"
              disabled={updateMutation.isPending || !form.formState.isDirty}
              className="min-w-32"
              data-testid="button-save-company-settings"
            >
              {updateMutation.isPending ? (
                t["forms.saving"]
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  <T k="pages.saveChanges" />
                </>
              )}
            </Button>
          </FormActions>

          <p className="flex items-start gap-3 rounded-lg bg-surface-sunken px-4 py-3 text-small text-muted-foreground">
            <FileText className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              {t["forms.settings.complianceNotePrefix"]}{" "}
              <a
                href="/company-profile"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                <T k="pageLabels.companyProfile" />
              </a>
            </span>
          </p>
        </form>
      </Form>

      {/* W3-D: WPS / MOL settings used by the payroll SIF (SCR record). */}
      {companyId && <WpsSettingsCard companyId={companyId} />}
    </div>
  );
}
