import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { RegisterForm } from "@/components/auth/RegisterForm";
import { SignupPlanStep } from "@/components/auth/SignupPlanStep";
import {
  applySignupChange,
  readSignupPlan,
  signupPlanUrl,
  type SignupPlanState,
} from "@/components/auth/signup-plan";
import { TurnstileWidget } from "@/components/security/TurnstileWidget";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { fetchCurrentUser } from "@/lib/auth";
import { hasAuthHint } from "@/lib/authHint";
import { establishAuthenticatedSession } from "@/lib/authSession";
import { setActiveCompanyIdRaw } from "@/lib/activeCompany";
import { apiRequest } from "@/lib/queryClient";
import { apiUrl } from "@/lib/api";
import { formatMessage, useTranslation } from "@/lib/i18n";
import {
  AUTH_BUTTON,
  AUTH_INPUT,
  AuthAlert,
  AuthHeader,
  AuthState,
} from "@/components/auth/AuthBlocks";
import { MailX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PaidPlanId } from "@shared/plans";
import { COMPANY_ROLE_LABELS, type CompanyRole } from "@shared/permissions";

type Bilingual = { en: string; ar: string };

const COPY = {
  checkInbox: {
    en: "If this email can be used, your account is ready. If you already have an account, sign in instead or reset your password.",
    ar: "إذا كان يمكن استخدام هذا البريد فحسابك جاهز. إذا كان لديك حساب بالفعل، سجّل الدخول أو أعد تعيين كلمة المرور.",
  },
  inviteTitle: { en: "Join your team", ar: "انضم إلى فريقك" },
  inviteBody: { en: "You were invited to join", ar: "تمت دعوتك للانضمام إلى" },
  asRole: { en: "as", ar: "بدور" },
  name: { en: "Your name", ar: "اسمك" },
  password: { en: "Choose a password", ar: "اختر كلمة مرور" },
  passwordHint: {
    en: "8+ characters with upper and lower case and a digit; common passwords are refused.",
    ar: "8 أحرف أو أكثر مع أحرف كبيرة وصغيرة ورقم؛ تُرفض كلمات المرور الشائعة.",
  },
  accept: { en: "Accept invitation", ar: "قبول الدعوة" },
  signInFirst: {
    en: "An account already exists for this email. Sign in with it and you join the company straight away.",
    ar: "يوجد حساب لهذا البريد. سجّل الدخول به وستنضم إلى الشركة مباشرة.",
  },
  signIn: { en: "Sign in", ar: "تسجيل الدخول" },
  invalidTitle: { en: "This invitation has expired", ar: "انتهت صلاحية هذه الدعوة" },
  invalid: {
    en: "This invitation is no longer valid. Ask the person who invited you to resend it.",
    ar: "هذه الدعوة لم تعد صالحة. اطلب من الشخص الذي دعاك إعادة إرسالها.",
  },
} satisfies Record<string, Bilingual>;

interface InvitationPreview {
  email: string;
  role: CompanyRole;
  company: { id: string; name: string } | null;
  accountExists: boolean;
}

/**
 * Two invitation systems share this screen:
 *  - "team": company team invitations (`?teamInvite=`, /api/team-invitations/*)
 *  - "admin": admin-created client invitations (`?invite=`, /api/invitations/*), which always
 *    create a new account for the invited address.
 */
type InviteKind = "team" | "admin";

