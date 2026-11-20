import { useState } from "react";
import { useTranslation, translateNow } from "@/lib/i18n";
import { T } from "@/components/layout/T";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Send, MessageSquare, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { apiRequest, portalQuery } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/format-date";

/** "17 Nov 2026 · 14:05" in the reader's language (Latin digits). */
function formatStamp(value: string, locale: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString(locale === "ar" ? "ar-AE-u-nu-latn" : "en-AE", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${formatDate(d, locale)} · ${time}`;
}

/**
 * Client portal messages (WP-F, spec 3.18): one thread, oldest first, with the composer at the
 * bottom of the thread.
 */
export default function PortalMessages() {
  const { t, locale } = useTranslation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");

  const { data: messages = [], isLoading } = useQuery<any[]>({
    ...portalQuery("/api/client-portal/messages"),
  });

  const sendMutation = useMutation({
    mutationFn: (payload: any) => apiRequest("POST", "/api/client-portal/messages", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-messages"] });
      setSubject("");
      setContent("");
      toast({
        title: translateNow("toasts.messageSent"),
        description: translateNow("toasts.nrAccountingWillRespondShortly"),
      });
    },
    onError: (e: any) =>
      toast({
        title: translateNow("toasts.failedToSend"),
        description: e.message,
        variant: "destructive",
      }),
  });

  function handleSend() {
    if (!content.trim()) return;
    sendMutation.mutate({ subject: subject.trim() || null, content: content.trim() });
  }

  const thread = [...messages].sort(
    (a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime()
  );

  return (
    <div className="mx-auto max-w-[760px] space-y-6">
      <PageHeader
        title={t["portal.doc.messagesTitle"]}
        description={t["portal.doc.messagesHint"]}
      />

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
            </div>
          ) : thread.length === 0 ? (
            <EmptyState
              headingLevel="h2"
              icon={MessageSquare}
              title={t["portal.doc.noMessagesTitle"]}
              description={t["portal.doc.noMessagesBody"]}
            />
          ) : (
            <ol className="divide-y divide-border" aria-label={t["portal.doc.messagesTitle"]}>
              {thread.map((msg: any) => (
                <li key={msg.id} className="space-y-1 px-5 py-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <p
                      className="min-w-0 truncate text-small font-semibold text-foreground"
                      dir="auto"
                    >
                      {msg.subject ?? ""}
                    </p>
                    <span className="shrink-0 text-caption text-muted-foreground">
                      {msg.createdAt ? formatStamp(msg.createdAt, locale) : ""}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-small text-foreground" dir="auto">
                    {msg.content}
                  </p>
                  {!msg.isRead && (
                    <StatusBadge tone="accent">
                      <T k="portal.doc.unread" />
                    </StatusBadge>
                  )}
                </li>
              ))}
            </ol>
          )}
          <form
            className="space-y-3 border-t border-border bg-surface-sunken p-4"
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
          >
            <Input
              className="h-11 md:h-9"
              aria-label={t["portal.doc.messageSubject"]}
              placeholder={t["portal.doc.messageSubject"]}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
            <Textarea
              aria-label={t["portal.doc.messageBody"]}
              placeholder={t["portal.doc.messageBody"]}
              rows={3}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={!content.trim() || sendMutation.isPending}
                data-testid="button-portal-send"
              >
                {sendMutation.isPending ? (
                  <Loader2 className="h-4 w-4 me-2 animate-spin" aria-hidden />
                ) : (
                  <Send className="h-4 w-4 me-2 rtl:-scale-x-100" aria-hidden />
                )}
                <T k="portal.doc.send" />
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
