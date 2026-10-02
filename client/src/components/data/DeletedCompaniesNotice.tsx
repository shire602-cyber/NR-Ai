import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { actionableDeletions, daysUntil, RESTORE_WINDOW_DAYS, type DeletionRow } from "@/lib/data-lifecycle";
import { useI18n } from "@/lib/i18n";
import { ApiError, apiRequest, queryClient } from "@/lib/queryClient";
import { messages as pageMessages } from "./ExportCard.i18n";

export const DELETIONS_KEY = ["/api/me/company-deletions"] as const;

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: "long" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Shows companies scheduled for deletion with a Restore button. Renders nothing when there are none. */
export function DeletedCompaniesNotice({ companyId }: { companyId?: string }) {
  const tr = pageMessages.useT();
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const { data } = useQuery<DeletionRow[]>({ queryKey: DELETIONS_KEY, retry: false });
  const rows = actionableDeletions(data).filter((r) => !companyId || r.companyId === companyId);

  const restore = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/company-deletions/${id}/restore`),
    onSuccess: async () => {
      toast({ title: tr("restoredToast") });
      await queryClient.invalidateQueries();
      window.setTimeout(() => window.location.assign("/dashboard"), 600);
    },
    onError: (err) => toast({ variant: "destructive", title: err instanceof ApiError && err.code === "RESTORE_WINDOW_CLOSED" ? tr("restoreClosed") : tr("errGeneric") }),
  });

  if (rows.length === 0) return null;
  return (
    <div className="space-y-2" data-testid="notice-deleted-companies">
      {rows.map((row) => {
        const name = row.companyName ?? "";
        const days = daysUntil(row.purgeAfter) ?? RESTORE_WINDOW_DAYS;
        const text =
          row.status === "awaiting_firm"
            ? tr("noticeAwaiting", { name })
            : days === 1
              ? tr("noticeBodyOne", { name, date: formatDate(row.purgeAfter, locale) })
              : tr("noticeBody", { name, date: formatDate(row.purgeAfter, locale), days });
        return (
          <div key={row.id} role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <div>
              <p className="font-medium">{tr("noticeTitle")}</p>
              <p className="text-muted-foreground">{text}</p>
            </div>
            {row.status === "pending" && (
              <Button size="sm" onClick={() => restore.mutate(row.id)} disabled={restore.isPending} data-testid={`button-restore-${row.id}`}>
                {restore.isPending ? tr("restoring") : tr("restore")}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
