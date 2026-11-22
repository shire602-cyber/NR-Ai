import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { PortalInvoiceList, type PortalInvoice } from "@/components/portal/PortalInvoiceList";
import { useToast } from "@/hooks/use-toast";
import { usePortalSupplier, usePortalSupplierQuery } from "@/lib/portal-supplier";
import { useTranslation } from "@/lib/i18n";

export default function PortalInvoices() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const accountId = usePortalSupplier()?.company.accountId;
  const {
    data: invoices = [],
    isLoading,
    isError,
    refetch,
  } = usePortalSupplierQuery<PortalInvoice[]>("portal-invoices", "invoices", 60_000);
  const { data: dashboard } = usePortalSupplierQuery<{ onlinePayment?: { available: boolean } }>(
    "portal-dashboard",
    "dashboard",
    60_000
  );

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
      {isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : (
        <PortalInvoiceList
          invoices={invoices}
          accountId={accountId}
          loading={isLoading}
          onlinePayment={dashboard?.onlinePayment?.available === true}
        />
      )}
    </div>
  );
}
