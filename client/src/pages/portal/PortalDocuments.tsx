import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, FileText, FileImage, File, Loader2, CheckCircle2, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { useTranslation } from "@/lib/i18n";
import {
  ACCEPTED_UPLOAD_TYPES,
  checkFileBeforeUpload,
  downloadAuthenticatedFile,
  fileProblemMessage,
  readFileAsBase64,
} from "@/lib/file-upload";
import { messages as pageMessages } from "./PortalDocuments.i18n";

const getCategoryLabels = (): Record<string, string> => ({
  trade_license: pageMessages.t("tradeLicense"),
  contract: pageMessages.t("contract"),
  tax_certificate: pageMessages.t("taxCertificate"),
  audit_report: pageMessages.t("auditReport"),
  bank_statement: pageMessages.t("bankStatement"),
  insurance: pageMessages.t("insurance"),
  visa: pageMessages.t("visa"),
  other: pageMessages.t("other"),
});

function fileIcon(mime: string) {
  if (mime?.startsWith("image/")) return <FileImage className="w-5 h-5 text-info" />;
  if (mime === "application/pdf") return <FileText className="w-5 h-5 text-destructive" />;
  return <File className="w-5 h-5 text-muted-foreground/70" />;
}

function formatBytes(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PortalDocuments() {
  const tr = pageMessages.useT();

  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const { locale } = useTranslation();
  const isAr = locale === "ar";

  const { data: documents = [], isLoading } = useQuery<any[]>({
    queryKey: ["portal-documents"],
    queryFn: () => apiRequest("GET", "/api/client-portal/documents"),
  });

  const uploadMutation = useMutation({
    mutationFn: (payload: any) => apiRequest("POST", "/api/client-portal/documents", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-documents"] });
      toast({
        title: tr("documentUploaded"),
        description: tr("nrAccountingCanNowSeeYour"),
      });
    },
  });

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);

    const problem = checkFileBeforeUpload(file);
    if (problem) {
      setUploadError(fileProblemMessage(problem, locale));
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    setUploading(true);
    try {
      // The file itself is sent (base64); the server validates it and stores it privately.
      const fileData = await readFileAsBase64(file);
      await uploadMutation.mutateAsync({
        name: file.name.replace(/\.[^.]+$/, ""),
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        category: "other",
        fileData,
      });
    } catch (error: any) {
      setUploadError(error?.message || tr("uploadFailed"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleDownload(doc: any) {
    try {
      await downloadAuthenticatedFile(
        `/api/client-portal/documents/${doc.id}/download`,
        doc.fileName || doc.name
      );
    } catch (error: any) {
      toast({
        title: tr("downloadFailed"),
        description: error?.message,
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{tr("documents")}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {tr("uploadReceiptsAndDocumentsForNr")}
          </p>
        </div>
        <div>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={handleFileChange}
            accept={ACCEPTED_UPLOAD_TYPES}
          />
          <Button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="bg-info hover:bg-info text-white"
          >
            {uploading ? (
              <Loader2 className="w-4 h-4 me-2 animate-spin" />
            ) : (
              <Upload className="w-4 h-4 me-2" />
            )}
            {uploading ? tr("uploading") : tr("uploadDocument")}
          </Button>
        </div>
      </div>

      {uploadError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {uploadError}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-14">
              <Upload className="w-10 h-10 text-muted-foreground/70 mx-auto mb-3" />
              <p className="text-sm font-medium text-muted-foreground">{tr("noDocumentsYet")}</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                {tr("uploadReceiptsOrFilesForYour")}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {documents.map((doc: any) => (
                <div
                  key={doc.id}
                  className="flex items-center gap-4 px-4 py-3 hover:bg-muted transition-colors"
                >
                  <div className="flex-shrink-0">{fileIcon(doc.mimeType)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{doc.name}</p>
                    <p className="text-xs text-muted-foreground/70">
                      {doc.createdAt ? format(new Date(doc.createdAt), "MMM d, yyyy") : "—"}
                      {doc.fileSize ? ` · ${formatBytes(doc.fileSize)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge variant="outline" className="text-xs">
                      {getCategoryLabels()[doc.category] ?? doc.category}
                    </Badge>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleDownload(doc)}
                      aria-label={tr("download")}
                    >
                      <Download className="w-4 h-4" />
                    </Button>
                    {doc.uploadedBy && (
                      <CheckCircle2
                        className="w-4 h-4 text-success"
                        aria-label={tr("receivedByNra")}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
