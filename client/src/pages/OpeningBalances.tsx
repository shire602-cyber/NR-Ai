import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { CheckCircle2, FileUp, Loader2, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { parseCalendarDay } from "@/lib/date-safe";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import { useComplianceText } from "@/lib/i18n-compliance";
import { messages as pageMessages } from "./OpeningBalances.i18n";

interface OverviewAccount {
  id: string;
  code: string;
  nameEn: string;
  nameAr?: string | null;
  type: string;
}

interface Overview {
  active: null | { id: string; asOfDate: string; documents: { invoices: number; bills: number } };
  firstTransactionDate: string | null;
  suggestedDate: string | null;
  accounts: OverviewAccount[];
}

interface DocRow {
  party: string;
  number: string;
  date: string;
  dueDate: string;
  amount: string;
  currency: string;
  exchangeRate: string;
}

interface Issue {
  code: string;
  message: string;
  row?: number;
}

interface Preview {
  ok: boolean;
  errors: Issue[];
  parsedRows: Array<{ accountCode: string; debit: number; credit: number }> | null;
  totals: {
    debit: number;
    credit: number;
    balancingSide: "credit" | "debit" | "none";
    balancingAmount: number;
    ar: number;
    ap: number;
    openInvoicesTotal: number;
    openBillsTotal: number;
  } | null;
}

const emptyDoc = (): DocRow => ({
  party: "",
  number: "",
  date: "",
  dueDate: "",
  amount: "",
  currency: "AED",
  exchangeRate: "1",
});
const num = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(/,/g, "")));

