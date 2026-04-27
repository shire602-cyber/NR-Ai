import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { companyPreferencesSchema, type Company, type CompanyPreferences } from '@shared/schema';
import { Building2, Globe, MapPin, FileText, Save, Upload } from 'lucide-react';

const CURRENCY_OPTIONS = [
  { value: 'AED', label: 'AED — UAE Dirham' },
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'GBP', label: 'GBP — British Pound' },
  { value: 'SAR', label: 'SAR — Saudi Riyal' },
  { value: 'QAR', label: 'QAR — Qatari Riyal' },
  { value: 'KWD', label: 'KWD — Kuwaiti Dinar' },
  { value: 'BHD', label: 'BHD — Bahraini Dinar' },
  { value: 'OMR', label: 'OMR — Omani Rial' },
  { value: 'INR', label: 'INR — Indian Rupee' },
];

const MONTH_OPTIONS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const VAT_RATE_OPTIONS = [
  { value: '0', label: '0% — Zero-rated / Out of scope' },
  { value: '0.05', label: '5% — UAE Standard rate' },
  { value: '0.15', label: '15% — KSA Standard rate' },
];

const EMIRATE_OPTIONS = [
  { value: 'abu_dhabi', label: 'Abu Dhabi' },
  { value: 'dubai', label: 'Dubai' },
  { value: 'sharjah', label: 'Sharjah' },
  { value: 'ajman', label: 'Ajman' },
  { value: 'umm_al_quwain', label: 'Umm Al Quwain' },
  { value: 'ras_al_khaimah', label: 'Ras Al Khaimah' },
  { value: 'fujairah', label: 'Fujairah' },
];

const COUNTRY_OPTIONS = [
  { value: 'AE', label: 'United Arab Emirates' },
  { value: 'SA', label: 'Saudi Arabia' },
  { value: 'QA', label: 'Qatar' },
  { value: 'KW', label: 'Kuwait' },
  { value: 'BH', label: 'Bahrain' },
  { value: 'OM', label: 'Oman' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'US', label: 'United States' },
  { value: 'IN', label: 'India' },
];

const DATE_FORMAT_OPTIONS = [
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY (e.g. 27/04/2026)' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (e.g. 04/27/2026)' },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (e.g. 2026-04-27)' },
];

type FormValues = CompanyPreferences;

