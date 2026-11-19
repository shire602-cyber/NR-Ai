import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  Clock,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRoundCheck,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert } from "@/components/ui/alert";
import { PasswordRules } from "@/components/portal/PasswordRules";
import { PortalStatePage } from "@/components/portal/PortalStatePage";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { establishAuthenticatedSession } from "@/lib/authSession";
import { currentUserQueryKey } from "@/hooks/useCurrentUser";
import { formatMessage, useI18n, useTranslation } from "@/lib/i18n";
import { VALIDATION_NAMESPACES } from "@/lib/validation-messages";
import { removeToken } from "@/lib/auth";
import { failedPasswordRules } from "@shared/validators/password-rules";
import { PORTAL_WELCOME_KEY } from "@/lib/portal-state";

/** The invitation token lives in the URL fragment; it is moved to this tab's storage and stripped. */
const TOKEN_KEY = "muhasib.portalInvite";
const TOKEN_RE = /^[0-9a-f]{64}$/i;


function readToken(): string | null {
  if (typeof window === "undefined") return null;
  const m = /[#&]t=([0-9a-f]{64})/i.exec(window.location.hash);
  if (m) {
    try {
      window.sessionStorage.setItem(TOKEN_KEY, m[1]);
    } catch {
      /* storage blocked: the token stays only in memory for this page view */
    }
    // The link is single-use and secret: drop it from the address bar and history.
    window.history.replaceState(null, "", window.location.pathname);
    return m[1];
  }
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function clearStoredToken() {
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

interface InviteInfo {
  status: "pending";
  supplier: { name: string; logoUrl: string | null; contactEmail: string | null };
  customerName: string;
  customerNameAr: string | null;
  email: string;
  name: string;
  language: "en" | "ar" | "bilingual";
  expiresAt: string;
  account: "new" | "existing" | "signed_in" | "signed_in_other";
  signedInAs: string | null;
  onlinePayment: { available: boolean };
}

type StateKind = "loading" | "invalid" | "expired" | "revoked" | "accepted" | "throttled" | "error";

function classify(error: unknown): { kind: StateKind; body?: Record<string, unknown> } {
  if (error instanceof ApiError) {
    const code = String(error.body?.code ?? "");
    if (error.status === 429) return { kind: "throttled" };
    if (error.status === 404) return { kind: "invalid" };
    if (error.status === 410) {
      return {
        kind:
          code === "PORTAL_INVITE_ACCEPTED"
            ? "accepted"
            : code === "PORTAL_INVITE_REVOKED"
              ? "revoked"
              : "expired",
        body: error.body,
      };
    }
  }
  return { kind: "error" };
}

/** A sentence template with `{terms}` / `{privacy}` slots rendered as links. */
function withLinks(template: string, slots: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{\w+\})/g).map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return m && m[1] in slots ? <span key={i}>{slots[m[1]]}</span> : part;
  });
}

function Shell({ children, supplier }: { children: ReactNode; supplier?: InviteInfo["supplier"] }) {
  const { t, locale } = useTranslation();
  const { setLocale } = useI18n();
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a
        href="#join-main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
      >
        {t["portal.join.skip"]}
      </a>
      <header className="flex h-14 items-center justify-between gap-3 border-b border-border bg-card px-4 sm:px-8">
        <div className="flex min-w-0 items-center gap-2.5">
          {supplier?.logoUrl ? (
            <img
              src={supplier.logoUrl}
              alt=""
              className="h-8 w-8 shrink-0 rounded-md object-cover"
            />
          ) : (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
              <Building2 className="h-4 w-4" aria-hidden="true" />
            </span>
          )}
          <span className="truncate text-small font-semibold" dir="auto">
            {supplier?.name ?? t["portal.customerPortal"]}
          </span>
        </div>
        <div
          className="flex shrink-0 items-center rounded-md border border-border p-0.5"
          role="group"
          aria-label={t["portal.join.language"]}
        >
          {(["en", "ar"] as const).map((l) => (
            <button
              key={l}
              type="button"
              lang={l}
              aria-pressed={locale === l}
              onClick={() => setLocale(l)}
              className={`min-h-9 min-w-11 rounded px-3 text-small font-medium ${
                locale === l ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              }`}
              data-testid={`join-lang-${l}`}
            >
              {l === "en" ? "EN" : "عربي"}
            </button>
          ))}
        </div>
      </header>
      <main id="join-main" className="flex flex-1 items-start justify-center px-4 py-8 sm:py-14">
        <div className="w-full max-w-[440px]">{children}</div>
      </main>
      <footer className="px-4 pb-6 text-center text-caption text-muted-foreground">
        {t["portal.join.footer"]}
      </footer>
    </div>
  );
}

