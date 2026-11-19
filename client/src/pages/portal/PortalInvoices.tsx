import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/page-header";
import { PortalInvoiceList, type PortalInvoice } from "@/components/portal/PortalInvoiceList";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useTranslation } from "@/lib/i18n";

export default function PortalInvoices() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: invoices = [], isLoading } = useQuery<PortalInvoice[]>({
    queryKey: ["portal-invoices"],
    queryFn: () => apiRequest("GET", "/api/client-portal/invoices"),
    staleTime: 60_000,
  });
  const { data: dashboard } = useQuery<{ onlinePayment?: { available: boolean } }>({
    queryKey: ["portal-dashboard"],
    queryFn: () => apiRequest("GET", "/api/client-portal/dashboard"),
    staleTime: 60_000,
  });

  // Back from the payment gateway: say what happened and refresh the balances.
  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get("payment");
    if (status !== "success" && status !== "cancelled") return;
    window.history.replaceState(null, "", window.location.pathname);
    toast({
      title: status === "success" ? t["portal.list.paymentSuccess"] : t["portal.list.paymentCancelled"],
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
        onlinePayment={dashboard?.onlinePayment?.available === true}
      />
    </div>
  );
}
