import { useMutation, useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { StatementSettings } from "@/lib/banking-api-types";
import { messages } from "./PdfAiFallbackSetting.i18n";
import { messages as common } from "./BankingCommon.i18n";
import { bankingErrorText } from "./banking-common";

/** The company's choice to let the AI provider read scanned PDF statements. Off by default and labelled as paid. */
export function PdfAiFallbackSetting({ companyId }: { companyId: string }) {
  const tr = messages.useT();
  const trc = common.useT();
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const key = ["/api/companies", companyId, "bank-statements", "settings"];

  const { data, isLoading } = useQuery<StatementSettings>({ queryKey: key, enabled: !!companyId });

  const save = useMutation({
    mutationFn: (pdfAiFallback: boolean) => apiRequest("PUT", `/api/companies/${companyId}/bank-statements/settings`, { pdfAiFallback }),
    onSuccess: (next: StatementSettings) => {
      queryClient.setQueryData(key, next);
      toast({ title: tr("saved") });
    },
    onError: (err: unknown) => toast({ variant: "destructive", title: tr("saveFailed"), description: bankingErrorText(trc, err, locale) }),
  });

  if (isLoading || !data) return <Skeleton className="h-24 w-full" />;

  return (
    <div className="rounded-md border p-3 space-y-2" data-testid="pdf-ai-setting">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-sm font-medium">{tr("title")}</p>
          <StatusBadge tone={data.pdfAiFallback ? "warning" : "neutral"}>{data.pdfAiFallback ? tr("on") : tr("off")}</StatusBadge>
        </div>
        <Switch
          checked={data.pdfAiFallback}
          onCheckedChange={(v) => save.mutate(v)}
          disabled={save.isPending}
          aria-label={tr("title")}
          data-testid="switch-pdf-ai"
        />
      </div>
      <p className="text-xs text-muted-foreground">{tr("description", { pages: data.maxAiPages })}</p>
      {!data.aiConfigured && <p className="text-xs text-[hsl(var(--chart-4))]">{tr("notConfigured")}</p>}
    </div>
  );
}
