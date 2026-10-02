import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isTotpCode, normaliseTotpCode } from "@/lib/security-api";
import { ApiError } from "@/lib/queryClient";
import { messages as pageMessages } from "./TwoFactorCard.i18n";

interface Props {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  /** Throws on failure; the dialog shows the error and stays open. */
  onConfirm: (password: string, code: string) => Promise<void>;
}

/** Password plus authenticator code: the re-authentication every sensitive 2FA change asks for. */
export function ReauthDialog({ open, title, description, confirmLabel, destructive, onCancel, onConfirm }: Props) {
  const tr = pageMessages.useT();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPassword("");
      setCode("");
      setError(null);
    }
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !password || !isTotpCode(code)) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(password, code);
    } catch (err) {
      const apiCode = err instanceof ApiError ? err.code : undefined;
      setError(
        apiCode === "PASSWORD_INVALID"
          ? tr("errPassword")
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

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onCancel()}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reauth-password">{tr("currentPassword")}</Label>
            <Input id="reauth-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-reauth-password" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reauth-code">{tr("authCode")}</Label>
            <Input
              id="reauth-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              className="font-mono tracking-widest"
              value={code}
              onChange={(e) => setCode(normaliseTotpCode(e.target.value))}
              data-testid="input-reauth-code"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive" data-testid="text-reauth-error">
              {error}
            </p>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
              {tr("cancel")}
            </Button>
            <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={busy || !password || !isTotpCode(code)} data-testid="button-reauth-confirm">
              {busy ? tr("working") : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
