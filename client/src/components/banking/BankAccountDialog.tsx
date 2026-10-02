import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { accountName } from "@/lib/account-name";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { BankAccount, LedgerAccount } from "@/lib/banking-api-types";
import { messages } from "./BankAccountDialog.i18n";
import { messages as common } from "./BankingCommon.i18n";
import { bankingErrorText } from "./banking-common";
import { GlAccountDialog } from "./GlAccountDialog";

/** The bank names the server accepts. */
// i18n-ignore: bank names are values the server accepts, not interface text
export const BANKS = ["Emirates NBD", "ADCB", "FAB", "Mashreq", "Other"] as const;
export const CURRENCIES = ["AED", "USD", "EUR", "GBP", "SAR", "QAR", "KWD", "BHD", "OMR", "INR", "PKR", "EGP", "CHF", "JPY", "CNY"];

interface FormState {
  nameEn: string;
  bankName: string;
  iban: string;
  accountNumber: string;
  currency: string;
  glAccountId: string;
  reconcileFrom: string;
  isActive: boolean;
}

/** Select value for "make the ledger account for me". */
const NEW_LEDGER = "__new";

const blank = (): FormState => ({ nameEn: "", bankName: "Other", iban: "", accountNumber: "", currency: "AED", glAccountId: NEW_LEDGER, reconcileFrom: "", isActive: true });

const fromAccount = (a: BankAccount): FormState => ({
  nameEn: a.nameEn,
  bankName: a.bankName,
  iban: a.iban ?? "",
  accountNumber: a.accountNumber ?? "",
  currency: (a.currency || "AED").toUpperCase(),
  glAccountId: a.glAccountId ?? "",
  reconcileFrom: a.reconcileFrom ? String(a.reconcileFrom).slice(0, 10) : "",
  isActive: a.isActive,
});

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  /** The account being edited; null to add one. */
  account: BankAccount | null;
  accounts: LedgerAccount[];
}

