import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  ErrorSummary,
  Field,
  FormActions,
  FormGrid,
  FormSection,
} from "@/components/ui/form-layout";
import { useFormGate } from "@/hooks/use-form-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { apiRequest } from "@/lib/queryClient";

// Create-supplier dialog, loaded on demand by pages/Vendors. The page keeps it mounted once
// requested, so typed values survive a manual close.

const COPY = {
  en: {
    nameAr: "Arabic name",
    trn: "TRN (15 digits)",
    phone: "Phone",
    terms: "Payment terms (days)",
    iban: "IBAN",
    bank: "Bank",
    save: "Save",
    cancel: "Cancel",
    saved: "Supplier saved",
  },
  ar: {
    nameAr: "الاسم بالعربية",
    trn: "الرقم الضريبي (15 رقمًا)",
    phone: "الهاتف",
    terms: "شروط الدفع (أيام)",
    iban: "رقم الآيبان",
    bank: "البنك",
    save: "حفظ",
    cancel: "إلغاء",
    saved: "تم حفظ المورد",
  },
} as const;

const EMPTY = {
  name: "",
  name_ar: "",
  trn: "",
  email: "",
  phone: "",
  payment_terms_days: "30",
  currency: "AED",
  iban: "",
  bank_name: "",
};

interface NewVendorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string | undefined;
  onSaved: () => void;
  /** Labels the supplier list also shows; passed in so each is written once. */
  labels: { title: string; name: string; email: string; currency: string };
}

export default function NewVendorDialog({
  open,
  onOpenChange,
  companyId,
  onSaved,
  labels,
}: NewVendorDialogProps) {
  const { t, locale } = useTranslation();
  const c = COPY[locale === "ar" ? "ar" : "en"];
  const { toast } = useToast();
  const [form, setForm] = useState<Record<string, string>>({ ...EMPTY });

  const create = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/vendors`, {
        name: form.name,
        name_ar: form.name_ar || null,
        trn: form.trn || null,
        email: form.email || null,
        phone: form.phone || null,
        payment_terms_days: Number(form.payment_terms_days) || 0,
        currency: form.currency || "AED",
        iban: form.iban || null,
        bank_name: form.bank_name || null,
      }),
    onSuccess: () => {
      onSaved();
      toast({ title: c.saved });
      onOpenChange(false);
      setForm({ ...EMPTY });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: e.message }),
  });

  const gate = useFormGate([{ id: "vendor-name", label: labels.name, invalid: !form.name }]);
  const field = (
    key: keyof typeof EMPTY,
    label: string,
    props: Record<string, string> = {},
    opts: { required?: boolean; help?: string; ltr?: boolean } = {}
  ) => (
    <Field
      id={`vendor-${key}`}
      label={label}
      required={opts.required}
      help={opts.help}
      error={gate.errorFor(`vendor-${key}`)}
    >
      <Input
        ltr={opts.ltr}
        value={form[key] ?? ""}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        {...props}
      />
    </Field>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) gate.reset();
      }}
    >
      <DialogContent size="md" data-testid="dialog-vendor-form">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{t["forms.vendor.desc"]}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (create.isPending || !gate.attempt()) return;
            create.mutate();
          }}
        >
          <ErrorSummary items={gate.summary} />
          <FormSection title={t["forms.section.vendor"]}>
            <FormGrid>
              {field("name", labels.name, { dir: "auto" }, { required: true })}
              {field("name_ar", c.nameAr, { dir: "rtl", lang: "ar" })}
            </FormGrid>
          </FormSection>
          <FormSection title={t["forms.section.tax"]} description={t["forms.section.taxDesc"]}>
            <FormGrid>
              {field(
                "trn",
                c.trn,
                { inputMode: "numeric", maxLength: "15" },
                { ltr: true, help: t["forms.contact.trnHelp"] }
              )}
              {field(
                "payment_terms_days",
                c.terms,
                { inputMode: "numeric" },
                { ltr: true, help: t["forms.vendor.termsHelp"] }
              )}
              {field("currency", labels.currency, { maxLength: "3" }, { ltr: true })}
            </FormGrid>
          </FormSection>
          <FormSection title={t["forms.section.contact"]}>
            <FormGrid>
              {field("email", labels.email, { type: "email", dir: "ltr", autoComplete: "email" })}
              {field("phone", c.phone, { type: "tel", dir: "ltr", autoComplete: "tel" })}
            </FormGrid>
          </FormSection>
          <FormSection title={t["forms.section.bank"]}>
            <FormGrid>
              {field("iban", c.iban, { autoComplete: "off" }, { ltr: true })}
              {field("bank_name", c.bank, { dir: "auto" })}
            </FormGrid>
          </FormSection>
          <FormActions sticky>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {c.cancel}
            </Button>
            <Button type="submit" className="sm:min-w-32" disabled={create.isPending}>
              {create.isPending ? t["forms.saving"] : c.save}
            </Button>
          </FormActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
