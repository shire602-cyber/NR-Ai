import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Check, MoreHorizontal, Star, Trash2 } from "lucide-react";
import { SettingsLayout } from "@/components/layout/SettingsLayout";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { SetupNotice } from "@/components/ui/setup-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { InvoicePreview } from "@/components/invoices/InvoicePreview";
import {
  DOCUMENT_ACCENT_DEFAULT,
  DOCUMENT_ACCENT_PRESETS,
  resolveDocumentAccent,
} from "@shared/document-accent";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useSubscription } from "@/hooks/useSubscription";
import { companyLogoSrc } from "@/lib/company-logo";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatMessage, translateNow, useTranslation } from "@/lib/i18n";
import { zodResolver } from "@/lib/zod-resolver";
import { cn } from "@/lib/utils";

/**
 * Settings → Documents (spec 3.7). One page for how customer documents look:
 * (a) what appears on them (company fields, title, footer note — stored on the company),
 * (b) the accent colour, (c) terms and bank details (stored on the default invoice template),
 * (d) a live preview. More templates are listed as cards only when the company has several.
 * The invoice "Branding" tab and the separate template list page are gone; their data is unchanged.
 */

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const brandingSchema = z.object({
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
type BrandingFormData = z.infer<typeof brandingSchema>;

interface InvoiceTemplate {
  id: string;
  companyId: string;
  name: string;
  primaryColor: string;
  accentColor: string;
  layout: string;
  headerText?: string | null;
  footerText?: string | null;
  termsText?: string | null;
  bankDetails?: string | null;
  showLogo: boolean;
  showStamp: boolean;
  isDefault: boolean;
}

interface TemplateDraft {
  primaryColor: string;
  headerText: string;
  footerText: string;
  termsText: string;
  bankDetails: string;
}

const SAMPLE_LINES = [
  { description: "", quantity: 2, unitPrice: 1500, vatRate: 0.05, lineTotal: 3150 },
];

export default function InvoiceTemplates() {
  const { t } = useTranslation();
  const tt = t as Record<string, string>;
  const { company, companyId } = useDefaultCompany();
  const { canAccess, getRequiredTier, isLoading: subLoading } = useSubscription();
  const templatesAllowed = canAccess("invoiceTemplates");

  return (
    <SettingsLayout>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Settings"
          title={tt["invoiceDesign.documents.title"]}
          description={tt["invoiceDesign.documents.description"]}
        />
        {!company || subLoading ? (
          <Skeleton className="h-96" />
        ) : (
          <DocumentsSettings
            company={company}
            companyId={companyId}
            templatesAllowed={templatesAllowed}
            upgrade={
              templatesAllowed ? null : (
                <UpgradePrompt
                  feature="invoiceTemplates"
                  requiredTier={getRequiredTier("invoiceTemplates")}
                  description={t["invoiceTemplates.customizeYourInvoiceAppearanceWith"]}
                />
              )
            }
          />
        )}
      </div>
    </SettingsLayout>
  );
}

type Company = NonNullable<ReturnType<typeof useDefaultCompany>["company"]>;

function DocumentsSettings({
  company,
  companyId,
  templatesAllowed,
  upgrade,
}: {
  company: Company;
  companyId?: string;
  templatesAllowed: boolean;
  upgrade: React.ReactNode;
}) {
  const { t } = useTranslation();
  const tt = t as Record<string, string>;
  const { toast } = useToast();
  const templatesKey = ["/api/companies", companyId, "invoice-templates"];
  const { data: templates, isLoading: templatesLoading } = useQuery<InvoiceTemplate[]>({
    queryKey: templatesKey,
    enabled: !!companyId && templatesAllowed,
  });
  const defaultTemplate = templates?.find((tpl) => tpl.isDefault) ?? templates?.[0] ?? null;
  const [draft, setDraft] = useState<TemplateDraft>({
    primaryColor: DOCUMENT_ACCENT_DEFAULT,
    headerText: "",
    footerText: "",
    termsText: "",
    bankDetails: "",
  });
  useEffect(() => {
    if (!defaultTemplate) return;
    setDraft({
      primaryColor: resolveDocumentAccent(defaultTemplate.primaryColor),
      headerText: defaultTemplate.headerText ?? "",
      footerText: defaultTemplate.footerText ?? "",
      termsText: defaultTemplate.termsText ?? "",
      bankDetails: defaultTemplate.bankDetails ?? "",
    });
  }, [defaultTemplate]);

  // (a) Company fields on documents — the former Invoices → Branding tab, same PATCH body.
  const form = useForm<BrandingFormData>({
    resolver: zodResolver(brandingSchema),
    defaultValues: {
      invoiceShowLogo: company.invoiceShowLogo ?? true,
      invoiceShowAddress: company.invoiceShowAddress ?? true,
      invoiceShowPhone: company.invoiceShowPhone ?? true,
      invoiceShowEmail: company.invoiceShowEmail ?? true,
      invoiceShowWebsite: company.invoiceShowWebsite ?? false,
      invoiceCustomTitle: company.invoiceCustomTitle || "",
      invoiceFooterNote: company.invoiceFooterNote || "",
    },
  });
  const saveBranding = useMutation({
    mutationFn: (data: BrandingFormData) =>
      apiRequest("PATCH", `/api/companies/${companyId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({
        title: t["invoices.toastBrandingUpdated"],
        description: t["invoices.toastBrandingBody"],
      });
    },
    onError: (error: Error) =>
      toast({
        variant: "destructive",
        title: t["invoices.toastBrandingFailed"],
        description: error?.message || t["invoices.toastTryAgain"],
      }),
  });

  // (b) + (c) Accent, terms and bank details live on the default template.
  const saveTemplate = useMutation({
    mutationFn: async (data: TemplateDraft) => {
      if (defaultTemplate) {
        return apiRequest("PUT", `/api/invoice-templates/${defaultTemplate.id}`, data);
      }
      const created = await apiRequest("POST", `/api/companies/${companyId}/invoice-templates`, {
        name: tt["invoiceDesign.documents.standardName"],
        layout: "standard",
        showLogo: true,
        showStamp: false,
        ...data,
      });
      return apiRequest("POST", `/api/invoice-templates/${created.id}/set-default`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: templatesKey });
      toast({
        title: translateNow("toasts.templateUpdated"),
        description: translateNow("toasts.yourInvoiceTemplateHasBeenUpdatedSuccessfully"),
      });
    },
    onError: (error: Error) =>
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToCreateTemplate"),
        description: error?.message || translateNow("toasts.pleaseTryAgain"),
      }),
  });

  const watch = form.watch();
  const missing = useMemo(
    () => ({
      logo: !companyLogoSrc(company),
      address: !company.businessAddress,
      phone: !company.contactPhone,
      email: !company.contactEmail,
      website: !company.websiteUrl,
    }),
    [company]
  );
  const anyMissing = Object.values(missing).some(Boolean);
  const vatRegistered = Boolean(company.trnVatNumber?.trim());

  const toggles: Array<{
    name: keyof BrandingFormData;
    label: string;
    missing: boolean;
    testId: string;
  }> = [
    {
      name: "invoiceShowLogo",
      label: tt["invoiceDesign.documents.showLogo"],
      missing: missing.logo,
      testId: "switch-show-logo",
    },
    {
      name: "invoiceShowAddress",
      label: tt["invoiceDesign.documents.showAddress"],
      missing: missing.address,
      testId: "switch-show-address",
    },
    {
      name: "invoiceShowPhone",
      label: tt["invoiceDesign.documents.showPhone"],
      missing: missing.phone,
      testId: "switch-show-phone",
    },
    {
      name: "invoiceShowEmail",
      label: tt["invoiceDesign.documents.showEmail"],
      missing: missing.email,
      testId: "switch-show-email",
    },
    {
      name: "invoiceShowWebsite",
      label: tt["invoiceDesign.documents.showWebsite"],
      missing: missing.website,
      testId: "switch-show-website",
    },
  ];

  const preview = (
    <InvoicePreview
      sellerName={company.legalName || company.name}
      sellerTrn={company.trnVatNumber}
      sellerAddress={watch.invoiceShowAddress ? company.businessAddress : null}
      number={null}
      date={new Date()}
      customerName={tt["invoiceDesign.documents.sampleCustomer"]}
      currency={(company as { baseCurrency?: string }).baseCurrency || "AED"}
      lines={SAMPLE_LINES.map((l) => ({
        ...l,
        description: tt["invoiceDesign.documents.sampleLine"],
      }))}
      subtotal={3000}
      vatAmount={150}
      total={3150}
      ratesLabel="5%"
      accent={templatesAllowed ? draft.primaryColor : DOCUMENT_ACCENT_DEFAULT}
    />
  );

  return (
    <div className="space-y-8">
      <div className="space-y-8">
        <Form {...form}>
          <form onSubmit={form.handleSubmit((data) => saveBranding.mutate(data))}>
            <SectionCard
              title={tt["invoiceDesign.documents.appearsTitle"]}
              description={tt["invoiceDesign.documents.appearsBody"]}
              footer={
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    disabled={saveBranding.isPending}
                    data-testid="button-save-branding"
                  >
                    {saveBranding.isPending ? t["forms.saving"] : t["pageLabels.saveSettings"]}
                  </Button>
                </div>
              }
            >
              <div className="space-y-5">
                {anyMissing && (
                  <SetupNotice
                    action={{
                      label: tt["invoiceDesign.documents.openCompany"],
                      href: "/settings/company",
                    }}
                  >
                    {tt["invoiceDesign.documents.missingDetails"]}
                  </SetupNotice>
                )}
                <div className="divide-hairline rounded-lg border border-border">
                  {toggles.map((toggle) => (
                    <FormField
                      key={toggle.name}
                      control={form.control}
                      name={toggle.name}
                      render={({ field }) => (
                        <FormItem className="flex min-h-11 items-center justify-between gap-4 space-y-0 px-4 py-2.5">
                          <FormLabel className="font-normal">{toggle.label}</FormLabel>
                          <FormControl>
                            <Switch
                              checked={Boolean(field.value)}
                              onCheckedChange={field.onChange}
                              disabled={toggle.missing}
                              data-testid={toggle.testId}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  ))}
                </div>
                <FormField
                  control={form.control}
                  name="invoiceCustomTitle"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tt["invoiceDesign.documents.titleLabel"]}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={
                            vatRegistered
                              ? tt["invoiceDesign.documents.titlePlaceholderTax"]
                              : tt["invoiceDesign.documents.titlePlaceholder"]
                          }
                          {...field}
                          value={field.value ?? ""}
                          data-testid="input-invoice-title"
                        />
                      </FormControl>
                      <p className="text-small text-muted-foreground">
                        {vatRegistered
                          ? tt["invoiceDesign.documents.titleHelpTax"]
                          : tt["invoiceDesign.documents.titleHelp"]}
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="invoiceFooterNote"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tt["invoiceDesign.documents.footerLabel"]}</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder={t["pageLabels.thankYouForYourBusiness"]}
                          className="resize-none"
                          rows={3}
                          {...field}
                          value={field.value ?? ""}
                          data-testid="textarea-footer-note"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </SectionCard>
          </form>
        </Form>

        {templatesAllowed ? (
          templatesLoading ? (
            <Skeleton className="h-64" />
          ) : (
            <SectionCard
              title={tt["invoiceDesign.documents.styleTitle"]}
              description={tt["invoiceDesign.documents.styleBody"]}
              footer={
                <div className="flex justify-end">
                  <Button
                    onClick={() => saveTemplate.mutate(draft)}
                    disabled={saveTemplate.isPending || !HEX_COLOR.test(draft.primaryColor)}
                    data-testid="button-save-template"
                  >
                    {saveTemplate.isPending ? t["forms.saving"] : t["pageLabels.saveSettings"]}
                  </Button>
                </div>
              }
            >
              <div className="space-y-6">
                <fieldset className="space-y-2">
                  <legend className="text-small font-medium">
                    {tt["invoiceDesign.documents.accentLabel"]}
                  </legend>
                  <div className="flex flex-wrap items-center gap-2" role="radiogroup">
                    {DOCUMENT_ACCENT_PRESETS.map((preset) => {
                      const selected =
                        draft.primaryColor.toLowerCase() === preset.hex.toLowerCase();
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setDraft({ ...draft, primaryColor: preset.hex })}
                          className={cn(
                            "flex min-h-11 items-center gap-2 rounded-md border px-3 text-small transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            selected
                              ? "border-primary bg-secondary text-foreground"
                              : "border-border text-muted-foreground hover:text-foreground"
                          )}
                          data-testid={`accent-${preset.id}`}
                        >
                          <span
                            className="flex h-5 w-5 items-center justify-center rounded-full"
                            style={{ backgroundColor: preset.hex }}
                            aria-hidden
                          >
                            {selected && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                          </span>
                          {tt[`invoiceDesign.documents.accent.${preset.id}`]}
                        </button>
                      );
                    })}
                    <label className="flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-small text-muted-foreground">
                      <span>{tt["invoiceDesign.documents.accentCustom"]}</span>
                      <Input
                        value={draft.primaryColor}
                        onChange={(e) => setDraft({ ...draft, primaryColor: e.target.value })}
                        className="h-8 w-28 font-mono"
                        dir="ltr"
                        aria-invalid={!HEX_COLOR.test(draft.primaryColor)}
                        data-testid="input-accent-hex"
                      />
                    </label>
                  </div>
                  <p className="text-small text-muted-foreground">
                    {tt["invoiceDesign.documents.accentHelp"]}
                  </p>
                </fieldset>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="doc-header">{tt["invoiceDesign.documents.headerText"]}</Label>
                    <Textarea
                      id="doc-header"
                      rows={2}
                      value={draft.headerText}
                      onChange={(e) => setDraft({ ...draft, headerText: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="doc-footer">{tt["invoiceDesign.documents.footerText"]}</Label>
                    <Textarea
                      id="doc-footer"
                      rows={2}
                      value={draft.footerText}
                      onChange={(e) => setDraft({ ...draft, footerText: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="doc-terms">{tt["invoiceDesign.documents.terms"]}</Label>
                    <Textarea
                      id="doc-terms"
                      rows={4}
                      maxLength={2000}
                      value={draft.termsText}
                      onChange={(e) => setDraft({ ...draft, termsText: e.target.value })}
                      data-testid="textarea-terms"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="doc-bank">{tt["invoiceDesign.documents.bankDetails"]}</Label>
                    <Textarea
                      id="doc-bank"
                      rows={4}
                      maxLength={1000}
                      value={draft.bankDetails}
                      onChange={(e) => setDraft({ ...draft, bankDetails: e.target.value })}
                      data-testid="textarea-bank-details"
                    />
                  </div>
                </div>
              </div>
            </SectionCard>
          )
        ) : (
          upgrade
        )}

        {templatesAllowed && (templates?.length ?? 0) > 1 && (
          <TemplateCards templates={templates!} companyId={companyId} />
        )}
      </div>

      {/* SettingsLayout keeps a 760 px column, so the live preview follows the settings. */}
      <SectionCard title={tt["invoices.editor.preview"]}>{preview}</SectionCard>
    </div>
  );
}

/** Several templates: cards with an accent thumbnail; the default one drives every document. */
function TemplateCards({
  templates,
  companyId,
}: {
  templates: InvoiceTemplate[];
  companyId?: string;
}) {
  const { t } = useTranslation();
  const tt = t as Record<string, string>;
  const { toast } = useToast();
  const key = ["/api/companies", companyId, "invoice-templates"];
  const setDefault = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/invoice-templates/${id}/set-default`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      toast({
        title: translateNow("toasts.defaultTemplateSet"),
        description: translateNow("toasts.thisTemplateWillBeUsedForNew"),
      });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/invoice-templates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      toast({
        title: translateNow("toasts.templateDeleted"),
        description: translateNow("toasts.theTemplateHasBeenDeleted"),
      });
    },
    onError: (error: Error) =>
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToDeleteTemplate"),
        description: error?.message,
      }),
  });
  return (
    <SectionCard
      title={tt["invoiceDesign.documents.templatesTitle"]}
      description={formatMessage(tt["invoiceDesign.documents.templatesBody"], {
        count: templates.length,
      })}
    >
      <ul className="grid gap-3 sm:grid-cols-2">
        {templates.map((tpl) => (
          <li
            key={tpl.id}
            className="flex items-center gap-3 rounded-lg border border-border p-3"
            data-testid={`template-card-${tpl.id}`}
          >
            {/* Thumbnail: a page with the accent rule and amount-due bar. */}
            <span
              className="flex h-14 w-11 shrink-0 flex-col justify-between rounded-sm border border-border bg-card p-1"
              aria-hidden
            >
              <span
                className="h-0.5 w-full rounded-full"
                style={{ backgroundColor: tpl.primaryColor }}
              />
              <span className="space-y-0.5">
                <span className="block h-px w-full bg-border" />
                <span className="block h-px w-full bg-border" />
                <span className="block h-px w-2/3 bg-border" />
              </span>
              <span
                className="ms-auto h-1 w-1/2 rounded-[1px]"
                style={{ backgroundColor: tpl.primaryColor }}
              />
            </span>
            <div className="min-w-0 flex-1">
              <div dir="auto" className="truncate text-small font-medium">
                {tpl.name}
              </div>
              {tpl.isDefault && (
                <StatusBadge tone="accent" className="mt-1">
                  {tt["invoiceDesign.documents.default"]}
                </StatusBadge>
              )}
            </div>
            {!tpl.isDefault && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t["components.rowMoreActions"]}
                  >
                    <MoreHorizontal aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setDefault.mutate(tpl.id)}>
                    <Star aria-hidden />
                    {tt["invoiceDesign.documents.makeDefault"]}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive"
                    onSelect={() => remove.mutate(tpl.id)}
                  >
                    <Trash2 aria-hidden />
                    {tt["invoiceDesign.documents.delete"]}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
