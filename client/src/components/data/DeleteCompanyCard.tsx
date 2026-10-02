import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { RESTORE_WINDOW_DAYS, RETENTION_YEARS, canSubmitDeletion, deletionErrorKey } from "@/lib/data-lifecycle";
import { ApiError, apiRequest, queryClient } from "@/lib/queryClient";
import { normaliseTotpCode, twoFactorStatusKey, type TwoFactorStatus } from "@/lib/security-api";
import { messages as pageMessages } from "./ExportCard.i18n";

const ERROR_TEXT = {
  reauth: "errReauth",
  password: "errPassword",
  code: "errCode",
  name: "errName",
  exists: "errExists",
  owner: "errOwner",
  generic: "errGeneric",
} as const;

interface Props {
  companyId: string;
  companyName: string;
  isOwner: boolean;
  /** Already requested: the card explains the state instead of offering the button again. */
  alreadyRequested: boolean;
}

export function DeleteCompanyCard({ companyId, companyName, isOwner, alreadyRequested }: Props) {
  const tr = pageMessages.useT();
  const { toast } = useToast();
  const { data: tfa } = useQuery<TwoFactorStatus>({ queryKey: twoFactorStatusKey });
  const needsCode = tfa?.enabled === true;

  const [open, setOpen] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setTypedName("");
    setPassword("");
    setCode("");
    setReason("");
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !canSubmitDeletion({ typedName, companyName, password, needsCode, code })) return;
    setBusy(true);
    setError(null);
    try {
      await apiRequest("DELETE", `/api/companies/${companyId}`, {
        password,
        confirmName: typedName.trim(),
        ...(needsCode ? { code } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      toast({ title: tr("deletedToast") });
      setOpen(false);
      reset();
      await queryClient.invalidateQueries({ queryKey: ["/api/me/company-deletions"] });
      // The company is hidden now: reload so the app re-reads which companies the user can reach.
      window.setTimeout(() => window.location.assign("/dashboard"), 600);
    } catch (err) {
      setError(tr(ERROR_TEXT[deletionErrorKey(err instanceof ApiError ? err.code : undefined)]));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-destructive/40" data-testid="card-delete-company">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg text-destructive">
          <Trash2 className="h-5 w-5" aria-hidden="true" />
          <h2>{tr("deleteTitle")}</h2>
        </CardTitle>
        <CardDescription className="max-w-2xl space-y-2">
          <span className="block">{tr("deleteBody", { days: RESTORE_WINDOW_DAYS })}</span>
          <span className="block">{tr("deleteKeep", { years: RETENTION_YEARS })}</span>
          <span className="block">{tr("deleteKeys")}</span>
          <span className="block font-medium text-foreground">{tr("deleteExportFirst")}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button variant="destructive" disabled={!isOwner || alreadyRequested} onClick={() => setOpen(true)} data-testid="button-delete-company">
          {tr("deleteButton")}
        </Button>
        {!isOwner && <p className="text-xs text-muted-foreground">{tr("deleteOwnerOnly")}</p>}
        {alreadyRequested && <p className="text-xs text-muted-foreground">{tr("errExists")}</p>}
      </CardContent>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent className="max-w-md" data-testid="dialog-delete-company">
          <form onSubmit={submit} className="space-y-4" noValidate>
            <DialogHeader>
              <DialogTitle>{tr("deleteDialogTitle", { name: companyName })}</DialogTitle>
              <DialogDescription>{tr("deleteDialogBody", { days: RESTORE_WINDOW_DAYS })}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="del-name">{tr("typeName")}</Label>
              <Input id="del-name" value={typedName} onChange={(e) => setTypedName(e.target.value)} autoComplete="off" data-testid="input-delete-name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="del-password">{tr("password")}</Label>
              <Input id="del-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-delete-password" />
            </div>
            {needsCode && (
              <div className="space-y-2">
                <Label htmlFor="del-code">{tr("authCode")}</Label>
                <Input id="del-code" inputMode="numeric" autoComplete="one-time-code" dir="ltr" className="max-w-[12rem] font-mono tracking-widest" value={code} onChange={(e) => setCode(normaliseTotpCode(e.target.value))} data-testid="input-delete-code" />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="del-reason">{tr("reason")}</Label>
              <Input id="del-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive" data-testid="text-delete-error">
                {error}
              </p>
            )}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                {tr("cancel")}
              </Button>
              <Button type="submit" variant="destructive" disabled={busy || !canSubmitDeletion({ typedName, companyName, password, needsCode, code })} data-testid="button-delete-confirm">
                {busy ? tr("deleting") : tr("deleteConfirm")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
