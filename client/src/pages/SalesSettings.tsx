import { Settings2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CustomFieldsPanel } from "@/components/sales/CustomFieldsPanel";
import { OnlinePaymentsPanel } from "@/components/sales/OnlinePaymentsPanel";
import { PriceListsPanel } from "@/components/sales/PriceListsPanel";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { stripeReturnState } from "@/lib/sales-api";
import { messages } from "./SalesSettings.i18n";

/** Sales settings: price lists, custom fields and online payments. Late fees live on Payment Chasing, auto-send on Recurring Invoices. */
export default function SalesSettings() {
  const tr = messages.useT();
  const { companyId } = useDefaultCompany();
  // Coming back from Stripe lands on the payments tab.
  const initial = typeof window !== "undefined" && stripeReturnState(window.location.search) ? "payments" : "price-lists";

  return (
    <div className="space-y-6" data-testid="page-sales-settings">
      <PageHeader eyebrow={tr("eyebrow")} title={tr("title")} description={tr("description")} icon={Settings2} />
      {!companyId ? (
        <Skeleton className="h-64" />
      ) : (
        <Tabs defaultValue={initial} className="space-y-6">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="price-lists" data-testid="tab-price-lists">{tr("tabPriceLists")}</TabsTrigger>
            <TabsTrigger value="custom-fields" data-testid="tab-custom-fields">{tr("tabCustomFields")}</TabsTrigger>
            <TabsTrigger value="payments" data-testid="tab-online-payments">{tr("tabPayments")}</TabsTrigger>
          </TabsList>
          <TabsContent value="price-lists" className="mt-0"><PriceListsPanel companyId={companyId} /></TabsContent>
          <TabsContent value="custom-fields" className="mt-0"><CustomFieldsPanel companyId={companyId} /></TabsContent>
          <TabsContent value="payments" className="mt-0"><OnlinePaymentsPanel companyId={companyId} /></TabsContent>
        </Tabs>
      )}
    </div>
  );
}
