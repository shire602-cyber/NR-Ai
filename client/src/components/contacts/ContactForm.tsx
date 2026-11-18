/**
 * The contact create / edit form (moved out of CustomerContacts.tsx).
 *
 * WQ5: one record for a customer and/or supplier (the server links the vendors row bills
 * read), business or individual, ID type and number (the buyer legal identifier PINT AE
 * writes), free zone, structured address, typed tax registrations (VAT, CT, excise, VAT
 * exception), default revenue / expense account (control accounts left out, C1), VAT
 * treatment and cost centre, and the Arabic name used on Arabic and bilingual documents.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { T } from "@/components/layout/T";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ErrorSummary,
  Field,
  FormActions,
  FormGrid,
  FormSection,
  formSpanFull,
} from "@/components/ui/form-layout";
import { useFormGate } from "@/hooks/use-form-gate";
import { useTranslation } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { withoutControlAccounts } from "@/lib/control-account-options";
import { cn } from "@/lib/utils";
import { SUPPLY_TYPES } from "@shared/validators/primitives";
import {
  SELLER_ID_TYPES,
  TAX_REGISTRATION_TYPES,
  type SellerIdType,
  type TaxRegistrationType,
} from "@shared/validators/einvoice-identity";
import {
  contactBodyFromForm,
  initialRegistrations,
  type ContactFormState,
  type ContactRow,
} from "./contact-form-model";

export type { ContactRow };

/** Select sentinel for "use the company emirate" / "none" (Radix items cannot carry ""). */
const NONE = "default";

const CONTACT_EMIRATES = [
  "abu_dhabi",
  "dubai",
  "sharjah",
  "ajman",
  "umm_al_quwain",
  "ras_al_khaimah",
  "fujairah",
] as const;

interface AccountOption {
  id: string;
  code?: string | null;
  nameEn?: string | null;
  nameAr?: string | null;
  name?: string | null;
  type?: string | null;
  parentId?: string | null;
  isVatAccount?: boolean | null;
  vatType?: string | null;
  isActive?: boolean | null;
  isArchived?: boolean | null;
}

