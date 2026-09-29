import { PageHeader } from "@/components/ui/page-header";
import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import { FileText, Save, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { Company } from "@shared/schema";
import { messages as pageMessages } from "./InvoiceSettings.i18n";

const invoiceSettingsSchema = z.object({
  invoiceShowLogo: z.boolean().default(true),
  invoiceShowAddress: z.boolean().default(true),
  invoiceShowPhone: z.boolean().default(true),
  invoiceShowEmail: z.boolean().default(true),
  invoiceShowWebsite: z.boolean().default(false),
  invoiceCustomTitle: z
    .string()
    .transform((val) => val || undefined)
    .optional(),
  invoiceFooterNote: z
    .string()
    .transform((val) => val || undefined)
    .optional(),
});

type InvoiceSettingsFormData = z.infer<typeof invoiceSettingsSchema>;

export default function InvoiceSettings() {
  const tr = pageMessages.useT();

  const { toast } = useToast();
  const { companyId } = useDefaultCompany();

  const { data: company, isLoading } = useQuery<Company>({
    queryKey: ["/api/companies", companyId],
    enabled: !!companyId,
  });

  const form = useForm<InvoiceSettingsFormData>({
    resolver: zodResolver(invoiceSettingsSchema),
    defaultValues: {
      invoiceShowLogo: true,
      invoiceShowAddress: true,
      invoiceShowPhone: true,
      invoiceShowEmail: true,
      invoiceShowWebsite: false,
      invoiceCustomTitle: "",
      invoiceFooterNote: "",
    },
  });

  // Load company data into form
  useEffect(() => {
    if (company) {
      form.reset({
        invoiceShowLogo: company.invoiceShowLogo ?? true,
        invoiceShowAddress: company.invoiceShowAddress ?? true,
        invoiceShowPhone: company.invoiceShowPhone ?? true,
        invoiceShowEmail: company.invoiceShowEmail ?? true,
        invoiceShowWebsite: company.invoiceShowWebsite ?? false,
        invoiceCustomTitle: company.invoiceCustomTitle || "",
        invoiceFooterNote: company.invoiceFooterNote || "",
      });
    }
  }, [company, form]);

  const updateMutation = useMutation({
    mutationFn: (data: InvoiceSettingsFormData) => {
      return apiRequest("PATCH", `/api/companies/${companyId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({
        title: tr("invoiceSettingsUpdated"),
        description: tr("yourInvoiceCustomizationSettingsHaveBeen"),
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToUpdateSettings"),
        description: error?.message || tr("pleaseTryAgain"),
      });
    },
  });

  const onSubmit = (data: InvoiceSettingsFormData) => {
    updateMutation.mutate(data);
  };

  const isVATRegistered = company?.trnVatNumber && company?.trnVatNumber.length > 0;

  if (isLoading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!company) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">{tr("companyNotFound")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <PageHeader
        eyebrow={tr("settings")}
        title={tr("invoiceSettings")}
        description={tr("customizeHowYourInvoicesAppearTo")}
      />

      {isVATRegistered && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            {tr("yourCompanyIsVatRegisteredAll", { trnVatNumber: company.trnVatNumber })}
          </AlertDescription>
        </Alert>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          {/* Company Details Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                {tr("companyDetailsDisplay")}
              </CardTitle>
              <CardDescription>{tr("chooseWhichCompanyInformationToDisplay")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="invoiceShowLogo"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">{tr("showCompanyLogo")}</FormLabel>
                      <FormDescription>
                        {tr("displayYourCompanyLogoAtThe")}
                        {!company.logoUrl && (
                          <span className="block text-xs text-warning mt-1">
                            {tr("noteSetYourLogoInCompany")}
                          </span>
                        )}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={!company.logoUrl}
                        data-testid="switch-show-logo"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="invoiceShowAddress"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">{tr("showBusinessAddress")}</FormLabel>
                      <FormDescription>
                        {tr("displayYourBusinessAddressOnInvoices")}
                        {!company.businessAddress && (
                          <span className="block text-xs text-warning mt-1">
                            {tr("noteSetYourAddressInCompany")}
                          </span>
                        )}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={!company.businessAddress}
                        data-testid="switch-show-address"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="invoiceShowPhone"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">{tr("showPhoneNumber")}</FormLabel>
                      <FormDescription>
                        {tr("displayYourBusinessPhoneNumberOn")}
                        {!company.contactPhone && (
                          <span className="block text-xs text-warning mt-1">
                            {tr("noteSetYourPhoneInCompany")}
                          </span>
                        )}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={!company.contactPhone}
                        data-testid="switch-show-phone"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="invoiceShowEmail"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">{tr("showEmailAddress")}</FormLabel>
                      <FormDescription>
                        {tr("displayYourBusinessEmailOnInvoices")}
                        {!company.contactEmail && (
                          <span className="block text-xs text-warning mt-1">
                            {tr("noteSetYourEmailInCompany")}
                          </span>
                        )}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={!company.contactEmail}
                        data-testid="switch-show-email"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="invoiceShowWebsite"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">{tr("showWebsite")}</FormLabel>
                      <FormDescription>
                        {tr("displayYourWebsiteUrlOnInvoices")}
                        {!company.websiteUrl && (
                          <span className="block text-xs text-warning mt-1">
                            {tr("noteSetYourWebsiteInCompany")}
                          </span>
                        )}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={!company.websiteUrl}
                        data-testid="switch-show-website"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Customization Section */}
          <Card>
            <CardHeader>
              <CardTitle>{tr("invoiceCustomization")}</CardTitle>
              <CardDescription>{tr("customizeTheAppearanceAndTextOf")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="invoiceCustomTitle"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tr("invoiceTitle")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={
                          isVATRegistered ? tr("taxInvoiceDefault") : tr("invoiceDefault")
                        }
                        {...field}
                        data-testid="input-invoice-title"
                      />
                    </FormControl>
                    <FormDescription>
                      {isVATRegistered
                        ? tr("forVatRegisteredCompaniesInvoicesDefault")
                        : tr("customTitleForYourInvoicesLeave")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="invoiceFooterNote"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tr("footerNote")}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={tr("thankYouForYourBusiness")}
                        className="resize-none"
                        rows={3}
                        {...field}
                        data-testid="textarea-footer-note"
                      />
                    </FormControl>
                    <FormDescription>{tr("addACustomMessageAtThe")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={updateMutation.isPending}
              data-testid="button-save-settings"
            >
              <Save className="w-4 h-4 me-2" />
              {updateMutation.isPending ? tr("saving") : tr("saveSettings")}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
