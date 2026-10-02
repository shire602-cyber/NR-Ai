import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ApiError, queryClient } from "@/lib/queryClient";
import {
  confirmEnrolment,
  disableTwoFactor,
  formatSecret,
  isTotpCode,
  normaliseTotpCode,
  regenerateRecoveryCodes,
  sessionsKey,
  startEnrolment,
  twoFactorStatusKey,
  type TwoFactorEnrolment,
  type TwoFactorStatus,
} from "@/lib/security-api";
import { RecoveryCodesDialog } from "./RecoveryCodesDialog";
import { ReauthDialog } from "./ReauthDialog";
import { messages as pageMessages } from "./TwoFactorCard.i18n";

const LOW_CODES = 3;

export function TwoFactorCard() {
  const tr = pageMessages.useT();
  const { toast } = useToast();
  const { data: status, isLoading, isError } = useQuery<TwoFactorStatus>({ queryKey: twoFactorStatusKey });
  const [enrolment, setEnrolment] = useState<TwoFactorEnrolment | null>(null);
  const [code, setCode] = useState("");
  const [enrolError, setEnrolError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [dialog, setDialog] = useState<"disable" | "regenerate" | null>(null);

  const begin = useMutation({
    mutationFn: startEnrolment,
    onSuccess: (data) => {
      setEnrolment(data);
      setCode("");
      setEnrolError(null);
    },
    onError: () => toast({ variant: "destructive", title: tr("errGeneric") }),
  });

  const confirm = useMutation({
    mutationFn: (value: string) => confirmEnrolment(value),
    onSuccess: (data) => {
      setEnrolment(null);
      setCodes(data.recoveryCodes);
      queryClient.invalidateQueries({ queryKey: twoFactorStatusKey });
      queryClient.invalidateQueries({ queryKey: sessionsKey });
    },
    onError: (err) => {
      const apiCode = err instanceof ApiError ? err.code : undefined;
      setEnrolError(apiCode === "TOTP_REPLAYED" ? tr("errReplayed") : err instanceof ApiError && err.status === 429 ? tr("errRateLimited") : tr("errCode"));
      setCode("");
    },
  });

  function submitEnrolment(e: FormEvent) {
    e.preventDefault();
    if (isTotpCode(code) && !confirm.isPending) confirm.mutate(code);
  }

  const required = (status?.requiredByCompanies ?? []).length > 0;

  return (
    <Card data-testid="card-two-factor">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-lg">
              {status?.enabled ? <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" /> : <ShieldOff className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
              <h2>{tr("tfaTitle")}</h2>
            </CardTitle>
            <CardDescription>{tr("tfaBody")}</CardDescription>
          </div>
          {status && (
            <Badge variant={status.enabled ? "default" : "secondary"} data-testid="badge-2fa-status">
              {status.enabled ? tr("on") : tr("off")}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-muted-foreground">{tr("loading")}</p>}
        {isError && <p role="alert" className="text-sm text-destructive">{tr("errGeneric")}</p>}

        {required && !status?.enabled && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="status" data-testid="notice-2fa-required">
            {tr("requiredBy", { companies: status!.requiredByCompanies.map((c) => c.name).join(", ") })}
          </p>
        )}

        {status && !status.enabled && !enrolment && (
          <Button onClick={() => begin.mutate()} disabled={begin.isPending} data-testid="button-2fa-start">
            <KeyRound className="me-2 h-4 w-4" aria-hidden="true" />
            {begin.isPending ? tr("working") : tr("setUp")}
          </Button>
        )}

        {enrolment && (
          <form onSubmit={submitEnrolment} className="grid gap-5 md:grid-cols-[auto_1fr]" noValidate data-testid="form-2fa-enrol">
            <div className="flex flex-col items-center gap-2">
              <img src={enrolment.qrDataUrl} alt={tr("qrAlt")} width={200} height={200} className="rounded-md border bg-white p-2" />
            </div>
            <div className="space-y-4">
              <ol className="list-decimal space-y-1 ps-5 text-sm">
                <li>{tr("step1")}</li>
                <li>{tr("step2")}</li>
                <li>{tr("step3")}</li>
              </ol>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{tr("manualKey")}</p>
                <code dir="ltr" className="block break-all rounded bg-muted px-2 py-1.5 font-mono text-sm" data-testid="text-2fa-secret">
                  {formatSecret(enrolment.secret)}
                </code>
              </div>
              <div className="space-y-2">
                <Label htmlFor="enrol-code">{tr("authCode")}</Label>
                <Input
                  id="enrol-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  dir="ltr"
                  className="max-w-[12rem] font-mono tracking-widest"
                  value={code}
                  onChange={(e) => setCode(normaliseTotpCode(e.target.value))}
                  aria-invalid={enrolError ? true : undefined}
                  data-testid="input-enrol-code"
                />
                {enrolError && (
                  <p role="alert" className="text-sm text-destructive" data-testid="text-enrol-error">
                    {enrolError}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={!isTotpCode(code) || confirm.isPending} data-testid="button-enrol-confirm">
                  {confirm.isPending ? tr("working") : tr("turnOn")}
                </Button>
                <Button type="button" variant="outline" onClick={() => setEnrolment(null)}>
                  {tr("cancel")}
                </Button>
              </div>
            </div>
          </form>
        )}

        {status?.enabled && (
          <div className="space-y-3">
            <p className={`text-sm ${status.recoveryCodesRemaining < LOW_CODES ? "font-medium text-destructive" : "text-muted-foreground"}`} data-testid="text-codes-remaining">
              {tr.plural("codesLeft", status.recoveryCodesRemaining)}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setDialog("regenerate")} data-testid="button-regenerate-codes">
                {tr("newCodes")}
              </Button>
              <Button variant="outline" disabled={required} onClick={() => setDialog("disable")} data-testid="button-2fa-disable">
                {tr("turnOff")}
              </Button>
            </div>
            {required && <p className="text-xs text-muted-foreground">{tr("cannotDisable", { companies: status.requiredByCompanies.map((c) => c.name).join(", ") })}</p>}
          </div>
        )}
      </CardContent>

      <RecoveryCodesDialog codes={codes} onClose={() => setCodes(null)} />

      <ReauthDialog
        open={dialog === "disable"}
        title={tr("disableTitle")}
        description={tr("disableBody")}
        confirmLabel={tr("turnOff")}
        destructive
        onCancel={() => setDialog(null)}
        onConfirm={async (password, value) => {
          await disableTwoFactor(password, value);
          setDialog(null);
          queryClient.invalidateQueries({ queryKey: twoFactorStatusKey });
          queryClient.invalidateQueries({ queryKey: sessionsKey });
          toast({ title: tr("disabledToast") });
        }}
      />
      <ReauthDialog
        open={dialog === "regenerate"}
        title={tr("regenTitle")}
        description={tr("regenBody")}
        confirmLabel={tr("newCodes")}
        onCancel={() => setDialog(null)}
        onConfirm={async (password, value) => {
          const result = await regenerateRecoveryCodes(password, value);
          setDialog(null);
          setCodes(result.recoveryCodes);
          queryClient.invalidateQueries({ queryKey: twoFactorStatusKey });
          queryClient.invalidateQueries({ queryKey: sessionsKey });
        }}
      />
    </Card>
  );
}
