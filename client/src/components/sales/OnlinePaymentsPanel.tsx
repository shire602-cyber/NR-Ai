import { useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CreditCard, Link2Off, Loader2, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useCompanyRole } from "@/hooks/useCompanyRole";
import { useTranslation } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { salesErrorMessage, salesKeys, stripeReturnState, type GatewayStatus } from "@/lib/sales-api";
import { messages } from "./SalesShared.i18n";

/**
 * Online payments (Stripe Connect). Three honest states: not configured on this server (no keys), configured but this
 * company is not connected, connected. Connecting and changing settings is for the company owner only (the server
 * enforces it; the buttons are hidden for everyone else).
 */
export function OnlinePaymentsPanel({ companyId }: { companyId: string }) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const { toast } = useToast();
  const { isOwner, isLoading: roleLoading } = useCompanyRole();

  const status = useQuery<GatewayStatus>({ queryKey: salesKeys.gateway(companyId) });

  // Back from Stripe: /settings/sales?stripe=connected|error&reason=
  useEffect(() => {
    const back = stripeReturnState(window.location.search);
    if (!back) return;
    if (back.state === "connected") toast({ title: tr("stripeConnected") });
    else toast({ variant: "destructive", title: tr("stripeConnectFailed"), description: back.reason ? tr("stripeConnectReason", { reason: back.reason }) : undefined });
    queryClient.invalidateQueries({ queryKey: salesKeys.gateway(companyId) });
    window.history.replaceState({}, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fail = (title: string) => (error: unknown) => toast({ variant: "destructive", title, description: salesErrorMessage(error, (k) => tr(k), tr("pleaseTryAgain")) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: salesKeys.gateway(companyId) });

  const connect = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/payment-gateway/stripe/connect`, {}) as Promise<{ url: string }>,
    onSuccess: ({ url }) => window.location.assign(url),
    onError: fail(tr("stripeConnectFailed")),
  });
  const disconnect = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/companies/${companyId}/payment-gateway/stripe`),
    onSuccess: () => {
      toast({ title: tr("stripeDisconnected") });
      refresh();
    },
    onError: fail(tr("stripeDisconnectFailed")),
  });
  const update = useMutation({
    mutationFn: (patch: { allowPartial?: boolean; enabled?: boolean }) => apiRequest("PATCH", `/api/companies/${companyId}/payment-gateway/settings`, patch),
    onSuccess: refresh,
    onError: fail(tr("settingsNotSaved")),
  });

  const s = status.data;
  const connection = s?.connection;
  const connected = connection?.status === "active";

  return (
    <Card data-testid="online-payments-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          {tr("onlinePayments")}
        </CardTitle>
        <CardDescription>{tr("onlinePaymentsHelp")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status.isLoading || roleLoading ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-label={tr("loading")} />
        ) : status.isError || !s ? (
          <p role="alert" className="text-sm text-destructive">{tr("gatewayLoadFailed")}</p>
        ) : !s.configured ? (
          <Alert data-testid="gateway-not-configured">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>{tr("notConfiguredTitle")}</AlertTitle>
            <AlertDescription>{tr("notConfiguredBody")}</AlertDescription>
          </Alert>
        ) : (
          <>
            {s.mode === "fake" && (
              <Alert data-testid="gateway-test-mode">
                <AlertDescription>{tr("testModeNote")}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap items-center gap-2" data-testid="gateway-status">
              <span className="text-sm font-medium">{tr("stripeAccount")}</span>
              {connected ? (
                <StatusBadge tone={s.ready ? "success" : "warning"}>{s.ready ? tr("statusReady") : tr("statusPaused")}</StatusBadge>
              ) : connection?.status === "revoked" ? (
                <StatusBadge tone="danger">{tr("statusRevoked")}</StatusBadge>
              ) : (
                <StatusBadge tone="neutral">{tr("statusNotConnected")}</StatusBadge>
              )}
              {connected && connection?.livemode === false && <StatusBadge tone="info">{tr("modeTest")}</StatusBadge>}
              {connected && connection?.livemode && <StatusBadge tone="info">{tr("modeLive")}</StatusBadge>}
            </div>

            {connected && (
              <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div className="flex gap-2"><dt className="text-muted-foreground">{tr("accountId")}</dt><dd dir="ltr" className="font-mono">{connection?.accountId}</dd></div>
                {connection?.connectedAt && <div className="flex gap-2"><dt className="text-muted-foreground">{tr("connectedOn")}</dt><dd>{formatDate(connection.connectedAt, locale)}</dd></div>}
              </dl>
            )}

            {!isOwner ? (
              <p className="text-sm text-muted-foreground" data-testid="gateway-owner-only">{tr("ownerOnly")}</p>
            ) : connected ? (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4 rounded-md border p-3">
                  <div>
                    <Label htmlFor="gateway-enabled">{tr("acceptPayments")}</Label>
                    <p className="text-xs text-muted-foreground">{tr("acceptPaymentsHelp")}</p>
                  </div>
                  <Switch id="gateway-enabled" checked={s.enabled} disabled={update.isPending} onCheckedChange={(v) => update.mutate({ enabled: v })} data-testid="switch-gateway-enabled" />
                </div>
                <div className="flex items-start justify-between gap-4 rounded-md border p-3">
                  <div>
                    <Label htmlFor="gateway-partial">{tr("allowPartial")}</Label>
                    <p className="text-xs text-muted-foreground">{tr("allowPartialHelp")}</p>
                  </div>
                  <Switch id="gateway-partial" checked={s.allowPartial} disabled={update.isPending} onCheckedChange={(v) => update.mutate({ allowPartial: v })} data-testid="switch-gateway-partial" />
                </div>
                <Button
                  variant="outline"
                  disabled={disconnect.isPending}
                  onClick={() => window.confirm(tr("disconnectConfirm")) && disconnect.mutate()}
                  data-testid="button-disconnect-stripe"
                >
                  <Link2Off className="me-2 h-4 w-4" />
                  {tr("disconnect")}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">{tr("connectHelp")}</p>
                <Button disabled={connect.isPending} onClick={() => connect.mutate()} data-testid="button-connect-stripe">
                  {connect.isPending ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <CreditCard className="me-2 h-4 w-4" />}
                  {connection?.status === "revoked" ? tr("reconnect") : tr("connectStripe")}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