function InviteAccept({ token, kind }: { token: string; kind: InviteKind }) {
  const { locale } = useTranslation();
  const tr = (b: Bilingual) => (locale === "ar" ? b.ar : b.en);
  const [, setLocation] = useLocation();
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const previewUrl =
      kind === "admin"
        ? `/api/invitations/verify/${encodeURIComponent(token)}`
        : `/api/team-invitations/${encodeURIComponent(token)}`;
    fetch(apiUrl(previewUrl), { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) return setInvalid(true);
        const body = await r.json();
        // Admin invitations come back without `accountExists`; the invited client becomes
        // the owner of the company view, so label the role accordingly.
        setPreview(kind === "admin" ? { ...body, role: "owner", accountExists: false } : body);
      })
      .catch(() => setInvalid(true));
    fetchCurrentUser()
      .then((u) => setSignedIn(!!u))
      .catch(() => undefined);
  }, [token, kind]);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const acceptUrl =
        kind === "admin"
          ? `/api/invitations/accept/${encodeURIComponent(token)}`
          : `/api/team-invitations/${encodeURIComponent(token)}/accept`;
      const result = await apiRequest(
        "POST",
        acceptUrl,
        preview?.accountExists ? {} : { name, password }
      );
      const currentUser = result?.user ? await establishAuthenticatedSession(result.user) : null;
      // E3 (J4-r3): open the company the person just joined.
      if (typeof result?.companyId === "string") setActiveCompanyIdRaw(result.companyId);
      setLocation(
        currentUser?.userType === "client_portal" ? "/client-portal/dashboard" : "/dashboard"
      );
    } catch (err) {
      setError((err as Error)?.message ?? null);
    } finally {
      setBusy(false);
    }
  };

  // E3 (J4-r3): an existing account signs in and comes straight back here (`accept=1`); the
  // invitation is then accepted without opening the link again.
  const inviteParam = kind === "admin" ? "invite" : "teamInvite";
  const returnPath = `/register?${inviteParam}=${encodeURIComponent(token)}&accept=1`;
  const signInHref = `/login?next=${encodeURIComponent(returnPath)}`;
  const autoAccept =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("accept") === "1";
  const autoTried = useRef(false);
  useEffect(() => {
    if (!autoAccept || autoTried.current || !preview?.accountExists || !signedIn) return;
    autoTried.current = true;
    void accept();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAccept, preview, signedIn]);

  if (invalid) {
    return (
      <AuthState
        icon={MailX}
        testId="text-invite-invalid"
        title={tr(COPY.invalidTitle)}
        body={tr(COPY.invalid)}
        actions={
          <Button className="h-11" onClick={() => setLocation("/login")}>
            {tr(COPY.signIn)}
          </Button>
        }
      />
    );
  }
  if (!preview) return null;
  const roleLabel = tr(COMPANY_ROLE_LABELS[preview.role] ?? COMPANY_ROLE_LABELS.employee);
  const needsSignIn = preview.accountExists && !signedIn;

  return (
    <div className="w-full" data-testid="card-team-invite">
      <AuthHeader
        title={tr(COPY.inviteTitle)}
        description={
          <>
            {tr(COPY.inviteBody)}{" "}
            <strong className="text-foreground">{preview.company?.name}</strong> {tr(COPY.asRole)}{" "}
            {roleLabel} (<bdi>{preview.email}</bdi>)
          </>
        }
      />
      {error && <AuthAlert tone="danger">{error}</AuthAlert>}
      {needsSignIn ? (
        <div className="space-y-5">
          <p className="text-small">{tr(COPY.signInFirst)}</p>
          <Button
            className={AUTH_BUTTON}
            onClick={() => setLocation(signInHref)}
            data-testid="button-invite-sign-in"
          >
            {tr(COPY.signIn)}
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          {!preview.accountExists && (
            <>
              <div className="space-y-2">
                <Label htmlFor="invite-name">{tr(COPY.name)}</Label>
                <Input
                  id="invite-name"
                  autoComplete="name"
                  className={AUTH_INPUT}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  data-testid="input-invite-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-password">{tr(COPY.password)}</Label>
                <Input
                  id="invite-password"
                  type="password"
                  autoComplete="new-password"
                  className={AUTH_INPUT}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  data-testid="input-invite-password"
                />
                <p className="text-small text-muted-foreground">{tr(COPY.passwordHint)}</p>
              </div>
            </>
          )}
          <Button
            className={AUTH_BUTTON}
            onClick={accept}
            disabled={busy || (!preview.accountExists && (!name || !password))}
            data-testid="button-accept-invite"
          >
            {tr(COPY.accept)}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function Register() {
  const [, setLocation] = useLocation();
  const { locale, t } = useTranslation();
  const [notice, setNotice] = useState<string | null>(null);
  const query = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const teamInvite = query?.get("teamInvite") ?? null;
  const adminInvite = query?.get("invite") ?? null;
  const pendingInvite = teamInvite ?? adminInvite;

  // STEP4: the two sign-up steps live in the URL (Back / Forward work, a reload keeps the step).
  const [plan, setPlan] = useState<SignupPlanState>(() =>
    readSignupPlan(typeof window !== "undefined" ? window.location.search : "")
  );
  const trialOnly = plan.step === "account" && !plan.explicit;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusTarget = useRef<"heading" | "radio" | null>(null);
  const [announced, setAnnounced] = useState(false);
  // A browser that has signed in before may be signed in now: hold the step back until the
  // session answers, so a signed-in visitor is redirected without a flash of step 2.
  const [checking, setChecking] = useState(() => !pendingInvite && hasAuthHint());

  useEffect(() => {
    if (pendingInvite) return;
    fetchCurrentUser()
      .then((user) => {
        if (!user) return setChecking(false);
        if (user.userType === "client_portal") return setLocation("/client-portal/dashboard");
        // A signed-in visitor who followed a plan link goes to Settings > Billing with it chosen.
        const initial = readSignupPlan(window.location.search);
        if (initial.explicit) {
          const q = new URLSearchParams({ choose: initial.planId, cycle: initial.cycle });
          return setLocation(`/subscription?${q.toString()}`);
        }
        setLocation("/dashboard");
      })
      .catch(() => setChecking(false));
  }, [setLocation, pendingInvite]);

  // A deep link from /pricing lands on step 2: record the step in the URL without a new entry.
  useEffect(() => {
    if (pendingInvite) return;
    const initial = readSignupPlan(window.location.search);
    if (initial.explicit && !new URLSearchParams(window.location.search).has("step")) {
      window.history.replaceState(
        null,
        "",
        signupPlanUrl(initial.planId, initial.cycle, { step: "account", source: initial.source })
      );
    }
  }, [pendingInvite]);

  useEffect(() => {
    const onPop = () => {
      const next = readSignupPlan(window.location.search);
      // Forward into step 2 has no radio: focus its heading. Back into step 1 focuses the radio.
      focusTarget.current = next.step === "account" ? "heading" : "radio";
      setAnnounced(true);
      setPlan(next);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const goToStep = useCallback((next: SignupPlanState, target: "heading" | "radio") => {
    focusTarget.current = target;
    setAnnounced(true);
    // Keep the selection on the step being left, so Back returns to it as it was.
    window.history.replaceState(
      null,
      "",
      signupPlanUrl(next.planId, next.cycle, {
        step: next.step === "account" ? "plan" : "account",
        source: next.source,
      })
    );
    window.history.pushState(
      null,
      "",
      signupPlanUrl(next.planId, next.cycle, { step: next.step, source: next.source })
    );
    setPlan({ ...next, explicit: true });
  }, []);

  // Step change: move focus (heading on Continue, the selected radio on Change / Back).
  useEffect(() => {
    if (!focusTarget.current) return;
    const target = focusTarget.current;
    focusTarget.current = null;
    const root = document.getElementById("main-content");
    if (target === "radio") {
      root?.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.focus();
    } else {
      const h1 = root?.querySelector<HTMLElement>("h1");
      if (h1) {
        h1.tabIndex = -1;
        h1.focus();
      }
    }
  }, [plan]);

  // Polite announcement of the new step (after the first change only).
  const announce = announced
    ? formatMessage(t["marketing.signupStepAnnounce"], {
        n: plan.step === "plan" ? 1 : 2,
        title: t[plan.step === "plan" ? "marketing.signupPlanTitle" : "components.authStartBooks"],
      })
    : "";

  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  const handleSuccess = async (user: any) => {
    // R17-14: an email that is already registered gets a generic answer with
    // no session; tell the person what to do instead of failing silently.
    if (!user) {
      setNotice(locale === "ar" ? COPY.checkInbox.ar : COPY.checkInbox.en);
      return;
    }
    const currentUser = await establishAuthenticatedSession(user);
    setLocation(
      currentUser?.userType === "client_portal" ? "/client-portal/dashboard" : "/dashboard"
    );
  };

  return (
    <AuthLayout variant="register">
      <p role="status" aria-live="polite" className="sr-only" data-testid="signup-live">
        {announce}
      </p>
      {pendingInvite ? (
        <InviteAccept token={pendingInvite} kind={teamInvite ? "team" : "admin"} />
      ) : checking ? (
        <div className="min-h-[40vh]" aria-busy="true" data-testid="register-session-check" />
      ) : plan.step === "plan" ? (
        <SignupPlanStep
          ref={headingRef}
          planId={plan.planId}
          cycle={plan.cycle}
          onPlanChange={(planId) =>
            setPlan(applySignupChange(plan, { planId: planId as PaidPlanId }))
          }
          onCycleChange={(cycle) => setPlan(applySignupChange(plan, { cycle }))}
          onContinue={() => goToStep({ ...plan, step: "account" }, "heading")}
        />
      ) : (
        <div className="w-full">
          {notice && (
            <AuthAlert tone="info" testId="text-register-notice">
              {notice}
            </AuthAlert>
          )}
          <RegisterForm
            onSuccess={handleSuccess}
            captchaToken={captchaToken}
            captcha={<TurnstileWidget onToken={setCaptchaToken} />}
            plan={
              trialOnly
                ? undefined
                : { planId: plan.planId, cycle: plan.cycle, source: plan.source }
            }
            onChangePlan={
              trialOnly ? undefined : () => goToStep({ ...plan, step: "plan" }, "radio")
            }
          />
        </div>
      )}
    </AuthLayout>
  );
}
