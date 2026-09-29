import { PageHeader } from "@/components/ui/page-header";
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { Building2, FileText, Upload, Save } from "lucide-react";
import type { Company } from "@shared/schema";
import { messages as pageMessages } from "./CompanyProfile.i18n";

const companyProfileSchema = z.object({
  // Basic Info
  name: z.string().min(2, pageMessages.marker("companyNameIsRequired")),
  baseCurrency: z.string().default("AED"),
  locale: z.enum(["en", "ar"]).default("en"),

  // Company Information
  legalStructure: z.string().min(1, pageMessages.marker("legalStructureIsRequired")),
  industry: z
    .string()
    .transform((val) => val || undefined)
    .optional(),
  registrationNumber: z
    .string()
    .transform((val) => val || undefined)
    .optional(),
  businessAddress: z.string().min(1, pageMessages.marker("businessAddressIsRequired")),
  contactPhone: z
    .string()
    .transform((val) => val || undefined)
    .optional(),
  contactEmail: z
    .string()
    .email(pageMessages.marker("invalidEmail"))
    .or(z.literal(""))
    .transform((val) => val || undefined)
    .optional(),
  websiteUrl: z
    .string()
    .url(pageMessages.marker("invalidUrl"))
    .or(z.literal(""))
    .transform((val) => val || undefined)
    .optional(),
  logoUrl: z
    .string()
    .transform((val) => val || undefined)
    .optional(),

  // Tax & Compliance
  trnVatNumber: z.string().min(1, pageMessages.marker("trnVatNumberIsRequired")),
  taxRegistrationType: z.string().min(1, pageMessages.marker("taxRegistrationTypeIsRequired")),
  vatFilingFrequency: z.string().min(1, pageMessages.marker("vatFilingFrequencyIsRequired")),
  taxRegistrationDate: z
    .string()
    .transform((val) => val || undefined)
    .optional(),
  corporateTaxId: z
    .string()
    .transform((val) => val || undefined)
    .optional(),
});

type CompanyProfileFormData = z.infer<typeof companyProfileSchema>;

