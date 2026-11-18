import type { UseFormReturn } from "react-hook-form";
import { CalendarIcon } from "lucide-react";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { PAYMENT_TERM_OPTIONS } from "@shared/sales-documents";
import { paymentTermsLabel } from "@/lib/invoice-documents";

export interface TermsFormShape {
  paymentTerms?: string;
  dueDate?: Date | null;
  documentLanguage?: string;
  notes?: string;
}

/**
 * WQ1 (7.2b, 7.2g, 7.21): payment terms and the due date they give (filled from the contact's
 * terms, editable: a date picked by hand stays until the terms change), the document's PDF
 * language and the notes / terms printed on it.
 */
export function InvoiceTermsFields<T extends TermsFormShape>({
  form,
  onDueDateTouched,
  issued,
}: {
  form: UseFormReturn<T>;
  /** Called when the user picks a due date by hand. */
  onDueDateTouched: () => void;
  /** An issued invoice: terms, due date, language and notes stay editable. */
  issued?: boolean;
}) {
  const { t, locale } = useTranslation();
  // The generic form shape is narrowed here; react-hook-form's path types cannot follow it.
  const f = form as unknown as UseFormReturn<TermsFormShape>;
  const current = f.watch("paymentTerms");
  const termOptions =
    current && !(PAYMENT_TERM_OPTIONS as readonly string[]).includes(current)
      ? [...PAYMENT_TERM_OPTIONS, current]
      : [...PAYMENT_TERM_OPTIONS];
  return (
    <>
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
        <FormField
          control={f.control}
          name="paymentTerms"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t["invoices.terms.label"]}</FormLabel>
              <Select value={field.value || "net30"} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger data-testid="select-payment-terms">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {termOptions.map((code) => (
                    <SelectItem key={code} value={code}>
                      {paymentTermsLabel(t, code)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>{t["invoices.terms.hint"]}</FormDescription>
            </FormItem>
          )}
        />
        <FormField
          control={f.control}
          name="dueDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t["invoices.dueDate.label"]}</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant="outline"
                      name={field.name}
                      ref={field.ref}
                      className={cn(
                        "w-full justify-start text-start font-normal",
                        !field.value && "text-muted-foreground"
                      )}
                      data-testid="button-due-date"
                    >
                      <CalendarIcon className="h-4 w-4" aria-hidden />
                      {field.value ? formatDate(field.value, locale) : t["invoices.dueDate.none"]}
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={field.value ?? undefined}
                    onSelect={(d) => {
                      onDueDateTouched();
                      field.onChange(d ?? null);
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={f.control}
          name="documentLanguage"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t["invoices.language.label"]}</FormLabel>
              <Select value={field.value || "company"} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger data-testid="select-document-language">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="company">{t["invoices.language.company"]}</SelectItem>
                  <SelectItem value="en">{t["invoices.language.en"]}</SelectItem>
                  <SelectItem value="ar">{t["invoices.language.ar"]}</SelectItem>
                </SelectContent>
              </Select>
              <FormDescription>{t["invoices.language.hint"]}</FormDescription>
            </FormItem>
          )}
        />
      </div>
      <FormField
        control={f.control}
        name="notes"
        render={({ field }) => (
          <FormItem className="mt-4">
            <FormLabel>{t["invoices.notes.label"]}</FormLabel>
            <FormControl>
              <Textarea
                {...field}
                value={field.value ?? ""}
                dir="auto"
                rows={3}
                maxLength={4000}
                placeholder={t["invoices.notes.placeholder"]}
                data-testid="input-invoice-notes"
              />
            </FormControl>
            <FormDescription>
              {issued ? t["invoices.notes.issuedHint"] : t["invoices.notes.hint"]}
            </FormDescription>
          </FormItem>
        )}
      />
    </>
  );
}
