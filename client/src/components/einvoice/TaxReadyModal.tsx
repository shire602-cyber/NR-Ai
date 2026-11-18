/**
 * WQ5: the first-invoice e-invoice details prompt.
 *
 * Owned here, mounted by the invoice editor (WQ1):
 *
 *   const taxReady = useTaxReadyPrompt(companyId, { enabled: isNewInvoice });
 *   ...
 *   <TaxReadyModal {...taxReady.modalProps} />
 *
 * It asks only for the seller fields that are still missing (legal name, TIN, seller ID,
 * street, city, emirate) and offers the Arabic name and address. "Later" and "Save details"
 * both record that it was shown, so it never appears twice; it never appears when nothing is
 * missing. Not shown at signup.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileCheck2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormActions } from "@/components/ui/form-layout";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatMessage, useTranslation } from "@/lib/i18n";
import type { TaxReadyField } from "@shared/validators/einvoice-identity";
import { TaxIdentityFields, type IdentityGroup } from "./TaxIdentityFields";
import {
  FIELD_KEYS,
  bodyFromForm,
  formFromIdentity,
  taxReadyKey,
  useSaveTaxIdentity,
  type TaxIdentityForm,
  type TaxReadyState,
} from "./tax-identity";
import { identityErrorFor } from "./identity-errors";

export interface TaxReadyModalProps {
  open: boolean;
  companyId: string;
  state: TaxReadyState | undefined;
  /** Called after Save or Later (the editor continues either way). */
  onDone: (outcome: "saved" | "skipped") => void;
}

/** Decide whether to open: data loaded, fields missing, never shown before. Pure for tests. */
export function shouldOpenTaxReady(state: TaxReadyState | undefined): boolean {
  return !!state && state.show && state.missing.length > 0;
}

/**
 * The hook the invoice editor calls. `enabled` should be true on a new invoice only. It opens
 * once per page view at most and the server makes it once per company.
 */
export function useTaxReadyPrompt(
  companyId: string | null | undefined,
  { enabled = true }: { enabled?: boolean } = {}
) {
  const query = useQuery<TaxReadyState>({
    queryKey: taxReadyKey(companyId ?? ""),
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/einvoicing/tax-ready`),
    enabled: !!companyId && enabled,
    staleTime: 60_000,
  });
  const [open, setOpen] = useState(false);
  const opened = useRef(false);
  useEffect(() => {
    if (!opened.current && enabled && shouldOpenTaxReady(query.data)) {
      opened.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- opens once when the server says so
      setOpen(true);
    }
  }, [query.data, enabled]);
  return {
    open,
    state: query.data,
    modalProps: {
      open,
      companyId: companyId ?? "",
      state: query.data,
      onDone: () => setOpen(false),
    } satisfies TaxReadyModalProps,
  };
}

export function TaxReadyModal({ open, companyId, state, onDone }: TaxReadyModalProps) {
  const { t } = useTranslation();
  const save = useSaveTaxIdentity(companyId);
  const missing = useMemo<TaxReadyField[]>(() => state?.missing ?? [], [state]);
  const [form, setForm] = useState<TaxIdentityForm>(() => formFromIdentity(state?.identity));
  const [withArabic, setWithArabic] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof TaxIdentityForm, string>>>({});

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates local form state from fetched data
    if (state?.identity) setForm(formFromIdentity(state.identity));
  }, [state?.identity]);

  const markShown = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/einvoicing/tax-ready/shown`, {}),
    onSuccess: (next: TaxReadyState) => queryClient.setQueryData(taxReadyKey(companyId), next),
  });

  const groups: IdentityGroup[] = [...missing, ...(withArabic ? (["arabic"] as const) : [])];
  const keys = [
    ...missing.flatMap((f) => FIELD_KEYS[f]),
    ...(withArabic ? (["legalNameAr", "addressAr"] as const) : []),
  ];

  const finish = (outcome: "saved" | "skipped") => {
    markShown.mutate();
    onDone(outcome);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && finish("skipped")}>
      <DialogContent size="md" data-testid="tax-ready-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCheck2 className="h-5 w-5 text-brand-600" aria-hidden />
            {t["einvoicing.taxReady.title"]}
          </DialogTitle>
          <DialogDescription>
            {formatMessage(t["einvoicing.taxReady.body"], { count: missing.length })}
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            setErrors({});
            save.mutate(bodyFromForm(form, keys), {
              onSuccess: () => finish("saved"),
              onError: (err) => {
                const mapped = identityErrorFor(err, t);
                setErrors(
                  mapped
                    ? { [mapped.field]: mapped.message }
                    : { legalName: err.message || t["einvoicing.taxId.saveFailed"] }
                );
              },
            });
          }}
        >
          <TaxIdentityFields
            idPrefix="tax-ready"
            form={form}
            view={state?.identity}
            groups={groups}
            errors={errors}
            onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
          />
          <label className="flex items-start gap-2 text-small text-foreground">
            <Checkbox
              checked={withArabic}
              onCheckedChange={(v) => setWithArabic(v === true)}
              data-testid="tax-ready-arabic"
            />
            <span>{t["einvoicing.taxReady.addArabic"]}</span>
          </label>
          <p className="text-caption text-muted-foreground">
            {t["einvoicing.taxReady.whereLater"]}
          </p>
          <FormActions>
            <Button
              type="button"
              variant="outline"
              onClick={() => finish("skipped")}
              data-testid="tax-ready-later"
            >
              {t["einvoicing.taxReady.later"]}
            </Button>
            <Button type="submit" disabled={save.isPending} data-testid="tax-ready-save">
              {save.isPending ? t["forms.saving"] : t["einvoicing.taxReady.save"]}
            </Button>
          </FormActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