export default function CompanyProfile() {
  const tr = pageMessages.useT();

  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { companyId, isLoading: companiesLoading } = useDefaultCompany();
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);

  const { data: company, isLoading } = useQuery<Company>({
    queryKey: ["/api/companies", companyId],
    enabled: !!companyId,
  });

  const form = useForm<CompanyProfileFormData>({
    resolver: zodResolver(companyProfileSchema),
    defaultValues: {
      name: "",
      baseCurrency: "AED",
      locale: "en",
      legalStructure: "",
      industry: "",
      registrationNumber: "",
      businessAddress: "",
      contactPhone: "",
      contactEmail: "",
      websiteUrl: "",
      logoUrl: "",
      trnVatNumber: "",
      taxRegistrationType: "",
      vatFilingFrequency: "",
      taxRegistrationDate: "",
      corporateTaxId: "",
    },
  });

  // Load company data into form
  useEffect(() => {
    if (company) {
      form.reset({
        name: company.name || "",
        baseCurrency: company.baseCurrency || "AED",
        locale: (company.locale as "en" | "ar") || "en",
        legalStructure: company.legalStructure || "",
        industry: company.industry || "",
        registrationNumber: company.registrationNumber || "",
        businessAddress: company.businessAddress || "",
        contactPhone: company.contactPhone || "",
        contactEmail: company.contactEmail || "",
        websiteUrl: company.websiteUrl || "",
        logoUrl: company.logoUrl || "",
        trnVatNumber: company.trnVatNumber || "",
        taxRegistrationType: company.taxRegistrationType || "",
        vatFilingFrequency: company.vatFilingFrequency || "",
        taxRegistrationDate: company.taxRegistrationDate
          ? new Date(company.taxRegistrationDate).toISOString().split("T")[0]
          : "",
        corporateTaxId: company.corporateTaxId || "",
      });

      if (company.logoUrl) {
        setLogoPreview(company.logoUrl);
      }
    }
  }, [company, form]);

  const updateMutation = useMutation({
    mutationFn: (data: CompanyProfileFormData) => {
      // Convert date string to Date object if present
      const payload = {
        ...data,
        taxRegistrationDate: data.taxRegistrationDate
          ? new Date(data.taxRegistrationDate)
          : undefined,
      };
      return apiRequest("PATCH", `/api/companies/${companyId}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({
        title: tr("companyProfileUpdated"),
        description: tr("yourCompanyProfileHasBeenSaved"),
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToUpdateProfile"),
        description: error?.message || tr("pleaseTryAgain"),
      });
    },
  });

  const onSubmit = (data: CompanyProfileFormData) => {
    updateMutation.mutate(data);
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLogoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        setLogoPreview(result);
        form.setValue("logoUrl", result);
      };
      reader.readAsDataURL(file);
    }
  };

  if (isLoading || companiesLoading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!company) {
    return (
      <div className="space-y-8">
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <Building2 className="w-12 h-12 mx-auto mb-4" />
              <p className="mb-4">{tr("setUpYourCompanyToManage")}</p>
              <Button onClick={() => navigate("/onboarding")} data-testid="button-create-company">
                {tr("createYourCompany")}
              </Button>
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
        title={tr("companyProfile")}
        description={tr("manageYourCompanyInformationTaxSettings")}
      />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          {/* Company Information Section */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <Building2 className="w-5 h-5 text-primary" />
                <div>
                  <CardTitle>{tr("companyInformation")}</CardTitle>
                  <CardDescription>{tr("basicDetailsAboutYourBusiness")}</CardDescription>
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
                          placeholder={tr("acmeCorporation")}
                          data-testid="input-company-name"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="legalStructure"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("legalStructure")}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-legal-structure">
                            <SelectValue placeholder={tr("selectLegalStructure")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Sole Proprietorship">
                            {tr("soleProprietorship")}
                          </SelectItem>
                          <SelectItem value="LLC">LLC</SelectItem>
                          <SelectItem value="Corporation">{tr("corporation")}</SelectItem>
                          <SelectItem value="Partnership">{tr("partnership")}</SelectItem>
                          <SelectItem value="Other">{tr("other")}</SelectItem>
                        </SelectContent>
                      </Select>
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
                          placeholder={tr("technologyRetailEtc")}
                          data-testid="input-industry"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="registrationNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("businessRegistrationNumber")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="1234567890"
                          className="font-mono"
                          data-testid="input-registration-number"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="businessAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tr("businessAddress")}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder={tr("n123BusinessStDubaiUae")}
                        rows={3}
                        data-testid="textarea-business-address"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="contactPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("contactPhone")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="+971 4 123 4567"
                          type="tel"
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
                      <FormLabel>{tr("contactEmail")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="contact@company.com"
                          type="email"
                          data-testid="input-contact-email"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="websiteUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("websiteUrl")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="https://www.company.com"
                          type="url"
                          data-testid="input-website-url"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormItem>
                  <FormLabel>{tr("companyLogo")}</FormLabel>
                  <div className="flex items-center gap-4">
                    {logoPreview && (
                      <div className="w-16 h-16 rounded border overflow-hidden flex-shrink-0">
                        <img
                          src={logoPreview}
                          alt={tr("logoPreview")}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    <div className="flex-1">
                      <Input
                        type="file"
                        accept="image/*"
                        onChange={handleLogoChange}
                        className="cursor-pointer"
                        data-testid="input-logo-upload"
                      />
                      <FormDescription className="mt-2">
                        {tr("uploadYourCompanyLogoOptional")}
                      </FormDescription>
                    </div>
                  </div>
                </FormItem>
              </div>
            </CardContent>
          </Card>

          {/* Tax & Compliance Section */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-primary" />
                <div>
                  <CardTitle>{tr("taxComplianceSettings")}</CardTitle>
                  <CardDescription>
                    {tr("vatRegistrationAndTaxComplianceInformation")}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="trnVatNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("trnVatNumber")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="123456789012345"
                          className="font-mono"
                          data-testid="input-trn-vat-number"
                        />
                      </FormControl>
                      <FormDescription>{tr("n15DigitTaxRegistrationNumberUae")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="taxRegistrationType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("taxRegistrationType")}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-tax-registration-type">
                            <SelectValue placeholder={tr("selectRegistrationType")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Standard">{tr("standard")}</SelectItem>
                          <SelectItem value="Flat Rate">{tr("flatRate")}</SelectItem>
                          <SelectItem value="Non-registered">{tr("nonRegistered")}</SelectItem>
                          <SelectItem value="Other">{tr("other")}</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="vatFilingFrequency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("vatFilingFrequency")}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-vat-filing-frequency">
                            <SelectValue placeholder={tr("selectFilingFrequency")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Monthly">{tr("monthly")}</SelectItem>
                          <SelectItem value="Quarterly">{tr("quarterly")}</SelectItem>
                          <SelectItem value="Annually">{tr("annually")}</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>{tr("requiredForVatRegisteredBusinesses")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="taxRegistrationDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("taxRegistrationEffectiveDate")}</FormLabel>
                      <FormControl>
                        <Input {...field} type="date" data-testid="input-tax-registration-date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="corporateTaxId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("corporateTaxId")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="CT-123456789"
                          className="font-mono"
                          data-testid="input-corporate-tax-id"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          {/* Save Button */}
          <div className="flex justify-end gap-3">
            <Button
              type="submit"
              disabled={updateMutation.isPending}
              className="min-w-32"
              data-testid="button-save-company-profile"
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
        </form>
      </Form>
    </div>
  );
}
