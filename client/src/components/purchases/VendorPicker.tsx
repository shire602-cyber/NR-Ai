import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { useContactsByType, type TypedContact } from "@/hooks/useContactsByType";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { exactVendorMatch, filterVendors, vendorContactsOf } from "@/lib/purchasing-hr";
import { cn } from "@/lib/utils";
import { messages } from "./VendorPicker.i18n";

export interface PickedVendor {
  id: string;
  name: string;
  trnNumber: string | null;
  /** The contact's country as saved ("UAE" by default); drives the reverse-charge default on bills. */
  country: string | null;
}

interface Props {
  companyId: string | undefined;
  /** The vendor contact id, or null when none is chosen (a legacy document keeps its name snapshot below). */
  vendorId: string | null | undefined;
  /** Name shown when no contact is linked yet (older documents). */
  fallbackName?: string;
  onSelect: (vendor: PickedVendor) => void;
  disabled?: boolean;
  testId?: string;
}

/** A searchable list of the company's vendors (vendor and both contacts), with "create vendor" inline. */
export function VendorPicker({ companyId, vendorId, fallbackName, onSelect, disabled, testId = "select-vendor" }: Props) {
  const tr = messages.useT();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { data: all = [], isError } = useContactsByType(companyId, "vendor");
  // The API already narrows to vendors; keeping the filter makes the picker safe against a stale cache.
  const vendors = vendorContactsOf(all);
  const shown = filterVendors(vendors, query);
  const selected = vendors.find((v) => v.id === vendorId) ?? null;
  const canCreate = query.trim().length > 0 && !exactVendorMatch(vendors, query);

  const create = useMutation({
    mutationFn: (name: string) => apiRequest("POST", `/api/companies/${companyId}/customer-contacts`, { name: name.trim(), contactType: "vendor" }),
    onSuccess: (contact: TypedContact) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "customer-contacts"] });
      toast({ title: tr("created") });
      onSelect({ id: contact.id, name: contact.name, trnNumber: contact.trnNumber ?? null, country: contact.country ?? null });
      setOpen(false);
      setQuery("");
    },
    onError: (error: any) => toast({ variant: "destructive", title: tr("createFailed"), description: error?.message }),
  });

  const pick = (v: TypedContact) => {
    onSelect({ id: v.id, name: v.name, trnNumber: v.trnNumber ?? null, country: v.country ?? null });
    setOpen(false);
    setQuery("");
  };

  const label = selected?.name ?? (fallbackName?.trim() ? fallbackName : "");

  // The list is rendered in place (not in a portal): inside a Dialog the focus trap would otherwise keep the search box from taking focus.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <Button type="button" variant="outline" role="combobox" aria-expanded={open} aria-haspopup="listbox" disabled={disabled} onClick={() => setOpen((o) => !o)} className="w-full justify-between font-normal" data-testid={testId}>
        <span className={cn("truncate", !label && "text-muted-foreground")}>{label || tr("placeholder")}</span>
        <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
      </Button>
      {open && (
        <div className="absolute start-0 top-full z-50 mt-1 w-full min-w-[260px] rounded-md border bg-popover text-popover-foreground shadow-md" data-testid={`${testId}-list`}>
          <Command shouldFilter={false}>
            <CommandInput autoFocus value={query} onValueChange={setQuery} placeholder={tr("search")} data-testid={`${testId}-search`} />
            <CommandList>
              {isError && <p className="px-3 py-2 text-xs text-muted-foreground">{tr("loadFailed")}</p>}
              {shown.length === 0 && !canCreate && <CommandEmpty>{tr("none")}</CommandEmpty>}
              <CommandGroup>
                {shown.map((v) => (
                  <CommandItem key={v.id} value={v.id} onSelect={() => pick(v)} data-testid={`option-vendor-${v.id}`}>
                    <Check className={cn("h-4 w-4 me-2", v.id === vendorId ? "opacity-100" : "opacity-0")} />
                    <div className="min-w-0">
                      <div className="truncate">{v.name}</div>
                      {(v.trnNumber || v.contactType === "both") && (
                        <div className="text-xs opacity-70 truncate">
                          {v.contactType === "both" ? tr("both") : ""} {v.trnNumber ? tr("trn", { trn: v.trnNumber }) : ""}
                        </div>
                      )}
                    </div>
                  </CommandItem>
                ))}
                {canCreate && (
                  <CommandItem value="__create__" onSelect={() => create.mutate(query)} disabled={create.isPending} data-testid={`${testId}-create`}>
                    {create.isPending ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <Plus className="h-4 w-4 me-2" />}
                    {create.isPending ? tr("creating") : tr("create", { name: query.trim() })}
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      )}
    </div>
  );
}
