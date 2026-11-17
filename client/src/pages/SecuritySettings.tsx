/**
 * W5-E Security settings (R01-11, R01-16, R17-19, R17-23): two-factor authentication
 * (TOTP + recovery codes), email verification status, signed-in devices, sign-in history,
 * the company MFA policy and the tamper-evident audit trail.
 */
import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { activityActionLabel } from "@/lib/activity-log-labels";
import { apiUrl } from "@/lib/api";
import { isStepUpRequired, securityFetch, SecurityApiError } from "@/lib/securityApi";

interface MfaStatus {
  enabled: boolean;
  enrolledAt: string | null;
  pendingEnrollment: boolean;
  recoveryCodesRemaining: number;
}

interface Overview {
  mfa: MfaStatus;
  mfaRequiredByCompanies: string[];
  emailVerification: {
    verified: boolean;
    enforced: boolean;
    graceEndsAt: string | null;
    restricted: boolean;
  };
}

interface SessionRow {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  current: boolean;
}

interface HistoryRow {
  id: string;
  action: string;
  at: string;
  ipAddress: string | null;
  userAgent: string | null;
}

interface AuditRow {
  id: string;
  seq: number;
  at: string;
  action: string;
  userEmail: string | null;
  resourceType: string;
  hash: string | null;
}

interface PolicyResponse {
  requireMfa: "none" | "owners_admins" | "all";
  uncovered: number;
}

/** A retryable async action (call signature keeps the i18n scanner quiet). */
interface AsyncAction {
  (): Promise<void>;
}

type Verification = {
  ok: boolean;
  checked: number;
  firstBroken: { seq: number; reason: string } | null;
};

/** "Chrome · Linux" from a raw user-agent string (the full string stays in the tooltip). */
function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "—";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  if (!browser && !os) return ua;
  return [browser, os].filter(Boolean).join(" · ");
}

function fmt(date: string | null | undefined, locale: string): string {
  if (!date) return "—";
  return new Date(date).toLocaleString(locale === "ar" ? "ar-AE" : "en-AE");
}

