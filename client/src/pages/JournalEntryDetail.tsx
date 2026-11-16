import { T } from "@/components/layout/T";
import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  ArrowLeft,
  BookMarked,
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  RotateCcw,
  Ban,
} from "lucide-react";

interface JournalLine {
  id: string;
  entryId: string;
  accountId: string;
  debit: string | number;
  credit: string | number;
  account?: {
    id: string;
    code: string;
    nameEn: string;
    nameAr: string | null;
    type: string;
  };
}

interface JournalEntry {
  id: string;
  companyId: string;
  entryNumber: string;
  date: string;
  memo: string | null;
  // Ledger-effect status. A reversed/voided original stays "posted".
  status: "draft" | "posted" | "void";
  // Derived by the API from reversedByEntryId + reversalKind.
  lifecycleStatus: "draft" | "posted" | "reversed" | "voided" | "void";
  source: string | null;
  sourceId: string | null;
  entryKind: string;
  approvalStatus: string | null;
  reversedByEntryId: string | null;
  reversalOf: string | null;
  reversedByEntry: { id: string; entryNumber: string; date: string } | null;
  reversalOfEntry: { id: string; entryNumber: string; date: string } | null;
  createdAt: string;
  lines: JournalLine[];
}

/** Integer fils from an API amount (number or decimal string). */
function fils(v: string | number | null | undefined): number {
  return Math.round(Number(v || 0) * 100);
}

