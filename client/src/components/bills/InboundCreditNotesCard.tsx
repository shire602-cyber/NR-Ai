/**
 * Supplier credit notes received as e-invoices (W4-C residual, S2). They are stored for review;
 * the reviewer records each one as a vendor credit (debit note) through
 * POST /api/companies/:companyId/bills/inbound/:id/vendor-credit. Renders nothing when no
 * credit note is waiting.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatMessage, useTranslation } from "@/lib/i18n";

import { pendingSupplierCreditNotes, type InboundDocument } from "@/lib/bill-filters";

export function InboundCreditNotesCard({ companyId }: { companyId: string | undefined }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const key = ["/api/companies", companyId, "einvoicing", "inbound"];
  const { data } = useQuery<{ items: InboundDocument[] }>({
    queryKey: key,
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/einvoicing/inbound`),
    enabled: !!companyId,
    retry: false,
  });
  const record = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/companies/${companyId}/bills/inbound/${id}/vendor-credit`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "debit-notes"] });
      toast({ title: t["purchases.vendorCreditRecorded"] });
    },
    onError: (err: Error) =>
      toast({
        variant: "destructive",
        title: t["purchases.vendorCreditFailed"],
        description: err.message,
      }),
  });
  const pending = pendingSupplierCreditNotes(data?.items ?? []);
  if (pending.length === 0) return null;
  return (
    <Card data-testid="inbound-credit-notes">
      <CardHeader>
        <CardTitle>{t["purchases.inboundCreditNotes"]}</CardTitle>
        <CardDescription>{t["purchases.inboundCreditNotesHint"]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {pending.map((d) => (
          <div key={d.id} className="flex items-center justify-between gap-3 border rounded-md p-3">
            <span className="text-sm">
              {formatMessage(t["purchases.inboundCreditNoteRow"], {
                supplier: d.supplierName ?? "—",
                number: d.documentNumber,
              })}
            </span>
            <Button
              size="sm"
              disabled={record.isPending}
              onClick={() => record.mutate(d.id)}
              data-testid={`record-vendor-credit-${d.id}`}
            >
              {t["purchases.recordVendorCredit"]}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
