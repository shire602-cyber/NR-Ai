import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { formatMessage, useTranslation } from "@/lib/i18n";
import type { PortalSheetContact } from "@/components/portal/PortalAccessSheet";
import { portalSummaryKey } from "@/lib/portal-invite";
import type { PortalSummaryEntry } from "@/components/portal/PortalStatusChip";
import { PORTAL_BULK_MAX } from "@shared/validators/portal-invitations";

type Outcome =
  | "invited"
  | "skipped_no_email"
  | "already_active"
  | "pending"
  | "not_found"
  | "rate_limited";

interface BulkProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  contacts: PortalSheetContact[];
  summary: Record<string, PortalSummaryEntry>;
}

function BulkBody({ onOpenChange, companyId, contacts, summary }: BulkProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const eligible = useMemo(
    () =>
      contacts.filter((c) => {
        const s = summary[c.id];
        return !!c.email && !(s && (s.state === "active" || s.state === "invited"));
      }),
    [contacts, summary]
  );
  const skippedNoEmail = contacts.filter((c) => !c.email).length;
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(eligible.slice(0, PORTAL_BULK_MAX).map((c) => c.id))
  );
  const [results, setResults] = useState<Array<{ contactId: string; outcome: Outcome }> | null>(
    null
  );

  const send = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/portal-invitations/bulk`, {
        contactIds: [...picked],
        language: "contact",
      }) as Promise<{ results: Array<{ contactId: string; outcome: Outcome }> }>,
    onSuccess: (res) => {
      setResults(res.results);
      void queryClient.invalidateQueries({ queryKey: portalSummaryKey(companyId) });
      const n = res.results.filter((r) => r.outcome === "invited").length;
      toast({ title: formatMessage(t["portal.bulk.done"], { count: n }) });
    },
    onError: (err) =>
      toast({
        title: err instanceof ApiError ? err.message : t["portal.invite.failed"],
        variant: "destructive",
      }),
  });

  const nameOf = (id: string) => contacts.find((c) => c.id === id)?.name ?? id;
  const toggle = (id: string, on: boolean) =>
    setPicked((p) => {
      const next = new Set(p);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t["portal.bulk.title"]}</DialogTitle>
        <DialogDescription>{t["portal.bulk.help"]}</DialogDescription>
      </DialogHeader>
      {results ? (
        <ul className="max-h-72 space-y-1 overflow-y-auto text-small" data-testid="bulk-results">
          {results.map((r) => (
            <li key={r.contactId} className="flex items-center justify-between gap-3 py-1">
              <span className="truncate" dir="auto">
                {nameOf(r.contactId)}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {t[`portal.bulk.outcome.${r.outcome}`]}
              </span>
            </li>
          ))}
        </ul>
      ) : eligible.length === 0 ? (
        <p className="text-small text-muted-foreground" data-testid="bulk-empty">
          {t["portal.bulk.none"]}
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 text-small">
            <span>
              {formatMessage(t["portal.bulk.selected"], {
                count: picked.size,
                total: eligible.length,
              })}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11"
              onClick={() =>
                setPicked(
                  picked.size === Math.min(eligible.length, PORTAL_BULK_MAX)
                    ? new Set()
                    : new Set(eligible.slice(0, PORTAL_BULK_MAX).map((c) => c.id))
                )
              }
            >
              {picked.size > 0 ? t["portal.bulk.clearAll"] : t["portal.bulk.selectAll"]}
            </Button>
          </div>
          <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {eligible.map((c) => (
              <li key={c.id} className="flex items-center gap-3 p-3">
                <Checkbox
                  id={`bulk-${c.id}`}
                  checked={picked.has(c.id)}
                  onCheckedChange={(v) => toggle(c.id, v === true)}
                  className="h-5 w-5"
                />
                <Label
                  htmlFor={`bulk-${c.id}`}
                  className="min-w-0 flex-1 cursor-pointer font-normal"
                >
                  <span className="block truncate text-small font-medium" dir="auto">
                    {c.name}
                  </span>
                  <span className="block truncate text-caption text-muted-foreground" dir="ltr">
                    {c.email}
                  </span>
                </Label>
              </li>
            ))}
          </ul>
          {skippedNoEmail > 0 && (
            <p className="text-caption text-muted-foreground">
              {formatMessage(t["portal.bulk.noEmail"], { count: skippedNoEmail })}
            </p>
          )}
        </>
      )}
      <DialogFooter className="gap-2">
        <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>
          {results ? t["common.close"] : t["common.cancel"]}
        </Button>
        {!results && eligible.length > 0 && (
          <Button
            className="min-h-11"
            disabled={picked.size === 0 || send.isPending}
            onClick={() => send.mutate()}
            data-testid="bulk-send"
          >
            {send.isPending ? (
              <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Send className="me-2 h-4 w-4 rtl:-scale-x-100" aria-hidden />
            )}
            {formatMessage(t["portal.bulk.send"], { count: picked.size })}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

/**
 * Invite many customers at once. Only customers with an email and no active or pending access
 * can be ticked; each is invited in its own language (both when the language is unknown). The
 * result lists what happened per customer.
 */
export function BulkPortalInviteDialog(props: BulkProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="md" data-testid="bulk-portal-dialog">
        <BulkBody {...props} />
      </DialogContent>
    </Dialog>
  );
}
