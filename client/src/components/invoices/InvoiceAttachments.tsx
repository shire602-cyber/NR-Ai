import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, Paperclip, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileDrop } from "@/components/ui/file-drop";
import { useToast } from "@/hooks/use-toast";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { downloadServerFile } from "@/lib/export";
import { attachmentSizeLabel, uploadInvoiceAttachment } from "@/lib/invoice-documents";

export interface InvoiceAttachmentRow {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

/** Same cap as the server (7 MB decoded). */
const MAX_ATTACHMENT_BYTES = 7 * 1024 * 1024;
const ATTACHMENT_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,image/*,application/pdf";

/**
 * WQ1 (7.2g): files kept with an invoice (a purchase order, a delivery receipt). A saved invoice
 * uploads at once; a new one keeps the chosen files and uploads them right after the first save.
 */
export function InvoiceAttachments({
  invoiceId,
  pending,
  onPendingChange,
  disabled,
}: {
  invoiceId?: string | null;
  pending: File[];
  onPendingChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const key = ["/api/invoices", invoiceId, "attachments"];
  const { data: rows = [] } = useQuery<InvoiceAttachmentRow[]>({
    queryKey: key,
    queryFn: () => apiRequest("GET", `/api/invoices/${invoiceId}/attachments`),
    enabled: !!invoiceId,
  });
  const upload = useMutation({
    mutationFn: (file: File) => uploadInvoiceAttachment(invoiceId!, file),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
    onError: (error: Error) =>
      toast({
        variant: "destructive",
        title: t["invoices.attachments.uploadFailed"],
        description: error?.message,
      }),
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      apiRequest("DELETE", `/api/invoices/${invoiceId}/attachments/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
  });

  const onFiles = (files: File[]) => {
    const ok = files.filter((f) => f.size <= MAX_ATTACHMENT_BYTES);
    if (ok.length < files.length) {
      toast({ variant: "destructive", title: t["invoices.attachments.tooLarge"] });
    }
    if (!invoiceId) {
      onPendingChange([...pending, ...ok]);
      return;
    }
    for (const f of ok) upload.mutate(f);
  };

  return (
    <div className="space-y-3" data-testid="invoice-attachments">
      <FileDrop
        multiple
        accept={ATTACHMENT_ACCEPT}
        disabled={disabled || upload.isPending}
        onFiles={onFiles}
        label={t["invoices.attachments.drop"]}
        hint={t["invoices.attachments.hint"]}
        testId="invoice-attachments-drop"
        inputTestId="input-invoice-attachment"
      />
      {(rows.length > 0 || pending.length > 0) && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((a) => (
            <li key={a.id} className="flex items-center gap-2 px-3 py-2 text-small">
              <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate" dir="auto">
                {a.fileName}
              </span>
              <span className="shrink-0 text-caption text-muted-foreground" dir="ltr">
                {attachmentSizeLabel(a.sizeBytes)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={formatMessage(t["invoices.attachments.download"], { name: a.fileName })}
                onClick={() =>
                  void downloadServerFile(
                    `/api/invoices/${invoiceId}/attachments/${a.id}`,
                    a.fileName
                  )
                }
              >
                <Download className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-danger"
                disabled={disabled || remove.isPending}
                aria-label={formatMessage(t["invoices.attachments.remove"], { name: a.fileName })}
                onClick={() => remove.mutate(a.id)}
                data-testid={`button-remove-attachment-${a.id}`}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </li>
          ))}
          {pending.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center gap-2 px-3 py-2 text-small"
              data-testid={`pending-attachment-${i}`}
            >
              <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate" dir="auto">
                {f.name}
              </span>
              <span className="shrink-0 text-caption text-muted-foreground">
                {t["invoices.attachments.onSave"]}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-danger"
                aria-label={formatMessage(t["invoices.attachments.remove"], { name: f.name })}
                onClick={() => onPendingChange(pending.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
