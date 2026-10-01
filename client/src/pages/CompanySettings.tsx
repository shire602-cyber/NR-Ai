import { PageHeader } from "@/components/ui/page-header";
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { companyPreferencesSchema, type Company, type CompanyPreferences } from "@shared/schema";
import { Building2, Globe, MapPin, FileText, Save, Upload } from "lucide-react";
import { messages as pageMessages } from "./CompanySettings.i18n";

const getCurrencyOptions = () => [
  { value: "AED", label: pageMessages.t("aedUaeDirham") },
  { value: "USD", label: pageMessages.t("usdUsDollar") },
  { value: "EUR", label: pageMessages.t("eurEuro") },
  { value: "GBP", label: pageMessages.t("gbpBritishPound") },
  { value: "SAR", label: pageMessages.t("sarSaudiRiyal") },
  { value: "QAR", label: pageMessages.t("qarQatariRiyal") },
  { value: "KWD", label: pageMessages.t("kwdKuwaitiDinar") },
  { value: "BHD", label: pageMessages.t("bhdBahrainiDinar") },
  { value: "OMR", label: pageMessages.t("omrOmaniRial") },
  { value: "INR", label: pageMessages.t("inrIndianRupee") },
];

const getMonthOptions = () => [
  pageMessages.t("january"),
  pageMessages.t("february"),
  pageMessages.t("march"),
  pageMessages.t("april"),
  pageMessages.t("may"),
  pageMessages.t("june"),
  pageMessages.t("july"),
  pageMessages.t("august"),
  pageMessages.t("september"),
  pageMessages.t("october"),
  pageMessages.t("november"),
  pageMessages.t("december"),
];

