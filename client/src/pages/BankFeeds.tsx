import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Landmark, Loader2, PlugZap, RefreshCw, Upload } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { formatDate } from "@/lib/format-date";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatMessage, useTranslation } from "@/lib/i18n";

interface ProviderStatus {
  id: "lean" | "tarabut" | "wio";
  label: string;
  configured: boolean;
  status: "live" | "sandbox" | "requires_external" | "disabled";
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
  accountNumberLast4: string | null;
  bankAccountId: string | null;
  status: string;
  lastSyncedAt: string | null;
  lastError: string | null;
}

interface BankAccount {
  id: string;
  nameEn: string;
  nameAr?: string | null;
  bankName?: string | null;
}

const CONNECTION_TONE: Record<string, StatusTone> = {
  active: "success",
  error: "danger",
  disconnected: "neutral",
  pending: "warning",
};

/**
 * Bank feeds (spec 3.9). Customers see only what they can use: when no licensed provider is
 * available to them the page is one empty state pointing to statement import (the nav item is
 * hidden by the shell); when one is, a list of their bank accounts with Connect and the state of
 * each connection. The OAuth return (`/bank-feeds/callback`) shows a progress state and comes
 * back here. Nothing claims a connection or sync that did not happen.
 */
export default function BankFeeds() {
  const { t, locale } = useTranslation();
  const tt = t as Record<string, string>;
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { companyId } = useDefaultCompany();

  const { data: providers, isLoading: providersLoading } = useQuery<ProvidersResponse>({
    queryKey: ["/api/bank/providers"],
  });
  const { data: connections } = useQuery<Connection[]>({
    queryKey: ["/api/companies", companyId, "bank-connections"],
    enabled: !!companyId,
  });
  const { data: accounts, isLoading: accountsLoading } = useQuery<BankAccount[]>({
    queryKey: ["/api/companies", companyId, "bank-accounts"],
    enabled: !!companyId,
  });
  const onError = (err: Error) =>
    toast({ variant: "destructive", title: tt["banking.common.error"], description: err?.message });

  // OAuth return: /bank-feeds/callback?code=...&state=...&provider=...
  const [returning] = useState(() => {
    if (typeof window === "undefined") return false;
    const q = new URLSearchParams(window.location.search);
    return Boolean((q.get("code") ?? q.get("entity_id")) && q.get("state"));
  });
  const callbackMutation = useMutation({
    mutationFn: (p: { provider: string; code: string; state: string }) =>
      apiRequest("POST", `/api/companies/${companyId}/bank-connections/callback`, p),
    onSuccess: () => {
      toast({ title: tt["banking.feeds.callbackDone"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "bank-connections"],
      });
      navigate("/bank-feeds", { replace: true });
    },
    onError: (err: Error) => {
      onError(err);
      navigate("/bank-feeds", { replace: true });
    },
  });
  useEffect(() => {
    if (!companyId || !returning) return;
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
    mutationFn: ({ provider, bankAccountId }: { provider: string; bankAccountId: string }) =>
      apiRequest("POST", `/api/companies/${companyId}/bank-connections/connect`, {
        provider,
        redirectUrl: providers?.redirectUris[0] ?? "",
        bankAccountId,
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
      toast({ title: tt["banking.feeds.synced"], description: `${r.imported} / ${r.fetched}` });
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "bank-connections"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "bank-statements"] });
    },
    onError,
  });

  const available = useMemo(
    () => (providers?.statuses ?? []).filter((p) => p.configured),
    [providers?.statuses]
  );
  const noProvider = !providersLoading && available.length === 0;
  const connectionFor = (accountId: string) =>
    (connections ?? []).find((c) => c.provider !== "manual" && c.bankAccountId === accountId);

  const header = (
    <PageHeader
      eyebrow={tt["shell.nav.banking"]}
      title={tt[noProvider ? "banking.feeds.unavailableTitle" : "banking.feeds.title"]}
    />
  );

  if (returning) {
    return (
      <div
        className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center"
        role="status"
      >
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
        <h1 className="text-h2 text-foreground">{tt["banking.feeds.connecting"]}</h1>
        <p className="text-small text-muted-foreground">{tt["banking.feeds.connectingBody"]}</p>
      </div>
    );
  }

  if (providersLoading || accountsLoading) {
    return (
      <div className="space-y-6">
        {header}
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (noProvider) {
    return (
      <div className="space-y-6">
        {header}
        <Card>
          <EmptyState
            size="md"
            icon={Landmark}
            title={tt["banking.recon.importStatement"]}
            description={tt["banking.feeds.unavailableBody"]}
            action={{
              label: tt["banking.feeds.importStatement"],
              href: "/bank-reconciliation?import=1",
              icon: Upload,
              testId: "button-feeds-import-statement",
            }}
          />
        </Card>
      </div>
    );
  }

  if ((accounts ?? []).length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <Card>
          <EmptyState
            size="md"
            icon={Landmark}
            title={tt["banking.feeds.noAccountsTitle"]}
            description={tt["banking.feeds.noAccountsBody"]}
            action={{ label: tt["banking.feeds.addAccount"], href: "/bank-accounts" }}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      <Card className="overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-h3 text-foreground">{tt["banking.feeds.accountsTitle"]}</h2>
          <p className="text-small text-muted-foreground">{tt["banking.feeds.accountsBody"]}</p>
        </div>
        <ul className="divide-hairline">
          {(accounts ?? []).map((account) => {
            const connection = connectionFor(account.id);
            const name = locale === "ar" && account.nameAr ? account.nameAr : account.nameEn;
            return (
              <li
                key={account.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                data-testid={`bank-feed-account-${account.id}`}
              >
                <div className="min-w-0">
                  <div dir="auto" className="truncate text-small font-medium text-foreground">
                    {name}
                  </div>
                  <div className="text-caption text-muted-foreground">
                    {connection
                      ? connection.lastSyncedAt
                        ? formatMessage(tt["banking.feeds.lastSync"], {
                            date: formatDate(connection.lastSyncedAt, locale),
                          })
                        : tt["banking.feeds.neverSynced"]
                      : (account.bankName ?? "")}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {connection ? (
                    <>
                      <StatusBadge tone={CONNECTION_TONE[connection.status] ?? "neutral"}>
                        {tt[`banking.feeds.status.${connection.status}`] ??
                          tt["banking.feeds.status.pending"]}
                      </StatusBadge>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => syncMutation.mutate(connection.id)}
                        disabled={syncMutation.isPending}
                      >
                        <RefreshCw aria-hidden />
                        {tt["banking.feeds.sync"]}
                      </Button>
                    </>
                  ) : available.length === 1 ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={connectMutation.isPending}
                      onClick={() =>
                        connectMutation.mutate({
                          provider: available[0].id,
                          bankAccountId: account.id,
                        })
                      }
                      data-testid={`button-connect-${account.id}`}
                    >
                      <PlugZap aria-hidden />
                      {tt["banking.feeds.connectWith"]}
                    </Button>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid={`button-connect-${account.id}`}
                        >
                          <PlugZap aria-hidden />
                          {tt["banking.feeds.connectWith"]}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {available.map((p) => (
                          <DropdownMenuItem
                            key={p.id}
                            onSelect={() =>
                              connectMutation.mutate({ provider: p.id, bankAccountId: account.id })
                            }
                          >
                            {p.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
