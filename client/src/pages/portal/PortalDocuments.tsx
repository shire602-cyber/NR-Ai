import { usePortalAccountScope } from "@/lib/portal-scope";
import { T } from "@/components/layout/T";
import { useTranslation, translateNow } from "@/lib/i18n";
import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, FileText, FileImage, File, FolderOpen, Loader2, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PortalLoadNotice } from "@/components/portal/PortalLoadNotice";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { DateText } from "@/components/documents/DateText";
import { fetchPortalResource, portalQuery } from "@/lib/queryClient";
import { portalRequestHeaders } from "@/lib/portal-state";
import { withCsrfHeader } from "@/lib/csrf";

/** W4-D (R16-09): real multipart upload; the server sniffs the bytes and stores them. */
async function uploadDocument(file: File, supplier: string) {
  const form = new FormData();
  form.append("name", file.name.replace(/\.[^.]+$/, ""));
  form.append("category", "other");
  form.append("file", file, file.name);
  const headers = await withCsrfHeader("POST", portalRequestHeaders(supplier));
  const res = await fetchPortalResource("/api/client-portal/documents", {
    method: "POST",
    headers,
    body: form,
  });
  return res.json();
}
import { useToast } from "@/hooks/use-toast";
import { usePortalRetry } from "@/hooks/usePortalRetry";

const CATEGORIES = new Set([
  "trade_license",
  "contract",
  "tax_certificate",
  "audit_report",
  "bank_statement",
  "insurance",
  "visa",
  "other",
]);

function fileIcon(mime: string) {
  if (mime?.startsWith("image/")) return FileImage;
  if (mime === "application/pdf") return FileText;
  return File;
}

function formatBytes(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PortalDocuments() {
  const supplier = usePortalAccountScope();
  const { t, locale } = useTranslation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const documentsQuery = portalQuery("/api/client-portal/documents", supplier);
  const query = useQuery<any[]>({ ...documentsQuery });
  const { data: documents, isPaused, isFetching } = query;
  const { error, isLoading, retryPending, retry } = usePortalRetry(documentsQuery.queryKey, query);

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadDocument(file, supplier),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-documents"] });
      toast({
        title: translateNow("toasts.documentUploaded"),
        description: translateNow("toasts.nrAccountingCanNowSeeYourFile"),
      });
    },
    onError: (e: any) =>
      toast({
        title: translateNow("toasts.uploadFailed2"),
        description: e.message,
        variant: "destructive",
      }),
  });

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await uploadMutation.mutateAsync(file);
    } catch {
      // The mutation reports upload failures to the customer.
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const pick = () => fileRef.current?.click();

  return (
    <div className="mx-auto max-w-[960px] space-y-6">
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={handleFileChange}
        accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.txt,.csv"
      />
      <PageHeader
        title={t["pages.documents"]}
        description={t["portal.doc.documentsHint"]}
        primaryAction={
          <Button
            className="min-h-11"
            onClick={pick}
            disabled={uploading}
            data-testid="button-portal-upload"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 me-2 animate-spin" aria-hidden />
            ) : (
              <Upload className="h-4 w-4 me-2" aria-hidden />
            )}
            <T k="portal.doc.upload" />
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          {!isLoading && (
            <PortalLoadNotice
              error={error}
              paused={isPaused}
              retrying={isFetching}
              retryPending={retryPending}
              onRetry={retry}
              compact={documents !== undefined}
              resource="documents"
            />
          )}
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
            </div>
          ) : documents === undefined ? null : documents.length === 0 ? (
            <EmptyState
              headingLevel="h2"
              icon={FolderOpen}
              title={t["portal.doc.noDocumentsTitle"]}
              description={t["portal.doc.noDocumentsBody"]}
              action={{ label: t["portal.doc.upload"], onClick: pick }}
            />
          ) : (
            <ul className="divide-y divide-border">
              {documents.map((doc: any) => {
                const Icon = fileIcon(doc.mimeType);
                return (
                  <li key={doc.id} className="flex items-center gap-4 px-5 py-3">
                    <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-small font-medium text-foreground" dir="auto">
                        {doc.name}
                      </p>
                      <p className="text-caption text-muted-foreground">
                        {doc.createdAt ? <DateText value={doc.createdAt} locale={locale} /> : "—"}
                        {doc.fileSize ? <bdi> · {formatBytes(doc.fileSize)}</bdi> : null}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge tone="neutral">
                        {
                          t[
                            `portal.doc.category.${CATEGORIES.has(doc.category) ? doc.category : "other"}`
                          ]
                        }
                      </StatusBadge>
                      {doc.uploadedBy && (
                        <CheckCircle2
                          className="h-4 w-4 text-success"
                          aria-label={t["portal.doc.received"]}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
