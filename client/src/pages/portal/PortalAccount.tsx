import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, Languages, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ChangePasswordCard } from "@/pages/security/ChangePasswordCard";
import { currentUserQueryKey, useCurrentUser } from "@/hooks/useCurrentUser";
import { useSessionActions } from "@/hooks/useSessionActions";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { getSelectedPortalAccount, setSelectedPortalAccount } from "@/lib/auth";
import { useI18n, useTranslation } from "@/lib/i18n";

interface PortalAccountRow {
  id: string;
  company: { id: string; name: string; logoUrl: string | null };
  customer: { id: string; name: string; nameAr: string | null };
}

/**
 * The customer's own account: who they are, their language, password, every device, and the
 * suppliers whose portals they can open. Sign-out here clears the server session.
 */
export default function PortalAccount() {
  const { t, locale } = useTranslation();
  const { setLocale } = useI18n();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { signOut } = useSessionActions();
  const { data: user } = useCurrentUser();
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  // The display name is the one profile field a customer may change (email is theirs by invitation).
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? user?.name ?? "";
  const setName = setDraft;
  const [savingName, setSavingName] = useState(false);
  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    const next = name.trim();
    if (!next || next === user?.name) return;
    setSavingName(true);
    try {
      await apiRequest("PATCH", "/api/client-portal/profile", { name: next });
      await queryClient.invalidateQueries({ queryKey: currentUserQueryKey });
      setDraft(null);
      toast({ title: t["portal.account.nameSaved"] });
    } catch (err) {
      toast({
        title: err instanceof ApiError ? err.message : t["portal.account.nameFailed"],
        variant: "destructive",
      });
    } finally {
      setSavingName(false);
    }
  };
  const { data: accounts = [] } = useQuery<PortalAccountRow[]>({
    queryKey: ["portal-accounts"],
    queryFn: () => apiRequest("GET", "/api/client-portal/accounts"),
    staleTime: 5 * 60 * 1000,
  });
  const selected = getSelectedPortalAccount();
  const current = accounts.find((a) => a.id === selected) ?? accounts[0];

  const signOutEverywhere = async () => {
    setBusy(true);
    try {
      await apiRequest("POST", "/api/auth/logout-all", {});
    } catch {
      /* the local sign-out below still ends this device */
    }
    await signOut();
    navigate("/login");
  };

  return (
    <div className="mx-auto max-w-[720px] space-y-6" data-testid="portal-account-page">
      <PageHeader title={t["portal.account.title"]} description={t["portal.account.subtitle"]} />

      <Card>
        <CardHeader>
          <CardTitle className="text-h3">{t["portal.account.profile"]}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            onSubmit={(e) => void saveName(e)}
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            data-testid="portal-name-form"
          >
            <div className="min-w-0 flex-1">
              <Label htmlFor="portal-account-name">{t["portal.join.nameLabel"]}</Label>
              <Input
                id="portal-account-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                autoComplete="name"
                dir="auto"
                className="mt-1.5 h-11 text-base"
                data-testid="portal-account-name"
              />
            </div>
            <Button
              type="submit"
              className="min-h-11"
              disabled={savingName || !name.trim() || name.trim() === user?.name}
              data-testid="portal-account-name-save"
            >
              {t["portal.account.saveName"]}
            </Button>
          </form>
          <dl>
            <div>
              <dt className="text-caption text-muted-foreground">{t["portal.email"]}</dt>
              <dd className="mt-0.5 break-all text-small font-medium" dir="ltr">
                {user?.email ?? "—"}
              </dd>
            </div>
          </dl>
          <div>
            <p className="text-caption text-muted-foreground">{t["portal.account.language"]}</p>
            <div
              className="mt-1.5 inline-flex rounded-md border border-border p-0.5"
              role="group"
              aria-label={t["portal.account.language"]}
            >
              {(["en", "ar"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  lang={l}
                  aria-pressed={locale === l}
                  onClick={() => setLocale(l)}
                  className={`flex min-h-11 min-w-20 items-center justify-center gap-1.5 rounded px-4 text-small font-medium ${
                    locale === l ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                  }`}
                  data-testid={`account-lang-${l}`}
                >
                  <Languages className="h-4 w-4" aria-hidden />
                  {l === "en" ? "English" : "العربية"}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <ChangePasswordCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-h3">{t["portal.account.suppliers"]}</CardTitle>
          <CardDescription>{t["portal.account.suppliersHint"]}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border" data-testid="portal-account-suppliers">
            {accounts.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-3">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
                    <Building2 className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-small font-medium" dir="auto">
                      {a.company.name}
                    </span>
                    <span className="block truncate text-caption text-muted-foreground" dir="auto">
                      {locale === "ar" && a.customer.nameAr ? a.customer.nameAr : a.customer.name}
                    </span>
                  </span>
                </span>
                {a.id === current?.id ? (
                  <span className="flex shrink-0 items-center gap-1 text-caption font-medium text-success">
                    <Check className="h-4 w-4" aria-hidden />
                    {t["portal.account.current"]}
                  </span>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11"
                    onClick={() => {
                      setSelectedPortalAccount(a.id);
                      queryClient.removeQueries({
                        predicate: (q) => String(q.queryKey[0]).startsWith("portal-"),
                      });
                      navigate("/client-portal/dashboard");
                    }}
                  >
                    {t["portal.account.open"]}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-h3">{t["portal.account.devices"]}</CardTitle>
          <CardDescription>{t["portal.account.devicesHint"]}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          <Button
            variant="outline"
            className="min-h-11"
            disabled={busy}
            onClick={() => void signOutEverywhere()}
            data-testid="portal-sign-out-all"
          >
            <LogOut className="me-2 h-4 w-4 rtl:-scale-x-100" aria-hidden />
            {t["portal.account.signOutAll"]}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
