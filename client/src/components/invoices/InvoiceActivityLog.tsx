import { useQuery } from "@tanstack/react-query";
import { Eye, Mail } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { apiRequest } from "@/lib/queryClient";
import { formatDateTime } from "@/lib/format-date";
import { emailStatusKey } from "@/lib/invoice-documents";

export interface InvoiceActivityItem {
  kind: "emailed" | "viewed";
  at: string;
  recipient: string | null;
  status: string | null;
  sent: boolean;
  subject: string | null;
}

/** WQ1 (7.25): when the invoice was emailed (and whether it really left) and when it was viewed. */
export function InvoiceActivityLog({ invoiceId }: { invoiceId: string }) {
  const { t, locale } = useTranslation();
  const { data = [], isLoading } = useQuery<InvoiceActivityItem[]>({
    queryKey: [`/api/invoices/${invoiceId}/activity`],
    queryFn: () => apiRequest("GET", `/api/invoices/${invoiceId}/activity`),
  });
  if (isLoading) return null;
  if (data.length === 0) {
    return (
      <p className="text-small text-muted-foreground" data-testid="invoice-activity-empty">
        {t["invoices.activity.empty"]}
      </p>
    );
  }
  return (
    <ol className="space-y-4" data-testid="invoice-activity">
      {data.map((item, i) => (
        <li key={`${item.kind}-${item.at}-${i}`} className="flex items-start gap-3 text-small">
          {item.kind === "emailed" ? (
            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <Eye className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-foreground">
              {item.kind === "emailed"
                ? formatMessage(t["invoices.activity.emailed"], {
                    to: item.recipient ?? "",
                  })
                : t["invoices.activity.viewed"]}
            </p>
            <p className="text-caption text-muted-foreground">{formatDateTime(item.at, locale)}</p>
          </div>
          {item.kind === "emailed" && (
            <StatusBadge tone={item.sent ? "success" : "warning"}>
              {t[emailStatusKey(item)]}
            </StatusBadge>
          )}
        </li>
      ))}
    </ol>
  );
}
