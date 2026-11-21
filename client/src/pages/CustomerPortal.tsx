import { T } from "@/components/layout/T";
// The light public root does not load the app shell's stylesheets; these pages need the
// mobile row-card tables and the RTL rules.
import "@/styles/rtl.css";
import "@/styles/mobile.css";
import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { ScrollTabs } from "@/components/ui/scroll-tabs";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Alert } from "@/components/ui/alert";
import { FileDrop } from "@/components/ui/file-drop";
import { Money, MoneyCell } from "@/components/ui/money";
import { StatementOfAccount } from "@/components/documents/StatementOfAccount";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { RowActionButton, RowActions } from "@/components/ui/row-actions";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertCircle, Clock, CreditCard, FileDown, FileText, Loader2, Printer } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { LinkLanguageSwitch } from "@/components/customer-link/LinkLanguageSwitch";
import { useDocumentTitle, useLinkLocale } from "@/lib/customer-link";
import { apiUrl } from "@/lib/api";
import { DateText } from "@/components/documents/DateText";
import { formatDate } from "@/lib/format-date";
import { customerEInvoiceLabel, type CustomerEInvoiceOutcome } from "@/lib/einvoice-outcome";
import { formatMessage, useTranslation } from "@/lib/i18n";

/**
 * Customer portal (W4-D: R16-04/06/07/14/15/16/19). Reached with a portal link token
 * (/portal/<token>), or by signing in with a one-time code (/portal/login?c=<companyId>), which
 * keeps the short-lived session token in sessionStorage (/portal/session).
 */

interface PortalInfo {
  customerName: string;
  customerNameAr: string | null;
  contactPerson: string | null;
  companyId: string;
  companyName: string;
  companyLogo: string | null;
  /** The customer's own language when the firm recorded one (en | ar). */
  preferredLanguage?: string | null;
  /** The company's language (en | ar): the portal opens in it until the viewer switches. */
  companyLocale?: string | null;
  onlinePayment: { available: boolean; status: string };
}

interface PortalInvoice {
  id: string;
  number: string;
  invoiceType: string;
  date: string;
  dueDate: string | null;
  currency: string;
  total: number;
  amountDue: number;
  paymentStatus: "paid" | "partially_paid" | "overdue" | "unpaid" | "credit";
  canPayOnline?: boolean;
  einvoice: (CustomerEInvoiceOutcome & { uuid: string | null; hasXml: boolean }) | null;
}

interface StatementSection {
  currency: string;
  openingBalance: number;
  closingBalance: number;
  lines: Array<{
    date: string;
    type: string;
    reference: string;
    debit: number;
    credit: number;
    balance: number;
  }>;
  aging: { current: number; days30: number; days60: number; days90: number; over90: number };
}

interface PortalQuote {
  id: string;
  number: string;
  date: string;
  currency: string;
  total: number;
  status: string;
}

interface PortalDocument {
  id: string;
  name: string;
  fileName: string;
  createdAt: string;
}

/** Catalogs this page reads (declared so an in-page language switch loads them). */
const PORTAL_NAMESPACES = ["portal", "customerLink"];

const SESSION_KEY = "muhasib.portalSession";

const STATUS_TONE: Record<PortalInvoice["paymentStatus"], StatusTone> = {
  paid: "success",
  partially_paid: "warning",
  overdue: "danger",
  unpaid: "warning",
  credit: "neutral",
};

/** An answer from the portal API; the HTTP status and code decide what the page says. */
class PortalHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(`${status} ${code}`);
  }
}

async function readJson<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { code?: string };
  if (!res.ok) throw new PortalHttpError(res.status, body.code ?? "");
  return body as T;
}

