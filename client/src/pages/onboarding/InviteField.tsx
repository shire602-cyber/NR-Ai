import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { formatMessage, useTranslation } from "@/lib/i18n";
import type { CompanyRole } from "@shared/permissions";

/** Roles offered when inviting from onboarding (the team page offers the full list). */
const INVITE_ROLES: readonly CompanyRole[] = ["accountant", "bookkeeper", "admin", "viewer"];

/** POST the same invitation the team page sends. */
export function sendTeamInvite(companyId: string, email: string, role: CompanyRole) {
  return apiRequest("POST", `/api/companies/${companyId}/team/invite`, { email, role });
}

export function isEmail(value: string): boolean {
  return z.string().email().safeParse(value.trim()).success;
}

/**
 * Inline "email + role + Send invite" row (firm onboarding step 2, spec 3.3). Sends through the
 * team invitation endpoint and lists who was invited underneath.
 */
export function InviteField({ companyId }: { companyId: string | undefined }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<CompanyRole>("accountant");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string[]>([]);

  const send = async () => {
    if (!companyId) return;
    if (!isEmail(email)) {
      setError(t["forms.errors.enterValidEmail"]);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendTeamInvite(companyId, email.trim(), role);
      setSent((s) => [...s, email.trim()]);
      setEmail("");
    } catch (err) {
      setError((err as Error)?.message || t["onboarding.v3InviteFailed"]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto]">
        <Input
          type="email"
          dir="ltr"
          autoComplete="off"
          className="h-10 text-start"
          placeholder="name@firm.ae"
          aria-label={t["onboarding.v3InviteEmail"]}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void send();
            }
          }}
          data-testid="firm-onboarding-invite-email"
        />
        <Select value={role} onValueChange={(v) => setRole(v as CompanyRole)}>
          <SelectTrigger className="h-10" aria-label={t["onboarding.v3InviteRole"]}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INVITE_ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {t[`onboarding.v3Role_${r}`]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          className="h-10"
          onClick={() => void send()}
          disabled={busy || !email.trim()}
          data-testid="firm-onboarding-invite-send"
        >
          {t["onboarding.v3InviteSend"]}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      ) : null}
      {sent.length ? (
        <ul className="space-y-1 text-small text-muted-foreground" aria-live="polite">
          {sent.map((address) => (
            <li key={address}>{formatMessage(t["onboarding.v3InviteSent"], { email: address })}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