export default function PortalJoin() {
  const { t, locale } = useTranslation(["portal", ...VALIDATION_NAMESPACES]);
  const { setLocale } = useI18n();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const token = useMemo(() => readToken(), []);
  const validToken = !!token && TOKEN_RE.test(token);

  const query = useQuery<InviteInfo>({
    queryKey: ["portal-invite", token],
    queryFn: () => apiRequest("GET", `/api/portal-invitations/${token}`),
    enabled: validToken,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

  // Open in the language the supplier chose (once); the toggle then stays under the visitor's control.
  const appliedLanguage = useRef(false);
  useEffect(() => {
    const lang = query.data?.language;
    if (!appliedLanguage.current && (lang === "ar" || lang === "en")) {
      appliedLanguage.current = true;
      if (lang !== locale) setLocale(lang);
    }
  }, [query.data?.language, locale, setLocale]);

  const goSignIn = (email?: string) => {
    const q = new URLSearchParams({ next: "/portal/join" });
    if (email) q.set("email", email);
    window.location.assign(`/login?${q.toString()}`);
  };

  // ── states without an invitation ──────────────────────────────────────────
  if (!validToken || query.isError) {
    const { kind, body } = !validToken ? { kind: "invalid" as StateKind, body: undefined } : classify(query.error);
    const supplier = (body?.supplier ?? null) as { name?: string; contactEmail?: string | null } | null;
    const supplierName = supplier?.name ?? t["portal.join.theSupplier"];
    const signIn = (
      <Button className="h-11" onClick={() => goSignIn()} data-testid="join-go-sign-in">
        {t["portal.join.goSignIn"]}
      </Button>
    );
    const contact = supplier?.contactEmail ? (
      <Button asChild variant="outline" className="h-11">
        <a href={`mailto:${supplier.contactEmail}`} data-testid="join-contact-supplier">
          {formatMessage(t["portal.join.emailSupplier"], { supplier: supplierName })}
        </a>
      </Button>
    ) : null;
    const states: Record<StateKind, ReactNode> = {
      loading: null,
      invalid: (
        <PortalStatePage
          icon={AlertTriangle}
          tone="danger"
          title={t["portal.join.invalidTitle"]}
          body={t["portal.join.invalidBody"]}
          actions={signIn}
          testId="join-state-invalid"
        />
      ),
      expired: (
        <PortalStatePage
          icon={Clock}
          tone="warning"
          title={t["portal.join.expiredTitle"]}
          body={formatMessage(t["portal.join.expiredBody"], { supplier: supplierName })}
          actions={
            <>
              {contact}
              {signIn}
            </>
          }
          testId="join-state-expired"
        />
      ),
      revoked: (
        <PortalStatePage
          icon={AlertTriangle}
          tone="danger"
          title={t["portal.join.revokedTitle"]}
          body={formatMessage(t["portal.join.revokedBody"], { supplier: supplierName })}
          actions={contact}
          testId="join-state-revoked"
        />
      ),
      accepted: (
        <PortalStatePage
          icon={UserRoundCheck}
          tone="success"
          title={t["portal.join.acceptedTitle"]}
          body={t["portal.join.acceptedBody"]}
          actions={signIn}
          testId="join-state-accepted"
        />
      ),
      throttled: (
        <PortalStatePage
          icon={ShieldCheck}
          tone="warning"
          title={t["portal.join.throttledTitle"]}
          body={t["portal.join.throttledBody"]}
          testId="join-state-throttled"
        />
      ),
      error: (
        <PortalStatePage
          icon={WifiOff}
          title={t["portal.join.errorTitle"]}
          body={t["portal.join.errorBody"]}
          actions={
            <Button className="h-11" onClick={() => void query.refetch()} data-testid="join-retry">
              {t["portal.join.retry"]}
            </Button>
          }
          testId="join-state-error"
        />
      ),
    };
    return <Shell>{states[kind]}</Shell>;
  }

  if (query.isPending || !query.data) {
    return (
      <Shell>
        <div className="space-y-4" data-testid="join-loading" aria-busy="true">
          <div className="mx-auto h-12 w-12 animate-pulse rounded-xl bg-muted" />
          <div className="mx-auto h-6 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-11 animate-pulse rounded bg-muted" />
          <div className="h-11 animate-pulse rounded bg-muted" />
          <p className="sr-only" role="status">
            {t["portal.join.loading"]}
          </p>
        </div>
      </Shell>
    );
  }

  const info = query.data;
  return (
    <Shell supplier={info.supplier}>
      <JoinPanel
        info={info}
        token={token!}
        onSignIn={() => goSignIn(info.email)}
        onDone={async (res) => {
          clearStoredToken();
          try {
            window.localStorage.setItem(PORTAL_WELCOME_KEY, "1");
          } catch {
            /* ignore */
          }
          if (res.user) {
            await establishAuthenticatedSession(res.user).catch(() => undefined);
          } else {
            await queryClient.invalidateQueries({ queryKey: currentUserQueryKey });
          }
          setLocation(res.redirectTo || "/client-portal/dashboard");
        }}
      />
    </Shell>
  );
}

interface AcceptResult {
  redirectTo: string;
  user?: unknown;
}

function JoinPanel({
  info,
  token,
  onSignIn,
  onDone,
}: {
  info: InviteInfo;
  token: string;
  onSignIn: () => void;
  onDone: (res: AcceptResult) => Promise<void>;
}) {
  const { t, locale } = useTranslation(["portal", ...VALIDATION_NAMESPACES]);
  const [name, setName] = useState(info.name);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field?: "name" | "password"; message: string } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const supplier = info.supplier.name;
  const customer = locale === "ar" && info.customerNameAr ? info.customerNameAr : info.customerName;
  const expires = new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn-ca-gregory" : "en-AE", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Dubai",
  }).format(new Date(info.expiresAt));
  const rulesOk = failedPasswordRules(password).length === 0;

  const accept = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = (await apiRequest(
        "POST",
        `/api/portal-invitations/${token}/accept`,
        body
      )) as AcceptResult;
      await onDone(res);
    } catch (err) {
      const api = err instanceof ApiError ? err : null;
      const code = String(api?.body?.code ?? "");
      const fields = (api?.body?.details as { fields?: Record<string, string[]> } | undefined)?.fields;
      if (api?.status === 400 && (fields?.password || /password/i.test(api.rawMessage))) {
        setError({ field: "password", message: api.message });
        requestAnimationFrame(() => passwordRef.current?.focus());
      } else if (code === "LOGIN_REQUIRED") {
        onSignIn();
        return;
      } else {
        setError({ message: api?.message ?? t["portal.join.errorBody"] });
      }
    } finally {
      setBusy(false);
    }
  };

  const submitNew = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError({ field: "name", message: t["portal.join.nameRequired"] });
      nameRef.current?.focus();
      return;
    }
    if (!rulesOk) {
      setError({ field: "password", message: t["portal.join.passwordWeak"] });
      passwordRef.current?.focus();
      return;
    }
    void accept({ name: name.trim(), password, acceptTerms: true });
  };

  const header = (
    <header className="mb-6 text-center">
      <h1 className="text-h2 text-balance" tabIndex={-1}>
        {formatMessage(t["portal.join.title"], { supplier })}
      </h1>
      <p className="mt-2 text-small text-muted-foreground text-pretty">
        {formatMessage(t["portal.join.subtitle"], { supplier, customer })}
      </p>
    </header>
  );

  if (info.account === "existing") {
    return (
      <div data-testid="join-existing">
        {header}
        <Alert tone="info" title={t["portal.join.existingTitle"]} className="mb-5">
          {formatMessage(t["portal.join.existingBody"], { email: info.email, supplier })}
        </Alert>
        <Button className="h-11 w-full" onClick={onSignIn} data-testid="join-sign-in">
          {t["portal.join.signIn"]}
        </Button>
      </div>
    );
  }

  if (info.account === "signed_in_other") {
    return (
      <div data-testid="join-other">
        {header}
        <Alert tone="danger" title={t["portal.join.otherTitle"]} className="mb-5">
          {formatMessage(t["portal.join.otherBody"], {
            email: info.email,
            current: info.signedInAs ?? "",
          })}
        </Alert>
        <Button
          className="h-11 w-full"
          variant="outline"
          onClick={async () => {
            try {
              await apiRequest("POST", "/api/auth/logout");
            } catch {
              /* cookies expire anyway */
            }
            removeToken();
            window.location.reload();
          }}
          data-testid="join-sign-out-continue"
        >
          {t["portal.join.signOutContinue"]}
        </Button>
      </div>
    );
  }

  if (info.account === "signed_in") {
    return (
      <div data-testid="join-signed-in">
        {header}
        <Alert tone="info" title={formatMessage(t["portal.join.signedInTitle"], { supplier })} className="mb-5">
          {formatMessage(t["portal.join.signedInBody"], { email: info.email, customer })}
        </Alert>
        {error ? (
          <Alert tone="danger" className="mb-4" role="alert">
            {error.message}
          </Alert>
        ) : null}
        <Button
          className="h-11 w-full"
          disabled={busy}
          onClick={() => void accept({ acceptTerms: true })}
          data-testid="join-confirm-add"
        >
          {busy ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {formatMessage(t["portal.join.confirmAdd"], { supplier })}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submitNew} noValidate data-testid="join-form">
      {header}
      {error && !error.field ? (
        <Alert tone="danger" className="mb-4" role="alert" data-testid="join-error">
          {error.message}
        </Alert>
      ) : null}

      <div className="space-y-4">
        <div>
          <Label htmlFor="join-email">{t["portal.email"]}</Label>
          <div className="mt-1.5 flex h-11 items-center gap-2 rounded-md border border-input bg-muted/40 px-3 text-small">
            <Mail className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span id="join-email" dir="ltr" className="truncate [unicode-bidi:isolate]">
              {info.email}
            </span>
          </div>
        </div>

        <div>
          <Label htmlFor="join-name">{t["portal.join.nameLabel"]}</Label>
          <Input
            id="join-name"
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            className="mt-1.5 h-11 text-base"
            aria-invalid={error?.field === "name"}
            aria-describedby={error?.field === "name" ? "join-name-error" : undefined}
            data-testid="join-name"
          />
          {error?.field === "name" ? (
            <p id="join-name-error" role="alert" className="mt-1.5 text-caption text-danger">
              {error.message}
            </p>
          ) : null}
        </div>

        <div>
          <Label htmlFor="join-password">{t["portal.join.passwordLabel"]}</Label>
          <div className="relative mt-1.5">
            <Input
              id="join-password"
              ref={passwordRef}
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              dir="ltr"
              className="h-11 pe-12 text-base"
              aria-invalid={error?.field === "password"}
              aria-describedby={
                error?.field === "password" ? "join-password-rules join-password-error" : "join-password-rules"
              }
              data-testid="join-password"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              aria-pressed={show}
              aria-label={show ? t["portal.join.hidePassword"] : t["portal.join.showPassword"]}
              className="absolute inset-y-0 end-0 grid w-11 place-items-center text-muted-foreground hover:text-foreground"
              data-testid="join-toggle-password"
            >
              {show ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
          {error?.field === "password" ? (
            <p id="join-password-error" role="alert" className="mt-1.5 text-caption text-danger">
              {error.message}
            </p>
          ) : null}
          <div className="mt-3">
            <PasswordRules password={password} id="join-password-rules" />
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Checkbox
            id="join-terms"
            checked={terms}
            onCheckedChange={(v) => setTerms(v === true)}
            className="mt-0.5 h-5 w-5"
            data-testid="join-terms"
          />
          <Label htmlFor="join-terms" className="text-small font-normal leading-snug">
            {withLinks(t["portal.join.terms"], {
              terms: (
                <Link href="/terms" className="font-medium text-accent underline" target="_blank" rel="noopener noreferrer">
                  {t["portal.join.termsLink"]}
                </Link>
              ),
              privacy: (
                <Link href="/privacy" className="font-medium text-accent underline" target="_blank" rel="noopener noreferrer">
                  {t["portal.join.privacyLink"]}
                </Link>
              ),
            })}
          </Label>
        </div>

        <Button
          type="submit"
          className="h-11 w-full"
          disabled={busy || !terms || !rulesOk || !name.trim()}
          data-testid="join-submit"
        >
          {busy ? (
            <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <LockKeyhole className="me-2 h-4 w-4" aria-hidden="true" />
          )}
          {busy ? t["portal.join.submitting"] : t["portal.join.submit"]}
        </Button>
        <p className="text-center text-caption text-muted-foreground">
          {formatMessage(t["portal.join.expiresOn"], { date: expires })}
        </p>
      </div>
    </form>
  );
}
