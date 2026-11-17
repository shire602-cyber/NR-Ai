import { T } from "@/components/layout/T";
import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Download,
  FileText,
  AlertCircle,
  Clock,
  Loader2,
  Receipt,
  DollarSign,
  FileCheck,
  CreditCard,
  Upload,
} from "lucide-react";
import { apiUrl } from "@/lib/api";
import { Money } from "@/components/ui/money";
import { useTranslation } from "@/lib/i18n";

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

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-AE", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const STATUS_CLASS: Record<PortalInvoice["paymentStatus"], string> = {
  paid: "bg-success-subtle text-success-subtle-foreground",
  partially_paid: "bg-warning-subtle text-warning-subtle-foreground",
  overdue: "bg-danger-subtle text-danger-subtle-foreground",
  unpaid: "bg-info-subtle text-info-subtle-foreground",
  credit: "bg-muted text-foreground",
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
    <div className="min-h-screen bg-muted flex items-center justify-center p-4">
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
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [signer, setSigner] = useState("");
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
      <div className="min-h-screen bg-muted flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="py-16 text-center text-muted-foreground">
            <T k="portal.sessionEnded" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (infoLoading) {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-info" />
      </div>
    );
  }

  if (infoError || !info) {
    const message = infoError instanceof Error ? infoError.message : "";
    const ended = /expired|revoked/i.test(message);
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            {ended ? (
              <Clock className="w-16 h-16 text-warning mb-4" />
            ) : (
              <AlertCircle className="w-16 h-16 text-destructive mb-4" />
            )}
            <h2 className="text-xl font-semibold mb-2">
              <T k={ended ? "portal.linkEnded" : "portal.linkInvalid"} />
            </h2>
            <p className="text-muted-foreground">
              <T k="portal.linkHelp" />
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const open = invoices.filter((i) => i.invoiceType !== "credit_note");
  const defaultCurrency = open[0]?.currency ?? "AED";
  const totalOutstanding = open.reduce((s, i) => s + i.amountDue, 0);
  const totalPaid = open.reduce((s, i) => s + (i.total - i.amountDue), 0);

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
  };

  return (
    <div className="min-h-screen bg-muted">
      <header className="bg-card border-b shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold text-foreground" dir="auto">
                {info.companyName}
              </h1>
              <p className="text-muted-foreground mt-1">
                <T k="portal.customerPortal" />
              </p>
            </div>
            <div className="text-end">
              <p className="text-sm text-muted-foreground">
                <T k="portal.welcome" />
              </p>
              <p className="text-lg font-semibold text-foreground">{info.customerName}</p>
              {info.customerNameAr && (
                <p className="text-sm text-muted-foreground" dir="rtl">
                  {info.customerNameAr}
                </p>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        {notice && (
          <div className="rounded-lg bg-info-subtle text-info-subtle-foreground p-3" role="status">
            {notice}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-6 flex items-center gap-3">
              <DollarSign className="w-5 h-5 text-destructive" />
              <div>
                <p className="text-sm text-muted-foreground">
                  <T k="pages.totalOutstanding" />
                </p>
                <p className="text-xl font-bold text-destructive">
                  <Money amount={totalOutstanding} currency={defaultCurrency} />
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6 flex items-center gap-3">
              <FileCheck className="w-5 h-5 text-success" />
              <div>
                <p className="text-sm text-muted-foreground">
                  <T k="pages.totalPaid" />
                </p>
                <p className="text-xl font-bold text-success">
                  <Money amount={totalPaid} currency={defaultCurrency} />
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6 flex items-center gap-3">
              <Receipt className="w-5 h-5 text-info" />
              <div>
                <p className="text-sm text-muted-foreground">
                  <T k="pages.totalInvoices" />
                </p>
                <p className="text-xl font-bold text-info">{open.length}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="invoices">
          <TabsList>
            <TabsTrigger value="invoices">
              <T k="pages.invoices" />
            </TabsTrigger>
            <TabsTrigger value="statement">
              <T k="portal.statement" />
            </TabsTrigger>
            <TabsTrigger value="quotes">
              <T k="portal.quotes" />
            </TabsTrigger>
            <TabsTrigger value="documents">
              <T k="portal.documents" />
            </TabsTrigger>
          </TabsList>

          <TabsContent value="invoices">
            <Card>
              <CardContent className="pt-6">
                {invoicesLoading ? (
                  <Loader2 className="w-8 h-8 animate-spin text-info mx-auto" />
                ) : invoices.length === 0 ? (
                  <p className="py-12 text-center text-muted-foreground">
                    <T k="portal.noInvoices" />
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>
                            <T k="portal.invoiceNumber" />
                          </TableHead>
                          <TableHead>
                            <T k="portal.dueDate" />
                          </TableHead>
                          <TableHead data-numeric>
                            <T k="portal.amountDue" />
                          </TableHead>
                          <TableHead>
                            <T k="pages.status" />
                          </TableHead>
                          <TableHead data-numeric>
                            <T k="pages.actions" />
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {invoices.map((invoice) => (
                          <TableRow key={invoice.id}>
                            <TableCell className="font-medium">
                              {invoice.number}
                              {invoice.einvoice && (
                                <Badge variant="outline" className="ms-2">
                                  <T k="portal.einvoiceStatus" />: {invoice.einvoice.status}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {invoice.dueDate
                                ? formatDate(invoice.dueDate)
                                : formatDate(invoice.date)}
                            </TableCell>
                            <TableCell data-numeric className=" font-medium">
                              <Money amount={invoice.amountDue} currency={invoice.currency} />
                            </TableCell>
                            <TableCell>
                              <Badge className={STATUS_CLASS[invoice.paymentStatus]}>
                                <T k={`portal.payStatus.${invoice.paymentStatus}`} />
                              </Badge>
                            </TableCell>
                            <TableCell className="text-end space-x-2 rtl:space-x-reverse">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  window.open(
                                    apiUrl(`${base}/invoices/${invoice.id}/pdf`),
                                    "_blank"
                                  )
                                }
                              >
                                <Download className="w-4 h-4 me-1" />
                                PDF
                              </Button>
                              {invoice.einvoice?.hasXml && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    window.open(
                                      apiUrl(`${base}/invoices/${invoice.id}/einvoice`),
                                      "_blank"
                                    )
                                  }
                                >
                                  XML
                                </Button>
                              )}
                              {invoice.canPayOnline && (
                                <Button size="sm" onClick={() => pay(invoice.id)}>
                                  <CreditCard className="w-4 h-4 me-1" />
                                  <T k="portal.payNow" />
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="statement">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  <T k="portal.statementOfAccount" />
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(apiUrl(`${base}/statement?format=pdf`), "_blank")}
                >
                  <Download className="w-4 h-4 me-1" />
                  PDF
                </Button>
              </CardHeader>
              <CardContent className="space-y-6">
                {(statement?.sections ?? []).map((s) => (
                  <div key={s.currency} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>
                        <T k="portal.openingBalance" />
                      </span>
                      <span>
                        <Money amount={s.openingBalance} currency={s.currency} />
                      </span>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>
                            <T k="portal.date" />
                          </TableHead>
                          <TableHead>
                            <T k="portal.reference" />
                          </TableHead>
                          <TableHead data-numeric>
                            <T k="portal.debit" />
                          </TableHead>
                          <TableHead data-numeric>
                            <T k="portal.credit" />
                          </TableHead>
                          <TableHead data-numeric>
                            <T k="portal.balance" />
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {s.lines.map((l, i) => (
                          <TableRow key={`${l.reference}-${i}`}>
                            <TableCell>{l.date}</TableCell>
                            <TableCell>{l.reference}</TableCell>
                            <TableCell data-numeric>
                              {l.debit ? <Money amount={l.debit} currency={s.currency} /> : ""}
                            </TableCell>
                            <TableCell data-numeric>
                              {l.credit ? <Money amount={l.credit} currency={s.currency} /> : ""}
                            </TableCell>
                            <TableCell data-numeric>
                              <Money amount={l.balance} currency={s.currency} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <div className="flex justify-between font-semibold">
                      <span>
                        <T k="portal.closingBalance" />
                      </span>
                      <span>
                        <Money amount={s.closingBalance} currency={s.currency} />
                      </span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="quotes">
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="max-w-sm">
                  <Label htmlFor="signer">
                    <T k="portal.signerName" />
                  </Label>
                  <Input id="signer" value={signer} onChange={(e) => setSigner(e.target.value)} />
                </div>
                {quotes.length === 0 ? (
                  <p className="text-muted-foreground">
                    <T k="portal.noQuotes" />
                  </p>
                ) : (
                  quotes.map((q) => (
                    <div
                      key={q.id}
                      className="flex items-center justify-between border rounded p-3"
                    >
                      <div>
                        <p className="font-medium">{q.number}</p>
                        <p className="text-sm text-muted-foreground">
                          <Money amount={q.total} currency={q.currency} /> · {formatDate(q.date)}
                        </p>
                      </div>
                      {q.status === "sent" ? (
                        <div className="space-x-2 rtl:space-x-reverse">
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
                        <Badge variant="outline">
                          <T k={`portal.quoteStatus.${q.status}`} />
                        </Badge>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="documents">
            <Card>
              <CardContent className="pt-6 space-y-4">
                <Label
                  htmlFor="portal-upload"
                  className="inline-flex items-center gap-2 cursor-pointer border rounded px-3 py-2"
                >
                  <Upload className="w-4 h-4" />
                  <T k="portal.uploadDocument" />
                </Label>
                <input
                  id="portal-upload"
                  type="file"
                  className="sr-only"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt"
                  onChange={(e) => upload(e.target.files?.[0])}
                />
                {documents.map((d) => (
                  <div key={d.id} className="flex justify-between text-sm border-b py-2">
                    <span>{d.name}</span>
                    <span className="text-muted-foreground">{formatDate(d.createdAt)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <footer className="border-t bg-card mt-12">
        <div className="max-w-5xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <p className="text-center text-sm text-muted-foreground/70">{info.companyName}</p>
        </div>
      </footer>
    </div>
  );
}
