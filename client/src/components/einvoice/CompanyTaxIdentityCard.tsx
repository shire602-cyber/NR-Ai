/**
 * WQ5: Settings › Company "E-invoicing identity" card: stored TIN (prefilled from the CT TRN),
 * seller ID type and number, structured address, Arabic legal name and address. Saves through
 * PUT /api/companies/:id/einvoicing/identity (validated on the server).
 */
import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { TaxIdentityFields } from "./TaxIdentityFields";
import {
  bodyFromForm,
  formFromIdentity,
  useSaveTaxIdentity,
  useTaxIdentity,
  type TaxIdentityForm,
} from "./tax-identity";
import { identityErrorFor } from "./identity-errors";

const ALL_KEYS: (keyof TaxIdentityForm)[] = [
  "legalName",
  "legalNameAr",
  "einvoiceTin",
  "sellerIdType",
  "sellerIdNumber",
  "sellerIdCountry",
  "tradeLicenceAuthority",
  "addressStreet",
  "addressDistrict",
  "addressCity",
  "addressPoBox",
  "addressAr",
  "emirate",
];

export function CompanyTaxIdentityCard({ companyId }: { companyId: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { gate } = useCompanyPermission();
  const identity = useTaxIdentity(companyId);
  const save = useSaveTaxIdentity(companyId);
  const [form, setForm] = useState<TaxIdentityForm>(() => formFromIdentity(undefined));
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof TaxIdentityForm, string>>>({});

  useEffect(() => {
    if (identity.data && !dirty) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates local form state from fetched data
      setForm(formFromIdentity(identity.data));
    }
  }, [identity.data, dirty]);

  const missing = identity.data?.missing ?? [];

  return (
    <SectionCard
      testId="company-tax-identity-card"
      title={t["einvoicing.taxId.cardTitle"]}
      description={t["einvoicing.taxId.cardDescription"]}
      actions={
        identity.data ? (
          <StatusBadge tone={missing.length ? "warning" : "success"} data-testid="tax-id-status">
            {missing.length
              ? t["einvoicing.taxId.statusMissing"]
              : t["einvoicing.taxId.statusReady"]}
          </StatusBadge>
        ) : undefined
      }
    >
      <form
        noValidate
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          setErrors({});
          save.mutate(bodyFromForm(form, ALL_KEYS), {
            onSuccess: () => {
              setDirty(false);
              toast({ title: t["einvoicing.taxId.saved"] });
            },
            onError: (err) => {
              const mapped = identityErrorFor(err, t);
              if (mapped) setErrors({ [mapped.field]: mapped.message });
              toast({
                variant: "destructive",
                title: t["einvoicing.taxId.saveFailed"],
                description: mapped?.message ?? err.message,
              });
            },
          });
        }}
      >
        <TaxIdentityFields
          idPrefix="company-tax-id"
          form={form}
          view={identity.data}
          errors={errors}
          onChange={(patch) => {
            setDirty(true);
            setForm((f) => ({ ...f, ...patch }));
          }}
        />
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={!dirty || save.isPending}
            data-testid="button-save-tax-identity"
            {...gate("settings.company")}
          >
            <Save className="h-4 w-4" aria-hidden />
            {save.isPending ? t["forms.saving"] : t["einvoicing.taxId.save"]}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
