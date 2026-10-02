import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Landmark, Loader2, PlugZap, RefreshCw, Unplug } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isLiveFeed, type BankAccount, type LeanSession, type ProviderAccount, type ProvidersResponse, type PublicBankConnection, type SyncResult } from "@/lib/banking-api-types";
import { messages } from "./BankFeedsPanel.i18n";
import { messages as common } from "./BankingCommon.i18n";
import { bankKey, bankingErrorText } from "./banking-common";
import { openLeanLink } from "./lean-link";

interface Props {
  companyId: string;
  bankAccounts: BankAccount[];
  providers: ProvidersResponse;
}

interface LinkState {
  state: string;
  entityId: string;
  accounts: ProviderAccount[];
}

export function BankFeedsPanel({ companyId, bankAccounts, providers }: Props) {
  const tr = messages.useT();
  const trc = common.useT();
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const [link, setLink] = useState<LinkState | null>(null);
  const [externalId, setExternalId] = useState("");
  const [ledgerId, setLedgerId] = useState("");
  const [autoSync, setAutoSync] = useState(true);
  const [toDisconnect, setToDisconnect] = useState<PublicBankConnection | null>(null);

  const connectionsKey = ["/api/companies", companyId, "bank-connections"];
  const { data: connections, isLoading } = useQuery<PublicBankConnection[]>({ queryKey: connectionsKey, enabled: !!companyId });
  const feeds = (connections ?? []).filter(isLiveFeed);
  const failure = (title: string) => (err: unknown) => toast({ variant: "destructive", title, description: bankingErrorText(trc, err, locale) });

  const startLink = useMutation({
    mutationFn: async () => {
      const session = (await apiRequest("POST", `/api/companies/${companyId}/bank-feeds/lean/session`)) as LeanSession;
      const result = await openLeanLink(session);
      if (result.status !== "SUCCESS") return { cancelled: true as const };
      // The server finds the bank login Link just created for this company; the browser sends only the signed state.
      const path = `/api/companies/${companyId}/bank-feeds/lean/accounts`;
      let found = (await apiRequest("POST", path, { state: session.state })) as { entityId?: string; accounts?: ProviderAccount[]; entities?: Array<{ id: string }> };
      if (!found.accounts && found.entities?.length) {
        found = (await apiRequest("POST", path, { state: session.state, entityId: found.entities[0].id })) as typeof found;
      }
      if (!found.entityId || !found.accounts) throw new Error(tr("linkNoEntity"));
      return { cancelled: false as const, state: session.state, entityId: found.entityId, accounts: found.accounts };
    },
    onSuccess: (r) => {
      if (r.cancelled) {
        toast({ title: tr("linkCancelled") });
        return;
      }
      setLink({ state: r.state, entityId: r.entityId, accounts: r.accounts });
      setExternalId(r.accounts[0]?.externalId ?? "");
      setLedgerId("");
    },
    onError: (err: unknown) => {
      const message = err instanceof Error && /Lean SDK/.test(err.message) ? tr("linkSdkFailed") : bankingErrorText(trc, err, locale);
      toast({ variant: "destructive", title: tr("linkFailed"), description: message });
    },
  });

  const saveLink = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/bank-feeds/connections`, { state: link!.state, entityId: link!.entityId, externalAccountId: externalId, bankAccountId: ledgerId, autoSync }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: connectionsKey });
      setLink(null);
      toast({ title: tr("linkDone") });
    },
    onError: failure(tr("linkFailed")),
  });

  const sync = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/bank-connections/${id}/sync`, {})) as SyncResult,
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: connectionsKey });
      queryClient.invalidateQueries({ queryKey: bankKey(companyId) });
      toast({ title: tr("syncDone"), description: tr("syncDoneBody", { imported: r.imported, duplicates: r.duplicates }) });
    },
    onError: (err: unknown) => {
      queryClient.invalidateQueries({ queryKey: connectionsKey });
      failure(tr("syncFailed"))(err);
    },
  });

  const disconnect = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/bank-connections/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: connectionsKey });
      setToDisconnect(null);
      toast({ title: tr("disconnected") });
    },
    onError: failure(tr("disconnectFailed")),
  });

  const chosen = link?.accounts.find((a) => a.externalId === externalId);
  const ledgerOptions = bankAccounts.filter((b) => b.isActive && (!chosen || b.currency.toUpperCase() === chosen.currency.toUpperCase()));
  const sandbox = providers.environment === "sandbox";

  return (
    <div className="space-y-4" data-testid="bank-feeds-panel">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Landmark className="h-5 w-5" />
                {tr("title")}
                {sandbox && <StatusBadge tone="warning">{tr("sandboxBadge")}</StatusBadge>}
              </CardTitle>
              <CardDescription>{tr("intro")}</CardDescription>
            </div>
            <Button onClick={() => startLink.mutate()} disabled={startLink.isPending} data-testid="button-connect-bank">
              {startLink.isPending ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <PlugZap className="h-4 w-4 me-2" />}
              {startLink.isPending ? tr("connecting") : tr("connect")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm font-medium">{tr("connectedTitle")}</p>
          {isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : feeds.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="feeds-empty">
              {tr("noConnections")}
            </p>
          ) : (
            <ul className="space-y-3">
              {feeds.map((c) => {
                const ledger = bankAccounts.find((b) => b.id === c.bankAccountId);
                return (
                  <li key={c.id} className="rounded-lg border p-3 space-y-2" data-testid={`feed-${c.id}`}>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 space-y-0.5">
                        <p className="font-medium" dir="auto">
                          {c.bankName || c.provider} {c.accountName ? `- ${c.accountName}` : ""}
                          {c.accountNumberLast4 ? ` ****${c.accountNumberLast4}` : ""}
                        </p>
                        {ledger && <p className="text-xs text-muted-foreground">{tr("ledgerAccount", { name: ledger.nameEn })}</p>}
                        <p className="text-xs text-muted-foreground">{c.lastSyncedAt ? tr("lastSynced", { when: formatDate(c.lastSyncedAt, locale, { dateStyle: "medium", timeStyle: "short" } as Intl.DateTimeFormatOptions) }) : tr("neverSynced")}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {c.environment === "sandbox" && <StatusBadge tone="warning">{tr("sandboxConnection")}</StatusBadge>}
                        <StatusBadge tone={c.status === "active" ? "success" : "danger"}>{c.status === "active" ? tr("statusActive") : tr("statusError")}</StatusBadge>
                      </div>
                    </div>
                    {c.consecutiveFailures >= 3 && <p className="text-xs text-destructive">{tr("failedSyncs", { count: c.consecutiveFailures })}</p>}
                    {c.lastError && c.status !== "active" && (
                      <p className="text-xs text-destructive" dir="auto">
                        {tr("lastError", { error: c.lastError })}
                      </p>
                    )}
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <span className="text-xs text-muted-foreground">
                        {tr("autoSync")}: {c.autoSync ? tr("autoOn") : tr("autoOff")}
                      </span>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => sync.mutate(c.id)} disabled={sync.isPending} data-testid={`button-sync-${c.id}`}>
                          {sync.isPending && sync.variables === c.id ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <RefreshCw className="h-4 w-4 me-2" />}
                          {sync.isPending && sync.variables === c.id ? tr("syncing") : tr("syncNow")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setToDisconnect(c)} data-testid={`button-disconnect-${c.id}`}>
                          <Unplug className="h-4 w-4 me-2" />
                          {tr("disconnect")}
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!link} onOpenChange={(open) => !open && setLink(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tr("linkTitle")}</DialogTitle>
            <DialogDescription>{tr("linkDescription")}</DialogDescription>
          </DialogHeader>
          {link && link.accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tr("linkNoAccounts")}</p>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>{tr("linkAccounts")}</Label>
                <Select value={externalId} onValueChange={(v) => { setExternalId(v); setLedgerId(""); }}>
                  <SelectTrigger data-testid="select-provider-account">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {link?.accounts.map((a) => (
                      <SelectItem key={a.externalId} value={a.externalId}>
                        {a.name || a.iban || a.externalId} ({a.currency})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{tr("linkLedger")}</Label>
                <Select value={ledgerId} onValueChange={setLedgerId}>
                  <SelectTrigger data-testid="select-ledger-account">
                    <SelectValue placeholder={tr("linkSelectLedger")} />
                  </SelectTrigger>
                  <SelectContent>
                    {ledgerOptions.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.nameEn} ({b.currency})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {chosen && <p className="text-xs text-muted-foreground">{tr("currencyHint", { currency: chosen.currency })}</p>}
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="link-auto">{tr("linkAuto")}</Label>
                <Switch id="link-auto" checked={autoSync} onCheckedChange={setAutoSync} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLink(null)}>
              {tr("cancel")}
            </Button>
            <Button onClick={() => saveLink.mutate()} disabled={!externalId || !ledgerId || saveLink.isPending} data-testid="button-save-link">
              {saveLink.isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
              {saveLink.isPending ? tr("linkSaving") : tr("linkSave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDisconnect} onOpenChange={(open) => !open && setToDisconnect(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("disconnectTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{tr("disconnectBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDisconnect && disconnect.mutate(toDisconnect.id)}>{tr("disconnectConfirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
