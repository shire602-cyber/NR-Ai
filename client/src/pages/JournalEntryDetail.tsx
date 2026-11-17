import { localizeJournalMemo } from "@/lib/journal-memo";
import { DatePicker } from "@/components/ui/date-picker";
import { T } from "@/components/layout/T";
import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
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
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { Money, MoneyCell } from "@/components/ui/money";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ArrowLeft, CheckCircle2, XCircle, Clock, FileText, RotateCcw, Ban } from "lucide-react";
import { accountDisplayName } from "@/lib/account-name";

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

  const accountTypeLabel = (type?: string | null) =>
    type
      ? ((
          {
            asset: t["screens.typeAsset"],
            liability: t["screens.typeLiability"],
            equity: t["screens.typeEquity"],
            income: t["screens.typeIncome"],
            expense: t["screens.typeExpense"],
          } as Record<string, string>
        )[type] ?? type)
      : "—";

  const getStatusBadge = (entry: JournalEntry) => {
    switch (entry.lifecycleStatus ?? entry.status) {
      case "posted":
        return (
          <Badge variant="success">
            <CheckCircle2 className="w-3 h-3 me-1" />
            {t["journal.statusPosted"]}
          </Badge>
        );
      case "draft":
        return (
          <Badge variant="neutral">
            <Clock className="w-3 h-3 me-1" />
            {entry.approvalStatus === "pending"
              ? t["journal.statusPendingApproval"]
              : t["journal.statusDraft"]}
          </Badge>
        );
      case "reversed":
        return (
          <Badge variant="danger">
            <RotateCcw className="w-3 h-3 me-1" />
            {t["journal.statusReversed"]}
          </Badge>
        );
      case "voided":
        return (
          <Badge variant="danger">
            <Ban className="w-3 h-3 me-1" />
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
      <Badge variant="outline">
        <FileText className="w-3 h-3 me-1" />
        {sourceLabels[source] || source}
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
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
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button asChild variant="ghost" size="icon" data-testid="button-back-to-journal">
            <Link href="/journal">
              <ArrowLeft className="w-5 h-5 rtl:-scale-x-100" />
            </Link>
          </Button>
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
            <Button asChild className="mt-4" data-testid="button-return-to-journal">
              <Link href="/journal">
                <T k="pageLabels.returnToJournal" />
              </Link>
            </Button>
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
    <div className="space-y-6">
      <PageHeader
        backHref="/journal"
        backLabel={t["pageLabels.viewAllEntries"]}
        eyebrow="Accounting"
        title={
          <>
            {t["screens.journalEntry"]}{" "}
            <span dir="ltr" className="tabular-nums [unicode-bidi:isolate]">
              {entry.entryNumber}
            </span>
          </>
        }
        testId="text-journal-entry-number"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{formatDate(entry.date, locale)}</span>
            {getStatusBadge(entry)}
            {getSourceBadge(entry.source)}
          </span>
        }
        actions={
          <>
            {canReverse && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" data-testid="button-void-entry">
                    <Ban aria-hidden />
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
            {canReverse && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" data-testid="button-reverse-entry">
                    <RotateCcw aria-hidden />
                    {t["journal.reverse"]}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t["journal.reverseTitle"]}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t["journal.reverseDescription"]}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label htmlFor="reversal-date">{t["journal.reversalDate"]}</Label>
                      <DatePicker
                        id="reversal-date"
                        value={reverseDate}
                        onChange={(value) => setReverseDate(value)}
                        data-testid="input-reversal-date"
                      />
                      <p className="text-xs text-muted-foreground">
                        {t["journal.reversalDateHint"]}
                      </p>
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
            {canApprove && (
              <Button
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending}
                data-testid="button-approve-entry"
              >
                <CheckCircle2 aria-hidden />
                {t["journal.approve"]}
              </Button>
            )}
          </>
        }
      />

      <div className="mobile-keep-cols grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard
          label={t["pageLabels.totalDebits"]}
          value={<Money amount={totalDebit} />}
          testId="text-total-debits"
        />
        <StatCard
          label={t["pageLabels.totalCredits"]}
          value={<Money amount={totalCredit} />}
          testId="text-total-credits"
        />
        <StatCard
          label={t["portal.balance"]}
          testId="text-balance"
          value={
            isBalanced ? (
              <span className="inline-flex items-center gap-2 text-success">
                <CheckCircle2 className="h-6 w-6" aria-hidden />
                {t.balanced}
              </span>
            ) : (
              <Money
                amount={Math.abs(totalDebitFils - totalCreditFils) / 100}
                className="text-danger"
              />
            )
          }
          hint={isBalanced ? t["screens.debitsEqualCredits"] : t["screens.notBalanced"]}
        />
      </div>

      {entry.memo && (
        <SectionCard title={t["screens.memo"]}>
          <p dir="auto" className="text-sm text-muted-foreground" data-testid="text-memo">
            {localizeJournalMemo(t, entry.memo, locale)}
          </p>
        </SectionCard>
      )}

      <SectionCard
        title={t["screens.entryLines"]}
        description={t["pageLabels.doubleEntryTransactionDetails"]}
        flush
      >
        <Table className="mobile-fit">
          <TableHeader>
            <TableRow>
              <TableHead>{t["screens.code"]}</TableHead>
              <TableHead className="w-full">
                <T k="pageLabels.accountName" />
              </TableHead>
              <TableHead className="hidden sm:table-cell">{t["screens.type"]}</TableHead>
              <TableHead data-numeric="">{t["screens.debit"]}</TableHead>
              <TableHead data-numeric="">{t["screens.credit"]}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entry.lines.map((line, index) => (
              <TableRow key={line.id} data-testid={`row-journal-line-${index}`}>
                <TableCell data-nowrap="" className="tabular-nums text-muted-foreground">
                  {line.account?.code || "—"}
                </TableCell>
                <TableCell data-truncate="" dir="auto">
                  {accountDisplayName(line.account, locale) || t["screens.unknownAccount"]}
                </TableCell>
                <TableCell data-nowrap="" className="hidden text-muted-foreground sm:table-cell">
                  {accountTypeLabel(line.account?.type)}
                </TableCell>
                <TableCell data-numeric="">
                  {fils(line.debit) > 0 ? (
                    <Money amount={fils(line.debit) / 100} showCurrency={false} />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell data-numeric="">
                  {fils(line.credit) > 0 ? (
                    <Money amount={fils(line.credit) / 100} showCurrency={false} />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2}>
                <T k="pages.totals" />
              </TableCell>
              <TableCell className="hidden sm:table-cell" />
              <MoneyCell amount={totalDebit} />
              <MoneyCell amount={totalCredit} />
            </TableRow>
          </TableFooter>
        </Table>
      </SectionCard>

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
                <Button
                  asChild
                  variant="ghost"
                  className="text-primary p-0 h-auto"
                  data-testid="link-reversal-entry"
                >
                  <Link href={`/journal/${entry.reversedByEntryId}`}>
                    {t["journal.viewReversalEntry"]}
                  </Link>
                </Button>
              </p>
            )}
            {entry.reversalOf && (
              <p className="text-muted-foreground" data-testid="text-reversal-of">
                {t["journal.thisEntryIsReversal"]}{" "}
                {formatMessage(t["journal.reversalOf"], {
                  number: entry.reversalOfEntry?.entryNumber ?? "",
                })}{" "}
                <Button
                  asChild
                  variant="ghost"
                  className="text-primary p-0 h-auto"
                  data-testid="link-original-entry"
                >
                  <Link href={`/journal/${entry.reversalOf}`}>
                    {t["journal.viewOriginalEntry"]}
                  </Link>
                </Button>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <SectionCard title={t["pageLabels.entryDetails"]}>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm md:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-caption text-muted-foreground">{t["screens.entryId"]}</dt>
            <dd
              dir="ltr"
              className="truncate tabular-nums [unicode-bidi:isolate]"
              data-testid="text-entry-id"
            >
              {entry.id}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-muted-foreground">{t["screens.created"]}</dt>
            <dd data-testid="text-created-at">{formatDate(entry.createdAt, locale)}</dd>
          </div>
          {entry.source && (
            <div>
              <dt className="text-caption text-muted-foreground">{t["journal.source"]}</dt>
              <dd>{getSourceBadge(entry.source)}</dd>
            </div>
          )}
          {entry.sourceId && (
            <div className="min-w-0">
              <dt className="text-caption text-muted-foreground">{t["screens.sourceId"]}</dt>
              <dd dir="ltr" className="truncate tabular-nums [unicode-bidi:isolate]">
                {entry.sourceId}
              </dd>
            </div>
          )}
        </dl>
      </SectionCard>
    </div>
  );
}
