import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Link2, Loader2, Mail, RotateCw, Send, UserRoundX, XCircle } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { formatDate } from "@/lib/format-date";
import { formatMessage, useTranslation } from "@/lib/i18n";
import {
  PORTAL_INVITE_MESSAGE_MAX,
  PORTAL_INVITE_TTL_DAYS,
  type PortalInviteLanguage,
} from "@shared/validators/portal-invitations";

export interface PortalSheetContact {
  id: string;
  name: string;
  email: string | null;
  contactPerson?: string | null;
  preferredLanguage?: string | null;
}

interface AccessData {
  contact: { id: string; email: string | null };
  people: Array<{ id: string; name: string; email: string; since: string; lastSeenAt: string | null }>;
  invitations: Array<{
    id: string;
    email: string;
    status: "pending" | "accepted" | "revoked" | "expired";
    expiresAt: string;
    lastSentAt: string | null;
    resendIn: number;
    language: PortalInviteLanguage;
  }>;
}

interface InviteResponse {
  delivery: "email" | "queued" | "link";
  inviteUrl?: string;
  invitation: { id: string; email: string };
}

const STATUS_TONE: Record<string, StatusTone> = {
  pending: "info",
  expired: "warning",
  revoked: "neutral",
  accepted: "success",
};

/** The contact's language preference, else both languages (the customer's language is unknown). */
export function defaultInviteLanguage(pref: string | null | undefined): PortalInviteLanguage {
  return pref === "ar" ? "ar" : pref === "en" ? "en" : "bilingual";
}

const accessKey = (companyId: string, contactId: string) =>
  [`/api/companies/${companyId}/customer-contacts/${contactId}/portal-access`] as const;
export const portalSummaryKey = (companyId: string) =>
  [`/api/companies/${companyId}/portal-access/summary`] as const;

type Confirm =
  | { kind: "revoke"; id: string; email: string }
  | { kind: "remove"; id: string; name: string }
  | null;

/**
 * "Portal access" for one customer: who can sign in, the invitations (resend, revoke) and a form
 * to invite someone, with the email language and an optional note. Nothing is reported as sent
 * without an email provider: the staff member gets the link to share instead.
 */
