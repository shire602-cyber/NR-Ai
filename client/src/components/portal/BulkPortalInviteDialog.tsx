import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Download, Loader2, Send } from "lucide-react";
import { Alert } from "@/components/ui/alert";
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

interface BulkResult {
  contactId: string;
  outcome: Outcome;
  delivery?: "email" | "queued" | "link";
  inviteUrl?: string;
}

/** One CSV cell, quoted, with a leading formula character neutralised (spreadsheet injection). */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

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
  const [results, setResults] = useState<BulkResult[] | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/portal-invitations/bulk`, {
        contactIds: [...picked],
        language: "contact",
      }) as Promise<{ results: BulkResult[] }>,
    onSuccess: (res) => {
      setResults(res.results);
      void queryClient.invalidateQueries({ queryKey: portalSummaryKey(companyId) });
      const n = res.results.filter((r) => r.outcome === "invited").length;
      const unsent = res.results.some((r) => r.inviteUrl);
      toast({
        title: formatMessage(t[unsent ? "portal.bulk.doneLinks" : "portal.bulk.done"], {
          count: n,
        }),
      });
    },
    onError: (err) =>
      toast({
        title: err instanceof ApiError ? err.message : t["portal.invite.failed"],
        variant: "destructive",
      }),
  });

  const nameOf = (id: string) => contacts.find((c) => c.id === id)?.name ?? id;
  const emailOf = (id: string) => contacts.find((c) => c.id === id)?.email ?? "";
  // With no email provider nothing was sent: the links are for the supplier to share.
  const links = (results ?? []).filter((r) => r.inviteUrl);
  const copy = async (text: string, key: string, doneToast: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(key);
      toast({ title: doneToast });
    } catch {
      toast({ title: t["portal.bulk.copyFailed"], variant: "destructive" });
    }
  };
  const exportCsv = () => {
    const rows = [
      [t["portal.bulk.csv.customer"], t["portal.bulk.csv.email"], t["portal.bulk.csv.link"]],
      ...links.map((r) => [nameOf(r.contactId), emailOf(r.contactId), r.inviteUrl ?? ""]),
    ];
    const blob = new Blob(["\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "portal-invitation-links.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
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
        <div className="space-y-3">
          {links.length > 0 && (
            <Alert tone="info" title={t["portal.bulk.linksTitle"]} data-testid="bulk-links-panel">
              <p className="mb-2 text-small">{t["portal.bulk.linksBody"]}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() =>
                    void copy(
                      links.map((r) => `${nameOf(r.contactId)}\t${r.inviteUrl}`).join("\n"),
                      "all",
                      t["portal.bulk.linksCopied"]
                    )
                  }
                  data-testid="bulk-copy-all"
                >
                  {copiedId === "all" ? (
                    <Check className="me-2 h-4 w-4" aria-hidden />
                  ) : (
                    <Copy className="me-2 h-4 w-4" aria-hidden />
                  )}
                  {t["portal.bulk.copyAll"]}
                </Button>
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={exportCsv}
                  data-testid="bulk-export-links"
                >
                  <Download className="me-2 h-4 w-4" aria-hidden />
                  {t["portal.bulk.exportLinks"]}
                </Button>
              </div>
            </Alert>
          )}
          <ul className="max-h-72 space-y-1 overflow-y-auto text-small" data-testid="bulk-results">
            {results.map((r) => (
              <li key={r.contactId} className="flex items-center justify-between gap-3 py-1">
                <span className="truncate" dir="auto">
                  {nameOf(r.contactId)}
                </span>
                {r.inviteUrl ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11 shrink-0"
                    onClick={() =>
                      void copy(
                        r.inviteUrl!,
                        r.contactId,
                        t["customerContacts.linkCopiedToClipboard"]
                      )
                    }
                    aria-label={`${t["portal.invite.copyLink"]}: ${nameOf(r.contactId)}`}
                    data-testid={`bulk-copy-${r.contactId}`}
                  >
                    {copiedId === r.contactId ? (
                      <Check className="me-1.5 h-4 w-4" aria-hidden />
                    ) : (
                      <Copy className="me-1.5 h-4 w-4" aria-hidden />
                    )}
                    {t["portal.invite.copyLink"]}
                  </Button>
                ) : (
                  <span className="shrink-0 text-muted-foreground">
                    {t[`portal.bulk.outcome.${r.outcome}`]}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
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
              <li key={c.id}>
                {/* The whole row is the label: a 44px-tall tap target, not just the 20px box. */}
                <Label
                  htmlFor={`bulk-${c.id}`}
                  className="flex min-h-11 cursor-pointer items-center gap-3 p-3 font-normal"
                >
                  <Checkbox
                    id={`bulk-${c.id}`}
                    checked={picked.has(c.id)}
                    onCheckedChange={(v) => toggle(c.id, v === true)}
                    className="h-5 w-5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-small font-medium" dir="auto">
                      {c.name}
                    </span>
                    <span className="block truncate text-caption text-muted-foreground" dir="ltr">
                      {c.email}
                    </span>
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