/** Runs `action`; when the server asks for step-up, collects a code and retries once. */
function useStepUp() {
  const [pending, setPending] = useState<null | {
    run: AsyncAction;
    resolve: () => void;
    reject: (e: unknown) => void;
  }>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const withStepUp = useCallback(async (action: AsyncAction) => {
    try {
      await action();
    } catch (err) {
      if (!isStepUpRequired(err)) throw err;
      await new Promise<void>((resolve, reject) => setPending({ run: action, resolve, reject }));
    }
  }, []);

  const submit = async () => {
    if (!pending) return;
    try {
      await securityFetch("POST", "/api/auth/mfa/step-up", { code: code.trim() });
      await pending.run();
      pending.resolve();
      setPending(null);
      setCode("");
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const cancel = () => {
    pending?.reject(new Error("cancelled"));
    setPending(null);
    setCode("");
  };
  return { withStepUp, open: !!pending, code, setCode, error, submit, cancel };
}

export default function SecuritySettings() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { companyId } = useDefaultCompany();
  const stepUp = useStepUp();

  const overview = useQuery<Overview>({
    queryKey: ["/api/auth/security/overview"],
    queryFn: () => securityFetch<Overview>("GET", "/api/auth/security/overview"),
  });
  const sessions = useQuery<{ sessions: SessionRow[] }>({
    queryKey: ["/api/auth/sessions"],
    queryFn: () => securityFetch("GET", "/api/auth/sessions"),
  });
  const history = useQuery<{ events: HistoryRow[] }>({
    queryKey: ["/api/auth/login-history"],
    queryFn: () => securityFetch("GET", "/api/auth/login-history"),
  });

  const fail = (err: unknown) =>
    toast({
      variant: "destructive",
      title: t["security.error"],
      description: err instanceof Error ? err.message : undefined,
    });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["/api/auth/security/overview"] });
    void qc.invalidateQueries({ queryKey: ["/api/auth/login-history"] });
  };

  // ── MFA enrolment ────────────────────────────────────────────────────────
  const [enrol, setEnrol] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [enrolCode, setEnrolCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [regenCode, setRegenCode] = useState("");

  const startEnrol = async () => {
    try {
      setEnrol(await securityFetch("POST", "/api/auth/mfa/enroll", {}));
    } catch (err) {
      fail(err);
    }
  };
  const confirmEnrol = async () => {
    try {
      const r = await securityFetch<{ recoveryCodes: string[] }>(
        "POST",
        "/api/auth/mfa/enroll/confirm",
        { code: enrolCode.trim() }
      );
      setRecoveryCodes(r.recoveryCodes);
      setEnrol(null);
      setEnrolCode("");
      refresh();
    } catch (err) {
      fail(err);
    }
  };
  const disable = async () => {
    try {
      await securityFetch("POST", "/api/auth/mfa/disable", {
        password: disablePassword,
        code: disableCode.trim(),
      });
      setDisablePassword("");
      setDisableCode("");
      setRecoveryCodes(null);
      refresh();
    } catch (err) {
      fail(err);
    }
  };
  const regenerate = async () => {
    try {
      const r = await securityFetch<{ recoveryCodes: string[] }>(
        "POST",
        "/api/auth/mfa/recovery-codes",
        { code: regenCode.trim() }
      );
      setRecoveryCodes(r.recoveryCodes);
      setRegenCode("");
      refresh();
    } catch (err) {
      fail(err);
    }
  };

  // ── Email verification ───────────────────────────────────────────────────
  const resend = async () => {
    try {
      const r = await securityFetch<{ sent: boolean }>("POST", "/api/auth/verify-email/resend", {});
      toast({ title: r.sent ? t["security.emailSent"] : t["security.emailQueued"] });
    } catch (err) {
      fail(err);
    }
  };

  // ── Sessions ─────────────────────────────────────────────────────────────
  const revoke = async (id: string) => {
    try {
      await securityFetch("DELETE", `/api/auth/sessions/${id}`);
      void qc.invalidateQueries({ queryKey: ["/api/auth/sessions"] });
    } catch (err) {
      fail(err);
    }
  };
  const [confirmLogoutAll, setConfirmLogoutAll] = useState(false);
  const logoutAll = async () => {
    try {
      await securityFetch("POST", "/api/auth/logout-all", {});
      window.location.href = "/login";
    } catch (err) {
      fail(err);
    }
  };

  const ov = overview.data;
  const mfa = ov?.mfa;

  return (
    <div className="max-w-narrow space-y-6" data-testid="page-security-settings">
      <PageHeader
        eyebrow="Settings"
        title={t["security.pageTitle"]}
        description={t["security.pageSubtitle"]}
      />

      {ov && ov.mfaRequiredByCompanies.length > 0 && (
        <p
          className="rounded-lg border border-warning/40 bg-warning-subtle p-3 text-small text-warning-subtle-foreground"
          role="alert"
        >
          {t["security.mfaRequiredBy"]}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {t["security.mfaTitle"]}
            {mfa && (
              <Badge variant={mfa.enabled ? "default" : "secondary"} data-testid="badge-mfa">
                {mfa.enabled ? t["security.mfaOn"] : t["security.mfaOff"]}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>{t["security.mfaDescription"]}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {recoveryCodes && (
            <div className="rounded-md border p-3" data-testid="recovery-codes">
              <p className="font-medium">{t["security.mfaRecoveryTitle"]}</p>
              <p className="mb-2 text-sm text-muted-foreground">{t["security.mfaRecoveryHelp"]}</p>
              <ul className="grid grid-cols-2 gap-1 font-mono text-sm" dir="ltr">
                {recoveryCodes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          {mfa && !mfa.enabled && !enrol && (
            <Button onClick={startEnrol} data-testid="button-mfa-start">
              {t["security.mfaStart"]}
            </Button>
          )}

          {enrol && (
            <div className="space-y-3">
              <p className="text-sm">{t["security.mfaScan"]}</p>
              <img src={enrol.qrDataUrl} alt="" width={220} height={220} />
              <p className="text-sm">
                {t["security.mfaManualKey"]}:{" "}
                <code className="font-mono" dir="ltr">
                  {enrol.secret}
                </code>
              </p>
              <Label htmlFor="enrol-code">{t["security.mfaCode"]}</Label>
              <div className="flex gap-2">
                <Input
                  id="enrol-code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  value={enrolCode}
                  onChange={(e) => setEnrolCode(e.target.value)}
                />
                <Button onClick={confirmEnrol} disabled={enrolCode.trim().length < 6}>
                  {t["security.mfaConfirm"]}
                </Button>
              </div>
            </div>
          )}

          {mfa?.enabled && (
            <div className="space-y-4">
              <p className="text-sm">
                {formatMessage(t["security.mfaRecoveryRemaining"], {
                  count: mfa.recoveryCodesRemaining,
                })}
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <Label htmlFor="regen-code">{t["security.mfaCode"]}</Label>
                  <Input
                    id="regen-code"
                    value={regenCode}
                    onChange={(e) => setRegenCode(e.target.value)}
                  />
                </div>
                <Button
                  variant="outline"
                  onClick={regenerate}
                  disabled={regenCode.trim().length < 6}
                >
                  {t["security.mfaRegenerate"]}
                </Button>
              </div>
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm text-muted-foreground">{t["security.mfaDisableHelp"]}</p>
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <Label htmlFor="disable-password">{t["security.password"]}</Label>
                    <Input
                      id="disable-password"
                      type="password"
                      autoComplete="current-password"
                      value={disablePassword}
                      onChange={(e) => setDisablePassword(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="disable-code">{t["security.mfaCode"]}</Label>
                    <Input
                      id="disable-code"
                      value={disableCode}
                      onChange={(e) => setDisableCode(e.target.value)}
                    />
                  </div>
                  <Button
                    variant="destructive"
                    onClick={disable}
                    disabled={!disablePassword || disableCode.trim().length < 6}
                  >
                    {t["security.mfaDisable"]}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {t["security.emailTitle"]}
            {ov && (
              <Badge variant={ov.emailVerification.verified ? "default" : "secondary"}>
                {ov.emailVerification.verified
                  ? t["security.emailVerified"]
                  : t["security.emailUnverified"]}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {ov && !ov.emailVerification.verified && (
            <>
              <p>
                {!ov.emailVerification.enforced
                  ? t["security.emailNotEnforced"]
                  : ov.emailVerification.restricted
                    ? t["security.emailRestricted"]
                    : formatMessage(t["security.emailGrace"], {
                        date: fmt(ov.emailVerification.graceEndsAt, locale),
                      })}
              </p>
              <Button variant="outline" onClick={resend}>
                {t["security.emailResend"]}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>{t["security.sessionsTitle"]}</CardTitle>
          <Button
            variant="outline"
            onClick={() => setConfirmLogoutAll(true)}
            data-testid="button-logout-all"
          >
            {t["security.logoutAll"]}
          </Button>
          <Dialog open={confirmLogoutAll} onOpenChange={setConfirmLogoutAll}>
            <DialogContent data-testid="dialog-logout-all">
              <DialogHeader>
                <DialogTitle>{t["security.logoutAllConfirmTitle"]}</DialogTitle>
                <DialogDescription>{t["security.logoutAllConfirmBody"]}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmLogoutAll(false)}>
                  {t["security.logoutAllCancel"]}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => void logoutAll()}
                  data-testid="button-logout-all-confirm"
                >
                  {t["security.logoutAllConfirmAction"]}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <ul className="divide-y text-sm">
            {(sessions.data?.sessions ?? []).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium" dir="ltr" title={s.userAgent ?? undefined}>
                    {describeUserAgent(s.userAgent)}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    <bdi dir="ltr">{s.ipAddress ?? "—"}</bdi> ·{" "}
                    {formatMessage(t["security.sessionLastUsed"], {
                      date: fmt(s.lastUsedAt ?? s.createdAt, locale),
                    })}
                  </p>
                </div>
                {s.current ? (
                  <Badge variant="success" dot>
                    {t["security.sessionCurrent"]}
                  </Badge>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => revoke(s.id)}>
                    {t["security.sessionRevoke"]}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t["security.historyTitle"]}</CardTitle>
        </CardHeader>
        <CardContent>
          {history.data?.events.length ? (
            <ul className="divide-y text-sm">
              {history.data.events.map((e) => (
                <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span className="tabular-nums">{activityActionLabel(t, e.action)}</span>
                  <span className="text-muted-foreground" dir="ltr">
                    {fmt(e.at, locale)} · {e.ipAddress ?? "—"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t["security.historyEmpty"]}</p>
          )}
        </CardContent>
      </Card>

      {companyId && (
        <CompanySecurity companyId={companyId} withStepUp={stepUp.withStepUp} onError={fail} />
      )}

      <Dialog open={stepUp.open} onOpenChange={(open) => !open && stepUp.cancel()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t["security.stepUpTitle"]}</DialogTitle>
            <DialogDescription>{t["security.stepUpHelp"]}</DialogDescription>
          </DialogHeader>
          <Input
            autoComplete="one-time-code"
            value={stepUp.code}
            onChange={(e) => stepUp.setCode(e.target.value)}
            aria-label={t["security.mfaCode"]}
          />
          {stepUp.error && (
            <p className="text-sm text-destructive" role="alert">
              {stepUp.error}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={stepUp.cancel}>
              {t["security.cancel"]}
            </Button>
            <Button onClick={stepUp.submit} disabled={stepUp.code.trim().length < 6}>
              {t["security.verify"]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CompanySecurity({
  companyId,
  withStepUp,
  onError,
}: {
  companyId: string;
  withStepUp(action: AsyncAction): Promise<void>;
  onError: (err: unknown) => void;
}) {
  const { t, locale } = useTranslation();
  const qc = useQueryClient();
  const [category, setCategory] = useState("all");
  const [verification, setVerification] = useState<Verification | null>(null);

  const policy = useQuery<PolicyResponse | null>({
    queryKey: ["/api/companies", companyId, "security/policy"],
    queryFn: async () => {
      try {
        return await securityFetch<PolicyResponse>(
          "GET",
          `/api/companies/${companyId}/security/policy`
        );
      } catch (err) {
        // Members without settings permission simply do not see this section.
        if (err instanceof SecurityApiError && err.status === 403) return null;
        throw err;
      }
    },
  });
  const audit = useQuery<{ events: AuditRow[] } | null>({
    queryKey: ["/api/companies", companyId, "audit-log", category],
    enabled: !!policy.data,
    queryFn: () =>
      securityFetch("GET", `/api/companies/${companyId}/audit-log?category=${category}&limit=100`),
  });

  const labels = useMemo(
    () => ({
      none: t["security.policyNone"],
      owners_admins: t["security.policyOwnersAdmins"],
      all: t["security.policyAll"],
    }),
    [t]
  );

  if (!policy.data) return null;

  const savePolicy = async (requireMfa: string) => {
    try {
      await withStepUp(async () => {
        await securityFetch("PUT", `/api/companies/${companyId}/security/policy`, { requireMfa });
      });
      void qc.invalidateQueries({ queryKey: ["/api/companies", companyId, "security/policy"] });
    } catch (err) {
      if (err instanceof SecurityApiError && err.code === "MFA_ENROLL_FIRST") {
        onError(new Error(t["security.policyEnrolFirst"]));
      } else if ((err as Error)?.message !== "cancelled") {
        onError(err);
      }
    }
  };

  const verify = async () => {
    try {
      setVerification(
        await securityFetch<Verification>("GET", `/api/companies/${companyId}/audit-log/verify`)
      );
    } catch (err) {
      onError(err);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t["security.policyTitle"]}</CardTitle>
          <CardDescription>{t["security.policyHelp"]}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Select value={policy.data.requireMfa} onValueChange={savePolicy}>
            <SelectTrigger className="w-72" data-testid="select-mfa-policy">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(labels) as Array<keyof typeof labels>).map((k) => (
                <SelectItem key={k} value={k}>
                  {labels[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            {formatMessage(t["security.policyUncovered"], { count: policy.data.uncovered })}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t["security.auditTitle"]}</CardTitle>
          <CardDescription>{t["security.auditHelp"]}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-56" aria-label={t["security.auditCategory"]}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t["security.auditAll"]}</SelectItem>
                <SelectItem value="security">{t["security.auditSecurity"]}</SelectItem>
                <SelectItem value="ledger">{t["security.auditLedger"]}</SelectItem>
                <SelectItem value="accounts">{t["security.auditAccounts"]}</SelectItem>
                <SelectItem value="team">{t["security.auditTeam"]}</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={verify} data-testid="button-audit-verify">
              {t["security.auditVerify"]}
            </Button>
            <Button variant="ghost" asChild>
              <a href={apiUrl(`/api/companies/${companyId}/audit-log/export?format=csv`)}>
                {t["security.auditExportCsv"]}
              </a>
            </Button>
            <Button variant="ghost" asChild>
              <a href={apiUrl(`/api/companies/${companyId}/audit-log/export?format=json`)}>
                {t["security.auditExportJson"]}
              </a>
            </Button>
          </div>
          {verification && (
            <p
              className={`text-sm ${verification.ok ? "" : "text-destructive"}`}
              role="status"
              data-testid="text-audit-verification"
            >
              {verification.ok
                ? formatMessage(t["security.auditVerified"], { count: verification.checked })
                : formatMessage(t["security.auditBroken"], {
                    seq: verification.firstBroken?.seq ?? "?",
                    reason: verification.firstBroken?.reason ?? "",
                  })}
            </p>
          )}
          {audit.data?.events.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-start text-muted-foreground">
                    <th className="py-1 text-start">#</th>
                    <th className="py-1 text-start">{t["security.auditWhen"]}</th>
                    <th className="py-1 text-start">{t["security.auditAction"]}</th>
                    <th className="py-1 text-start">{t["security.auditUser"]}</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.data.events.map((e) => (
                    <tr key={e.id} className="border-t" title={e.hash ?? undefined}>
                      <td className="py-1">{e.seq}</td>
                      <td className="py-1" dir="ltr">
                        {fmt(e.at, locale)}
                      </td>
                      <td className="py-1 tabular-nums">{activityActionLabel(t, e.action)}</td>
                      <td className="py-1" dir="ltr">
                        {e.userEmail ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t["security.auditEmpty"]}</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
