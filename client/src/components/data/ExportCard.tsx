import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, FileArchive } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/api";
import { canDownloadExport, exportPollInterval, formatBytes, type ExportRow, type ExportStatus } from "@/lib/data-lifecycle";
import { useI18n } from "@/lib/i18n";
import { ApiError, apiRequest, queryClient } from "@/lib/queryClient";
import { messages as pageMessages } from "./ExportCard.i18n";

const STATUS_KEY: Record<ExportStatus, "statusQueued" | "statusRunning" | "statusReady" | "statusFailed" | "statusExpired"> = {
  queued: "statusQueued",
  running: "statusRunning",
  ready: "statusReady",
  failed: "statusFailed",
  expired: "statusExpired",
};

function formatWhen(iso: string | null, locale: string): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function ExportCard({ companyId, canExport }: { companyId: string; canExport: boolean }) {
  const tr = pageMessages.useT();
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const queryKey = ["/api/companies", companyId, "exports"];
  const { data: rows, isLoading } = useQuery<ExportRow[]>({
    queryKey,
    enabled: canExport,
    refetchInterval: (query) => exportPollInterval(query.state.data as ExportRow[] | undefined),
  });

  const request = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/exports`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (err) => {
      if (err instanceof ApiError && err.code === "EXPORT_IN_PROGRESS") {
        toast({ title: tr("exportInProgress") });
        queryClient.invalidateQueries({ queryKey });
        return;
      }
      toast({ variant: "destructive", title: tr("errGeneric") });
    },
  });

  const active = rows?.some((r) => r.status === "queued" || r.status === "running") ?? false;

  return (
    <Card data-testid="card-export">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileArchive className="h-5 w-5" aria-hidden="true" />
          <h2>{tr("exportTitle")}</h2>
        </CardTitle>
        <CardDescription className="max-w-2xl">{tr("exportBody")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => request.mutate()} disabled={!canExport || request.isPending || active} data-testid="button-request-export">
            {request.isPending ? tr("exportRequesting") : tr("exportRequest")}
          </Button>
          {!canExport && <span className="text-xs text-muted-foreground">{tr("exportRoleNote")}</span>}
        </div>
        {canExport && isLoading && <p className="text-sm text-muted-foreground">{tr("loading")}</p>}
        {canExport && rows && rows.length === 0 && <p className="text-sm text-muted-foreground">{tr("exportEmpty")}</p>}
        {rows && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm" data-testid="table-exports">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pe-3 text-start font-medium">{tr("exportColRequested")}</th>
                  <th scope="col" className="py-2 pe-3 text-start font-medium">{tr("exportColStatus")}</th>
                  <th scope="col" className="py-2 pe-3 text-start font-medium">{tr("exportColSize")}</th>
                  <th scope="col" className="py-2 pe-3 text-start font-medium">{tr("exportColExpires")}</th>
                  <th scope="col" className="py-2"><span className="sr-only">{tr("download")}</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border/50" data-testid={`row-export-${row.id}`}>
                    <td className="py-2 pe-3">{formatWhen(row.createdAt, locale)}</td>
                    <td className="py-2 pe-3">
                      <Badge variant={row.status === "ready" ? "default" : row.status === "failed" ? "destructive" : "secondary"}>{tr(STATUS_KEY[row.status])}</Badge>
                    </td>
                    <td className="py-2 pe-3" dir="ltr">{formatBytes(row.sizeBytes)}</td>
                    <td className="py-2 pe-3">{row.status === "ready" ? formatWhen(row.expiresAt, locale) : ""}</td>
                    <td className="py-2 text-end">
                      {canDownloadExport(row) ? (
                        <Button asChild size="sm" variant="outline">
                          <a href={apiUrl(`/api/companies/${companyId}/exports/${row.id}/download`)} download>
                            <Download className="me-1.5 h-4 w-4" aria-hidden="true" />
                            {tr("download")}
                          </a>
                        </Button>
                      ) : row.status === "failed" ? (
                        <span className="text-xs text-muted-foreground">{tr("exportFailedHint")}</span>
                      ) : row.status === "expired" ? (
                        <span className="text-xs text-muted-foreground">{tr("exportExpiredHint")}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
