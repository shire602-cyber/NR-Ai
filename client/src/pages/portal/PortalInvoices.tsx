import { usePortalAccountScope } from "@/lib/portal-scope";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/page-header";
import { PortalInvoiceList, type PortalInvoice } from "@/components/portal/PortalInvoiceList";
import { useToast } from "@/hooks/use-toast";
import { portalQuery } from "@/lib/queryClient";
import { useTranslation } from "@/lib/i18n";

export default function PortalInvoices() {
  const supplier = usePortalAccountScope();
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const {
    data: invoices,
    isLoading,
    error,
    refetch,
  } = useQuery<PortalInvoice[]>({
    ...portalQuery("/api/client-portal/invoices", supplier),
    staleTime: 60_000,
  });
  const { data: dashboard } = useQuery<{ onlinePayment?: { available: boolean } }>({
    ...portalQuery("/api/client-portal/dashboard", supplier),
    staleTime: 60_000,
  });

  // Back from the payment gateway: say what happened and refresh the balances.
  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get("payment");
    if (status !== "success" && status !== "cancelled") return;
    window.history.replaceState(null, "", window.location.pathname);
    toast({
      title:
        status === "success" ? t["portal.list.paymentSuccess"] : t["portal.list.paymentCancelled"],
    });
    void queryClient.invalidateQueries({ queryKey: ["portal-invoices"] });
    void queryClient.invalidateQueries({ queryKey: ["portal-dashboard"] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-[1040px] space-y-6">
      <PageHeader title={t["portal.doc.invoices"]} description={t["portal.doc.invoicesHint"]} />
      <PortalInvoiceList
        invoices={invoices}
        loading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        onlinePayment={dashboard?.onlinePayment?.available === true}
      />
    </div>
  );
}
