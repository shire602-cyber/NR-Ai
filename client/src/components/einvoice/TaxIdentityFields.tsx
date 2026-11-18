/**
 * WQ5: the seller e-invoicing identity fields, shared by the Settings › Company card (every
 * field) and the first-invoice tax-ready prompt (only the missing ones).
 */
import { Input } from "@/components/ui/input";
import { Field, FormGrid, formSpanFull } from "@/components/ui/form-layout";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { EMIRATES } from "@shared/validators/primitives";
import {
  SELLER_ID_TYPES,
  type SellerIdType,
  type TaxReadyField,
} from "@shared/validators/einvoice-identity";
import { tinLocalError, type TaxIdentityForm, type TaxIdentityView } from "./tax-identity";

export type IdentityGroup = TaxReadyField | "arabic" | "poBox";

const ALL_GROUPS: IdentityGroup[] = [
  "legalName",
  "arabic",
  "tin",
  "sellerId",
  "addressStreet",
  "addressCity",
  "emirate",
  "poBox",
];

export function TaxIdentityFields({
  form,
  onChange,
  view,
  groups = ALL_GROUPS,
  idPrefix,
  errors = {},
}: {
  form: TaxIdentityForm;
  onChange: (patch: Partial<TaxIdentityForm>) => void;
  view?: TaxIdentityView;
  groups?: IdentityGroup[];
  idPrefix: string;
  errors?: Partial<Record<keyof TaxIdentityForm, string>>;
}) {
  const { t } = useTranslation();
  const has = (g: IdentityGroup) => groups.includes(g);
  const id = (k: string) => `${idPrefix}-${k}`;
  const tinError =
    errors.einvoiceTin ??
    (tinLocalError(form.einvoiceTin) ? t["einvoicing.taxId.tinFormatError"] : undefined);
  const tinHelp =
    view?.tinSource === "ct_trn" || view?.tinSource === "vat_trn"
      ? formatMessage(t["einvoicing.taxId.tinPrefilled"], {
          source:
            view.tinSource === "ct_trn"
              ? t["einvoicing.taxId.sourceCtTrn"]
              : t["einvoicing.taxId.sourceVatTrn"],
        })
      : t["einvoicing.taxId.tinHelp"];
  const idType = form.sellerIdType as SellerIdType | "";

  return (
    <FormGrid>
      {has("legalName") && (
        <Field
          id={id("legal-name")}
          label={t["einvoicing.taxId.legalName"]}
          help={t["einvoicing.taxId.legalNameHelp"]}
          error={errors.legalName}
          className={formSpanFull}
        >
          <Input
            dir="auto"
            value={form.legalName}
            onChange={(e) => onChange({ legalName: e.target.value })}
            data-testid="tax-id-legal-name"
          />
        </Field>
      )}
      {has("arabic") && (
        <Field
          id={id("legal-name-ar")}
          label={t["einvoicing.taxId.legalNameAr"]}
          help={t["einvoicing.taxId.arabicHelp"]}
          className={formSpanFull}
        >
          <Input
            dir="rtl"
            lang="ar"
            value={form.legalNameAr}
            onChange={(e) => onChange({ legalNameAr: e.target.value })}
            data-testid="tax-id-legal-name-ar"
          />
        </Field>
      )}
      {has("tin") && (
        <Field id={id("tin")} label={t["einvoicing.taxId.tin"]} help={tinHelp} error={tinError}>
          <Input
            ltr
            inputMode="numeric"
            maxLength={10}
            value={form.einvoiceTin}
            onChange={(e) => onChange({ einvoiceTin: e.target.value.replace(/\D/g, "") })}
            placeholder="1XXXXXXXXX"
            data-testid="tax-id-tin"
          />
        </Field>
      )}
      {has("sellerId") && (
        <>
          <Field id={id("seller-id-type")} label={t["einvoicing.taxId.idType"]}>
            <Select
              value={idType || undefined}
              onValueChange={(v) => onChange({ sellerIdType: v as SellerIdType })}
            >
              <SelectTrigger data-testid="tax-id-type">
                <SelectValue placeholder={t["einvoicing.taxId.idTypePlaceholder"]} />
              </SelectTrigger>
              <SelectContent>
                {SELLER_ID_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t[`einvoicing.taxId.idType_${type}`]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            id={id("seller-id-number")}
            label={
              idType ? t[`einvoicing.taxId.idNumber_${idType}`] : t["einvoicing.taxId.idNumber"]
            }
            error={errors.sellerIdNumber}
          >
            <Input
              ltr
              value={form.sellerIdNumber}
              onChange={(e) => onChange({ sellerIdNumber: e.target.value })}
              data-testid="tax-id-number"
            />
          </Field>
          {idType === "PAS" && (
            <Field
              id={id("seller-id-country")}
              label={t["einvoicing.taxId.passportCountry"]}
              help={t["einvoicing.taxId.passportCountryHelp"]}
              error={errors.sellerIdCountry}
            >
              <Input
                ltr
                maxLength={2}
                value={form.sellerIdCountry}
                onChange={(e) => onChange({ sellerIdCountry: e.target.value.toUpperCase() })}
                placeholder="AE"
                data-testid="tax-id-passport-country"
              />
            </Field>
          )}
          {idType === "TL" && (
            <Field
              id={id("seller-id-authority")}
              label={t["einvoicing.taxId.authority"]}
              help={t["einvoicing.taxId.authorityHelp"]}
              className={formSpanFull}
            >
              <Input
                dir="auto"
                value={form.tradeLicenceAuthority}
                onChange={(e) => onChange({ tradeLicenceAuthority: e.target.value })}
                data-testid="tax-id-authority"
              />
            </Field>
          )}
        </>
      )}
      {has("addressStreet") && (
        <>
          <Field
            id={id("street")}
            label={t["einvoicing.taxId.street"]}
            error={errors.addressStreet}
            className={formSpanFull}
          >
            <Input
              dir="auto"
              autoComplete="address-line1"
              value={form.addressStreet}
              onChange={(e) => onChange({ addressStreet: e.target.value })}
              data-testid="tax-id-street"
            />
          </Field>
          <Field id={id("district")} label={t["einvoicing.taxId.district"]}>
            <Input
              dir="auto"
              value={form.addressDistrict}
              onChange={(e) => onChange({ addressDistrict: e.target.value })}
              data-testid="tax-id-district"
            />
          </Field>
        </>
      )}
      {has("addressCity") && (
        <Field id={id("city")} label={t["einvoicing.taxId.city"]} error={errors.addressCity}>
          <Input
            dir="auto"
            autoComplete="address-level2"
            value={form.addressCity}
            onChange={(e) => onChange({ addressCity: e.target.value })}
            data-testid="tax-id-city"
          />
        </Field>
      )}
      {has("emirate") && (
        <Field id={id("emirate")} label={t["einvoicing.taxId.emirate"]}>
          <Select value={form.emirate || undefined} onValueChange={(v) => onChange({ emirate: v })}>
            <SelectTrigger data-testid="tax-id-emirate">
              <SelectValue placeholder={t["einvoicing.taxId.emiratePlaceholder"]} />
            </SelectTrigger>
            <SelectContent>
              {EMIRATES.map((e) => (
                <SelectItem key={e} value={e}>
                  {t[`invoices.emirate.${e}`]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      {has("poBox") && (
        <Field id={id("po-box")} label={t["einvoicing.taxId.poBox"]}>
          <Input
            ltr
            value={form.addressPoBox}
            onChange={(e) => onChange({ addressPoBox: e.target.value })}
            data-testid="tax-id-po-box"
          />
        </Field>
      )}
      {has("arabic") && (
        <Field
          id={id("address-ar")}
          label={t["einvoicing.taxId.addressAr"]}
          className={formSpanFull}
        >
          <Input
            dir="rtl"
            lang="ar"
            value={form.addressAr}
            onChange={(e) => onChange({ addressAr: e.target.value })}
            data-testid="tax-id-address-ar"
          />
        </Field>
      )}
    </FormGrid>
  );
}