/** Enter opening balances (account grid, CSV import, open invoices and bills), check them, post them once. */
export default function OpeningBalances() {
  const tr = pageMessages.useT();

  const { c, f, locale } = useComplianceText();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const fileInput = useRef<HTMLInputElement>(null);

  const overviewKey = ["/api/companies", companyId, "opening-balances"];
  const { data: overview, isLoading } = useQuery<Overview>({
    queryKey: overviewKey,
    enabled: !!companyId,
  });

  const [asOfDate, setAsOfDate] = useState("");
  const [grid, setGrid] = useState<Record<string, { debit: string; credit: string }>>({});
  const [invoices, setInvoices] = useState<DocRow[]>([]);
  const [bills, setBills] = useState<DocRow[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewedFor, setPreviewedFor] = useState<string>("");
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reverseError, setReverseError] = useState<string | null>(null);

  const effectiveDate = asOfDate || overview?.suggestedDate || "";

  const payload = useMemo(
    () => ({
      asOfDate: effectiveDate,
      rows: Object.entries(grid)
        .map(([accountCode, v]) => ({ accountCode, debit: num(v.debit), credit: num(v.credit) }))
        .filter((r) => r.debit !== 0 || r.credit !== 0),
      invoices: invoices.map((d) => ({
        ...d,
        amount: num(d.amount),
        exchangeRate: num(d.exchangeRate) || 1,
      })),
      bills: bills.map((d) => ({
        ...d,
        amount: num(d.amount),
        exchangeRate: num(d.exchangeRate) || 1,
      })),
    }),
    [effectiveDate, grid, invoices, bills]
  );
  const signature = JSON.stringify(payload);

  const previewMutation = useMutation({
    mutationFn: ({ body }: { body: object; sig: string }) =>
      apiRequest("POST", `/api/companies/${companyId}/opening-balances/preview`, body),
    onSuccess: (data: Preview, vars) => {
      setPreview(data);
      // Posting is only offered for the exact input that was checked.
      setPreviewedFor(vars.sig);
      if ((vars.body as { csv?: string }).csv && data.parsedRows) {
        const next: Record<string, { debit: string; credit: string }> = {};
        for (const r of data.parsedRows)
          next[r.accountCode] = {
            debit: r.debit ? String(r.debit) : "",
            credit: r.credit ? String(r.credit) : "",
          };
        setGrid(next);
        setPreviewedFor(""); // the grid now differs from what was checked: check again before posting
      }
    },
    onError: (err: any) =>
      toast({ variant: "destructive", title: c.obPostFailed, description: err?.message }),
  });

  const postMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/opening-balances`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: overviewKey });
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "journal"] });
      toast({ title: c.obPosted });
      setPreview(null);
    },
    onError: (err: any) =>
      toast({ variant: "destructive", title: c.obPostFailed, description: err?.message }),
  });

  const reverseMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/opening-balances/reverse`, {
        reason: reason.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: overviewKey });
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "journal"] });
      toast({ title: c.obReversed });
      setReverseOpen(false);
      setReason("");
    },
    onError: (err: any) => setReverseError(err?.message || c.obReverseFailed),
  });

  const totals = useMemo(() => {
    const debit = payload.rows.reduce((s, r) => s + r.debit, 0);
    const credit = payload.rows.reduce((s, r) => s + r.credit, 0);
    return { debit, credit, diff: Math.round((debit - credit) * 100) / 100 };
  }, [payload.rows]);

  if (isLoadingCompany || isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!companyId || !overview) {
    return <p className="text-muted-foreground">{c.obNoAccounts}</p>;
  }

  // Already entered: show the summary and the reversal.
  if (overview.active) {
    const asOf = format(
      parseCalendarDay(new Date(`${overview.active.asOfDate.slice(0, 10)}T00:00:00Z`)),
      "dd MMM yyyy"
    );
    return (
      <div className="space-y-6">
        <PageHeader eyebrow={tr("setup")} title={c.obTitle} description={c.obIntro} />
        <Card data-testid="card-opening-active">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <CheckCircle2 className="h-5 w-5 text-success" />
              {c.obActiveTitle}
            </CardTitle>
            <CardDescription>
              {f("obActiveBody", {
                date: asOf,
                invoices: overview.active.documents.invoices,
                bills: overview.active.documents.bills,
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={() => {
                setReverseError(null);
                setReverseOpen(true);
              }}
              data-testid="button-reverse-opening"
            >
              {c.obReverse}
            </Button>
          </CardContent>
        </Card>
        <Dialog open={reverseOpen} onOpenChange={setReverseOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{c.obReverseTitle}</DialogTitle>
              <DialogDescription>{c.obReverseBody}</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="ob-reason">{c.obReason}</Label>
              <Textarea
                id="ob-reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                data-testid="input-reverse-reason"
              />
            </div>
            {reverseError && (
              <p className="text-sm text-destructive" role="alert">
                {reverseError}
              </p>
            )}
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => setReverseOpen(false)}
                disabled={reverseMutation.isPending}
              >
                {c.cancel}
              </Button>
              <Button
                variant="destructive"
                disabled={reverseMutation.isPending}
                onClick={() => reverseMutation.mutate()}
                data-testid="button-confirm-reverse-opening"
              >
                {reverseMutation.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                {c.obReverse}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  const setDoc = (kind: "invoice" | "bill", index: number, patch: Partial<DocRow>) => {
    const update = (rows: DocRow[]) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
    if (kind === "invoice") setInvoices(update);
    else setBills(update);
  };
  const removeDoc = (kind: "invoice" | "bill", index: number) => {
    const drop = (rows: DocRow[]) => rows.filter((_, i) => i !== index);
    if (kind === "invoice") setInvoices(drop);
    else setBills(drop);
  };

  const onCsv = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    previewMutation.mutate({
      body: {
        asOfDate: effectiveDate,
        csv: text,
        invoices: payload.invoices,
        bills: payload.bills,
      },
      sig: "",
    });
  };

  const canPost = !!preview?.ok && previewedFor === signature && !postMutation.isPending;
  const docTable = (kind: "invoice" | "bill", rows: DocRow[]) => (
    <div className="space-y-2">
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{kind === "invoice" ? c.obCustomer : c.obVendor}</TableHead>
                <TableHead>{c.obNumber}</TableHead>
                <TableHead>{c.obDocDate}</TableHead>
                <TableHead>{c.obDocDue}</TableHead>
                <TableHead className="text-end">{c.obDocAmount}</TableHead>
                <TableHead>{c.obDocCurrency}</TableHead>
                <TableHead>{c.obDocRate}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Input
                      value={d.party}
                      onChange={(e) => setDoc(kind, i, { party: e.target.value })}
                      aria-label={kind === "invoice" ? c.obCustomer : c.obVendor}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={d.number}
                      onChange={(e) => setDoc(kind, i, { number: e.target.value })}
                      aria-label={c.obNumber}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="date"
                      value={d.date}
                      onChange={(e) => setDoc(kind, i, { date: e.target.value })}
                      aria-label={c.obDocDate}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="date"
                      value={d.dueDate}
                      onChange={(e) => setDoc(kind, i, { dueDate: e.target.value })}
                      aria-label={c.obDocDue}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      inputMode="decimal"
                      className="text-end font-mono"
                      value={d.amount}
                      onChange={(e) => setDoc(kind, i, { amount: e.target.value })}
                      aria-label={c.obDocAmount}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="w-20"
                      maxLength={3}
                      value={d.currency}
                      onChange={(e) => setDoc(kind, i, { currency: e.target.value.toUpperCase() })}
                      aria-label={c.obDocCurrency}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      inputMode="decimal"
                      className="w-24 font-mono"
                      value={d.exchangeRate}
                      disabled={d.currency === "AED"}
                      onChange={(e) => setDoc(kind, i, { exchangeRate: e.target.value })}
                      aria-label={c.obDocRate}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeDoc(kind, i)}
                      title={c.obRemoveRow}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          kind === "invoice"
            ? setInvoices((r) => [...r, emptyDoc()])
            : setBills((r) => [...r, emptyDoc()])
        }
        data-testid={`button-add-${kind}`}
      >
        <Plus className="me-1 h-4 w-4" />
        {c.obAddRow}
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={tr("setup")} title={c.obTitle} description={c.obIntro} />

      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ob-date">{c.obDate}</Label>
            <Input
              id="ob-date"
              type="date"
              value={effectiveDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              data-testid="input-opening-date"
            />
            {overview.suggestedDate && (
              <p className="text-xs text-muted-foreground">
                {f("obSuggested", {
                  date: format(
                    parseCalendarDay(new Date(`${overview.suggestedDate}T00:00:00Z`)),
                    "dd MMM yyyy"
                  ),
                })}
              </p>
            )}
          </div>
          <div className="flex items-end">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                void onCsv(e.target.files?.[0]);
                e.target.value = "";
              }}
              data-testid="input-opening-csv"
            />
            <div>
              <Button
                variant="outline"
                onClick={() => fileInput.current?.click()}
                disabled={previewMutation.isPending}
                data-testid="button-import-csv"
              >
                <FileUp className="me-2 h-4 w-4" />
                {c.obImportCsv}
              </Button>
              <p className="mt-1 text-xs text-muted-foreground">{c.obCsvHelp}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{c.obGridTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{c.obAccount}</TableHead>
                  <TableHead className="w-40 text-end">{c.obDebit}</TableHead>
                  <TableHead className="w-40 text-end">{c.obCredit}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.accounts.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <span dir="ltr" className="font-mono text-xs text-muted-foreground">
                        {a.code}
                      </span>{" "}
                      {locale === "ar" && a.nameAr ? a.nameAr : a.nameEn}
                    </TableCell>
                    <TableCell>
                      <Input
                        inputMode="decimal"
                        className="text-end font-mono"
                        value={grid[a.code]?.debit ?? ""}
                        onChange={(e) =>
                          setGrid((g) => ({
                            ...g,
                            [a.code]: { debit: e.target.value, credit: g[a.code]?.credit ?? "" },
                          }))
                        }
                        aria-label={`${a.code} ${c.obDebit}`}
                        data-testid={`input-debit-${a.code}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        inputMode="decimal"
                        className="text-end font-mono"
                        value={grid[a.code]?.credit ?? ""}
                        onChange={(e) =>
                          setGrid((g) => ({
                            ...g,
                            [a.code]: { debit: g[a.code]?.debit ?? "", credit: e.target.value },
                          }))
                        }
                        aria-label={`${a.code} ${c.obCredit}`}
                        data-testid={`input-credit-${a.code}`}
                      />
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-medium">{c.obTotals}</TableCell>
                  <TableCell className="text-end font-mono font-medium">
                    {formatCurrency(totals.debit, "AED", locale)}
                  </TableCell>
                  <TableCell className="text-end font-mono font-medium">
                    {formatCurrency(totals.credit, "AED", locale)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          {totals.diff !== 0 && (
            <p className="text-sm text-muted-foreground" data-testid="text-balancing">
              {f("obBalancing", {
                amount: formatCurrency(Math.abs(totals.diff), "AED", locale),
                side: totals.diff > 0 ? c.obSideCredit : c.obSideDebit,
              })}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{c.obInvoicesTitle}</CardTitle>
          <CardDescription>{c.obDocsHelp}</CardDescription>
        </CardHeader>
        <CardContent>{docTable("invoice", invoices)}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{c.obBillsTitle}</CardTitle>
        </CardHeader>
        <CardContent>{docTable("bill", bills)}</CardContent>
      </Card>

      {preview && !preview.ok && (
        <Alert className="border-destructive/40" data-testid="alert-opening-errors">
          <div className="space-y-1 text-sm">
            <p className="font-semibold">{c.obFixFirst}</p>
            <ul className="list-disc ps-5">
              {preview.errors.map((e, i) => (
                <li key={i}>{e.message}</li>
              ))}
            </ul>
          </div>
        </Alert>
      )}
      {preview?.ok && previewedFor === signature && (
        <Alert className="border-success/40" data-testid="alert-opening-ok">
          <div className="text-sm">
            <p className="font-semibold">{c.obCheckOk}</p>
            {preview.totals && preview.totals.balancingSide !== "none" && (
              <p className="text-muted-foreground">
                {f("obBalancing", {
                  amount: formatCurrency(preview.totals.balancingAmount, "AED", locale),
                  side: preview.totals.balancingSide === "credit" ? c.obSideCredit : c.obSideDebit,
                })}
              </p>
            )}
          </div>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => previewMutation.mutate({ body: payload, sig: signature })}
          disabled={previewMutation.isPending}
          data-testid="button-check-opening"
        >
          {previewMutation.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
          {previewMutation.isPending ? c.obChecking : c.obCheck}
        </Button>
        <Button
          onClick={() => postMutation.mutate()}
          disabled={!canPost}
          data-testid="button-post-opening"
        >
          {postMutation.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
          {postMutation.isPending ? c.obPosting : c.obPost}
        </Button>
      </div>
    </div>
  );
}
