import { PageHeader } from "@/components/ui/page-header";
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
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
import { translateNow } from "@/lib/i18n";
import { DatePicker } from "@/components/ui/date-picker";
import { Building2, FileText, Save } from "lucide-react";
import type { Company } from "@shared/schema";
import { EInvoicingPartnerCard } from "@/components/einvoice/EInvoicingPartnerCard";

const companyProfileSchema = z.object({
  // Basic Info
  name: z.string().min(2, "forms.errors.companyNameRequired"),
  baseCurrency: z.string().default("AED"),
  locale: z.enum(["en", "ar"]).default("en"),

  // Company Information
  legalStructure: z.string().min(1, "forms.errors.legalStructureRequired"),
  industry: z
    .string()
    .transform((val) => val || undefined)
    .optional(),
  registrationNumber: z
    .string()
    .transform((val) => val || undefined)
    .optional(),
  tradeLicenseAuthority: z
    .string()
    .transform((val) => val || undefined)
    .optional(),
  businessAddress: z.string().min(1, "forms.errors.businessAddressRequired"),
  contactPhone: z
    .string()
    .transform((val) => val || undefined)
    .optional(),
  contactEmail: z
    .string()
    .email("forms.errors.invalidEmail")
    .or(z.literal(""))
    .transform((val) => val || undefined)
    .optional(),
  websiteUrl: z
    .string()
    .url("forms.errors.invalidUrl")
    .or(z.literal(""))
    .transform((val) => val || undefined)
    .optional(),
  logoUrl: z
    .string()
    .transform((val) => val || undefined)
    .optional(),

  // Tax & Compliance
  trnVatNumber: z.string().min(1, "forms.errors.trnRequired"),
  taxRegistrationType: z.string().min(1, "forms.errors.taxRegistrationTypeRequired"),
  vatFilingFrequency: z.string().min(1, "forms.errors.vatFilingFrequencyRequired"),
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
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { companyId, isLoading: companiesLoading } = useDefaultCompany();
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [_logoFile, setLogoFile] = useState<File | null>(null);

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
      tradeLicenseAuthority: "",
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
        tradeLicenseAuthority: company.tradeLicenceAuthority || "",
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
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates local form state from fetched data
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
        title: translateNow("toasts.companyProfileUpdated"),
        description: translateNow("toasts.companyProfileSaved"),
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.companyProfileUpdateFailed"),
        description: error?.message || "Please try again.",
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
              <p className="mb-4">Set up your company to manage its profile.</p> {/* i18n-ignore: UI copy awaiting AR sweep */}
              <Button onClick={() => navigate("/onboarding")} data-testid="button-create-company"> {/* i18n-ignore: UI copy awaiting AR sweep */}
                Create your company
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
        eyebrow="Settings"
        title="Company Profile" // i18n-ignore: UI copy awaiting AR sweep
        description="Manage your company information, tax settings, and compliance details" // i18n-ignore: UI copy awaiting AR sweep
      />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          {/* Company Information Section */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <Building2 className="w-5 h-5 text-primary" />
                <div>
                  <CardTitle>Company Information</CardTitle> {/* i18n-ignore: UI copy awaiting AR sweep */}
                  <CardDescription>Basic details about your business</CardDescription> {/* i18n-ignore: UI copy awaiting AR sweep */}
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
                      <FormLabel>Company Name *</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="Acme Corporation" // i18n-ignore: UI copy awaiting AR sweep
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
                      <FormLabel>Legal Structure *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-legal-structure">
                            <SelectValue placeholder="Select legal structure" /> {/* i18n-ignore: UI copy awaiting AR sweep */}
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Sole Proprietorship">Sole Proprietorship</SelectItem> {/* i18n-ignore: UI copy awaiting AR sweep */}
                          <SelectItem value="LLC">LLC</SelectItem>
                          <SelectItem value="Corporation">Corporation</SelectItem> {/* i18n-ignore: UI copy awaiting AR sweep */}
                          <SelectItem value="Partnership">Partnership</SelectItem> {/* i18n-ignore: UI copy awaiting AR sweep */}
                          <SelectItem value="Other">Other</SelectItem> {/* i18n-ignore: UI copy awaiting AR sweep */}
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
                      <FormLabel>Industry</FormLabel> {/* i18n-ignore: UI copy awaiting AR sweep */}
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="Technology, Retail, etc." // i18n-ignore: UI copy awaiting AR sweep
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
                      <FormLabel>Business Registration Number</FormLabel> {/* i18n-ignore: UI copy awaiting AR sweep */}
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

                <FormField
                  control={form.control}
                  name="tradeLicenseAuthority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Licence Issuing Authority</FormLabel> {/* i18n-ignore: UI copy awaiting AR sweep */}
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="Dubai Economy and Tourism" // i18n-ignore: UI copy awaiting AR sweep
                          data-testid="input-trade-license-authority"
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
                    <FormLabel>Business Address *</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="123 Business St, Dubai, UAE"
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
                      <FormLabel>Contact Phone</FormLabel> {/* i18n-ignore: UI copy awaiting AR sweep */}
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
                      <FormLabel>Contact Email</FormLabel> {/* i18n-ignore: UI copy awaiting AR sweep */}
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
                      <FormLabel>Website URL</FormLabel> {/* i18n-ignore: UI copy awaiting AR sweep */}
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
                  <FormLabel>Company Logo</FormLabel> {/* i18n-ignore: UI copy awaiting AR sweep */}
                  <div className="flex items-center gap-4">
                    {logoPreview && (
                      <div className="w-16 h-16 rounded border overflow-hidden flex-shrink-0">
                        <img
                          src={logoPreview}
                          alt="Logo preview"
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
                        Upload your company logo (optional)
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
                  <CardTitle>Tax & Compliance Settings</CardTitle> {/* i18n-ignore: UI copy awaiting AR sweep */}
                  <CardDescription>VAT registration and tax compliance information</CardDescription> {/* i18n-ignore: UI copy awaiting AR sweep */}
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
                      <FormLabel>TRN / VAT Number *</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="123456789012345"
                          className="font-mono"
                          data-testid="input-trn-vat-number"
                        />
                      </FormControl>
                      <FormDescription>15-digit Tax Registration Number (UAE)</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="taxRegistrationType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tax Registration Type</FormLabel> {/* i18n-ignore: UI copy awaiting AR sweep */}
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-tax-registration-type">
                            <SelectValue placeholder="Select registration type" /> {/* i18n-ignore: UI copy awaiting AR sweep */}
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Standard">Standard</SelectItem> {/* i18n-ignore: UI copy awaiting AR sweep */}
                          <SelectItem value="Flat Rate">Flat Rate</SelectItem> {/* i18n-ignore: UI copy awaiting AR sweep */}
                          <SelectItem value="Non-registered">Non-registered</SelectItem> {/* i18n-ignore: UI copy awaiting AR sweep */}
                          <SelectItem value="Other">Other</SelectItem> {/* i18n-ignore: UI copy awaiting AR sweep */}
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
                      <FormLabel>VAT Filing Frequency *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-vat-filing-frequency">
                            <SelectValue placeholder="Select filing frequency" /> {/* i18n-ignore: UI copy awaiting AR sweep */}
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Monthly">Monthly</SelectItem> {/* i18n-ignore: UI copy awaiting AR sweep */}
                          <SelectItem value="Quarterly">Quarterly</SelectItem> {/* i18n-ignore: UI copy awaiting AR sweep */}
                          <SelectItem value="Annually">Annually</SelectItem> {/* i18n-ignore: UI copy awaiting AR sweep */}
                        </SelectContent>
                      </Select>
                      <FormDescription>Required for VAT registered businesses</FormDescription> {/* i18n-ignore: UI copy awaiting AR sweep */}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="taxRegistrationDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tax Registration Effective Date</FormLabel> {/* i18n-ignore: UI copy awaiting AR sweep */}
                      <FormControl>
                        <DatePicker
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          data-testid="input-tax-registration-date"
                        />
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
                      <FormLabel>Corporate Tax ID</FormLabel> {/* i18n-ignore: UI copy awaiting AR sweep */}
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
                "Saving..."
              ) : (
                <>
                  <Save className="w-4 h-4 me-2" /> {/* i18n-ignore: UI copy awaiting AR sweep */}
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </form>
      </Form>
      {companyId && <EInvoicingPartnerCard companyId={companyId} />}
    </div>
  );
}