export function PortalAccessSheet({
  open,
  onOpenChange,
  companyId,
  supplierName,
  contact,
  onManageLinks,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  supplierName: string;
  contact: PortalSheetContact | null;
  onManageLinks: () => void;
}) {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { can, gate } = useCompanyPermission();
  const canInvite = can("documents.write");
  const contactId = contact?.id ?? "";

  const { data, isLoading } = useQuery<AccessData>({
    queryKey: accessKey(companyId, contactId),
    enabled: open && !!contactId && !!companyId,
    staleTime: 0,
  });

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [language, setLanguage] = useState<PortalInviteLanguage>("en");
  const [note, setNote] = useState("");
  const [shownLink, setShownLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  // Seconds left before Resend works again, per invitation id (counts down once a second).
  const [cooldown, setCooldown] = useState<Record<string, number>>({});

  // Prefill from the contact each time the sheet opens for a customer.
  useEffect(() => {
    if (!open || !contact) return;
    setEmail(contact.email ?? "");
    setName(contact.contactPerson ?? "");
    setLanguage(defaultInviteLanguage(contact.preferredLanguage));
    setNote("");
    setShownLink(null);
    setCopied(false);
  }, [open, contact?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!data) return;
    setCooldown(Object.fromEntries(data.invitations.map((i) => [i.id, i.resendIn])));
  }, [data]);
  useEffect(() => {
    if (!Object.values(cooldown).some((n) => n > 0)) return;
    const id = window.setInterval(
      () =>
        setCooldown((c) =>
          Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Math.max(0, v - 1)]))
        ),
      1000
    );
    return () => window.clearInterval(id);
  }, [cooldown]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: accessKey(companyId, contactId) });
    void queryClient.invalidateQueries({ queryKey: portalSummaryKey(companyId) });
  };
  const fail = (err: unknown) =>
    toast({
      title: err instanceof ApiError ? err.message : t["portal.invite.failed"],
      variant: "destructive",
    });
  const reportDelivery = (res: InviteResponse) => {
    if (res.delivery === "link" && res.inviteUrl) {
      setShownLink(res.inviteUrl);
      toast({ title: t["portal.invite.linkCreated"] });
    } else if (res.delivery === "email") {
      toast({ title: formatMessage(t["portal.invite.sentTo"], { email: res.invitation.email }) });
    } else {
      toast({ title: t["portal.invite.queued"] });
    }
  };

  const base = `/api/companies/${companyId}`;
  const invite = useMutation({
    mutationFn: () =>
      apiRequest("POST", `${base}/customer-contacts/${contactId}/portal-invitations`, {
        email: email.trim() || undefined,
        name: name.trim() || undefined,
        language,
        message: note.trim() || undefined,
        saveEmailToContact: !contact?.email && !!email.trim() ? true : undefined,
      }) as Promise<InviteResponse>,
    onSuccess: (res) => {
      reportDelivery(res);
      setNote("");
      refresh();
    },
    onError: fail,
  });
  const resend = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `${base}/portal-invitations/${id}/resend`, {}) as Promise<InviteResponse>,
    onSuccess: (res) => {
      reportDelivery(res);
      refresh();
    },
    onError: fail,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `${base}/portal-invitations/${id}/revoke`, {}),
    onSuccess: () => {
      toast({ title: t["portal.invite.revoked"] });
      refresh();
    },
    onError: fail,
  });
  const removeAccess = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `${base}/portal-accounts/${id}`),
    onSuccess: () => {
      toast({ title: t["portal.access.removed"] });
      refresh();
    },
    onError: fail,
  });

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  // The subject the customer will see, one line per language (each in its own direction).
  const preview = useMemo(() => {
    const en = {
      lang: "en",
      text: formatMessage(t["portal.invite.previewSubjectEn"], { supplier: supplierName }),
    };
    const ar = {
      lang: "ar",
      text: formatMessage(t["portal.invite.previewSubjectAr"], { supplier: supplierName }),
    };
    return language === "ar" ? [ar] : language === "bilingual" ? [en, ar] : [en];
  }, [language, supplierName, t]);

  const copyLink = async () => {
    if (!shownLink) return;
    try {
      await navigator.clipboard.writeText(shownLink);
      setCopied(true);
      toast({ title: t["customerContacts.linkCopiedToClipboard"] });
    } catch {
      /* the field is selectable */
    }
  };

  const langs: Array<{ id: PortalInviteLanguage; label: string; lang?: string }> = [
    { id: "en", label: "English", lang: "en" },
    { id: "ar", label: "العربية", lang: "ar" },
    { id: "bilingual", label: t["portal.invite.both"] },
  ];

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side={locale === "ar" ? "left" : "right"}
          className="flex w-full max-w-none flex-col gap-0 overflow-y-auto p-0 sm:max-w-[500px]"
          data-testid="portal-access-sheet"
        >
          <SheetHeader className="border-b border-border p-5 pb-4">
            <SheetTitle>{t["customerContacts.portalAccess"]}</SheetTitle>
            <SheetDescription dir="auto">
              {contact ? formatMessage(t["portal.access.forName"], { name: contact.name }) : ""}
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-7 p-5">
            {/* People with access */}
            <section aria-labelledby="pa-people">
              <h3 id="pa-people" className="text-small font-semibold">
                {t["portal.access.people"]}
              </h3>
              {isLoading ? (
                <Skeleton className="mt-2 h-14" />
              ) : (data?.people.length ?? 0) === 0 ? (
                <p className="mt-1 text-small text-muted-foreground" data-testid="pa-people-empty">
                  {t["portal.access.noPeople"]}
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                  {data!.people.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 p-3" data-testid={`pa-person-${p.id}`}>
                      <span className="min-w-0">
                        <span className="block truncate text-small font-medium" dir="auto">
                          {p.name}
                        </span>
                        <span className="block truncate text-caption text-muted-foreground" dir="ltr">
                          {p.email}
                        </span>
                        <span className="block text-caption text-muted-foreground">
                          {p.lastSeenAt
                            ? formatMessage(t["portal.access.lastSeen"], {
                                date: formatDate(p.lastSeenAt, locale),
                              })
                            : t["portal.access.neverSignedIn"]}
                        </span>
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-11 shrink-0 text-destructive hover:text-destructive"
                        onClick={() => setConfirm({ kind: "remove", id: p.id, name: p.name })}
                        {...gate("documents.write")}
                        data-testid={`pa-remove-${p.id}`}
                      >
                        <UserRoundX className="me-1.5 h-4 w-4" aria-hidden />
                        {t["portal.access.remove"]}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Invitations */}
            <section aria-labelledby="pa-invites">
              <h3 id="pa-invites" className="text-small font-semibold">
                {t["portal.access.invitations"]}
              </h3>
              {!isLoading && (data?.invitations.length ?? 0) === 0 ? (
                <p className="mt-1 text-small text-muted-foreground" data-testid="pa-invites-empty">
                  {t["portal.access.noInvitations"]}
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {(data?.invitations ?? []).map((inv) => {
                    const wait = cooldown[inv.id] ?? 0;
                    const closed = inv.status === "revoked";
                    return (
                      <li
                        key={inv.id}
                        className="rounded-lg border border-border p-3"
                        data-testid={`pa-invite-${inv.id}`}
                        data-status={inv.status}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="min-w-0 truncate text-small font-medium" dir="ltr">
                            {inv.email}
                          </span>
                          <StatusBadge tone={STATUS_TONE[inv.status] ?? "neutral"}>
                            {t[`portal.access.status.${inv.status}`]}
                          </StatusBadge>
                        </div>
                        <p className="mt-0.5 text-caption text-muted-foreground">
                          {inv.status === "pending"
                            ? formatMessage(t["portal.access.expires"], {
                                date: formatDate(inv.expiresAt, locale),
                              })
                            : inv.status === "expired"
                              ? formatMessage(t["portal.access.expiredOn"], {
                                  date: formatDate(inv.expiresAt, locale),
                                })
                              : t["portal.access.cancelled"]}
                        </p>
                        {!closed && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="min-h-11"
                              disabled={wait > 0 || resend.isPending || !canInvite}
                              onClick={() => resend.mutate(inv.id)}
                              data-testid={`pa-resend-${inv.id}`}
                            >
                              {resend.isPending && resend.variables === inv.id ? (
                                <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
                              ) : (
                                <RotateCw className="me-1.5 h-4 w-4" aria-hidden />
                              )}
                              {wait > 0
                                ? formatMessage(t["portal.access.resendIn"], { seconds: wait })
                                : t["portal.access.resend"]}
                            </Button>
                            {inv.status === "pending" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="min-h-11 text-destructive hover:text-destructive"
                                onClick={() => setConfirm({ kind: "revoke", id: inv.id, email: inv.email })}
                                {...gate("documents.write")}
                                data-testid={`pa-revoke-${inv.id}`}
                              >
                                <XCircle className="me-1.5 h-4 w-4" aria-hidden />
                                {t["portal.access.revoke"]}
                              </Button>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {shownLink && (
              <Alert tone="info" title={t["portal.invite.linkTitle"]} data-testid="pa-link-panel">
                <p className="mb-2 text-small">{t["portal.invite.linkBody"]}</p>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={shownLink}
                    dir="ltr"
                    className="h-11 text-sm"
                    onFocus={(e) => e.currentTarget.select()}
                    aria-label={t["portal.invite.linkTitle"]}
                    data-testid="pa-link-input"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 shrink-0"
                    onClick={() => void copyLink()}
                    aria-label={t["portal.invite.copyLink"]}
                    data-testid="pa-copy-link"
                  >
                    {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                  </Button>
                </div>
              </Alert>
            )}

            {/* Invite someone */}
            <section aria-labelledby="pa-invite">
              <h3 id="pa-invite" className="text-small font-semibold">
                {t["portal.access.inviteSomeone"]}
              </h3>
              <form
                className="mt-3 space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (emailOk && canInvite) invite.mutate();
                }}
                data-testid="pa-invite-form"
              >
                <div>
                  <Label htmlFor="pa-email">{t["portal.email"]}</Label>
                  <Input
                    id="pa-email"
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    dir="ltr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1.5 h-11 text-base"
                    aria-describedby={!contact?.email ? "pa-email-help" : undefined}
                    data-testid="pa-email"
                  />
                  {!contact?.email && (
                    <p id="pa-email-help" className="mt-1 text-caption text-muted-foreground">
                      {t["portal.invite.noEmailHelp"]}
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="pa-name">{t["portal.invite.nameLabel"]}</Label>
                  <Input
                    id="pa-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1.5 h-11 text-base"
                    dir="auto"
                    maxLength={100}
                    data-testid="pa-name"
                  />
                </div>
                <fieldset>
                  <legend className="text-small font-medium">{t["portal.invite.languageLabel"]}</legend>
                  <div className="mt-1.5 inline-flex w-full rounded-md border border-border p-0.5 sm:w-auto" role="radiogroup">
                    {langs.map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        role="radio"
                        aria-checked={language === l.id}
                        lang={l.lang}
                        onClick={() => setLanguage(l.id)}
                        className={`min-h-11 flex-1 rounded px-4 text-small font-medium sm:flex-none ${
                          language === l.id ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                        }`}
                        data-testid={`pa-lang-${l.id}`}
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <div>
                  <Label htmlFor="pa-note">{t["portal.invite.noteLabel"]}</Label>
                  <Textarea
                    id="pa-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value.slice(0, PORTAL_INVITE_MESSAGE_MAX))}
                    rows={3}
                    className="mt-1.5 text-base"
                    dir="auto"
                    data-testid="pa-note"
                  />
                  <p className="mt-1 text-end text-caption text-muted-foreground tabular-nums">
                    {note.length}/{PORTAL_INVITE_MESSAGE_MAX}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3" data-testid="pa-preview">
                  <p className="flex items-center gap-1.5 text-caption font-medium text-muted-foreground">
                    <Mail className="h-3.5 w-3.5" aria-hidden />
                    {t["portal.invite.previewTitle"]}
                  </p>
                  {preview.map((line) => (
                    <p
                      key={line.lang}
                      className="mt-1 text-small font-medium"
                      lang={line.lang}
                      dir={line.lang === "ar" ? "rtl" : "ltr"}
                      data-testid={`pa-preview-${line.lang}`}
                    >
                      {line.text}
                    </p>
                  ))}
                  <p className="mt-0.5 text-caption text-muted-foreground">
                    {formatMessage(t["portal.invite.previewExpiry"], { days: PORTAL_INVITE_TTL_DAYS })}
                  </p>
                </div>
                <Button
                  type="submit"
                  className="h-11 w-full"
                  disabled={!emailOk || invite.isPending || !canInvite}
                  {...(canInvite ? {} : gate("documents.write"))}
                  data-testid="pa-send"
                >
                  {invite.isPending ? (
                    <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Send className="me-2 h-4 w-4 rtl:-scale-x-100" aria-hidden />
                  )}
                  {t["portal.invite.send"]}
                </Button>
              </form>
            </section>

            {/* Share link (no sign-in) */}
            <section aria-labelledby="pa-share" className="border-t border-border pt-5">
              <h3 id="pa-share" className="text-small font-semibold">
                {t["portal.access.shareLink"]}
              </h3>
              <p className="mt-1 text-small text-muted-foreground">{t["portal.access.shareLinkHelp"]}</p>
              <Button
                variant="outline"
                className="mt-3 min-h-11"
                onClick={onManageLinks}
                data-testid="pa-manage-links"
              >
                <Link2 className="me-2 h-4 w-4" aria-hidden />
                {t["portal.access.manageLinks"]}
              </Button>
            </section>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "remove" ? t["portal.access.remove"] : t["portal.access.revoke"]}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "remove"
                ? formatMessage(t["portal.access.removeConfirm"], { name: confirm.name })
                : confirm?.kind === "revoke"
                  ? formatMessage(t["portal.access.revokeConfirm"], { email: confirm.email })
                  : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t["common.cancel"]}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirm?.kind === "remove") removeAccess.mutate(confirm.id);
                else if (confirm?.kind === "revoke") revoke.mutate(confirm.id);
                setConfirm(null);
              }}
              data-testid="pa-confirm"
            >
              {confirm?.kind === "remove" ? t["portal.access.remove"] : t["portal.access.revoke"]}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
