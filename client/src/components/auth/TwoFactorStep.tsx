import { useEffect, useRef, useState, type FormEvent } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  isRecoveryCode,
  isTotpCode,
  loginStepErrorKind,
  normaliseRecoveryCode,
  normaliseTotpCode,
  verifyLoginChallenge,
  type LoginStepError,
} from "@/lib/security-api";
import { messages as pageMessages } from "./TwoFactorStep.i18n";

interface TwoFactorStepProps {
  /** Absent on the OAuth path: the httpOnly challenge cookie is used instead. */
  challengeToken?: string;
  onVerified: (user: any, extra: { twoFactorEnrolmentRequired: boolean }) => void | Promise<void>;
  onBack: () => void;
}

const ERROR_KEY = {
  invalid: "errorInvalid",
  replayed: "errorReplayed",
  expired: "errorExpired",
  recoveryInvalid: "errorRecovery",
  unknown: "errorUnknown",
} as const;

export function TwoFactorStep({ challengeToken, onVerified, onBack }: TwoFactorStepProps) {
  const tr = pageMessages.useT();
  const { toast } = useToast();
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorKind, setErrorKind] = useState<LoginStepError | null>(null);
  const [retryAfter, setRetryAfter] = useState(60);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [useRecovery]);

  const ready = useRecovery ? isRecoveryCode(value) : isTotpCode(value);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setErrorKind(null);
    try {
      const result = await verifyLoginChallenge({
        challengeToken,
        ...(useRecovery ? { recoveryCode: normaliseRecoveryCode(value) } : { code: value }),
      });
      if (!result.ok) {
        const kind = loginStepErrorKind(result.code, result.status);
        if (result.retryAfterSeconds) setRetryAfter(Math.ceil(result.retryAfterSeconds));
        setErrorKind(kind);
        if (kind === "expired") window.setTimeout(onBack, 1800);
        setValue("");
        inputRef.current?.focus();
        return;
      }
      toast({ title: tr("successTitle"), description: tr("successBody") });
      await onVerified(result.user, { twoFactorEnrolmentRequired: result.twoFactorEnrolmentRequired });
    } catch {
      setErrorKind("unknown");
    } finally {
      setBusy(false);
    }
  }

  const errorText = errorKind
    ? errorKind === "rateLimited"
      ? tr("errorRateLimited", { seconds: retryAfter })
      : tr(ERROR_KEY[errorKind])
    : null;
  const inputId = "two-factor-input";

  return (
    <Card className="w-full max-w-md border-border/60 shadow-xl" data-testid="two-factor-step">
      <CardHeader className="space-y-1.5">
        <CardTitle className="flex items-center gap-2 font-display text-[26px] font-normal leading-none tracking-tight">
          <ShieldCheck className="h-6 w-6 text-accent" aria-hidden="true" />
          <h1>{tr("title")}</h1>
        </CardTitle>
        <CardDescription>{useRecovery ? tr("descriptionRecovery") : tr("descriptionCode")}</CardDescription>
      </CardHeader>
      <form onSubmit={submit} noValidate>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={inputId}>{useRecovery ? tr("recoveryLabel") : tr("codeLabel")}</Label>
            <Input
              id={inputId}
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(useRecovery ? e.target.value.slice(0, 14) : normaliseTotpCode(e.target.value))}
              inputMode={useRecovery ? "text" : "numeric"}
              autoComplete="one-time-code"
              autoCapitalize={useRecovery ? "characters" : "off"}
              spellCheck={false}
              dir="ltr"
              className="text-center font-mono text-lg tracking-widest"
              aria-invalid={errorText ? true : undefined}
              aria-describedby={errorText ? `${inputId}-error` : undefined}
              disabled={busy}
              data-testid="input-2fa-code"
            />
            {errorText && (
              <p id={`${inputId}-error`} role="alert" className="text-sm text-destructive" data-testid="text-2fa-error">
                {errorText}
              </p>
            )}
          </div>
          <Button type="submit" className="w-full" disabled={!ready || busy} data-testid="button-2fa-verify">
            <KeyRound className="me-2 h-4 w-4" aria-hidden="true" />
            {busy ? tr("verifying") : tr("verify")}
          </Button>
        </CardContent>
      </form>
      <CardFooter className="flex flex-col gap-1 sm:flex-row sm:justify-between">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setUseRecovery((v) => !v);
            setValue("");
            setErrorKind(null);
          }}
          data-testid="button-2fa-toggle"
        >
          {useRecovery ? tr("useCode") : tr("useRecovery")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onBack} data-testid="button-2fa-back">
          {tr("back")}
        </Button>
      </CardFooter>
    </Card>
  );
}