export default function JournalEntryDetail() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const [reverseDate, setReverseDate] = useState("");
  const [reason, setReason] = useState("");

  const {
    data: entry,
    isLoading,
    error,
  } = useQuery<JournalEntry>({
    queryKey: [`/api/journal/${id}`],
    enabled: !!id,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/journal/${id}`] });
    queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
  };
  const onError = (error: { message?: string }) =>
    toast({
      variant: "destructive",
      title: t["journal.actionFailed"],
      description: error?.message,
    });

  const reverseMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/journal/${id}/reverse`, {
        reason: reason || null,
        date: reverseDate || null,
      }),
    onSuccess: (data: { reversalNumber?: string }) => {
      invalidate();
      toast({
        title: t["journal.reversedToast"],
        description: formatMessage(t["journal.reversedToastBody"], {
          number: data?.reversalNumber ?? "",
        }),
      });
    },
    onError,
  });
  const voidMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/journal/${id}/void`, { reason: reason || null }),
    onSuccess: () => {
      invalidate();
      toast({ title: t["journal.voidedToast"] });
    },
    onError,
  });
  const approveMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/journal/${id}/approve`, {}),
    onSuccess: () => {
      invalidate();
      toast({ title: t["journal.approvedToast"] });
    },
    onError,
  });

  const getStatusBadge = (entry: JournalEntry) => {
    switch (entry.lifecycleStatus ?? entry.status) {
      case "posted":
        return (
          <Badge className="bg-success-subtle text-success-subtle-foreground ">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            {t["journal.statusPosted"]}
          </Badge>
        );
      case "draft":
        return (
          <Badge variant="secondary">
            <Clock className="w-3 h-3 mr-1" />
            {entry.approvalStatus === "pending"
              ? t["journal.statusPendingApproval"]
              : t["journal.statusDraft"]}
          </Badge>
        );
      case "reversed":
        return (
          <Badge variant="destructive">
            <RotateCcw className="w-3 h-3 mr-1" />
            {t["journal.statusReversed"]}
          </Badge>
        );
      case "voided":
        return (
          <Badge variant="destructive">
            <Ban className="w-3 h-3 mr-1" />
            {t["journal.statusVoided"]}
          </Badge>
        );
      case "void":
        return <Badge variant="outline">{t["journal.statusVoid"]}</Badge>;
      default:
        return <Badge variant="outline">{entry.status}</Badge>;
    }
  };

  const getSourceBadge = (source: string | null) => {
    if (!source) return null;
    const sourceLabels: Record<string, string> = {
      invoice: t["journal.sourceInvoice"],
      receipt: t["journal.sourceReceipt"],
      manual: t["journal.sourceManual"],
      payment: t["journal.sourcePayment"],
      reversal: t["journal.sourceReversal"],
      journal_template: t["journal.sourceTemplate"],
    };

    return (
      <Badge variant="outline" className="ml-2">
        <FileText className="w-3 h-3 mr-1" />
        {sourceLabels[source] || source}
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-8 w-64" />
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Skeleton className="h-40 w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !entry) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center gap-4">
          <Link href="/journal">
            <Button variant="ghost" size="icon" data-testid="button-back-to-journal">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">
            <T k="pageLabels.journalEntryNotFound" />
          </h1>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <XCircle className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">
              <T k="pageLabels.theRequestedJournalEntryCouldNotBeFound" />
            </p>
            <Link href="/journal">
              <Button className="mt-4" data-testid="button-return-to-journal">
                <T k="pageLabels.returnToJournal" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Exact comparison in integer fils (no 0.01 tolerance).
  const totalDebitFils = entry.lines.reduce((sum, line) => sum + fils(line.debit), 0);
  const totalCreditFils = entry.lines.reduce((sum, line) => sum + fils(line.credit), 0);
  const totalDebit = totalDebitFils / 100;
  const totalCredit = totalCreditFils / 100;
  const isBalanced = totalDebitFils === totalCreditFils;
  const canReverse = entry.lifecycleStatus === "posted" && entry.entryKind !== "reversal";
  const canApprove = entry.status === "draft" && entry.approvalStatus === "pending";

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <Link href="/journal">
            <Button variant="ghost" size="icon" data-testid="button-back-to-journal">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <BookMarked className="w-6 h-6 text-primary" />
              <h1 className="text-2xl font-bold" data-testid="text-journal-entry-number">
                Journal Entry #{entry.entryNumber}
              </h1>
              {getStatusBadge(entry)}
              {getSourceBadge(entry.source)}
            </div>
            <p className="text-muted-foreground">{format(new Date(entry.date), "MMMM d, yyyy")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canApprove && (
            <Button
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending}
              data-testid="button-approve-entry"
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              {t["journal.approve"]}
            </Button>
          )}
          {canReverse && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" data-testid="button-reverse-entry">
                  <RotateCcw className="w-4 h-4 mr-2" />
                  {t["journal.reverse"]}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t["journal.reverseTitle"]}</AlertDialogTitle>
                  <AlertDialogDescription>{t["journal.reverseDescription"]}</AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="reversal-date">{t["journal.reversalDate"]}</Label>
                    <Input
                      id="reversal-date"
                      type="date"
                      value={reverseDate}
                      onChange={(e) => setReverseDate(e.target.value)}
                      data-testid="input-reversal-date"
                    />
                    <p className="text-xs text-muted-foreground">{t["journal.reversalDateHint"]}</p>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="reversal-reason">{t["journal.reason"]}</Label>
                    <Input
                      id="reversal-reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      data-testid="input-reversal-reason"
                    />
                  </div>
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>
                    <T k="pages.cancel" />
                  </AlertDialogCancel>
                  <AlertDialogAction onClick={() => reverseMutation.mutate()}>
                    {t["journal.confirmReverse"]}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {canReverse && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" data-testid="button-void-entry">
                  <Ban className="w-4 h-4 mr-2" />
                  {t["journal.void"]}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t["journal.voidTitle"]}</AlertDialogTitle>
                  <AlertDialogDescription>{t["journal.voidDescription"]}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>
                    <T k="pages.cancel" />
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => voidMutation.mutate()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {t["journal.confirmVoid"]}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Link href="/journal">
            <Button variant="outline" data-testid="button-view-all-entries">
              <T k="pageLabels.viewAllEntries" />
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              <T k="pageLabels.totalDebits" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success" data-testid="text-total-debits">
              {formatCurrency(totalDebit, "AED", locale)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              <T k="pageLabels.totalCredits" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-info" data-testid="text-total-credits">
              {formatCurrency(totalCredit, "AED", locale)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              <T k="portal.balance" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${isBalanced ? "text-success" : "text-destructive"}`}
              data-testid="text-balance"
            >
              {isBalanced
                ? t.balanced
                : formatCurrency(Math.abs(totalDebitFils - totalCreditFils) / 100, "AED", locale)}
            </div>
          </CardContent>
        </Card>
      </div>

      {entry.memo && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Memo</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground" data-testid="text-memo">
              {entry.memo}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            <T k="pages.lineItems" />
          </CardTitle>
          <CardDescription>
            <T k="pageLabels.doubleEntryTransactionDetails" />
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Code</TableHead>
                <TableHead>
                  <T k="pageLabels.accountName" />
                </TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Debit (AED)</TableHead>
                <TableHead className="text-right">Credit (AED)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entry.lines.map((line, index) => (
                <TableRow key={line.id} data-testid={`row-journal-line-${index}`}>
                  <TableCell className="font-mono">{line.account?.code || "-"}</TableCell>
                  <TableCell>
                    {locale === "ar" && line.account?.nameAr
                      ? line.account.nameAr
                      : line.account?.nameEn || "Unknown Account"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {line.account?.type || "-"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {fils(line.debit) > 0
                      ? formatCurrency(fils(line.debit) / 100, "AED", locale)
                      : "-"}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {fils(line.credit) > 0
                      ? formatCurrency(fils(line.credit) / 100, "AED", locale)
                      : "-"}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/50 font-bold">
                <TableCell colSpan={3} className="text-right">
                  <T k="pages.totals" />
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatCurrency(totalDebit, "AED", locale)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatCurrency(totalCredit, "AED", locale)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {(entry.reversedByEntryId || entry.reversalOf) && (
        <Card className="border-warning/30" data-testid="card-reversal-information">
          <CardHeader>
            <CardTitle className="text-lg text-warning">
              {t["journal.reversalInformation"]}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {entry.reversedByEntryId && (
              <p className="text-muted-foreground" data-testid="text-reversed-by">
                {entry.lifecycleStatus === "voided"
                  ? t["journal.thisEntryVoided"]
                  : t["journal.thisEntryReversed"]}{" "}
                {formatMessage(
                  entry.lifecycleStatus === "voided"
                    ? t["journal.voidedBy"]
                    : t["journal.reversedBy"],
                  { number: entry.reversedByEntry?.entryNumber ?? "" }
                )}{" "}
                <Link href={`/journal/${entry.reversedByEntryId}`}>
                  <Button
                    variant="ghost"
                    className="text-primary p-0 h-auto"
                    data-testid="link-reversal-entry"
                  >
                    {t["journal.viewReversalEntry"]}
                  </Button>
                </Link>
              </p>
            )}
            {entry.reversalOf && (
              <p className="text-muted-foreground" data-testid="text-reversal-of">
                {t["journal.thisEntryIsReversal"]}{" "}
                {formatMessage(t["journal.reversalOf"], {
                  number: entry.reversalOfEntry?.entryNumber ?? "",
                })}{" "}
                <Link href={`/journal/${entry.reversalOf}`}>
                  <Button
                    variant="ghost"
                    className="text-primary p-0 h-auto"
                    data-testid="link-original-entry"
                  >
                    {t["journal.viewOriginalEntry"]}
                  </Button>
                </Link>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            <T k="pageLabels.entryDetails" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Entry ID:</span>
              <span className="ml-2 font-mono" data-testid="text-entry-id">
                {entry.id}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Created:</span>
              <span className="ml-2" data-testid="text-created-at">
                {format(new Date(entry.createdAt), "MMM d, yyyy HH:mm")}
              </span>
            </div>
            {entry.source && (
              <div>
                <span className="text-muted-foreground">{t["journal.source"]}:</span>
                <span className="ml-2 capitalize">{entry.source}</span>
              </div>
            )}
            {entry.sourceId && (
              <div>
                <span className="text-muted-foreground">Source ID:</span>
                <span className="ml-2 font-mono">{entry.sourceId}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