async function getJson<T>(path: string): Promise<T> {
  return readJson<T>(await fetch(apiUrl(path)));
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  return readJson<T>(
    await fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

type LinkProblem = "invalid" | "expired" | "revoked" | "busy" | "failed";

/** What went wrong with a request, from the HTTP status (never from English server text). */
function problemOf(error: unknown): LinkProblem {
  if (!(error instanceof PortalHttpError)) return "failed";
  if (error.status === 404) return "invalid";
  if (error.status === 410) return error.code === "PORTAL_LINK_EXPIRED" ? "expired" : "revoked";
  if (error.status === 429) return "busy";
  return "failed";
}

/** Arabic needs four count forms (1, 2, 3-10, 11+); English uses 1 and many. */
function overdueKey(days: number): string {
  if (days === 1) return "customerLink.overdueOne";
  if (days === 2) return "customerLink.overdueTwo";
  return days >= 3 && days <= 10 ? "customerLink.overdueFew" : "customerLink.overdueMany";
}

function daysOverdue(dueDate: string | null): number {
  if (!dueDate) return 0;
  const due = new Date(dueDate.length === 10 ? `${dueDate}T00:00:00` : dueDate);
  return Math.max(0, Math.floor((Date.now() - due.getTime()) / 86_400_000));
}

function readSession(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function PortalLogin() {
  const { t, locale } = useTranslation(PORTAL_NAMESPACES);
  const [, setLocation] = useLocation();
  const companyId =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("c") : null;
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useLinkLocale(true);
  useDocumentTitle(t["portal.signInTitle"]);

  const failure = (e: unknown) => {
    const problem = problemOf(e);
    setErrorKey(
      e instanceof PortalHttpError && e.status === 401
        ? "customerLink.codeInvalid"
        : problem === "busy"
          ? "customerLink.busyBody"
          : "customerLink.actionFailed"
    );
  };
  const request = async () => {
    setBusy(true);
    setErrorKey(null);
    try {
      await postJson("/api/portal/login/request", { companyId, email });
      setStep("code");
    } catch (e) {
      failure(e);
    } finally {
      setBusy(false);
    }
  };
  const verify = async () => {
    setBusy(true);
    setErrorKey(null);
    try {
      const r = await postJson<{ token: string }>("/api/portal/login/verify", {
        companyId,
        email,
        code,
      });
      try {
        sessionStorage.setItem(SESSION_KEY, r.token);
      } catch {
        // private mode: fall back to the token in the URL
        setLocation(`/portal/${r.token}`);
        return;
      }
      setLocation("/portal/session");
    } catch (e) {
      failure(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main
      className="min-h-screen bg-background flex flex-col items-center justify-center gap-2 p-4"
      dir={locale === "ar" ? "rtl" : "ltr"}
    >
      <div className="flex w-full max-w-md justify-end">
        <LinkLanguageSwitch testId="portal-language" />
      </div>
      <Card className="max-w-md w-full">
        <CardHeader>
          <h1 className="text-h3 font-semibold leading-none tracking-tight">
            <T k="portal.signInTitle" />
          </h1>
        </CardHeader>
        <CardContent className="space-y-4">
          {!companyId ? (
            <p className="text-muted-foreground">
              <T k="portal.signInNeedsLink" />
            </p>
          ) : step === "email" ? (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (email && !busy) void request();
              }}
            >
              <Label htmlFor="portal-email">
                <T k="portal.email" />
              </Label>
              <Input
                id="portal-email"
                type="email"
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
              <Button type="submit" disabled={busy || !email} className="w-full">
                <T k="portal.sendCode" />
              </Button>
            </form>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (code.length === 6 && !busy) void verify();
              }}
            >
              <p className="text-sm text-muted-foreground">
                <T k="portal.codeSent" />
              </p>
              <Label htmlFor="portal-code">
                <T k="portal.code" />
              </Label>
              <Input
                id="portal-code"
                inputMode="numeric"
                dir="ltr"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                autoComplete="one-time-code"
              />
              <Button type="submit" disabled={busy || code.length !== 6} className="w-full">
                <T k="portal.signIn" />
              </Button>
            </form>
          )}
          {errorKey && (
            <p className="text-sm text-destructive" role="alert">
              {t[errorKey]}
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

export default function CustomerPortal() {
  const params = useParams<{ token: string }>();
  if (params.token === "login") return <PortalLogin />;
  const token = params.token === "session" ? readSession() : params.token;
  return <PortalHome token={token} />;
}

interface PortalOverview {
  info: PortalInfo;
  invoices: PortalInvoice[];
}

type Notice = { tone: "success" | "warning" | "danger"; key: string };

/** The notice for `?payment=success|cancelled`, the query the payment page returns with. */
function paymentReturnNotice(): Notice | null {
  if (typeof window === "undefined") return null;
  const result = new URLSearchParams(window.location.search).get("payment");
  if (result === "success") return { tone: "success", key: "customerLink.paymentSuccess" };
  if (result === "cancelled") return { tone: "warning", key: "customerLink.paymentCancelled" };
  return null;
}

function PortalHome({ token }: { token: string | null }) {
  const { t, locale } = useTranslation(PORTAL_NAMESPACES);
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<Notice | null>(paymentReturnNotice);
  const [tab, setTab] = useState("invoices");
  const [payingId, setPayingId] = useState<string | null>(null);
  const [signer, setSigner] = useState("");
  const [uploading, setUploading] = useState(false);
  const base = `/api/portal/${token}`;

  // The first screen is one request (who, which company, the invoices); the other tabs are
  // fetched when they are opened.
  const overview = useQuery<PortalOverview>({
    queryKey: ["portal-overview", token],
    queryFn: () => getJson<PortalOverview>(`${base}/overview`),
    enabled: !!token,
    retry: false,
  });
  const info = overview.data?.info;
  const invoices = overview.data?.invoices ?? [];
  const ready = !!info;

  useLinkLocale(!overview.isLoading, info?.preferredLanguage, info?.companyLocale);

  const { data: statement } = useQuery<{ asOf: string; sections: StatementSection[] }>({
    queryKey: ["portal-statement", token],
    queryFn: () => getJson(`${base}/statement`),
    enabled: !!token && ready && tab === "statement",
    retry: false,
  });
  const { data: quotes = [] } = useQuery<PortalQuote[]>({
    queryKey: ["portal-quotes", token],
    queryFn: () => getJson<PortalQuote[]>(`${base}/quotes`),
    enabled: !!token && ready && tab === "quotes",
    retry: false,
  });
  const { data: documents = [] } = useQuery<PortalDocument[]>({
    queryKey: ["portal-documents", token],
    queryFn: () => getJson<PortalDocument[]>(`${base}/documents`),
    enabled: !!token && ready && tab === "documents",
    retry: false,
  });

  // Coming back from the payment page: the notice was read on first render; drop the query
  // string once and refresh the balances after a successful payment.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("payment");
    if (result !== "success" && result !== "cancelled") return;
    params.delete("payment");
    const rest = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : ""));
    if (result === "success") {
      void queryClient.invalidateQueries({ queryKey: ["portal-overview", token] });
    }
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const problem: LinkProblem | null = !token
    ? "revoked"
    : overview.error
      ? problemOf(overview.error)
      : null;
  const titleKey = !token
    ? "portal.sessionEnded"
    : problem === "invalid"
      ? "customerLink.invalidTitle"
      : problem === "expired"
        ? "customerLink.expiredTitle"
        : problem === "revoked"
          ? "customerLink.revokedTitle"
          : problem === "busy"
            ? "customerLink.busyTitle"
            : problem === "failed"
              ? "customerLink.loadFailedTitle"
              : null;
  useDocumentTitle(
    titleKey
      ? t[titleKey]
      : info
        ? formatMessage(t["customerLink.pageTitle"], { company: info.companyName })
        : t["customerLink.pageTitleBare"]
  );

  if (!token) {
    return (
      <PortalMessage icon={Clock} title={<T k="portal.sessionEnded" />}>
        <T k="customerLink.endedBody" />
      </PortalMessage>
    );
  }

  if (overview.isLoading) return <PortalSkeleton />;

  if (problem || !info) {
    const bodyKey =
      problem === "invalid"
        ? "customerLink.invalidBody"
        : problem === "busy"
          ? "customerLink.busyBody"
          : problem === "failed" || !problem
            ? "customerLink.loadFailedBody"
            : "customerLink.endedBody";
    const retryable = problem === "busy" || problem === "failed" || !problem;
    return (
      <PortalMessage
        icon={problem === "expired" || problem === "revoked" ? Clock : AlertCircle}
        title={<T k={titleKey ?? "customerLink.loadFailedTitle"} />}
        action={
          retryable ? (
            <Button variant="outline" onClick={() => void overview.refetch()}>
              <T k="customerLink.retry" />
            </Button>
          ) : undefined
        }
      >
        <T k={bodyKey} />
      </PortalMessage>
    );
  }

  const open = invoices.filter((i) => i.invoiceType !== "credit_note");
  const defaultCurrency = open[0]?.currency ?? "AED";
  const totalOutstanding = open.reduce((s, i) => s + i.amountDue, 0);
  const totalPaid = open.reduce((s, i) => s + (i.total - i.amountDue), 0);
  const customerName =
    locale === "ar" && info.customerNameAr ? info.customerNameAr : info.customerName;

  const pay = async (invoiceId: string) => {
    setPayingId(invoiceId);
    setNotice(null);
    try {
      const r = await postJson<{ url: string }>(`${base}/invoices/${invoiceId}/pay`, {});
      // Stay in the busy state while the browser leaves for the payment page.
      window.location.assign(r.url);
    } catch (e) {
      setPayingId(null);
      setNotice({
        tone: "danger",
        key:
          e instanceof PortalHttpError && e.code === "PAYMENTS_REQUIRES_EXTERNAL"
            ? "customerLink.payUnavailable"
            : "customerLink.payFailed",
      });
    }
  };

  const respond = async (quoteId: string, decision: "accepted" | "declined") => {
    try {
      await postJson(`${base}/quotes/${quoteId}/respond`, { decision, signerName: signer });
      await queryClient.invalidateQueries({ queryKey: ["portal-quotes", token] });
      setNotice({
        tone: "success",
        key: decision === "accepted" ? "portal.quoteAccepted" : "portal.quoteDeclined",
      });
    } catch {
      setNotice({ tone: "danger", key: "customerLink.actionFailed" });
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("name", file.name);
      form.append("file", file, file.name);
      const res = await fetch(apiUrl(`${base}/documents`), { method: "POST", body: form });
      if (!res.ok) {
        setNotice({ tone: "danger", key: "portal.uploadFailed" });
        return;
      }
      setNotice({ tone: "success", key: "portal.uploaded" });
      await queryClient.invalidateQueries({ queryKey: ["portal-documents", token] });
    } catch {
      setNotice({ tone: "danger", key: "portal.uploadFailed" });
    } finally {
      setUploading(false);
    }
  };

  const openPdf = (path: string) => window.open(apiUrl(`${base}${path}`), "_blank");

  return (
    <div
      className="flex min-h-screen flex-col bg-background print:min-h-0"
      dir={locale === "ar" ? "rtl" : "ltr"}
    >
      <header className="border-b border-border bg-card">
        <div aria-hidden className="h-0.5 bg-primary print:hidden" />
        <div className="mx-auto flex max-w-content items-center justify-between gap-4 px-4 py-4 sm:px-8">
          <div className="min-w-0">
            <h1 className="truncate text-h3 font-semibold text-foreground" dir="auto">
              {info.companyName}
            </h1>
            <p className="text-caption text-muted-foreground">
              <T k="portal.doc.customerPortal" />
            </p>
          </div>
          <div className="flex min-w-0 max-w-[60%] items-center gap-1">
            <p
              className="min-w-0 truncate text-small font-medium text-foreground"
              dir="auto"
              data-testid="portal-customer-name"
            >
              {customerName}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="hidden shrink-0 sm:inline-flex print:hidden"
              onClick={() => window.print()}
              data-testid="portal-print"
            >
              <Printer className="h-4 w-4" aria-hidden />
              <T k="customerLink.print" />
            </Button>
            <LinkLanguageSwitch testId="portal-language" />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-content flex-1 space-y-6 px-4 py-6 sm:px-8 sm:py-8">
        {notice && (
          <Alert tone={notice.tone} role={notice.tone === "danger" ? "alert" : "status"}>
            {t[notice.key]}
          </Alert>
        )}
        {open.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label={<T k="portal.doc.outstanding" />}
              value={
                <Money
                  amount={totalOutstanding}
                  currency={defaultCurrency}
                  className={
                    open.some((i) => i.paymentStatus === "overdue") ? "text-negative" : undefined
                  }
                />
              }
              hint={<T k="portal.doc.openInvoicesHint" />}
              testId="portal-kpi-outstanding"
            />
            <StatCard
              label={<T k="portal.doc.paid" />}
              value={<Money amount={totalPaid} currency={defaultCurrency} />}
              testId="portal-kpi-paid"
            />
            <StatCard
              label={<T k="portal.doc.invoices" />}
              value={<span className="tabular-nums">{open.length}</span>}
              hint={<T k="portal.doc.issuedHint" />}
              testId="portal-kpi-invoices"
            />
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab}>
          <ScrollTabs aria-label={t["portal.doc.sections"]} className="print:hidden">
            <TabsTrigger value="invoices" className="[@media(pointer:coarse)]:min-h-11">
              <T k="portal.doc.tabInvoices" />
            </TabsTrigger>
            <TabsTrigger value="statement" className="[@media(pointer:coarse)]:min-h-11">
              <T k="portal.doc.tabStatement" />
            </TabsTrigger>
            <TabsTrigger value="quotes" className="[@media(pointer:coarse)]:min-h-11">
              <T k="portal.doc.tabQuotes" />
            </TabsTrigger>
            <TabsTrigger value="documents" className="[@media(pointer:coarse)]:min-h-11">
              <T k="portal.doc.tabDocuments" />
            </TabsTrigger>
          </ScrollTabs>

          <TabsContent value="invoices">
            <Card>
              <CardContent className="p-0">
                {invoices.length === 0 ? (
                  <EmptyState
                    icon={FileText}
                    title={t["portal.doc.noInvoicesTitle"]}
                    description={t["portal.doc.noInvoicesBody"]}
                  />
                ) : (
                  <Table className="row-cards">
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          <T k="portal.doc.invoiceCol" />
                        </TableHead>
                        <TableHead>
                          <T k="portal.doc.dueDate" />
                        </TableHead>
                        <TableHead data-numeric>
                          <T k="portal.doc.amountDue" />
                        </TableHead>
                        <TableHead>
                          <T k="portal.doc.status" />
                        </TableHead>
                        <TableHead className="print:hidden">
                          <span className="sr-only">
                            <T k="portal.doc.actions" />
                          </span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoices.map((invoice) => {
                        const late =
                          invoice.paymentStatus === "overdue" ? daysOverdue(invoice.dueDate) : 0;
                        const paying = payingId === invoice.id;
                        const einvoiceLabel =
                          invoice.einvoice && customerEInvoiceLabel(invoice.einvoice, t);
                        return (
                          <TableRow key={invoice.id}>
                            <TableCell data-cell="title" className="font-medium">
                              <bdi>{invoice.number}</bdi>
                              {einvoiceLabel && (
                                <span className="ms-2 hidden text-caption text-muted-foreground md:inline">
                                  {einvoiceLabel}
                                </span>
                              )}
                            </TableCell>
                            {einvoiceLabel && (
                              <TableCell
                                data-cell="detail"
                                className="text-caption text-muted-foreground md:hidden"
                              >
                                {einvoiceLabel}
                              </TableCell>
                            )}
                            <TableCell
                              data-cell="meta"
                              data-nowrap=""
                              className="text-muted-foreground"
                            >
                              {invoice.paymentStatus === "paid" || !invoice.dueDate ? (
                                <DateText value={invoice.dueDate ?? invoice.date} locale={locale} />
                              ) : (
                                formatMessage(t["portal.dueOn"], {
                                  date: formatDate(invoice.dueDate, locale),
                                })
                              )}
                              {late > 0 && (
                                <span className="block text-caption text-negative">
                                  {formatMessage(t[overdueKey(late)], { days: late })}
                                </span>
                              )}
                            </TableCell>
                            <MoneyCell
                              amount={invoice.amountDue}
                              currency={invoice.currency}
                              className="font-semibold text-foreground"
                              data-cell="amount"
                            />
                            <TableCell data-cell="status" data-nowrap="">
                              <StatusBadge tone={STATUS_TONE[invoice.paymentStatus]}>
                                <T k={`portal.payStatus.${invoice.paymentStatus}`} />
                              </StatusBadge>
                            </TableCell>
                            <TableCell data-cell="actions" className="print:hidden">
                              <div className="flex items-center justify-end gap-1">
                                {invoice.canPayOnline && (
                                  <Button
                                    size="sm"
                                    onClick={() => pay(invoice.id)}
                                    disabled={payingId !== null}
                                    aria-busy={paying}
                                  >
                                    {paying ? (
                                      <Loader2 className="h-4 w-4 me-1 animate-spin" aria-hidden />
                                    ) : (
                                      <CreditCard className="h-4 w-4 me-1" aria-hidden />
                                    )}
                                    <T k={paying ? "customerLink.paying" : "portal.payNow"} />
                                  </Button>
                                )}
                                <RowActions
                                  menu={
                                    invoice.einvoice?.hasXml ? (
                                      <DropdownMenuItem
                                        onSelect={() => openPdf(`/invoices/${invoice.id}/einvoice`)}
                                      >
                                        <T k="customerLink.downloadXml" />
                                      </DropdownMenuItem>
                                    ) : undefined
                                  }
                                >
                                  <RowActionButton
                                    label={formatMessage(t["customerLink.downloadAria"], {
                                      number: invoice.number,
                                    })}
                                    icon={FileDown}
                                    onClick={() => openPdf(`/invoices/${invoice.id}/pdf`)}
                                  />
                                </RowActions>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="statement">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-h3">
                    <T k="portal.doc.statementOfAccount" />
                  </CardTitle>
                  {statement?.asOf && (
                    <p className="mt-1 text-small text-muted-foreground">
                      {formatMessage(t["portal.doc.asOfDate"], {
                        date: formatDate(statement.asOf, locale),
                      })}
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="print:hidden"
                  onClick={() => openPdf("/statement?format=pdf")}
                >
                  <FileDown className="h-4 w-4 me-1" aria-hidden />
                  <T k="portal.doc.downloadPdf" />
                </Button>
              </CardHeader>
              <CardContent className="space-y-6">
                {!statement ? (
                  <Skeleton className="h-32 w-full" aria-hidden />
                ) : statement.sections.length === 0 ? (
                  <EmptyState
                    size="sm"
                    title={t["portal.doc.noStatementTitle"]}
                    description={t["portal.doc.noStatementBody"]}
                  />
                ) : (
                  statement.sections.map((s) => <StatementOfAccount key={s.currency} section={s} />)
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="quotes">
            <Card>
              <CardContent className="space-y-4 pt-6">
                {quotes.length === 0 ? (
                  <EmptyState
                    icon={FileText}
                    title={t["portal.doc.noQuotesTitle"]}
                    description={t["portal.doc.noQuotesBody"]}
                  />
                ) : (
                  <>
                    {quotes.some((q) => q.status === "sent") && (
                      <div className="max-w-sm space-y-1.5">
                        <Label htmlFor="signer">
                          <T k="portal.doc.signer" />
                        </Label>
                        <Input
                          id="signer"
                          value={signer}
                          onChange={(e) => setSigner(e.target.value)}
                          autoComplete="name"
                        />
                      </div>
                    )}
                    <ul className="divide-y divide-border rounded-md border border-border">
                      {quotes.map((q) => (
                        <li
                          key={q.id}
                          className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <p className="font-medium text-foreground">
                              <bdi>{q.number}</bdi>
                            </p>
                            <p className="text-small text-muted-foreground">
                              <Money amount={q.total} currency={q.currency} /> ·{" "}
                              <DateText value={q.date} locale={locale} />
                            </p>
                          </div>
                          {q.status === "sent" ? (
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                disabled={!signer.trim()}
                                onClick={() => respond(q.id, "accepted")}
                              >
                                <T k="portal.accept" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!signer.trim()}
                                onClick={() => respond(q.id, "declined")}
                              >
                                <T k="portal.decline" />
                              </Button>
                            </div>
                          ) : (
                            <StatusBadge
                              tone={
                                q.status === "accepted" || q.status === "converted"
                                  ? "success"
                                  : "neutral"
                              }
                            >
                              <T k={`portal.quoteStatus.${q.status}`} />
                            </StatusBadge>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="documents">
            <Card>
              <CardContent className="space-y-4 pt-6">
                <FileDrop
                  id="portal-upload"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt"
                  onFiles={([f]) => upload(f)}
                  disabled={uploading}
                  label={t["portal.doc.uploadLabel"]}
                  hint={t["portal.doc.uploadHint"]}
                  inputTestId="portal-upload-input"
                />
                {documents.length === 0 ? (
                  <EmptyState
                    size="sm"
                    title={t["portal.doc.noDocumentsTitle"]}
                    description={t["portal.doc.noDocumentsBody"]}
                  />
                ) : (
                  <ul className="divide-y divide-border">
                    {documents.map((d) => (
                      <li key={d.id} className="flex items-center justify-between gap-4 py-2.5">
                        <span className="min-w-0 truncate text-small text-foreground" dir="auto">
                          {d.name}
                        </span>
                        <span className="shrink-0 text-small text-muted-foreground">
                          <DateText value={d.createdAt} locale={locale} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <footer className="border-t border-border print:hidden">
        <p className="mx-auto max-w-content px-4 py-5 text-center text-caption text-muted-foreground sm:px-8">
          <bdi>{info.companyName}</bdi> · <T k="portal.doc.sentWith" />
        </p>
      </footer>
    </div>
  );
}

/** The portal's shape while it loads: no layout jump when the real content arrives. */
function PortalSkeleton() {
  const { t, locale } = useTranslation(PORTAL_NAMESPACES);
  return (
    <div
      className="flex min-h-screen flex-col bg-background"
      dir={locale === "ar" ? "rtl" : "ltr"}
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">{t["customerLink.loading"]}</span>
      <header className="border-b border-border bg-card" aria-hidden>
        <div className="h-0.5 bg-primary" />
        <div className="mx-auto flex max-w-content items-center justify-between gap-4 px-4 py-4 sm:px-8">
          <div className="space-y-2">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-8 w-24" />
        </div>
      </header>
      <div
        className="mx-auto w-full max-w-content flex-1 space-y-6 px-4 py-6 sm:px-8 sm:py-8"
        aria-hidden
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[116px] w-full rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-11 w-full max-w-md rounded-lg" />
        <div className="space-y-px overflow-hidden rounded-lg border border-border">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[72px] w-full rounded-none" />
          ))}
        </div>
      </div>
    </div>
  );
}

function PortalMessage({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: typeof Clock;
  title: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { locale } = useTranslation(PORTAL_NAMESPACES);
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-2 bg-background p-4"
      dir={locale === "ar" ? "rtl" : "ltr"}
    >
      <div className="flex w-full max-w-md justify-end">
        <LinkLanguageSwitch testId="portal-language" />
      </div>
      <div className="w-full max-w-md rounded-lg border border-border bg-card px-6 py-12 text-center">
        <span className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800">
          <Icon className="h-5 w-5 text-muted-foreground" aria-hidden />
        </span>
        <h1 className="mb-2 text-h3 font-semibold text-foreground">{title}</h1>
        <p className="text-small text-muted-foreground">{children}</p>
        {action && <div className="mt-6">{action}</div>}
      </div>
    </main>
  );
}