/** Add or edit a bank account. It starts from a clean form (or the account's own values) every time it opens. */
export function BankAccountDialog({ open, onOpenChange, companyId, account, accounts }: Props) {
  const tr = messages.useT();
  const trc = common.useT();
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(blank);
  // the banks the server accepts (GET /api/banks); "Other" covers a bank that is not listed
  const { data: bankList } = useQuery<{ banks: Array<{ value: string; label: string }> }>({ queryKey: ["/api/banks"], enabled: open });
  const bankChoices = useMemo(() => {
    const names = bankList?.banks?.map((b) => b.value) ?? [...BANKS];
    return account && !names.includes(account.bankName) ? [account.bankName, ...names] : names;
  }, [bankList, account]);
  const [glOpen, setGlOpen] = useState(false);
  // accounts created from this dialog, offered at once (the chart refetches a moment later; a select whose value has no item resets itself)
  const [created, setCreated] = useState<LedgerAccount[]>([]);

  useEffect(() => {
    if (open) setForm(account ? fromAccount(account) : blank());
  }, [open, account]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const assets = useMemo(
    () =>
      [...accounts, ...created.filter((c) => !accounts.some((a) => a.id === c.id))]
        .filter((a) => a.type === "asset" && a.isActive !== false && a.isArchived !== true)
        .sort((x, y) => x.code.localeCompare(y.code)),
    [accounts, created]
  );
  const currencies = CURRENCIES.includes(form.currency) ? CURRENCIES : [form.currency, ...CURRENCIES];
  const valid = form.nameEn.trim() !== "" && form.bankName.trim() !== "" && /^[A-Za-z]{3}$/.test(form.currency) && form.glAccountId !== "";

  const save = useMutation({
    mutationFn: () => {
      const body = {
        nameEn: form.nameEn.trim(),
        bankName: form.bankName,
        iban: form.iban.trim() || null,
        accountNumber: form.accountNumber.trim() || null,
        currency: form.currency.toUpperCase(),
        glAccountId: form.glAccountId === NEW_LEDGER ? null : form.glAccountId || null,
        ...(form.glAccountId === NEW_LEDGER && !account ? { createLedgerAccount: true } : {}),
        reconcileFrom: form.reconcileFrom || null,
        ...(account ? { isActive: form.isActive } : {}),
      };
      return account
        ? apiRequest("PATCH", `/api/companies/${companyId}/bank-accounts/${account.id}`, body)
        : apiRequest("POST", `/api/companies/${companyId}/bank-accounts`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "bank-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "bank-statements"] });
      // a ledger account may have been created with the bank account
      queryClient.invalidateQueries({ predicate: (q) => q.queryKey[1] === companyId && String(q.queryKey[2]).startsWith("accounts") });
      toast({ title: account ? tr("updated") : tr("created") });
      onOpenChange(false);
    },
    onError: (err: unknown) => toast({ variant: "destructive", title: tr("failed"), description: bankingErrorText(trc, err, locale) }),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg max-h-[92vh] overflow-y-auto" data-testid="bank-account-dialog">
          <DialogHeader>
            <DialogTitle>{account ? tr("editTitle") : tr("createTitle")}</DialogTitle>
            <DialogDescription>{tr("description")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) save.mutate();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="ba-name">{tr("name")}</Label>
              <Input id="ba-name" value={form.nameEn} onChange={(e) => set("nameEn", e.target.value)} placeholder={tr("namePlaceholder")} maxLength={255} dir="auto" data-testid="input-bank-name" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>{tr("bank")}</Label>
                <Select value={form.bankName} onValueChange={(v) => v && set("bankName", v)}>
                  <SelectTrigger data-testid="select-bank-bank">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {bankChoices.map((b) => (
                      <SelectItem key={b} value={b}>
                        {b === "Other" ? tr("bankOther") : b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.bankName === "Other" && <p className="text-[11px] text-muted-foreground">{tr("bankOtherHint")}</p>}
              </div>
              <div className="space-y-1">
                <Label>{tr("currency")}</Label>
                <Select value={form.currency} onValueChange={(v) => set("currency", v)}>
                  <SelectTrigger data-testid="select-bank-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {currencies.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {account && <p className="text-[11px] text-muted-foreground">{tr("currencyLocked")}</p>}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="ba-iban">{tr("iban")}</Label>
                <Input id="ba-iban" value={form.iban} onChange={(e) => set("iban", e.target.value)} maxLength={64} dir="ltr" className="text-start font-mono" data-testid="input-bank-iban" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ba-number">{tr("accountNumber")}</Label>
                <Input id="ba-number" value={form.accountNumber} onChange={(e) => set("accountNumber", e.target.value)} maxLength={64} dir="ltr" className="text-start font-mono" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground -mt-2">{tr("ibanHint")}</p>

            <div className="space-y-1">
              <Label>{tr("gl")}</Label>
              <div className="flex gap-2">
                {/* an empty change is Radix resetting a value whose item has not mounted yet; keep the choice */}
                <Select value={form.glAccountId} onValueChange={(v) => v && set("glAccountId", v)}>
                  <SelectTrigger className="flex-1 min-w-0" data-testid="select-bank-gl">
                    <SelectValue placeholder={tr("glPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {!account && <SelectItem value={NEW_LEDGER}>{tr("glAuto")}</SelectItem>}
                    {assets.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        <span dir="ltr" className="font-mono">
                          {a.code}
                        </span>{" "}
                        {accountName(a, locale)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" onClick={() => setGlOpen(true)} data-testid="button-new-gl-account">
                  <Plus className="h-4 w-4 me-1" />
                  {tr("glNew")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{assets.length === 0 ? tr("noAssetAccounts") : tr("glHint")}</p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="ba-from">{tr("reconcileFrom")}</Label>
              <Input id="ba-from" type="date" value={form.reconcileFrom} onChange={(e) => set("reconcileFrom", e.target.value)} dir="ltr" className="text-start w-full sm:w-52" data-testid="input-bank-reconcile-from" />
              <p className="text-xs text-muted-foreground">{tr("reconcileFromHint")}</p>
            </div>

            {account && (
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="ba-active">{tr("active")}</Label>
                <Switch id="ba-active" checked={form.isActive} onCheckedChange={(v) => set("isActive", v)} />
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tr("cancel")}
              </Button>
              <Button type="submit" disabled={!valid || save.isPending} data-testid="button-save-bank-account">
                {save.isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
                {save.isPending ? tr("saving") : tr("save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <GlAccountDialog open={glOpen} onOpenChange={setGlOpen} companyId={companyId} accounts={accounts} defaultType="asset" lockType codeFrom={1021} onCreated={(a) => {
          setCreated((list) => [...list, a]);
          set("glAccountId", a.id);
        }} />
    </>
  );
}
