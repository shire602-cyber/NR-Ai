import { T } from "@/components/layout/T";
import { useState } from "react";
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
import { AlertCircle, Clock, CreditCard, FileDown, FileText, Loader2 } from "lucide-react";
import { apiUrl } from "@/lib/api";
import { formatDate } from "@/lib/format-date";
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
  einvoice: { status: string; uuid: string | null; hasXml: boolean } | null;
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

const SESSION_KEY = "muhasib.portalSession";

const STATUS_TONE: Record<PortalInvoice["paymentStatus"], StatusTone> = {
  paid: "success",
  partially_paid: "warning",
  overdue: "danger",
  unpaid: "warning",
  credit: "neutral",
};

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path));
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
  return body as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
  return json as T;
}

function readSession(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function PortalLogin() {
  const [, setLocation] = useLocation();
  const companyId =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("c") : null;
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const request = async () => {
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/portal/login/request", { companyId, email });
      setStep("code");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const verify = async () => {
    setBusy(true);
    setError(null);
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
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle>
            <T k="portal.signInTitle" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!companyId ? (
            <p className="text-muted-foreground">
              <T k="portal.signInNeedsLink" />
            </p>
          ) : step === "email" ? (
            <>
              <Label htmlFor="portal-email">
                <T k="portal.email" />
              </Label>
              <Input
                id="portal-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
              <Button onClick={request} disabled={busy || !email} className="w-full">
                <T k="portal.sendCode" />
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                <T k="portal.codeSent" />
              </p>
              <Label htmlFor="portal-code">
                <T k="portal.code" />
              </Label>
              <Input
                id="portal-code"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                autoComplete="one-time-code"
              />
              <Button onClick={verify} disabled={busy || code.length !== 6} className="w-full">
                <T k="portal.signIn" />
              </Button>
            </>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function CustomerPortal() {
  const params = useParams<{ token: string }>();
  if (params.token === "login") return <PortalLogin />;
  const token = params.token === "session" ? readSession() : params.token;
  return <PortalHome token={token} />;
}

function PortalHome({ token }: { token: string | null }) {
  const { t, locale } = useTranslation();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [signer, setSigner] = useState("");
  const [uploading, setUploading] = useState(false);
  const base = `/api/portal/${token}`;

  const {
    data: info,
    isLoading: infoLoading,
    error: infoError,
  } = useQuery<PortalInfo>({
    queryKey: ["portal-info", token],
    queryFn: () => getJson<PortalInfo>(`${base}/info`),
    enabled: !!token,
    retry: false,
  });

  const { data: invoices = [], isLoading: invoicesLoading } = useQuery<PortalInvoice[]>({
    queryKey: ["portal-invoices", token],
    queryFn: () => getJson<PortalInvoice[]>(`${base}/invoices`),
    enabled: !!token && !!info,
    retry: false,
  });
  const { data: statement } = useQuery<{ asOf: string; sections: StatementSection[] }>({
    queryKey: ["portal-statement", token],
    queryFn: () => getJson(`${base}/statement`),
    enabled: !!token && !!info,
    retry: false,
  });
  const { data: quotes = [] } = useQuery<PortalQuote[]>({
    queryKey: ["portal-quotes", token],
    queryFn: () => getJson<PortalQuote[]>(`${base}/quotes`),
    enabled: !!token && !!info,
    retry: false,
  });
  const { data: documents = [] } = useQuery<PortalDocument[]>({
    queryKey: ["portal-documents", token],
    queryFn: () => getJson<PortalDocument[]>(`${base}/documents`),
    enabled: !!token && !!info,
    retry: false,
  });

  if (!token) {
    return (
      <PortalMessage icon={Clock}>
        <T k="portal.sessionEnded" />
      </PortalMessage>
    );
  }

  if (infoLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  if (infoError || !info) {
    const message = infoError instanceof Error ? infoError.message : "";
    const ended = /expired|revoked/i.test(message);
    return (
      <PortalMessage
        icon={ended ? Clock : AlertCircle}
        title={<T k={ended ? "portal.linkEnded" : "portal.linkInvalid"} />}
      >
        <T k="portal.linkHelp" />
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
    try {
      const r = await postJson<{ url: string }>(`${base}/invoices/${invoiceId}/pay`, {});
      window.location.assign(r.url);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };

  const respond = async (quoteId: string, decision: "accepted" | "declined") => {
    try {
      await postJson(`${base}/quotes/${quoteId}/respond`, { decision, signerName: signer });
      await queryClient.invalidateQueries({ queryKey: ["portal-quotes", token] });
      setNotice(t[decision === "accepted" ? "portal.quoteAccepted" : "portal.quoteDeclined"]);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
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
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(body.message || t["portal.uploadFailed"]);
        return;
      }
      setNotice(t["portal.uploaded"]);
      await queryClient.invalidateQueries({ queryKey: ["portal-documents", token] });
    } finally {
      setUploading(false);
    }
  };

  const openPdf = (path: string) => window.open(apiUrl(`${base}${path}`), "_blank");

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border bg-card">
        <div aria-hidden className="h-0.5 bg-primary" />
        <div className="mx-auto flex max-w-content items-center justify-between gap-4 px-4 py-4 sm:px-8">
          <div className="min-w-0">
            <p className="truncate text-h3 font-semibold text-foreground" dir="auto">
              {info.companyName}
            </p>
            <p className="text-caption text-muted-foreground">
              <T k="portal.doc.customerPortal" />
            </p>
          </div>
          <p
            className="min-w-0 max-w-[45%] truncate text-small font-medium text-foreground"
            dir="auto"
            data-testid="portal-customer-name"
          >
            {customerName}
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-content flex-1 space-y-6 px-4 py-6 sm:px-8 sm:py-8">
        {notice && (
          <Alert tone="info" role="status">
            {notice}
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

        <Tabs defaultValue="invoices">
          <ScrollTabs aria-label={t["portal.doc.sections"]}>
            <TabsTrigger value="invoices">
              <T k="portal.doc.tabInvoices" />
            </TabsTrigger>
            <TabsTrigger value="statement">
              <T k="portal.doc.tabStatement" />
            </TabsTrigger>
            <TabsTrigger value="quotes">
              <T k="portal.doc.tabQuotes" />
            </TabsTrigger>
            <TabsTrigger value="documents">
              <T k="portal.doc.tabDocuments" />
            </TabsTrigger>
          </ScrollTabs>

          <TabsContent value="invoices">
            <Card>
              <CardContent className="p-0">
                {invoicesLoading ? (
                  <div className="flex h-32 items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
                  </div>
                ) : invoices.length === 0 ? (
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
                        <TableHead>
                          <span className="sr-only">
                            <T k="portal.doc.actions" />
                          </span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoices.map((invoice) => (
                        <TableRow key={invoice.id}>
                          <TableCell data-cell="title" className="font-medium">
                            <bdi>{invoice.number}</bdi>
                            {invoice.einvoice && (
                              <span className="ms-2 text-caption text-muted-foreground">
                                <T k="portal.doc.einvoice" />
                              </span>
                            )}
                          </TableCell>
                          <TableCell
                            data-cell="meta"
                            data-nowrap=""
                            className="text-muted-foreground"
                          >
                            {formatDate(invoice.dueDate ?? invoice.date, locale)}
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
                          <TableCell data-cell="actions">
                            <div className="flex items-center justify-end gap-1">
                              {invoice.canPayOnline && (
                                <Button size="sm" onClick={() => pay(invoice.id)}>
                                  <CreditCard className="h-4 w-4 me-1" aria-hidden />
                                  <T k="portal.payNow" />
                                </Button>
                              )}
                              <RowActions
                                menu={
                                  invoice.einvoice?.hasXml ? (
                                    <DropdownMenuItem
                                      onSelect={() => openPdf(`/invoices/${invoice.id}/einvoice`)}
                                    >
                                      XML
                                    </DropdownMenuItem>
                                  ) : undefined
                                }
                              >
                                <RowActionButton
                                  label={t["portal.doc.downloadPdf"]}
                                  icon={FileDown}
                                  onClick={() => openPdf(`/invoices/${invoice.id}/pdf`)}
                                />
                              </RowActions>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
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
                  onClick={() => openPdf("/statement?format=pdf")}
                >
                  <FileDown className="h-4 w-4 me-1" aria-hidden />
                  <T k="portal.doc.downloadPdf" />
                </Button>
              </CardHeader>
              <CardContent className="space-y-6">
                {(statement?.sections ?? []).length === 0 && (
                  <EmptyState
                    size="sm"
                    title={t["portal.doc.noStatementTitle"]}
                    description={t["portal.doc.noStatementBody"]}
                  />
                )}
                {(statement?.sections ?? []).map((s) => (
                  <StatementOfAccount key={s.currency} section={s} />
                ))}
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
                              {formatDate(q.date, locale)}
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
                          {formatDate(d.createdAt, locale)}
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

      <footer className="border-t border-border">
        <p className="mx-auto max-w-content px-4 py-5 text-center text-caption text-muted-foreground sm:px-8">
          <span dir="auto">{info.companyName}</span> · <T k="portal.doc.sentWith" />
        </p>
      </footer>
    </div>
  );
}

function PortalMessage({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Clock;
  title?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-card px-6 py-12 text-center">
        <span className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800">
          <Icon className="h-5 w-5 text-muted-foreground" aria-hidden />
        </span>
        {title && <h1 className="mb-2 text-h3 font-semibold text-foreground">{title}</h1>}
        <p className="text-small text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}
