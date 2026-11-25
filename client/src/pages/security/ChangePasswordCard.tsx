/**
 * Signed-in "Change password" (R01-13). Uses POST /api/auth/change-password: the server
 * verifies the current password, applies the password policy, signs out every other
 * session and token, and re-issues this device's session cookies.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { securityFetch, SecurityApiError } from "@/lib/securityApi";

/** Mirrors the server policy's character rules (server/auth.ts passwordPolicySchema). */
function passwordPolicyProblem(password: string): string | null {
  if (password.length < 8) return "security.passwordTooShort";
  if (password.length > 256) return "security.passwordTooLong";
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password))
    return "security.passwordComplexity";
  return null;
}

const SERVER_CODE_KEYS: Record<string, string> = {
  CURRENT_PASSWORD_INVALID: "security.currentPasswordWrong",
  PASSWORD_UNCHANGED: "security.passwordUnchanged",
  ACCOUNT_LOCKED: "security.passwordLocked",
};

export function ChangePasswordCard() {
  const { t } = useTranslation();
  const tt = t as Record<string, string>;
  const { toast } = useToast();
  const qc = useQueryClient();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!current) return setError(tt["security.currentPasswordRequired"]);
    const problem = passwordPolicyProblem(next);
    if (problem) return setError(tt[problem]);
    if (next === current) return setError(tt["security.passwordUnchanged"]);
    if (next !== confirm) return setError(tt["security.passwordsMismatch"]);
    setBusy(true);
    try {
      await securityFetch("POST", "/api/auth/change-password", {
        currentPassword: current,
        newPassword: next,
      });
      setCurrent("");
      setNext("");
      setConfirm("");
      toast({
        title: tt["security.passwordChanged"],
        description: tt["security.passwordChangedBody"],
      });
      void qc.invalidateQueries({ queryKey: ["/api/auth/sessions"] });
      void qc.invalidateQueries({ queryKey: ["/api/auth/login-history"] });
    } catch (err) {
      const key = err instanceof SecurityApiError && err.code ? SERVER_CODE_KEYS[err.code] : null;
      setError(key ? tt[key] : err instanceof Error ? err.message : tt["security.error"]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid="card-change-password">
      <CardHeader>
        <CardTitle>{tt["security.changePasswordTitle"]}</CardTitle>
        <CardDescription>{tt["security.changePasswordHelp"]}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="max-w-md space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cp-current">{tt["security.currentPassword"]}</Label>
            <Input
              id="cp-current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              data-testid="input-current-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp-new">{tt["security.newPassword"]}</Label>
            <Input
              id="cp-new"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              aria-describedby="cp-new-hint"
              data-testid="input-new-password"
            />
            <p id="cp-new-hint" className="text-small text-muted-foreground">
              {tt["security.passwordRules"]}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp-confirm">{tt["security.confirmNewPassword"]}</Label>
            <Input
              id="cp-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              data-testid="input-confirm-new-password"
            />
          </div>
          {error && (
            <p
              className="text-sm text-destructive"
              role="alert"
              data-testid="change-password-error"
            >
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy} data-testid="button-change-password">
            {tt["security.changePasswordSubmit"]}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
