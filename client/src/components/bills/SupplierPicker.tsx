import * as React from "react";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { filterSuppliers, suppliersQueryKey, type SupplierOption } from "@/lib/purchase-pickers";

export type { SupplierOption };

type InputProps = Omit<React.ComponentPropsWithoutRef<typeof Input>, "value" | "onChange">;

/**
 * WQ2 (8.1): the bill's supplier. A type-ahead over the supplier list (vendors): typing filters
 * the list, picking links the bill to the supplier record (its TRN, terms and default account),
 * and "+ New supplier" creates one inline. What is typed without picking stays free text, as on
 * legacy bills. Extra props (name, id, aria-*) go to the input, so it works inside FormControl.
 */
export const SupplierPicker = React.forwardRef<
  HTMLInputElement,
  InputProps & {
    companyId: string | undefined;
    vendorId: string | null | undefined;
    vendorName: string;
    onPick: (supplier: SupplierOption) => void;
    onFreeText: (name: string) => void;
    /** Prefill for "New supplier" (e.g. the name and TRN read from a captured bill). */
    createSuggestion?: { name?: string | null; trn?: string | null } | null;
    invalid?: boolean;
    testId?: string;
  }
>(function SupplierPicker(
  {
    companyId,
    vendorId,
    vendorName,
    onPick,
    onFreeText,
    createSuggestion,
    invalid,
    testId = "supplier-picker",
    className,
    ...inputProps
  },
  ref
) {
  const { t, locale } = useTranslation();
  const listId = React.useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const { data: suppliers = [] } = useQuery<SupplierOption[]>({
    queryKey: suppliersQueryKey(companyId),
    enabled: !!companyId,
  });
  const live = useMemo(() => suppliers.filter((s) => s.isActive !== false), [suppliers]);
  const linked = vendorId ? live.find((s) => s.id === vendorId) : undefined;
  // Once a supplier is linked, show the whole list again on focus; while typing, filter it.
  const options = filterSuppliers(live, linked ? "" : vendorName);
  const label = (s: SupplierOption) => (locale === "ar" && s.nameAr) || s.name;
  // The last option is always "+ New supplier".
  const count = options.length + 1;

  const choose = (i: number) => {
    if (i < options.length) onPick(options[i]);
    else setCreating(true);
    setOpen(false);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverPrimitive.Anchor asChild>
          <div className="relative">
            <Input
              ref={ref}
              {...inputProps}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={listId}
              aria-activedescendant={open ? `${listId}-${active}` : undefined}
              aria-invalid={invalid || inputProps["aria-invalid"] || undefined}
              autoComplete="off"
              dir="auto"
              placeholder={t["purchases.supplier.search"]}
              value={vendorName}
              data-testid={testId}
              className={cn(linked && "pe-9", className)}
              onFocus={() => setOpen(true)}
              onChange={(e) => {
                onFreeText(e.target.value);
                setActive(0);
                setOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setOpen(true);
                  setActive((a) => (a + 1) % count);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => (a - 1 + count) % count);
                } else if (e.key === "Enter" && open) {
                  e.preventDefault();
                  choose(active);
                } else if (e.key === "Escape") {
                  setOpen(false);
                }
              }}
            />
            {linked && (
              <Check
                className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-success"
                aria-label={t["purchases.supplier.linked"]}
              />
            )}
          </div>
        </PopoverPrimitive.Anchor>
        <PopoverContent
          align="start"
          className="w-[--radix-popover-trigger-width] min-w-72 p-1"
          // A list of options, not a dialog: the combobox input keeps focus.
          role="presentation"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            // A click back into the input keeps the list open.
            if ((e.target as HTMLElement)?.closest?.(`[data-testid="${testId}"]`))
              e.preventDefault();
          }}
        >
          <ul role="listbox" id={listId} aria-label={t["purchases.supplier.label"]}>
            {options.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground">
                {t["purchases.supplier.none"]}
              </li>
            )}
            {options.map((s, i) => (
              <li
                key={s.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm",
                  i === active && "bg-accent text-accent-foreground"
                )}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
              >
                <Check
                  className={cn("h-4 w-4", s.id === vendorId ? "opacity-100" : "opacity-0")}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate" dir="auto">
                  {label(s)}
                </span>
                {s.trn && (
                  <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">
                    {s.trn}
                  </span>
                )}
              </li>
            ))}
            <li
              id={`${listId}-${options.length}`}
              role="option"
              aria-selected={active === options.length}
              className={cn(
                "mt-1 flex cursor-pointer items-center gap-2 rounded-md border-t px-3 py-2 text-sm font-medium text-primary",
                active === options.length && "bg-accent"
              )}
              onMouseEnter={() => setActive(options.length)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(options.length)}
              data-testid={`${testId}-new`}
            >
              <Plus className="h-4 w-4" aria-hidden />
              {t["purchases.supplier.new"]}
            </li>
          </ul>
        </PopoverContent>
      </Popover>
      <NewSupplierDialog
        companyId={companyId}
        open={creating}
        onOpenChange={setCreating}
        initialName={createSuggestion?.name || vendorName}
        initialTrn={createSuggestion?.trn ?? ""}
        onCreated={(s) => {
          onPick(s);
          setCreating(false);
        }}
      />
    </>
  );
});

/** Inline "New supplier": name, TRN and payment terms; the rest is edited on Suppliers. */
export function NewSupplierDialog({
  companyId,
  open,
  onOpenChange,
  initialName,
  initialTrn,
  onCreated,
}: {
  companyId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string | null;
  initialTrn?: string | null;
  onCreated: (supplier: SupplierOption) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [trn, setTrn] = useState("");
  const [terms, setTerms] = useState("30");
  const [error, setError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);
  if (open && !seeded) {
    setSeeded(true);
    setName(initialName ?? "");
    setTrn(initialTrn ?? "");
    setTerms("30");
    setError(null);
  }
  if (!open && seeded) setSeeded(false);

  const create = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/vendors`, {
        name: name.trim(),
        trn: trn.trim() || null,
        payment_terms_days: Number(terms) || 0,
      }) as Promise<SupplierOption>,
    onSuccess: (s) => {
      void queryClient.invalidateQueries({ queryKey: suppliersQueryKey(companyId) });
      onCreated(s);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t["purchases.supplier.newTitle"]}</DialogTitle>
          <DialogDescription>{t["purchases.supplier.newDesc"]}</DialogDescription>
        </DialogHeader>
        <form
          id="new-supplier-form"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) {
              setError(t["forms.errors.vendorNameRequired"]);
              return;
            }
            create.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="new-supplier-name">{t["purchases.supplier.name"]}</Label>
            <Input
              id="new-supplier-name"
              dir="auto"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="new-supplier-name"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-supplier-trn">{t["purchases.supplier.trn"]}</Label>
              <Input
                id="new-supplier-trn"
                ltr
                inputMode="numeric"
                value={trn}
                onChange={(e) => setTrn(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-supplier-terms">{t["purchases.supplier.terms"]}</Label>
              <Input
                id="new-supplier-terms"
                ltr
                type="number"
                min={0}
                max={365}
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
              />
            </div>
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t["pages.cancel"]}
          </Button>
          <Button
            type="submit"
            form="new-supplier-form"
            disabled={create.isPending}
            data-testid="new-supplier-save"
          >
            {create.isPending ? t["forms.saving"] : t["purchases.supplier.create"]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
