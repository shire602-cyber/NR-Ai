import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { formatMessage, translateNow, useTranslation } from "@/lib/i18n";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface GlStats {
  totalProcessed: number;
  pendingReview: number;
}

/**
 * Assistant → Automations: what the assistant does for the books, in plain words, each
 * with the one action that runs it. Every result lands in Review as a draft; nothing is
 * posted on its own. There are no on/off switches here because these jobs run when asked
 * (a switch that does not persist would be a fake control).
 */
export default function AutomationsPanel() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();

  const stats = useQuery<GlStats>({
    queryKey: ["/api/companies", companyId, "ai-gl", "stats"],
    enabled: !!companyId,
  });

  const categorise = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/ai-gl/scan`),
    onSuccess: (data: { scan?: { classified?: number } }) => {
      toast({
        title: translateNow("toasts.scanComplete2"),
        description: formatMessage(translateNow("assistant.scanResult"), {
          count: data?.scan?.classified ?? 0,
        }),
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "ai-gl"] });
    },
    onError: (error: Error) =>
      toast({
        title: translateNow("toasts.scanFailed2"),
        description: error?.message,
        variant: "destructive",
      }),
  });

  const checks = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ai/detect-anomalies", { companyId }),
    onSuccess: (data: { summary?: { totalAnomalies?: number } }) => {
      toast({
        title: translateNow("toasts.scanComplete2"),
        description: formatMessage(translateNow("toasts.foundPotentialIssues"), {
          count: data?.summary?.totalAnomalies ?? 0,
        }),
      });
      void queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "anomaly-alerts"],
      });
    },
    onError: (error: Error) =>
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      }),
  });

  const processed = stats.data?.totalProcessed ?? 0;

  const rows = [
    {
      id: "categorise",
      title: t["assistant.autoCategoriseTitle"],
      body: t["assistant.autoCategoriseBody"],
      status:
        processed > 0
          ? formatMessage(t["assistant.autoCategoriseStatus"], { count: processed })
          : t["assistant.notRunYet"],
      action: (
        <Button
          variant="outline"
          size="sm"
          onClick={() => categorise.mutate()}
          disabled={categorise.isPending || !companyId}
          data-testid="button-automation-categorise"
        >
          {categorise.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
          {t["assistant.runNow"]}
        </Button>
      ),
    },
    {
      id: "checks",
      title: t["assistant.autoChecksTitle"],
      body: t["assistant.autoChecksBody"],
      status: t["assistant.onRequest"],
      action: (
        <Button
          variant="outline"
          size="sm"
          onClick={() => checks.mutate()}
          disabled={checks.isPending || !companyId}
          data-testid="button-scan-anomalies"
        >
          {checks.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
          {t["assistant.runNow"]}
        </Button>
      ),
    },
    {
      id: "matches",
      title: t["assistant.autoMatchesTitle"],
      body: t["assistant.autoMatchesBody"],
      status: t["assistant.inReconciliation"],
      action: (
        <Button variant="outline" size="sm" asChild>
          <Link href="/bank-reconciliation" data-testid="button-bank-reconciliation">
            {t["assistant.open"]}
          </Link>
        </Button>
      ),
    },
    {
      id: "receipts",
      title: t["assistant.autoReceiptsTitle"],
      body: t["assistant.autoReceiptsBody"],
      status: t["assistant.whenUploaded"],
      action: (
        <Button variant="outline" size="sm" asChild>
          <Link href="/receipts">{t["assistant.open"]}</Link>
        </Button>
      ),
    },
  ];

  return (
    <ul
      className="mx-auto max-w-[760px] divide-y divide-border overflow-hidden rounded-xl border border-border bg-card"
      data-testid="assistant-automations"
    >
      {rows.map((row) => (
        <li
          key={row.id}
          className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"
          data-testid={`automation-${row.id}`}
        >
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">{row.title}</p>
            <p className="text-small text-muted-foreground">{row.body}</p>
            <p className="mt-1 text-caption text-muted-foreground">{row.status}</p>
          </div>
          <div className="shrink-0">{row.action}</div>
        </li>
      ))}
    </ul>
  );
}
