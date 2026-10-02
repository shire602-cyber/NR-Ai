import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ApiError, queryClient } from "@/lib/queryClient";
import {
  changePassword,
  isTotpCode,
  normaliseTotpCode,
  passwordChecks,
  sessionsKey,
  twoFactorStatusKey,
  type TwoFactorStatus,
} from "@/lib/security-api";
import { messages as pageMessages } from "./TwoFactorCard.i18n";

export function ChangePasswordCard() {
  const tr = pageMessages.useT();
  const { toast } = useToast();
  const { data: status } = useQuery<TwoFactorStatus>({ queryKey: twoFactorStatusKey });
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checks = passwordChecks(next);
  const strong = Object.values(checks).every(Boolean) && next.length <= 128;
  const matches = next === confirm && confirm.length > 0;
  const needsCode = status?.enabled === true;
  const canSubmit = !!current && strong && matches && (!needsCode || isTotpCode(code)) && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await changePassword({ currentPassword: current, newPassword: next, ...(needsCode ? { code } : {}) });
      setCurrent("");
      setNext("");
      setConfirm("");
      setCode("");
      queryClient.invalidateQueries({ queryKey: sessionsKey });
      toast({ title: tr("passwordChanged"), description: tr("passwordChangedBody") });
    } catch (err) {
      const apiCode = err instanceof ApiError ? err.code : undefined;
      setError(
        apiCode === "PASSWORD_INVALID"
          ? tr("errPassword")
          : apiCode === "WEAK_PASSWORD"
            ? tr("errWeak")
            : apiCode === "TOTP_REPLAYED"
              ? tr("errReplayed")
              : apiCode === "TOTP_INVALID"
                ? tr("errCode")
                : err instanceof ApiError && err.status === 429
                  ? tr("errRateLimited")
                  : tr("errGeneric")
      );
    } finally {
      setBusy(false);
    }
  }

  const rules: Array<[keyof typeof checks, string]> = [
    ["length", tr("ruleLength")],
    ["upper", tr("ruleUpper")],
    ["lower", tr("ruleLower")],
    ["digit", tr("ruleDigit")],
  ];

  return (
    <Card data-testid="card-change-password">
      <CardHeader>
        <CardTitle className="text-lg">
          <h2>{tr("pwTitle")}</h2>
        </CardTitle>
        <CardDescription>{tr("pwBody")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="max-w-md space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="pw-current">{tr("currentPassword")}</Label>
            <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} data-testid="input-pw-current" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pw-new">{tr("newPassword")}</Label>
            <Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} aria-describedby="pw-rules" data-testid="input-pw-new" />
            <ul id="pw-rules" className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
              {rules.map(([key, label]) => (
                <li key={key} className={`flex items-center gap-1.5 ${checks[key] ? "text-primary" : "text-muted-foreground"}`}>
                  {checks[key] ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <X className="h-3.5 w-3.5" aria-hidden="true" />}
                  <span>{label}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pw-confirm">{tr("confirmPassword")}</Label>
            <Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={confirm.length > 0 && !matches ? true : undefined} data-testid="input-pw-confirm" />
            {confirm.length > 0 && !matches && <p className="text-xs text-destructive">{tr("mismatch")}</p>}
          </div>
          {needsCode && (
            <div className="space-y-2">
              <Label htmlFor="pw-code">{tr("authCode")}</Label>
              <Input id="pw-code" inputMode="numeric" autoComplete="one-time-code" dir="ltr" className="max-w-[12rem] font-mono tracking-widest" value={code} onChange={(e) => setCode(normaliseTotpCode(e.target.value))} data-testid="input-pw-code" />
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive" data-testid="text-pw-error">
              {error}
            </p>
          )}
          <Button type="submit" disabled={!canSubmit} data-testid="button-change-password">
            {busy ? tr("working") : tr("changePassword")}
          </Button>
          <p className="text-xs text-muted-foreground">{tr("signsOutOthers")}</p>
        </form>
      </CardContent>
    </Card>
  );
}
