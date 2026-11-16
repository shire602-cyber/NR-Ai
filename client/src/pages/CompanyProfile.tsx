import { T } from "@/components/layout/T";
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
import { companyLogoFileError, companyLogoSrc, uploadCompanyLogo } from "@/lib/company-logo";
import { Building2, FileText, Save } from "lucide-react";
import type { Company } from "@shared/schema";

const companyProfileSchema = z.object({
  // Basic Info
  name: z.string().min(2, "Company name is required"),
  baseCurrency: z.string().default("AED"),
  locale: z.enum(["en", "ar"]).default("en"),

  // Company Information
  legalStructure: z.string().min(1, "Legal structure is required"),
  industry: z
    .string()
    .transform((val) => val || undefined)
    .optional(),
  registrationNumber: z
    .string()
    .transform((val) => val || undefined)
    .optional(),
  businessAddress: z.string().min(1, "Business address is required"),
  contactPhone: z
    .string()
    .transform((val) => val || undefined)
    .optional(),
  contactEmail: z
    .string()
    .email("Invalid email")
    .or(z.literal(""))
    .transform((val) => val || undefined)
    .optional(),
  websiteUrl: z
    .string()
    .url("Invalid URL")
    .or(z.literal(""))
    .transform((val) => val || undefined)
    .optional(),
  logoUrl: z
    .string()
    .transform((val) => val || undefined)
    .optional(),

  // Tax & Compliance
  trnVatNumber: z
    .string()
    .min(1, "TRN/VAT Number is required")
    .regex(/^\d{15}$/, "TRN must be exactly 15 digits"),
  taxRegistrationType: z.string().min(1, "Tax registration type is required"),
  vatFilingFrequency: z.string().min(1, "VAT filing frequency is required"),
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

      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates local form state from fetched data
      setLogoPreview(companyLogoSrc(company));
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
        title: "Company profile updated",
        description: "Your company profile has been saved successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to update profile",
        description: error?.message || "Please try again.",
      });
    },
  });

  const onSubmit = (data: CompanyProfileFormData) => {
    updateMutation.mutate(data);
  };

  // S1 (R14-13): the logo is uploaded to /api/companies/:id/logo (stored file, served
  // endpoint), never saved as an inline data: URL on the company row.
  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !companyId) return;
    const problem = companyLogoFileError(file);
    if (problem) {
      toast({ variant: "destructive", title: "Invalid logo", description: problem });
      e.target.value = "";
      return;
    }
    try {
      await uploadCompanyLogo(companyId, file);
      setLogoFile(file);
      setLogoPreview(URL.createObjectURL(file));
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Logo uploaded" });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Logo upload failed",
        description: error?.message || "Please try again.",
      });
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
              <p className="mb-4">
                <T k="pages.setUpYourCompanyToManageItsProfile" />
              </p>
              <Button onClick={() => navigate("/onboarding")} data-testid="button-create-company">
                <T k="pages.createYourCompany" />
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
        title="Company Profile"
        description="Manage your company information, tax settings, and compliance details"
      />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          {/* Company Information Section */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <Building2 className="w-5 h-5 text-primary" />
                <div>
                  <CardTitle>
                    <T k="pages.companyInformation" />
                  </CardTitle>
                  <CardDescription>
                    <T k="pages.basicDetailsAboutYourBusiness" />
                  </CardDescription>
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
                          placeholder="Acme Corporation"
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
                            <SelectValue placeholder="Select legal structure" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Sole Proprietorship">
                            <T k="pages.soleProprietorship" />
                          </SelectItem>
                          <SelectItem value="LLC">LLC</SelectItem>
                          <SelectItem value="Corporation">
                            <T k="pages.corporation" />
                          </SelectItem>
                          <SelectItem value="Partnership">
                            <T k="pages.partnership" />
                          </SelectItem>
                          <SelectItem value="Other">
                            <T k="pages.other" />
                          </SelectItem>
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
                      <FormLabel>
                        <T k="pages.industry" />
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="Technology, Retail, etc."
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
                      <FormLabel>
                        <T k="pages.businessRegistrationNumber" />
                      </FormLabel>
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
                      <FormLabel>
                        <T k="pages.contactPhone" />
                      </FormLabel>
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
                      <FormLabel>
                        <T k="pages.contactEmail" />
                      </FormLabel>
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
                      <FormLabel>
                        <T k="pages.websiteUrl" />
                      </FormLabel>
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
                  <FormLabel>
                    <T k="pages.companyLogo" />
                  </FormLabel>
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
                        aria-label="Company logo"
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
                  <CardTitle>
                    <T k="pages.taxComplianceSettings" />
                  </CardTitle>
                  <CardDescription>
                    <T k="pages.vatRegistrationAndTaxComplianceInformation" />
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
                      <FormLabel>
                        <T k="pages.taxRegistrationType" />
                      </FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-tax-registration-type">
                            <SelectValue placeholder="Select registration type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Standard">
                            <T k="pages.standard" />
                          </SelectItem>
                          <SelectItem value="Flat Rate">
                            <T k="pages.flatRate" />
                          </SelectItem>
                          <SelectItem value="Non-registered">
                            <T k="pages.nonRegistered" />
                          </SelectItem>
                          <SelectItem value="Other">
                            <T k="pages.other" />
                          </SelectItem>
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
                            <SelectValue placeholder="Select filing frequency" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Monthly">
                            <T k="pages.monthly" />
                          </SelectItem>
                          <SelectItem value="Quarterly">
                            <T k="pages.quarterly" />
                          </SelectItem>
                          <SelectItem value="Annually">
                            <T k="pages.annually" />
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        <T k="pages.requiredForVatRegisteredBusinesses" />
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="taxRegistrationDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <T k="pages.taxRegistrationEffectiveDate" />
                      </FormLabel>
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
                      <FormLabel>
                        <T k="pages.corporateTaxId" />
                      </FormLabel>
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
                  <Save className="w-4 h-4 mr-2" />
                  <T k="pages.saveChanges" />
                </>
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