export function ContactForm({
  contact,
  onSubmit,
  onCancel,
}: {
  contact?: ContactRow | null;
  onSubmit: (data: ReturnType<typeof contactBodyFromForm>) => void;
  onCancel: () => void;
}) {
  const { t, locale } = useTranslation();
  const { companyId } = useDefaultCompany();
  const [f, setF] = useState<ContactFormState>({
    name: contact?.name || "",
    nameAr: contact?.nameAr || "",
    email: contact?.email || "",
    phone: contact?.phone || "",
    address: contact?.address || "",
    // Legacy contacts: the single-line address becomes the street line.
    addressStreet: contact?.addressStreet || contact?.address || "",
    addressBuilding: contact?.addressBuilding || "",
    addressDistrict: contact?.addressDistrict || "",
    postalCode: contact?.postalCode || "",
    city: contact?.city || "",
    country: contact?.country || t["pageLabels.countryUaeName"],
    // R03-10: invoices to this contact default their place of supply and due date from here.
    emirate: contact?.emirate || "",
    paymentTerms: contact?.paymentTerms ?? 30,
    isCustomer: contact?.isCustomer ?? true,
    isSupplier: contact?.isSupplier ?? false,
    partyType: (contact?.partyType as "business" | "individual") || "business",
    freeZone: contact?.freeZone ?? false,
    legalIdType: contact?.legalIdType ?? "",
    legalId: contact?.legalId ?? "",
    legalIdCountry: contact?.legalIdCountry ?? "",
    registrations: initialRegistrations(contact),
    defaultRevenueAccountId: contact?.defaultRevenueAccountId ?? "",
    defaultExpenseAccountId: contact?.defaultExpenseAccountId ?? "",
    defaultVatTreatment: contact?.defaultVatTreatment ?? "",
    defaultCostCenterId: contact?.defaultCostCenterId ?? "",
  });
  const set = (patch: Partial<ContactFormState>) => setF((prev) => ({ ...prev, ...patch }));

  const { data: accounts = [] } = useQuery<AccountOption[]>({
    queryKey: ["/api/companies", companyId, "accounts"],
    enabled: !!companyId,
  });
  const { data: costCenters = [] } = useQuery<Array<{ id: string; code: string; name: string }>>({
    queryKey: [`/api/companies/${companyId}/cost-centers`],
    enabled: !!companyId,
    retry: false,
  });
  const pickable = withoutControlAccounts(accounts).filter(
    (a) => a.isActive !== false && a.isArchived !== true
  );
  const revenueAccounts = pickable.filter((a) => a.type === "income");
  const expenseAccounts = pickable.filter((a) => a.type === "expense");
  const accountLabel = (a: AccountOption) =>
    `${a.code ? `${a.code} · ` : ""}${(locale === "ar" ? a.nameAr : a.nameEn) || a.nameEn || a.name || ""}`;

  const idp = contact ? `contact-${contact.id}` : "contact-new";
  const emailRequired = f.isCustomer;
  const gate = useFormGate([
    { id: `${idp}-name`, label: t["forms.contact.name"], invalid: !f.name },
    {
      id: `${idp}-email`,
      label: t["forms.contact.email"],
      invalid: emailRequired && !f.email,
    },
    {
      id: `${idp}-role`,
      label: t["forms.contact.role"],
      invalid: !f.isCustomer && !f.isSupplier,
    },
  ]);

  const regLabel = (type: TaxRegistrationType) => t[`forms.contact.reg_${type}`];

  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!gate.attempt()) return;
        onSubmit(contactBodyFromForm(f));
      }}
    >
      <ErrorSummary items={gate.summary} />
      <FormSection title={t["forms.section.contact"]}>
        <FormGrid>
          <Field
            id={`${idp}-role`}
            label={t["forms.contact.role"]}
            help={t["forms.contact.roleHelp"]}
            error={gate.errorFor(`${idp}-role`)}
            className={formSpanFull}
          >
            <div className="flex flex-wrap gap-4" role="group">
              <label className="flex items-center gap-2 text-small">
                <Checkbox
                  checked={f.isCustomer}
                  onCheckedChange={(v) => set({ isCustomer: v === true })}
                  data-testid="contact-role-customer"
                />
                {t["forms.contact.roleCustomer"]}
              </label>
              <label className="flex items-center gap-2 text-small">
                <Checkbox
                  checked={f.isSupplier}
                  onCheckedChange={(v) => set({ isSupplier: v === true })}
                  data-testid="contact-role-supplier"
                />
                {t["forms.contact.roleSupplier"]}
              </label>
            </div>
          </Field>
          <Field id={`${idp}-party`} label={t["forms.contact.partyType"]} className={formSpanFull}>
            <div className="inline-flex rounded-lg border border-border p-0.5" role="group">
              {(["business", "individual"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={f.partyType === p}
                  onClick={() => set({ partyType: p })}
                  data-testid={`contact-party-${p}`}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-small",
                    f.partyType === p
                      ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-950 dark:text-brand-300"
                      : "text-muted-foreground"
                  )}
                >
                  {t[`forms.contact.party_${p}`]}
                </button>
              ))}
            </div>
          </Field>
          <Field
            id={`${idp}-name`}
            label={t["forms.contact.name"]}
            required
            error={gate.errorFor(`${idp}-name`)}
          >
            <Input
              dir="auto"
              value={f.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder={t["forms.contact.namePlaceholder"]}
              data-testid="input-contact-name"
            />
          </Field>
          <Field
            id={`${idp}-name-ar`}
            label={t["forms.contact.nameAr"]}
            help={t["forms.contact.nameArHelp"]}
          >
            <Input
              dir="rtl"
              lang="ar"
              value={f.nameAr}
              onChange={(e) => set({ nameAr: e.target.value })}
              data-testid="input-contact-name-ar"
            />
          </Field>
          <Field
            id={`${idp}-email`}
            label={t["forms.contact.email"]}
            required={emailRequired}
            error={gate.errorFor(`${idp}-email`)}
          >
            <Input
              type="email"
              autoComplete="email"
              value={f.email}
              onChange={(e) => set({ email: e.target.value })}
              placeholder="email@example.com"
              data-testid="input-contact-email"
            />
          </Field>
          <Field id={`${idp}-phone`} label={<T k="pages.phone" />}>
            <Input
              type="tel"
              autoComplete="tel"
              value={f.phone}
              onChange={(e) => set({ phone: e.target.value })}
              placeholder="+971 50 000 0000"
              data-testid="input-contact-phone"
            />
          </Field>
        </FormGrid>
      </FormSection>

      <FormSection title={t["forms.section.tax"]} description={t["forms.section.taxDesc"]}>
        <div className="space-y-3" data-testid="contact-registrations">
          {f.registrations.map((r, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] gap-2">
              <Select
                value={r.type}
                onValueChange={(v) =>
                  set({
                    registrations: f.registrations.map((x, j) =>
                      j === i ? { ...x, type: v as TaxRegistrationType } : x
                    ),
                  })
                }
              >
                <SelectTrigger
                  aria-label={t["forms.contact.regType"]}
                  data-testid={`contact-reg-type-${i}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TAX_REGISTRATION_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {regLabel(type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                ltr
                inputMode={r.type === "vat_exception" ? "text" : "numeric"}
                aria-label={formatRegNumberLabel(t, regLabel(r.type))}
                value={r.number}
                onChange={(e) =>
                  set({
                    registrations: f.registrations.map((x, j) =>
                      j === i ? { ...x, number: e.target.value } : x
                    ),
                  })
                }
                placeholder={r.type === "vat_exception" ? "" : "100XXXXXXXXX003"}
                data-testid={
                  i === 0 && r.type === "vat" ? "input-contact-trn" : `contact-reg-number-${i}`
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t["forms.contact.regRemove"]}
                onClick={() => set({ registrations: f.registrations.filter((_, j) => j !== i) })}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              set({
                registrations: [
                  ...f.registrations,
                  {
                    type: f.registrations.some((r) => r.type === "vat") ? "ct" : "vat",
                    number: "",
                  },
                ],
              })
            }
            data-testid="contact-reg-add"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t["forms.contact.regAdd"]}
          </Button>
          <p className="text-caption text-muted-foreground">{t["forms.contact.trnHelp"]}</p>
        </div>
        <FormGrid>
          <Field
            id={`${idp}-id-type`}
            label={t["forms.contact.idType"]}
            help={t["forms.contact.idTypeHelp"]}
          >
            <Select
              value={f.legalIdType || NONE}
              onValueChange={(v) => set({ legalIdType: v === NONE ? "" : (v as SellerIdType) })}
            >
              <SelectTrigger id={`${idp}-id-type`} data-testid="contact-id-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t["forms.contact.idTypeNone"]}</SelectItem>
                {SELLER_ID_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t[`einvoicing.taxId.idType_${type}`]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id={`${idp}-id-number`} label={t["forms.contact.idNumber"]}>
            <Input
              ltr
              value={f.legalId}
              disabled={!f.legalIdType}
              onChange={(e) => set({ legalId: e.target.value })}
              data-testid="contact-id-number"
            />
          </Field>
          {f.legalIdType === "PAS" && (
            <Field
              id={`${idp}-id-country`}
              label={t["einvoicing.taxId.passportCountry"]}
              help={t["einvoicing.taxId.passportCountryHelp"]}
            >
              <Input
                ltr
                maxLength={2}
                value={f.legalIdCountry}
                onChange={(e) => set({ legalIdCountry: e.target.value.toUpperCase() })}
                placeholder="AE"
                data-testid="contact-id-country"
              />
            </Field>
          )}
          <Field
            id={`${idp}-emirate`}
            label={t["invoices.placeOfSupply"]}
            help={t["forms.contact.emirateHelp"]}
          >
            <Select
              value={f.emirate || NONE}
              onValueChange={(value) => set({ emirate: value === NONE ? "" : value })}
            >
              <SelectTrigger id={`${idp}-emirate`} data-testid="select-contact-emirate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t["invoices.placeOfSupplyDefault"]}</SelectItem>
                {CONTACT_EMIRATES.map((e) => (
                  <SelectItem key={e} value={e}>
                    {t[`invoices.emirate.${e}`]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            id={`${idp}-free-zone`}
            label={t["forms.contact.freeZone"]}
            help={t["forms.contact.freeZoneHelp"]}
          >
            <Checkbox
              className="mt-2.5"
              checked={f.freeZone}
              onCheckedChange={(v) => set({ freeZone: v === true })}
              data-testid="contact-free-zone"
            />
          </Field>
        </FormGrid>
      </FormSection>

      <FormSection title={t["forms.section.address"]}>
        <FormGrid>
          <Field id={`${idp}-street`} label={t["forms.contact.street"]} className={formSpanFull}>
            <Input
              dir="auto"
              autoComplete="address-line1"
              value={f.addressStreet}
              onChange={(e) => set({ addressStreet: e.target.value })}
              placeholder={t["forms.contact.streetPlaceholder"]}
              data-testid="input-contact-address"
            />
          </Field>
          <Field id={`${idp}-building`} label={t["forms.contact.building"]}>
            <Input
              dir="auto"
              autoComplete="address-line2"
              value={f.addressBuilding}
              onChange={(e) => set({ addressBuilding: e.target.value })}
              data-testid="input-contact-building"
            />
          </Field>
          <Field id={`${idp}-district`} label={t["forms.contact.district"]}>
            <Input
              dir="auto"
              value={f.addressDistrict}
              onChange={(e) => set({ addressDistrict: e.target.value })}
              data-testid="input-contact-district"
            />
          </Field>
          <Field id={`${idp}-city`} label={t["forms.contact.city"]}>
            <Input
              dir="auto"
              value={f.city}
              onChange={(e) => set({ city: e.target.value })}
              placeholder={t["forms.contact.cityPlaceholder"]}
              data-testid="input-contact-city"
            />
          </Field>
          <Field id={`${idp}-postal`} label={t["forms.contact.postalCode"]}>
            <Input
              ltr
              value={f.postalCode}
              onChange={(e) => set({ postalCode: e.target.value })}
              data-testid="input-contact-postal"
            />
          </Field>
          <Field id={`${idp}-country`} label={<T k="pageLabels.country" />}>
            <Input
              dir="auto"
              value={f.country}
              onChange={(e) => set({ country: e.target.value })}
              placeholder={t["pageLabels.countryUaeName"]}
              data-testid="input-contact-country"
            />
          </Field>
        </FormGrid>
      </FormSection>

      <FormSection
        title={t["forms.contact.defaultsTitle"]}
        description={t["forms.contact.defaultsDesc"]}
      >
        <FormGrid>
          <Field
            id={`${idp}-terms`}
            label={t["invoices.contactPaymentTermsDays"]}
            help={t["forms.contact.termsHelp"]}
          >
            <Input
              type="number"
              min={0}
              max={365}
              value={f.paymentTerms}
              onChange={(e) => set({ paymentTerms: Math.max(0, Number(e.target.value) || 0) })}
              data-testid="input-contact-payment-terms"
            />
          </Field>
          <Field id={`${idp}-vat-treatment`} label={t["forms.contact.vatTreatment"]}>
            <Select
              value={f.defaultVatTreatment || NONE}
              onValueChange={(v) => set({ defaultVatTreatment: v === NONE ? "" : v })}
            >
              <SelectTrigger id={`${idp}-vat-treatment`} data-testid="contact-vat-treatment">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t["forms.contact.noDefault"]}</SelectItem>
                {SUPPLY_TYPES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t[`invoices.supply.${s}`]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {f.isCustomer && (
            <Field id={`${idp}-revenue`} label={t["forms.contact.revenueAccount"]}>
              <Select
                value={f.defaultRevenueAccountId || NONE}
                onValueChange={(v) => set({ defaultRevenueAccountId: v === NONE ? "" : v })}
              >
                <SelectTrigger id={`${idp}-revenue`} data-testid="contact-revenue-account">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t["forms.contact.noDefault"]}</SelectItem>
                  {revenueAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {accountLabel(a)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {f.isSupplier && (
            <Field id={`${idp}-expense`} label={t["forms.contact.expenseAccount"]}>
              <Select
                value={f.defaultExpenseAccountId || NONE}
                onValueChange={(v) => set({ defaultExpenseAccountId: v === NONE ? "" : v })}
              >
                <SelectTrigger id={`${idp}-expense`} data-testid="contact-expense-account">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t["forms.contact.noDefault"]}</SelectItem>
                  {expenseAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {accountLabel(a)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {costCenters.length > 0 && (
            <Field id={`${idp}-cost-centre`} label={t["forms.contact.costCentre"]}>
              <Select
                value={f.defaultCostCenterId || NONE}
                onValueChange={(v) => set({ defaultCostCenterId: v === NONE ? "" : v })}
              >
                <SelectTrigger id={`${idp}-cost-centre`} data-testid="contact-cost-centre">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t["forms.contact.noDefault"]}</SelectItem>
                  {costCenters.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {`${c.code} · ${c.name}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </FormGrid>
      </FormSection>

      <FormActions sticky>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          data-testid="button-cancel-contact"
        >
          <T k="pages.cancel" />
        </Button>
        <Button type="submit" className="sm:min-w-32" data-testid="button-save-contact">
          {contact ? t["forms.contact.update"] : t["forms.contact.create"]}
        </Button>
      </FormActions>
    </form>
  );
}

function formatRegNumberLabel(t: Record<string, string>, type: string): string {
  return `${type} · ${t["forms.contact.regNumber"]}`;
}
