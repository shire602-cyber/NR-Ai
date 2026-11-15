import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Landmark, PlugZap, RefreshCw } from "lucide-react";

interface ProviderStatus {
  id: "lean" | "tarabut" | "wio";
  label: string;
  configured: boolean;
  status: "live" | "sandbox" | "requires_external" | "disabled";
  message: { en: string; ar: string };
  externalAction: { en: string; ar: string };
}

interface ProvidersResponse {
  isConfigured: boolean;
  statuses: ProviderStatus[];
  redirectUris: string[];
}

interface Connection {
  id: string;
  provider: string;
  bankName: string | null;
  accountName: string | null;
  accountNumberLast4: string | null;
  bankAccountId: string | null;
  status: string;
  lastSyncedAt: string | null;
  lastError: string | null;
}

interface BankAccount {
  id: string;
  nameEn: string;
}

/**
 * Bank feeds (R06-19). Status comes from the server's capability registry: a provider without a
 * contract and credentials shows "Not connected — requires provider contract" and cannot start a
 * connection. Nothing here claims a connection or sync that did not happen.
 */
export default function BankFeeds() {
  const { t, locale } = useTranslation();
  const tr = (k: string) => t[k] ?? k;
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  const [targetAccount, setTargetAccount] = useState("");

  const { data: providers } = useQuery<ProvidersResponse>({ queryKey: ["/api/bank/providers"] });
  const { data: connections } = useQuery<Connection[]>({
    queryKey: ["/api/companies", companyId, "bank-connections"],
    enabled: !!companyId,
  });
  const { data: accounts } = useQuery<BankAccount[]>({
    queryKey: ["/api/companies", companyId, "bank-accounts"],
    enabled: !!companyId,
  });
  const onError = (err: Error) =>
    toast({ variant: "destructive", title: tr("banking.common.error"), description: err?.message });

  // OAuth return: /bank-feeds/callback?code=...&state=...&provider=...
  const callbackMutation = useMutation({
    mutationFn: (p: { provider: string; code: string; state: string }) =>
      apiRequest("POST", `/api/companies/${companyId}/bank-connections/callback`, p),
    onSuccess: () => {
      toast({ title: tr("banking.feeds.callbackDone") });
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "bank-connections"],
      });
      window.history.replaceState({}, "", "/bank-feeds");
    },
    onError,
  });
  useEffect(() => {
    if (!companyId) return;
    const q = new URLSearchParams(window.location.search);
    const code = q.get("code") ?? q.get("entity_id");
    const state = q.get("state");
    const provider = q.get("provider") ?? sessionStorage.getItem("bankFeedProvider");
    if (code && state && provider && !callbackMutation.isPending && !callbackMutation.isSuccess) {
      callbackMutation.mutate({ provider, code, state });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const connectMutation = useMutation({
    mutationFn: (provider: string) =>
      apiRequest("POST", `/api/companies/${companyId}/bank-connections/connect`, {
        provider,
        redirectUrl: providers?.redirectUris[0] ?? "",
        ...(targetAccount ? { bankAccountId: targetAccount } : {}),
      }),
    onSuccess: (r: { authUrl: string; provider: string }) => {
      sessionStorage.setItem("bankFeedProvider", r.provider);
      window.location.assign(r.authUrl);
    },
    onError,
  });

  const syncMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/bank-connections/${id}/sync`, {}),
    onSuccess: (r: { imported: number; fetched: number }) => {
      toast({ title: tr("banking.feeds.synced"), description: `${r.imported} / ${r.fetched}` });
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "bank-connections"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "bank-statements"] });
    },
    onError,
  });

  const lang = locale === "ar" ? "ar" : "en";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={tr("banking.accounts.title")}
        title={tr("banking.feeds.title")}
        description={tr("banking.feeds.description")}
      />

      <div className="max-w-sm">
        <Label>{tr("banking.feeds.linkAccount")}</Label>
        <Select value={targetAccount} onValueChange={setTargetAccount}>
          <SelectTrigger>
            <SelectValue placeholder={tr("banking.feeds.linkAccount")} />
          </SelectTrigger>
          <SelectContent>
            {(accounts ?? []).map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.nameEn}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(providers?.statuses ?? []).map((p) => (
          <Card key={p.id} data-testid={`bank-feed-provider-${p.id}`}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Landmark className="w-4 h-4" />
                {p.label}
              </CardTitle>
              <CardDescription>
                {p.configured ? (
                  <Badge variant={p.status === "live" ? "default" : "outline"}>
                    {p.status === "live"
                      ? tr("banking.feeds.statusLive")
                      : tr("banking.feeds.statusSandbox")}
                  </Badge>
                ) : (
                  <Badge variant="outline">{tr("banking.feeds.notConnected")}</Badge>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground">{p.message[lang]}</p>
              {!p.configured && (
                <p className="text-xs">
                  <span className="font-medium">{tr("banking.feeds.whatIsNeeded")}: </span>
                  {p.externalAction[lang]}
                </p>
              )}
              <Button
                size="sm"
                disabled={!p.configured || !companyId || connectMutation.isPending}
                onClick={() => connectMutation.mutate(p.id)}
              >
                <PlugZap className="w-4 h-4 me-1" />
                {tr("banking.feeds.connect")}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tr("banking.feeds.connections")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(connections ?? []).filter((c) => c.provider !== "manual").length === 0 ? (
            <p className="text-sm text-muted-foreground">{tr("banking.feeds.noConnections")}</p>
          ) : (
            (connections ?? [])
              .filter((c) => c.provider !== "manual")
              .map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-3 border rounded-md p-3"
                >
                  <div className="text-sm">
                    <p className="font-medium">
                      {c.bankName ?? c.provider}{" "}
                      {c.accountNumberLast4 ? `••${c.accountNumberLast4}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {tr("banking.feeds.lastSynced")}:{" "}
                      {c.lastSyncedAt?.slice(0, 16) ?? tr("banking.feeds.never")}
                    </p>
                    {c.lastError && <p className="text-xs text-destructive">{c.lastError}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={c.status === "active" ? "default" : "destructive"}>
                      {c.status}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => syncMutation.mutate(c.id)}
                      disabled={syncMutation.isPending}
                    >
                      <RefreshCw className="w-4 h-4 me-1" />
                      {tr("banking.feeds.sync")}
                    </Button>
                  </div>
                </div>
              ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