export default function CompanySettings() {
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const { data: company, isLoading } = useQuery<Company>({
    queryKey: ['/api/companies', companyId],
    enabled: !!companyId,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(companyPreferencesSchema),
    defaultValues: {
      name: '',
      legalName: '',
      trnVatNumber: '',
      baseCurrency: 'AED',
      fiscalYearStartMonth: 1,
      defaultVatRate: 0.05,
      addressStreet: '',
      addressCity: '',
      emirate: 'dubai',
      addressCountry: 'AE',
      contactPhone: '',
      contactEmail: '',
      industry: '',
      logoUrl: '',
      dateFormat: 'DD/MM/YYYY',
      locale: 'en',
    },
  });

  useEffect(() => {
    if (!company) return;
    form.reset({
      name: company.name ?? '',
      legalName: company.legalName ?? '',
      trnVatNumber: company.trnVatNumber ?? '',
      baseCurrency: (company.baseCurrency ?? 'AED') as FormValues['baseCurrency'],
      fiscalYearStartMonth: company.fiscalYearStartMonth ?? 1,
      defaultVatRate: company.defaultVatRate ?? 0.05,
      addressStreet: company.addressStreet ?? '',
      addressCity: company.addressCity ?? '',
      emirate: (company.emirate as FormValues['emirate']) ?? 'dubai',
      addressCountry: company.addressCountry ?? 'AE',
      contactPhone: company.contactPhone ?? '',
      contactEmail: company.contactEmail ?? '',
      industry: company.industry ?? '',
      logoUrl: company.logoUrl ?? '',
      dateFormat: (company.dateFormat as FormValues['dateFormat']) ?? 'DD/MM/YYYY',
      locale: (company.locale as FormValues['locale']) ?? 'en',
    });
    if (company.logoUrl) setLogoPreview(company.logoUrl);
  }, [company, form]);

  const updateMutation = useMutation({
    mutationFn: (data: FormValues) =>
      apiRequest('PATCH', `/api/companies/${companyId}/preferences`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId] });
      queryClient.invalidateQueries({ queryKey: ['/api/companies'] });
      toast({
        title: 'Preferences saved',
        description: 'Your company preferences have been updated.',
      });
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Failed to save preferences',
        description: error?.message || 'Please try again.',
      });
    },
  });

  const onSubmit = (data: FormValues) => updateMutation.mutate(data);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024) {
      toast({
        variant: 'destructive',
        title: 'Image too large',
        description: 'Please choose an image under 1 MB.',
      });
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      setLogoPreview(result);
      form.setValue('logoUrl', result, { shouldDirty: true });
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
              <p>No company selected.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-3xl font-semibold mb-2">Company Settings</h1>
        <p className="text-muted-foreground">
          Manage company-wide preferences: identity, currency, fiscal year, VAT, address, and locale.
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          {/* Identity */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <Building2 className="w-5 h-5 text-primary" />
                <div>
                  <CardTitle>Company Identity</CardTitle>
                  <CardDescription>Names, registration, and logo shown on invoices.</CardDescription>
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
                          value={field.value ?? ''}
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
                      <FormLabel>Legal Name</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ''}
                          placeholder="Acme Trading L.L.C"
                          data-testid="input-legal-name"
                        />
                      </FormControl>
                      <FormDescription>Registered name. Used on tax invoices.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="trnVatNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>TRN (Tax Registration Number)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ''}
                          placeholder="100123456789012"
                          inputMode="numeric"
                          maxLength={15}
                          className="font-mono"
                          data-testid="input-trn"
                        />
                      </FormControl>
                      <FormDescription>UAE: 15 digits.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="industry"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Industry</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ''}
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
                <FormLabel>Company Logo</FormLabel>
                <div className="flex items-center gap-4">
                  {logoPreview && (
                    <div className="w-16 h-16 rounded border overflow-hidden flex-shrink-0 bg-muted">
                      <img src={logoPreview} alt="Logo preview" className="w-full h-full object-contain" />
                    </div>
                  )}
                  <div className="flex-1">
                    <label
                      htmlFor="logo-upload"
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-input bg-background hover:bg-accent cursor-pointer text-sm"
                    >
                      <Upload className="w-4 h-4" />
                      Choose image
                    </label>
                    <input
                      id="logo-upload"
                      type="file"
                      accept="image/*"
                      onChange={handleLogoChange}
                      className="hidden"
                      data-testid="input-logo-upload"
                    />
                    <FormDescription className="mt-2">PNG/JPG/SVG, under 1 MB.</FormDescription>
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
                  <CardTitle>Localization & Finance</CardTitle>
                  <CardDescription>Currency, fiscal year, VAT, language, and date format.</CardDescription>
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
                      <FormLabel>Preferred Currency *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? 'AED'}>
                        <FormControl>
                          <SelectTrigger data-testid="select-base-currency">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {CURRENCY_OPTIONS.map(c => (
                            <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
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
                      <FormLabel>Financial Year Starts</FormLabel>
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
                            <SelectItem key={idx + 1} value={String(idx + 1)}>{label}</SelectItem>
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
                      <FormLabel>Default VAT Rate</FormLabel>
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
                          {VAT_RATE_OPTIONS.map(r => (
                            <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>Applied to new invoice lines by default.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="dateFormat"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date Format</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? 'DD/MM/YYYY'}>
                        <FormControl>
                          <SelectTrigger data-testid="select-date-format">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {DATE_FORMAT_OPTIONS.map(d => (
                            <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
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
                      <FormLabel>Language</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? 'en'}>
                        <FormControl>
                          <SelectTrigger data-testid="select-locale">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="en">English</SelectItem>
                          <SelectItem value="ar">العربية (Arabic)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>Used for invoice templates and the UI.</FormDescription>
                      <FormMessage />
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
                  <CardTitle>Address & Contact</CardTitle>
                  <CardDescription>Used on invoices, statements, and tax filings.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="addressStreet"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Street Address</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ''}
                        placeholder="Office 101, Building 7, Sheikh Zayed Rd"
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
                      <FormLabel>City</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ''}
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
                      <FormLabel>Emirate / Region</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? 'dubai'}>
                        <FormControl>
                          <SelectTrigger data-testid="select-emirate">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {EMIRATE_OPTIONS.map(e => (
                            <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
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
                      <FormLabel>Country</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? 'AE'}>
                        <FormControl>
                          <SelectTrigger data-testid="select-address-country">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {COUNTRY_OPTIONS.map(c => (
                            <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
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
                      <FormLabel>Phone</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ''}
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
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ''}
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
              Reset
            </Button>
            <Button
              type="submit"
              disabled={updateMutation.isPending || !form.formState.isDirty}
              className="min-w-32"
              data-testid="button-save-company-settings"
            >
              {updateMutation.isPending ? (
                'Saving…'
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          </div>

          <Card className="bg-muted/30 border-dashed">
            <CardContent className="py-4 flex items-start gap-3 text-sm text-muted-foreground">
              <FileText className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                Need to update tax registration type, filing frequency, or other compliance fields?
                Visit the <a href="/company-profile" className="text-primary underline">Company Profile</a> page.
              </div>
            </CardContent>
          </Card>
        </form>
      </Form>
    </div>
  );
}
