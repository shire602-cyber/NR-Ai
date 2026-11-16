/**
 * Delivery log files (W5-A, R12-01): the PDF / XLSX a delivery run rendered, downloadable
 * from the run history. Files are kept even when a run is blocked (no email provider).
 */
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { T } from "@/components/layout/T";
import { apiUrl } from "@/lib/api";
import { apiRequest } from "@/lib/queryClient";

interface DeliveryArtifact {
  id: string;
  kind: "pdf" | "xlsx" | "zip";
  filename: string;
  sizeBytes: number;
  href: string;
}

export function DeliveryRunFiles({
  companyId,
  runId,
  artifactCount,
}: {
  companyId: string | null | undefined;
  runId: string;
  artifactCount?: number;
}) {
  const enabled = Boolean(companyId) && (artifactCount ?? 0) > 0;
  const { data } = useQuery<{ artifacts: DeliveryArtifact[] }>({
    queryKey: ["/api/companies", companyId, "report-delivery", "runs", runId, "artifacts"],
    queryFn: () =>
      apiRequest("GET", `/api/companies/${companyId}/report-delivery/runs/${runId}/artifacts`),
    enabled,
    staleTime: 60_000,
  });
  if (!enabled || !data?.artifacts?.length) return null;
  return (
    <div
      className="mt-1 flex flex-wrap items-center gap-2"
      data-testid={`delivery-run-files-${runId}`}
    >
      <span className="text-muted-foreground">
        <T k="reportCenter.deliveryFiles" />:
      </span>
      {data.artifacts.map((a) => (
        <a
          key={a.id}
          href={apiUrl(a.href)}
          download
          className="inline-flex items-center gap-1 underline underline-offset-2"
        >
          <Download className="h-3 w-3" />
          {a.kind.toUpperCase()}
        </a>
      ))}
    </div>
  );
}