const getVatRateOptions = () => [
  { value: "0", label: pageMessages.t("n0ZeroRatedOutOfScope") },
  { value: "0.05", label: pageMessages.t("n5UaeStandardRate") },
  { value: "0.15", label: pageMessages.t("n15KsaStandardRate") },
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

const getCountryOptions = () => [
  { value: "AE", label: pageMessages.t("unitedArabEmirates") },
  { value: "SA", label: pageMessages.t("saudiArabia") },
  { value: "QA", label: pageMessages.t("qatar") },
  { value: "KW", label: pageMessages.t("kuwait") },
  { value: "BH", label: pageMessages.t("bahrain") },
  { value: "OM", label: pageMessages.t("oman") },
  { value: "GB", label: pageMessages.t("unitedKingdom") },
  { value: "US", label: pageMessages.t("unitedStates") },
  { value: "IN", label: pageMessages.t("india") },
];

const getDateFormatOptions = () => [
  { value: "DD/MM/YYYY", label: pageMessages.t("ddMmYyyyEG27") },
  { value: "MM/DD/YYYY", label: pageMessages.t("mmDdYyyyEG04") },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD (e.g. 2026-04-27)" },
];

type FormValues = CompanyPreferences;

export default function CompanySettings() {
  const tr = pageMessages.useT();

  const { toast } = useToast();
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
      inventoryCostingEnabled: false,
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
      inventoryCostingEnabled: company.inventoryCostingEnabled ?? false,
    });
    if (company.logoUrl) setLogoPreview(company.logoUrl);
  }, [company, form]);

  const updateMutation = useMutation({
    mutationFn: (data: FormValues) =>
      apiRequest("PATCH", `/api/companies/${companyId}/preferences`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({
        title: tr("preferencesSaved"),
        description: tr("yourCompanyPreferencesHaveBeenUpdated"),
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToSavePreferences"),
        description: error?.message || tr("pleaseTryAgain"),
      });
    },
  });

  const onSubmit = (data: FormValues) => updateMutation.mutate(data);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024) {
      toast({
        variant: "destructive",
        title: tr("imageTooLarge"),
        description: tr("pleaseChooseAnImageUnder1"),
      });
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      setLogoPreview(result);
      form.setValue("logoUrl", result, { shouldDirty: true });
    };
    reader.readAsDataURL(file);
  };

  if (isLoading) {
    return (
      <div className="space-y-8 max-w-4xl">
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
              <p>{tr("noCompanySelected")}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <PageHeader
        eyebrow={tr("settings")}
        title={tr("companySettings")}
        description={tr("manageCompanyWidePreferencesIdentityCurrency")}
      />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          {/* Identity */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <Building2 className="w-5 h-5 text-primary" />
                <div>
                  <CardTitle>{tr("companyIdentity")}</CardTitle>
                  <CardDescription>{tr("namesRegistrationAndLogoShownOn")}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("companyName")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ""}
                          placeholder={tr("acmeTrading")}
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
                      <FormLabel>{tr("legalName")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ""}
                          placeholder={tr("acmeTradingLLC")}
                          data-testid="input-legal-name"
                        />
                      </FormControl>
                      <FormDescription>{tr("registeredNameUsedOnTaxInvoices")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="trnVatNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("trnTaxRegistrationNumber")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ""}
                          placeholder="100123456789012"
                          inputMode="numeric"
                          maxLength={15}
                          className="font-mono"
                          data-testid="input-trn"
                        />
                      </FormControl>
                      <FormDescription>{tr("uae15Digits")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="industry"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("industry")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ""}
                          placeholder={tr("retailConstructionSoftware")}
                          data-testid="input-industry"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormItem>
                <FormLabel>{tr("companyLogo")}</FormLabel>
                <div className="flex items-center gap-4">
                  {logoPreview && (
                    <div className="w-16 h-16 rounded border overflow-hidden flex-shrink-0 bg-muted">
                      <img
                        src={logoPreview}
                        alt={tr("logoPreview")}
                        className="w-full h-full object-contain"
                      />
                    </div>
                  )}
                  <div className="flex-1">
                    <label
                      htmlFor="logo-upload"
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-input bg-background hover:bg-accent cursor-pointer text-sm"
                    >
                      <Upload className="w-4 h-4" />
                      {tr("chooseImage")}
                    </label>
                    <input
                      id="logo-upload"
                      type="file"
                      accept="image/*"
                      onChange={handleLogoChange}
                      className="hidden"
                      data-testid="input-logo-upload"
                    />
                    <FormDescription className="mt-2">{tr("pngJpgSvgUnder1Mb")}</FormDescription>
                  </div>
                </div>
              </FormItem>
            </CardContent>
          </Card>

          {/* Localization & Finance */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <Globe className="w-5 h-5 text-primary" />
                <div>
                  <CardTitle>{tr("localizationFinance")}</CardTitle>
                  <CardDescription>{tr("currencyFiscalYearVatLanguageAnd")}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="baseCurrency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("preferredCurrency")}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? "AED"}>
                        <FormControl>
                          <SelectTrigger data-testid="select-base-currency">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {getCurrencyOptions().map((c) => (
                            <SelectItem key={c.value} value={c.value}>
                              {c.label}
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
                      <FormLabel>{tr("financialYearStarts")}</FormLabel>
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
                          {getMonthOptions().map((label, idx) => (
                            <SelectItem key={idx + 1} value={String(idx + 1)}>
                              {label}
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
                      <FormLabel>{tr("defaultVatRate")}</FormLabel>
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
                          {getVatRateOptions().map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                              {r.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>{tr("appliedToNewInvoiceLinesBy")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="dateFormat"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("dateFormat")}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? "DD/MM/YYYY"}>
                        <FormControl>
                          <SelectTrigger data-testid="select-date-format">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {getDateFormatOptions().map((d) => (
                            <SelectItem key={d.value} value={d.value}>
                              {d.label}
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
                      <FormLabel>{tr("language")}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? "en"}>
                        <FormControl>
                          <SelectTrigger data-testid="select-locale">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="en">{tr("english")}</SelectItem>
                          {/* i18n-ignore: language endonym is always shown in its own script */}
                          <SelectItem value="ar">العربية (Arabic)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>{tr("usedForInvoiceTemplatesAndThe")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="inventoryCostingEnabled"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2 flex items-center justify-between rounded-md border p-3">
                      <div className="space-y-0.5">
                        <FormLabel>{tr("postInventoryToLedgerCogs")}</FormLabel>
                        <FormDescription>{tr("postInventoryToLedgerCogsHint")}</FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value ?? false}
                          onCheckedChange={field.onChange}
                          data-testid="switch-inventory-costing"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          {/* Address & Contact */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <MapPin className="w-5 h-5 text-primary" />
                <div>
                  <CardTitle>{tr("addressContact")}</CardTitle>
                  <CardDescription>{tr("usedOnInvoicesStatementsAndTax")}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="addressStreet"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tr("streetAddress")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ""}
                        placeholder={tr("office101Building7SheikhZayed")}
                        data-testid="input-address-street"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <FormField
                  control={form.control}
                  name="addressCity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("city")}</FormLabel>
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
                      <FormLabel>{tr("emirateRegion")}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? "dubai"}>
                        <FormControl>
                          <SelectTrigger data-testid="select-emirate">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {EMIRATE_OPTIONS.map((e) => (
                            <SelectItem key={e.value} value={e.value}>
                              {e.label}
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
                      <FormLabel>{tr("country")}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? "AE"}>
                        <FormControl>
                          <SelectTrigger data-testid="select-address-country">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {getCountryOptions().map((c) => (
                            <SelectItem key={c.value} value={c.value}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="contactPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("phone")}</FormLabel>
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
                      <FormLabel>{tr("email")}</FormLabel>
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
            </CardContent>
          </Card>

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => company && form.reset()}
              disabled={!form.formState.isDirty || updateMutation.isPending}
              data-testid="button-reset"
            >
              {tr("reset")}
            </Button>
            <Button
              type="submit"
              disabled={updateMutation.isPending || !form.formState.isDirty}
              className="min-w-32"
              data-testid="button-save-company-settings"
            >
              {updateMutation.isPending ? (
                tr("saving")
              ) : (
                <>
                  <Save className="w-4 h-4 me-2" />
                  {tr("saveChanges")}
                </>
              )}
            </Button>
          </div>

          <Card className="bg-muted/30 border-dashed">
            <CardContent className="py-4 flex items-start gap-3 text-sm text-muted-foreground">
              <FileText className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                {tr("needToUpdateTaxRegistrationType")}
                <a href="/company-profile" className="text-primary underline">
                  {tr("companyProfile")}
                </a>{" "}
                {tr("page")}
              </div>
            </CardContent>
          </Card>
        </form>
      </Form>
    </div>
  );
}
