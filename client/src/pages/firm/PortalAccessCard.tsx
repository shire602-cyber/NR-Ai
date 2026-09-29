import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Mail, RefreshCw, UserCheck, UserX, XCircle } from "lucide-react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface PortalInvitation {
  id: string;
  email: string;
  status: "pending" | "expired";
  expiresAt: string;
}

interface PortalUser {
  id: string;
  email: string;
  name: string;
  active: boolean;
  lastLoginAt: string | null;
}

interface PortalAccess {
  invitations: PortalInvitation[];
  users: PortalUser[];
}

/**
 * Firm-side management of a client's portal access: invite by email, resend or
 * revoke pending invitations, deactivate or reactivate portal users. The server
 * decides who may do this (firm staff assigned to the client).
 */
export function PortalAccessCard({ companyId }: { companyId: string }) {
  const { locale } = useI18n();
  const en = locale === "en";
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const queryKey = [`/api/firm/clients/${companyId}/portal`];

  const { data, isLoading, error } = useQuery<PortalAccess>({ queryKey, enabled: !!companyId });
  const refresh = () => queryClient.invalidateQueries({ queryKey });

  const onError = (e: any) => {
    // An email failure still leaves a pending invitation the firm can resend.
    refresh();
    toast({
      variant: "destructive",
      title: en ? "Could not complete the action" : "تعذر إكمال الإجراء",
      description: e?.message,
    });
  };

  const invite = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/firm/clients/${companyId}/portal-invitations`, { email }),
    onSuccess: () => {
      setEmail("");
      refresh();
      toast({ title: en ? "Invitation sent" : "تم إرسال الدعوة" });
    },
    onError,
  });

  const resend = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/firm/portal-invitations/${id}/resend`),
    onSuccess: () => {
      refresh();
      toast({ title: en ? "Invitation resent" : "تمت إعادة إرسال الدعوة" });
    },
    onError,
  });

  const revoke = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/firm/portal-invitations/${id}/revoke`),
    onSuccess: () => {
      refresh();
      toast({ title: en ? "Invitation revoked" : "تم إلغاء الدعوة" });
    },
    onError,
  });

  const setActive = useMutation({
    mutationFn: ({ userId, active }: { userId: string; active: boolean }) =>
      apiRequest(
        "POST",
        `/api/firm/clients/${companyId}/portal-users/${userId}/${active ? "reactivate" : "deactivate"}`
      ),
    onSuccess: refresh,
    onError,
  });

  const invitations = data?.invitations ?? [];
  const users = data?.users ?? [];

  return (
    <Card data-testid="portal-access-card" dir={en ? "ltr" : "rtl"}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Mail className="w-4 h-4" />
          {en ? "Client portal access" : "الوصول إلى بوابة العميل"}
        </CardTitle>
        <CardDescription>
          {en
            ? "Invite people at this client to view their invoices and statements, upload documents and message you."
            : "ادعُ أشخاصاً لدى هذا العميل للاطلاع على فواتيرهم وكشوفهم ورفع المستندات ومراسلتك."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) invite.mutate();
          }}
        >
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={en ? "name@client-company.com" : "name@client-company.com"}
            aria-label={en ? "Email address to invite" : "البريد الإلكتروني للدعوة"}
            data-testid="input-portal-invite-email"
          />
          <Button
            type="submit"
            disabled={!email.trim() || invite.isPending}
            data-testid="button-invite-portal"
          >
            {invite.isPending
              ? en
                ? "Sending…"
                : "جارٍ الإرسال…"
              : en
                ? "Invite client to portal"
                : "دعوة العميل إلى البوابة"}
          </Button>
        </form>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {(error as Error).message}
          </p>
        )}

        <section aria-label={en ? "Portal users" : "مستخدمو البوابة"}>
          <h3 className="text-sm font-medium mb-2">{en ? "Portal users" : "مستخدمو البوابة"}</h3>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{en ? "Loading…" : "جارٍ التحميل…"}</p>
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="portal-users-empty">
              {en ? "No one has accepted an invitation yet." : "لم يقبل أحد الدعوة بعد."}
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {users.map((u) => (
                <li
                  key={u.id}
                  className="flex flex-wrap items-center justify-between gap-2 p-3"
                  data-testid={`portal-user-${u.id}`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{u.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                    <div className="text-xs text-muted-foreground">
                      {u.lastLoginAt
                        ? `${en ? "Last sign-in" : "آخر دخول"}: ${format(new Date(u.lastLoginAt), "dd MMM yyyy")}`
                        : en
                          ? "Never signed in"
                          : "لم يسجل الدخول بعد"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={u.active ? "default" : "secondary"}>
                      {u.active ? (en ? "Active" : "نشط") : en ? "Deactivated" : "معطّل"}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={setActive.isPending}
                      onClick={() => setActive.mutate({ userId: u.id, active: !u.active })}
                      data-testid={`button-toggle-portal-user-${u.id}`}
                    >
                      {u.active ? (
                        <>
                          <UserX className="w-3.5 h-3.5 me-1" />
                          {en ? "Deactivate" : "تعطيل"}
                        </>
                      ) : (
                        <>
                          <UserCheck className="w-3.5 h-3.5 me-1" />
                          {en ? "Reactivate" : "إعادة تفعيل"}
                        </>
                      )}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label={en ? "Pending invitations" : "الدعوات المعلقة"}>
          <h3 className="text-sm font-medium mb-2">
            {en ? "Pending invitations" : "الدعوات المعلقة"}
          </h3>
          {invitations.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="portal-invites-empty">
              {en ? "No pending invitations." : "لا توجد دعوات معلقة."}
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {invitations.map((i) => (
                <li
                  key={i.id}
                  className="flex flex-wrap items-center justify-between gap-2 p-3"
                  data-testid={`portal-invite-${i.id}`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{i.email}</div>
                    <div className="text-xs text-muted-foreground">
                      {i.status === "expired"
                        ? en
                          ? "Expired"
                          : "منتهية"
                        : `${en ? "Expires" : "تنتهي"} ${format(new Date(i.expiresAt), "dd MMM yyyy")}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={resend.isPending}
                      onClick={() => resend.mutate(i.id)}
                      data-testid={`button-resend-invite-${i.id}`}
                    >
                      <RefreshCw className="w-3.5 h-3.5 me-1" />
                      {en ? "Resend" : "إعادة إرسال"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(i.id)}
                      data-testid={`button-revoke-invite-${i.id}`}
                    >
                      <XCircle className="w-3.5 h-3.5 me-1" />
                      {en ? "Revoke" : "إلغاء"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
