import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { LedgerAccount } from "@/lib/banking-api-types";
import { messages } from "./GlAccountDialog.i18n";
import { messages as common } from "./BankingCommon.i18n";
import { bankingErrorText } from "./banking-common";
import { nextAccountCode, type AccountKind } from "./gl-account-code";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  /** The company's accounts, for suggesting a free code. */
  accounts: Array<{ code?: string | null }>;
  defaultType?: AccountKind;
  /** Hide the type choice (a bank account's ledger account is always an asset). */
  lockType?: boolean;
  /** Start the code search here (a bank account's ledger account starts at 1021). */
  codeFrom?: number;
  onCreated?: (account: LedgerAccount) => void;
}

const KINDS: AccountKind[] = ["asset", "liability", "equity", "income", "expense"];

/** Create a ledger account. The form starts empty every time it opens, so nothing from the last account carries over. */
export function GlAccountDialog({ open, onOpenChange, companyId, accounts, defaultType = "asset", lockType = false, codeFrom, onCreated }: Props) {
  const tr = messages.useT();
  const trc = common.useT();
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const [type, setType] = useState<AccountKind>(defaultType);
  const [code, setCode] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");

  const codes = accounts.map((a) => a.code).filter((c): c is string => !!c);
  useEffect(() => {
    if (!open) return;
    setType(defaultType);
    setCode(nextAccountCode(codes, defaultType, codeFrom));
    setNameEn("");
    setNameAr("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const taken = code.trim() !== "" && codes.includes(code.trim());
  const valid = /^[0-9A-Za-z.-]{1,20}$/.test(code.trim()) && nameEn.trim() !== "" && !taken;

  const save = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/accounts`, {
        code: code.trim(),
        nameEn: nameEn.trim(),
        nameAr: nameAr.trim() || null,
        type,
        isActive: true,
      }) as Promise<LedgerAccount>,
    onSuccess: (account) => {
      queryClient.invalidateQueries({ predicate: (q) => q.queryKey[1] === companyId && String(q.queryKey[2]).startsWith("accounts") });
      toast({ title: tr("created") });
      onCreated?.(account);
      onOpenChange(false);
    },
    onError: (err: unknown) => toast({ variant: "destructive", title: tr("failed"), description: bankingErrorText(trc, err, locale) }),
  });

  const typeLabel = (k: AccountKind) =>
    k === "asset" ? tr("typeAsset") : k === "liability" ? tr("typeLiability") : k === "equity" ? tr("typeEquity") : k === "income" ? tr("typeIncome") : tr("typeExpense");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="gl-account-dialog">
        <DialogHeader>
          <DialogTitle>{tr("title")}</DialogTitle>
          <DialogDescription>{tr("description")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (valid) save.mutate();
          }}
        >
          {!lockType && (
            <div className="space-y-1">
              <Label>{tr("type")}</Label>
              <Select
                value={type}
                onValueChange={(v) => {
                  setType(v as AccountKind);
                  setCode(nextAccountCode(codes, v as AccountKind, codeFrom));
                }}
              >
                <SelectTrigger data-testid="select-gl-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {typeLabel(k)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="gl-code">{tr("code")}</Label>
            <Input id="gl-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} dir="ltr" className="text-start font-mono" aria-invalid={taken} data-testid="input-gl-code" />
            <p className={`text-xs ${taken ? "text-destructive" : "text-muted-foreground"}`}>{taken ? tr("codeTaken") : tr("codeHint")}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="gl-name">{tr("nameEn")}</Label>
            <Input id="gl-name" value={nameEn} onChange={(e) => setNameEn(e.target.value)} maxLength={255} data-testid="input-gl-name" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="gl-name-ar">{tr("nameAr")}</Label>
            <Input id="gl-name-ar" value={nameAr} onChange={(e) => setNameAr(e.target.value)} maxLength={255} dir="rtl" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tr("cancel")}
            </Button>
            <Button type="submit" disabled={!valid || save.isPending} data-testid="button-save-gl-account">
              {save.isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
              {save.isPending ? tr("saving") : tr("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
