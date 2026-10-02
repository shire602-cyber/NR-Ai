import { useState } from "react";
import { useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Clock, Download, XCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LanguageToggle } from "@/components/LanguageToggle";
import { CustomFieldsDisplay } from "@/components/sales/CustomFieldsDisplay";
import { QuoteStatusBadge } from "@/components/sales/SalesShared";
import { useI18n } from "@/lib/i18n";
import { formatCurrency as formatMoney, intlLocale } from "@/lib/format";
import { apiUrl } from "@/lib/api";
import { publicGet, publicPost } from "@/lib/sales-public";
import type { DisplayField } from "@/lib/sales-api";
import { ApiError } from "@/lib/queryClient";
import { messages as pageMessages } from "./PublicQuoteView.i18n";

interface PublicQuote {
  quote: {
    number: string;
    customerName: string;
    customerTrn: string | null;
    date: string;
    expiryDate: string | null;
    currency: string;
    subtotal: number;
    vatAmount: number;
    total: number;
    discountAmount: number | string;
    shippingAmount: number | string;
    itemsSubtotal: number;
    status: string;
    notes: string | null;
  };
  lines: Array<{ description: string; quantity: number; unitPrice: number; vatRate: number; lineKind?: string | null; discountType?: string | null; discountValue?: number | string | null }>;
  company: { name: string; trnVatNumber: string | null; businessAddress: string | null; contactPhone: string | null; contactEmail: string | null };
  customFields: DisplayField[];
  signature: { action: "accepted" | "declined"; signerName: string; signedAt: string; reason: string | null } | null;
  canRespond: boolean;
}

const money = (amount: number, currency: string) => formatMoney(amount, currency, useI18n.getState().locale);
const dateText = (value: string) =>
  new Intl.DateTimeFormat(intlLocale(useI18n.getState().locale), { year: "numeric", month: "long", day: "numeric" }).format(new Date(value));

type Mode = "idle" | "accept" | "decline";

