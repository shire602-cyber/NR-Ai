import { accountName } from "@/lib/account-name";
import { useParams, Link } from "wouter";
import { messages as iconLabels } from "@/components/ui/button.i18n";
import { useQuery } from "@tanstack/react-query";
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
import { useTranslation } from "@/lib/i18n";
import { localizeJournalText } from "@/lib/journal-text";
import { formatCurrency } from "@/lib/format";
import {
  ArrowLeft,
  BookMarked,
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  RotateCcw,
} from "lucide-react";
import { messages as pageMessages } from "./JournalEntryDetail.i18n";

interface JournalLine {
  id: string;
  journalEntryId: string;
  accountId: string;
  debit: string;
  credit: string;
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
  status: "draft" | "posted" | "reversed";
  sourceType: string | null;
  sourceId: string | null;
  reversedEntryId: string | null;
  createdAt: string;
  lines: JournalLine[];
}

export default function JournalEntryDetail() {
  const tr = pageMessages.useT();

  const { id } = useParams<{ id: string }>();
  const { t, locale } = useTranslation();

  const {
    data: entry,
    isLoading,
    error,
  } = useQuery<JournalEntry>({
    queryKey: [`/api/journal/${id}`],
    enabled: !!id,
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "posted":
        return (
          <Badge className="bg-success-subtle text-success-subtle-foreground ">
            <CheckCircle2 className="w-3 h-3 me-1" />
            {tr("posted")}
          </Badge>
        );
      case "draft":
        return (
          <Badge variant="secondary">
            <Clock className="w-3 h-3 me-1" />
            {tr("draft")}
          </Badge>
        );
      case "reversed":
        return (
          <Badge variant="destructive">
            <RotateCcw className="w-3 h-3 me-1" />
            {tr("reversed")}
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getSourceTypeBadge = (sourceType: string | null) => {
    if (!sourceType) return null;

    const sourceLabels: Record<string, string> = {
      invoice: tr("invoice"),
      receipt: tr("receiptExpense"),
      manual: tr("manualEntry"),
      payment: tr("payment"),
      adjustment: tr("adjustment"),
    };

    return (
      <Badge variant="outline" className="ms-2">
        <FileText className="w-3 h-3 me-1" />
        {sourceLabels[sourceType] || sourceType}
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
            <Button variant="ghost" size="icon" aria-label={iconLabels.t("back")} data-testid="button-back-to-journal">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">{tr("journalEntryNotFound")}</h1>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <XCircle className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">{tr("theRequestedJournalEntryCouldNot")}</p>
            <Link href="/journal">
              <Button className="mt-4" data-testid="button-return-to-journal">
                {tr("returnToJournal")}
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalDebit = entry.lines.reduce((sum, line) => sum + parseFloat(line.debit || "0"), 0);
  const totalCredit = entry.lines.reduce((sum, line) => sum + parseFloat(line.credit || "0"), 0);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <Link href="/journal">
            <Button variant="ghost" size="icon" aria-label={iconLabels.t("back")} data-testid="button-back-to-journal">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <BookMarked className="w-6 h-6 text-primary" />
              <h1 className="text-2xl font-bold" data-testid="text-journal-entry-number">
                {tr("journalEntry", { entryNumber: entry.entryNumber })}
              </h1>
              {getStatusBadge(entry.status)}
              {getSourceTypeBadge(entry.sourceType)}
            </div>
            <p className="text-muted-foreground">{format(new Date(entry.date), "MMMM d, yyyy")}</p>
          </div>
        </div>
        <Link href="/journal">
          <Button variant="outline" data-testid="button-view-all-entries">
            {tr("viewAllEntries")}
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{tr("totalDebits")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success" data-testid="text-total-debits">
              {formatCurrency(totalDebit, "AED", locale)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{tr("totalCredits")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-info" data-testid="text-total-credits">
              {formatCurrency(totalCredit, "AED", locale)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{tr("balance")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${Math.abs(totalDebit - totalCredit) < 0.01 ? "text-success" : "text-destructive"}`}
              data-testid="text-balance"
            >
              {Math.abs(totalDebit - totalCredit) < 0.01
                ? tr("balanced")
                : formatCurrency(Math.abs(totalDebit - totalCredit), "AED", locale)}
            </div>
          </CardContent>
        </Card>
      </div>

      {entry.memo && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{tr("memo")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground" data-testid="text-memo">
              {localizeJournalText(entry.memo, locale)}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{tr("lineItems")}</CardTitle>
          <CardDescription>{tr("doubleEntryTransactionDetails")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">{tr("code")}</TableHead>
                <TableHead>{tr("accountName")}</TableHead>
                <TableHead>{tr("type")}</TableHead>
                <TableHead className="text-end">{tr("debitAed")}</TableHead>
                <TableHead className="text-end">{tr("creditAed")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entry.lines.map((line, index) => (
                <TableRow key={line.id} data-testid={`row-journal-line-${index}`}>
                  <TableCell className="font-mono">{line.account?.code || "-"}</TableCell>
                  <TableCell>
                    {accountName(line.account, locale) || tr("unknownAccount")}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {line.account?.type || "-"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-end font-mono">
                    {parseFloat(line.debit) > 0
                      ? formatCurrency(parseFloat(line.debit), "AED", locale)
                      : "-"}
                  </TableCell>
                  <TableCell className="text-end font-mono">
                    {parseFloat(line.credit) > 0
                      ? formatCurrency(parseFloat(line.credit), "AED", locale)
                      : "-"}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/50 font-bold">
                <TableCell colSpan={3} className="text-end">
                  {tr("totals")}
                </TableCell>
                <TableCell className="text-end font-mono">
                  {formatCurrency(totalDebit, "AED", locale)}
                </TableCell>
                <TableCell className="text-end font-mono">
                  {formatCurrency(totalCredit, "AED", locale)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {entry.reversedEntryId && (
        <Card className="border-warning/30 ">
          <CardHeader>
            <CardTitle className="text-lg text-warning">{tr("reversalInformation")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              {tr("thisEntryHasBeenReversed")}
              <Link href={`/journal/${entry.reversedEntryId}`}>
                <Button
                  variant="ghost"
                  className="text-primary p-0 h-auto"
                  data-testid="link-reversal-entry"
                >
                  {tr("viewReversalEntry")}
                </Button>
              </Link>
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{tr("entryDetails")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">{tr("entryId")}</span>
              <span dir="ltr" className="ms-2 font-mono" data-testid="text-entry-id">
                {entry.id}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">{tr("created")}</span>
              <span className="ms-2" data-testid="text-created-at">
                {format(new Date(entry.createdAt), "MMM d, yyyy HH:mm")}
              </span>
            </div>
            {entry.sourceType && (
              <div>
                <span className="text-muted-foreground">{tr("sourceType")}</span>
                <span className="ms-2 capitalize">{entry.sourceType}</span>
              </div>
            )}
            {entry.sourceId && (
              <div>
                <span className="text-muted-foreground">{tr("sourceId")}</span>
                <span dir="ltr" className="ms-2 font-mono">
                  {entry.sourceId}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
