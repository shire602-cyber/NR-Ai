import { useMutation, useQuery } from "@tanstack/react-query";
import { Laptop, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { queryClient } from "@/lib/queryClient";
import { describeUserAgent, revokeOtherSessions, revokeSession, sessionsKey, sortSessions, type SessionView } from "@/lib/security-api";
import { messages as pageMessages } from "./TwoFactorCard.i18n";

function formatWhen(iso: string | null, locale: string): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function SessionsCard() {
  const tr = pageMessages.useT();
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const { data, isLoading, isError } = useQuery<SessionView[]>({ queryKey: sessionsKey });
  const sessions = sortSessions(data ?? []);
  const others = sessions.filter((s) => !s.current).length;

  const refresh = () => queryClient.invalidateQueries({ queryKey: sessionsKey });
  const revokeOne = useMutation({
    mutationFn: (id: string) => revokeSession(id),
    onSuccess: () => {
      refresh();
      toast({ title: tr("sessionRevoked") });
    },
    onError: () => toast({ variant: "destructive", title: tr("errGeneric") }),
  });
  const revokeAll = useMutation({
    mutationFn: revokeOtherSessions,
    onSuccess: () => {
      refresh();
      toast({ title: tr("othersRevoked") });
    },
    onError: () => toast({ variant: "destructive", title: tr("errGeneric") }),
  });

  return (
    <Card data-testid="card-sessions">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="text-lg">
              <h2>{tr("sessionsTitle")}</h2>
            </CardTitle>
            <CardDescription>{tr("sessionsBody")}</CardDescription>
          </div>
          {others > 0 && (
            <Button variant="outline" size="sm" onClick={() => revokeAll.mutate()} disabled={revokeAll.isPending} data-testid="button-revoke-others">
              {tr("signOutOthers")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground">{tr("loading")}</p>}
        {isError && <p role="alert" className="text-sm text-destructive">{tr("errGeneric")}</p>}
        <ul className="divide-y" data-testid="list-sessions">
          {sessions.map((s) => {
            const label = describeUserAgent(s.userAgent);
            const mobile = label.os === "iOS" || label.os === "Android";
            const Icon = mobile ? Smartphone : Laptop;
            const name = [label.browser, label.os].filter(Boolean).join(" · ") || tr("unknownDevice");
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-3" data-testid={`session-${s.id}`}>
                <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {name}
                    {s.current && <Badge variant="secondary">{tr("thisDevice")}</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {s.ipAddress ? <span dir="ltr">{s.ipAddress}</span> : null}
                    {s.ipAddress ? " · " : ""}
                    {tr("lastActive", { when: formatWhen(s.lastUsedAt ?? s.createdAt, locale) })}
                  </p>
                </div>
                {!s.current && (
                  <Button variant="ghost" size="sm" onClick={() => revokeOne.mutate(s.id)} disabled={revokeOne.isPending} aria-label={tr("signOutDevice", { name })}>
                    {tr("signOut")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