/** The page a customer opens from the emailed link: read the quote, then accept (with consent) or decline (with a reason). */
export default function PublicQuoteView() {
  const tr = pageMessages.useT();
  const { token } = useParams<{ token: string }>();
  const [mode, setMode] = useState<Mode>("idle");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [agree, setAgree] = useState(false);
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery<PublicQuote>({
    queryKey: ["public-quote", token],
    queryFn: () => publicGet<PublicQuote>(`/api/public/quotes/${token}`),
    enabled: !!token,
    retry: false,
  });

  const answer = useMutation({
    mutationFn: (kind: "accept" | "decline") =>
      publicPost(`/api/public/quotes/${token}/${kind}`, kind === "accept" ? { name: name.trim(), email: email.trim(), agree: true } : { name: name.trim(), email: email.trim(), reason: reason.trim() || null }),
    onSuccess: () => {
      setFormError(null);
      setMode("idle");
      refetch();
    },
    onError: (e: unknown) => {
      const code = (e as ApiError).code;
      setFormError(code === "QUOTE_NOT_OPEN" ? tr("alreadyAnswered") : code === "QUOTE_EXPIRED" || code === "QUOTE_LINK_EXPIRED" ? tr("expiredBody") : (e as Error).message || tr("answerFailed"));
      if (code === "QUOTE_NOT_OPEN") refetch();
    },
  });

  const submit = (kind: "accept" | "decline") => {
    setFormError(null);
    if (!name.trim()) return setFormError(tr("nameRequired"));
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setFormError(tr("emailRequired"));
    if (kind === "accept" && !agree) return setFormError(tr("consentRequired"));
    answer.mutate(kind);
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted">
        <p className="text-muted-foreground">{tr("loading")}</p>
      </div>
    );
  }

  if (error || !data) {
    const status = (error as ApiError | null)?.status;
    const expired = status === 410;
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted p-4">
        <LanguageToggle floating />
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center py-16 text-center" data-testid={expired ? "quote-expired" : "quote-not-found"}>
            {expired ? <Clock className="mb-4 h-16 w-16 text-warning" /> : <AlertCircle className="mb-4 h-16 w-16 text-destructive" />}
            <h1 className="mb-2 text-xl font-semibold">{expired ? tr("expiredTitle") : tr("notFoundTitle")}</h1>
            <p className="text-muted-foreground">{expired ? tr("expiredBody") : tr("notFoundBody")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { quote, lines, company, signature } = data;
  const discountAmount = Number(quote.discountAmount ?? 0);
  const shippingAmount = Number(quote.shippingAmount ?? 0);
  const answered = quote.status === "accepted" || quote.status === "declined" || quote.status === "converted";

  return (
    <div className="min-h-screen bg-muted px-4 py-8">
      <LanguageToggle floating />
      <div className="mx-auto max-w-3xl space-y-6">
        <Card className="overflow-hidden">
          <div className="bg-info p-6 text-white">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold">{company.name}</h1>
                {company.businessAddress && <p className="mt-1 text-sm">{company.businessAddress}</p>}
                {company.contactPhone && <p className="text-sm">{company.contactPhone}</p>}
                {company.contactEmail && <p className="text-sm">{company.contactEmail}</p>}
              </div>
              <div className="text-end">
                <h2 className="text-lg font-bold">{tr("quote")}</h2>
                {company.trnVatNumber && <p className="mt-1 text-sm">{tr("trn", { trn: company.trnVatNumber })}</p>}
              </div>
            </div>
          </div>

          <CardContent className="space-y-6 p-6">
            <div className="flex flex-wrap justify-between gap-6 rounded-lg bg-muted p-4">
              <div>
                <p className="text-sm text-muted-foreground">{tr("quoteNumber")}</p>
                <p className="text-lg font-semibold" dir="ltr">{quote.number}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{tr("date")}</p>
                <p className="font-semibold">{dateText(quote.date)}</p>
              </div>
              {quote.expiryDate && (
                <div>
                  <p className="text-sm text-muted-foreground">{tr("validUntil")}</p>
                  <p className="font-semibold">{dateText(quote.expiryDate)}</p>
                </div>
              )}
              <div>
                <p className="text-sm text-muted-foreground">{tr("status")}</p>
                <QuoteStatusBadge status={quote.status} />
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold uppercase text-info">{tr("preparedFor")}</h3>
              <p className="text-lg font-semibold">{quote.customerName}</p>
              {quote.customerTrn && <p className="text-sm text-muted-foreground">{tr("trn", { trn: quote.customerTrn })}</p>}
            </div>

            <CustomFieldsDisplay fields={data.customFields} className="grid gap-x-6 gap-y-1 rounded-lg bg-muted p-4 text-sm sm:grid-cols-2" />

            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-info hover:bg-info">
                    <TableHead className="font-semibold text-white">{tr("description")}</TableHead>
                    <TableHead className="text-center font-semibold text-white">{tr("qty")}</TableHead>
                    <TableHead className="text-center font-semibold text-white">{tr("unitPrice")}</TableHead>
                    <TableHead className="text-center font-semibold text-white">{tr("vat")}</TableHead>
                    <TableHead className="text-end font-semibold text-white">{tr("amount")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* Discounts and shipping appear in the totals below, not as table rows. */}
                  {lines.filter((l) => l.lineKind !== "discount" && l.lineKind !== "shipping").map((l, i) => (
                    <TableRow key={i} className={i % 2 === 0 ? "bg-card" : "bg-muted"}>
                      <TableCell className="font-medium">
                        {l.description}
                        {l.discountType && Number(l.discountValue) > 0 && (
                          <span className="block text-xs font-normal text-muted-foreground">
                            {l.discountType === "percent"
                              ? tr("lineDiscountPercent", { value: Number(l.discountValue) })
                              : tr("lineDiscountAmount", { value: money(Number(l.discountValue), quote.currency) })}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">{l.quantity}</TableCell>
                      <TableCell className="text-center">{money(l.unitPrice, quote.currency)}</TableCell>
                      <TableCell className="text-center">{Math.round((l.vatRate ?? 0) * 100)}%</TableCell>
                      <TableCell className="text-end">{money(l.quantity * l.unitPrice, quote.currency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-end">
              <div className="w-72 space-y-2">
                {(discountAmount > 0 || shippingAmount > 0) && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{tr("itemsSubtotal")}</span>
                    <span dir="ltr">{money(quote.itemsSubtotal + discountAmount, quote.currency)}</span>
                  </div>
                )}
                {discountAmount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{tr("discount")}</span>
                    <span dir="ltr">-{money(discountAmount, quote.currency)}</span>
                  </div>
                )}
                {shippingAmount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{tr("shipping")}</span>
                    <span dir="ltr">{money(shippingAmount, quote.currency)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{tr("subtotal")}</span>
                  <span dir="ltr">{money(quote.subtotal, quote.currency)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{tr("vat")}</span>
                  <span dir="ltr">{money(quote.vatAmount, quote.currency)}</span>
                </div>
                <div className="-mx-3 flex justify-between rounded-lg bg-info px-3 py-2 text-lg font-bold text-white">
                  <span>{tr("total")}</span>
                  <span dir="ltr" data-testid="public-quote-total">{money(quote.total, quote.currency)}</span>
                </div>
              </div>
            </div>

            {quote.notes && (
              <div>
                <h3 className="mb-1 text-sm font-semibold">{tr("notes")}</h3>
                <p className="whitespace-pre-line text-sm text-muted-foreground">{quote.notes}</p>
              </div>
            )}

            {answered && signature && (
              <Alert className={signature.action === "accepted" ? "border-success/40" : undefined} data-testid="quote-outcome">
                {signature.action === "accepted" ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-destructive" />}
                <AlertDescription>
                  {signature.action === "accepted"
                    ? tr("acceptedBy", { name: signature.signerName, date: dateText(signature.signedAt) })
                    : tr("declinedBy", { name: signature.signerName, date: dateText(signature.signedAt) })}
                  {signature.reason && <span className="mt-1 block text-muted-foreground">{signature.reason}</span>}
                </AlertDescription>
              </Alert>
            )}

            {data.canRespond && mode === "idle" && (
              <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row" data-testid="quote-actions">
                <Button size="lg" className="flex-1" onClick={() => setMode("accept")} data-testid="button-open-accept">
                  <CheckCircle2 className="me-2 h-5 w-5" />
                  {tr("acceptQuote")}
                </Button>
                <Button size="lg" variant="outline" className="flex-1" onClick={() => setMode("decline")} data-testid="button-open-decline">
                  <XCircle className="me-2 h-5 w-5" />
                  {tr("declineQuote")}
                </Button>
              </div>
            )}

            {data.canRespond && mode !== "idle" && (
              <form
                className="space-y-4 rounded-lg border p-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit(mode);
                }}
                data-testid={mode === "accept" ? "accept-form" : "decline-form"}
              >
                <h3 className="font-semibold">{mode === "accept" ? tr("acceptTitle") : tr("declineTitle")}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="quote-signer-name">{tr("yourName")}</Label>
                    <Input id="quote-signer-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-signer-name" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="quote-signer-email">{tr("yourEmail")}</Label>
                    <Input id="quote-signer-email" type="email" dir="ltr" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-signer-email" />
                  </div>
                </div>
                {mode === "accept" ? (
                  <div className="flex items-start gap-2">
                    <Checkbox id="quote-agree" checked={agree} onCheckedChange={(v) => setAgree(v === true)} data-testid="checkbox-agree" />
                    <Label htmlFor="quote-agree" className="text-sm font-normal leading-snug">
                      {tr("consent", { company: company.name, total: money(quote.total, quote.currency) })}
                    </Label>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="quote-decline-reason">{tr("reasonOptional")}</Label>
                    <Textarea id="quote-decline-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="input-decline-reason" />
                  </div>
                )}
                <p className="text-xs text-muted-foreground">{tr("recordNotice")}</p>
                {formError && (
                  <p role="alert" className="text-sm text-destructive" data-testid="quote-form-error">
                    {formError}
                  </p>
                )}
                <div className="flex gap-3">
                  <Button type="button" variant="outline" onClick={() => { setMode("idle"); setFormError(null); }}>
                    {tr("back")}
                  </Button>
                  <Button type="submit" disabled={answer.isPending} variant={mode === "accept" ? "default" : "destructive"} data-testid="button-submit-answer">
                    {answer.isPending ? tr("sending") : mode === "accept" ? tr("confirmAccept") : tr("confirmDecline")}
                  </Button>
                </div>
              </form>
            )}

            <div className="flex justify-center border-t pt-4">
              <Button variant="outline" onClick={() => window.open(apiUrl(`/api/public/quotes/${token}/pdf`), "_blank")} data-testid="button-quote-pdf">
                <Download className="me-2 h-4 w-4" />
                {tr("downloadPdf")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
