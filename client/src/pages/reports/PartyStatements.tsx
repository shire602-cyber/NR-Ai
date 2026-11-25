/**
 * Customer and supplier statements of account (S4, R12-09 part), opened from
 * the Report Center. Reads the W4-D statement service:
 *   GET /api/companies/:companyId/customer-statements/:contactId?from&asOf[&format=pdf]
 *   GET /api/companies/:companyId/supplier-statements/:vendorId?from&asOf[&format=pdf]
 *   POST /api/companies/:companyId/customer-statements/:contactId/email
 */
import { DatePicker } from "@/components/ui/date-picker";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, Download, Mail } from "lucide-react";
import { T } from "@/components/layout/T";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorState } from "@/components/ui/error-state";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { TableSkeleton } from "@/components/ui/loading-skeletons";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest } from "@/lib/queryClient";
import { apiUrl } from "@/lib/api";
import { formatDate } from "@/lib/format-date";
import { Money } from "@/components/ui/money";
import { useTranslation } from "@/lib/i18n";
import { statementUrl, type PartyKind } from "./partyStatementUrl";

interface Party {
  id: string;
  name: string;
}
interface StatementLine {
  date: string;
  type: string;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}
interface StatementSection {
  currency: string;
  openingBalance: number;
  lines: StatementLine[];
  closingBalance: number;
}
interface Statement {
  party: { id: string; name: string; email: string | null };
  from: string | null;
  asOf: string;
  sections: StatementSection[];
}

export default function PartyStatements() {
  const { locale, t } = useTranslation();
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  const [kind, setKind] = useState<PartyKind>("customer");
  const [partyId, setPartyId] = useState("");
  const [from, setFrom] = useState("");
  const [asOf, setAsOf] = useState("");

  const customersQuery = useQuery<Party[]>({
    queryKey: ["/api/companies", companyId, "customer-contacts"],
    enabled: !!companyId && kind === "customer",
  });
  const vendorsQuery = useQuery<Party[]>({
    queryKey: ["/api/companies", companyId, "vendors"],
    enabled: !!companyId && kind === "supplier",
  });
  const listQuery = kind === "customer" ? customersQuery : vendorsQuery;
  // Only a successfully loaded list can be "empty". A refresh failure keeps the cached list and
  // still reports the error.
  const parties = listQuery.data;
  const listError = listQuery.isError ? listQuery.error : null;
  // Paused is a fetch state, independent of the query status: it covers a first load and also a
  // refresh or Retry of an already loaded (or already failed) list while offline. The current
  // paused state wins over a stale error from the previous attempt.
  const listOffline = listQuery.fetchStatus === "paused";
  const listShownError = listOffline ? null : listError;
  const listEmpty = listQuery.isSuccess && parties?.length === 0;
  const emptyLabel = listEmpty
    ? kind === "customer"
      ? t["reportCenter.partyNoCustomers"]
      : t["reportCenter.partyNoSuppliers"]
    : listOffline
      ? t["common.errorHeading.offline"]
      : listShownError
        ? t["firm.loadFailedTitle"]
        : listQuery.isLoading
          ? t["reportCenter.partyListLoading"]
          : null;
  const range = useMemo(() => ({ from: from || undefined, asOf: asOf || undefined }), [from, asOf]);
  const url = companyId && partyId ? statementUrl(companyId, kind, partyId, range) : null;
  const statementQuery = useQuery<Statement>({
    queryKey: [url],
    queryFn: () => apiRequest("GET", url!),
    enabled: !!url,
  });
  const statement = statementQuery.data;
  const statementError = statementQuery.isError ? statementQuery.error : null;
  // Same rule as the list: paused is independent of status, and wins over a stale error.
  const statementOffline = statementQuery.fetchStatus === "paused";
  const statementShownError = statementOffline ? null : statementError;
  const email = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/customer-statements/${partyId}/email`, {
        ...(range.from ? { from: range.from } : {}),
        ...(range.asOf ? { asOf: range.asOf } : {}),
      }),
    onSuccess: (r: { message?: string }) =>
      toast({ title: t["reportCenter.partyStatementEmailed"], description: r?.message }),
    onError: (e: Error) =>
      toast({ title: t["reportCenter.partyStatementEmailFailed"], description: e.message }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reports"
        backHref="/reports"
        backLabel={t["reportCenter.backToReportCenter"]}
        title={<T k="reportCenter.partyStatementsTitle" />}
        description={<T k="reportCenter.partyStatementsHint" />}
      />
      <Card>
        <CardContent className="grid grid-cols-1 gap-3 pt-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label>
              <T k="reportCenter.partyStatementKind" />
            </Label>
            <Select
              value={kind}
              onValueChange={(v) => {
                setKind(v as PartyKind);
                setPartyId("");
              }}
            >
              <SelectTrigger
                aria-label={t["reportCenter.partyStatementKind"]}
                data-testid="select-statement-kind"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="customer">{t["reportCenter.partyCustomer"]}</SelectItem>
                <SelectItem value="supplier">{t["reportCenter.partySupplier"]}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>
              <T
                k={
                  kind === "customer" ? "reportCenter.partyCustomer" : "reportCenter.partySupplier"
                }
              />
            </Label>
            <Select value={partyId} onValueChange={setPartyId}>
              <SelectTrigger
                aria-label={
                  kind === "customer"
                    ? t["reportCenter.partyCustomer"]
                    : t["reportCenter.partySupplier"]
                }
                data-testid="select-statement-party"
              >
                <SelectValue placeholder={t["reportCenter.partySelect"]} />
              </SelectTrigger>
              <SelectContent>
                {!parties?.length && emptyLabel ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground" role="status">
                    {emptyLabel}
                  </div>
                ) : null}
                {(parties ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="statement-from">
              <T k="reportCenter.partyStatementFrom" />
            </Label>
            <DatePicker id="statement-from" value={from} onChange={(value) => setFrom(value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="statement-asof">
              <T k="reportCenter.partyStatementAsOf" />
            </Label>
            <DatePicker id="statement-asof" value={asOf} onChange={(value) => setAsOf(value)} />
          </div>
        </CardContent>
      </Card>

      {/* The list and the statement fail independently: each notice sits above whatever is
          still on screen and carries its own Retry, so a failed refresh never hides a loaded
          statement and a failed list never blocks the statement of the selected party. */}
      {listOffline ? (
        <ErrorState
          title={t["common.errorHeading.offline"]}
          description={t["reportCenter.partyLoadPausedOffline"]}
          testId="party-list-offline"
        />
      ) : null}
      {listShownError ? (
        <LoadErrorState
          error={listShownError}
          onRetry={() => void listQuery.refetch()}
          compact={parties !== undefined}
          testId="party-list-error"
        />
      ) : null}
      {partyId && statementShownError ? (
        <LoadErrorState
          error={statementShownError}
          onRetry={() => void statementQuery.refetch()}
          title={t["reportCenter.partyStatementLoadFailed"]}
          compact={statement !== undefined}
          testId="party-statement-error"
        />
      ) : null}
      {partyId && statementOffline ? (
        <ErrorState
          title={t["common.errorHeading.offline"]}
          description={t["reportCenter.partyLoadPausedOffline"]}
          testId="party-statement-offline"
        />
      ) : null}
      {!partyId ? (
        parties === undefined && (listOffline || listError) ? null : (
          <p className="text-sm text-muted-foreground">
            {listEmpty ? emptyLabel : <T k="reportCenter.partyStatementPick" />}
          </p>
        )
      ) : statement ? (
        <Card data-testid="card-party-statement">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">
              {statement.party.name} · {formatDate(statement.asOf, locale)}
            </CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <a
                  href={apiUrl(statementUrl(companyId!, kind, partyId, range, "pdf"))}
                  download
                  data-testid="link-party-statement-pdf"
                >
                  <Download className="me-1 h-4 w-4" />
                  <T k="reportCenter.partyStatementPdf" />
                </a>
              </Button>
              {kind === "customer" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={email.isPending || !statement.party.email}
                  title={statement.party.email ?? t["reportCenter.partyStatementNoEmail"]}
                  onClick={() => email.mutate()}
                  data-testid="button-email-party-statement"
                >
                  <Mail className="me-1 h-4 w-4" />
                  <T k="reportCenter.partyStatementEmail" />
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {statement.sections.length === 0 ? (
              <EmptyState size="sm" title={t["reportCenter.partyStatementEmpty"]} />
            ) : (
              statement.sections.map((section) => (
                <div key={section.currency} className="space-y-2">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span className="text-muted-foreground">
                      <T k="reportCenter.partyStatementOpening" />
                    </span>
                    <Money amount={section.openingBalance} currency={section.currency} />
                    <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
                    <span className="text-muted-foreground">
                      <T k="reportCenter.partyStatementClosing" />
                    </span>
                    <Money amount={section.closingBalance} currency={section.currency} />
                  </p>
                  {section.lines.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      <T k="reportCenter.partyStatementEmpty" />
                    </p>
                  ) : null}
                  {section.lines.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>
                            <T k="reportCenter.partyStatementDate" />
                          </TableHead>
                          <TableHead>
                            <T k="reportCenter.partyStatementReference" />
                          </TableHead>
                          <TableHead data-numeric>
                            <T k="reportCenter.partyStatementDebit" />
                          </TableHead>
                          <TableHead data-numeric>
                            <T k="reportCenter.partyStatementCredit" />
                          </TableHead>
                          <TableHead data-numeric>
                            <T k="reportCenter.partyStatementBalance" />
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {section.lines.map((line, i) => (
                          <TableRow key={`${line.reference}-${i}`}>
                            <TableCell className="whitespace-nowrap text-xs">
                              {formatDate(line.date, locale)}
                            </TableCell>
                            <TableCell className="break-words text-xs">
                              <bdi dir="ltr" translate="no">
                                {line.reference}
                              </bdi>
                              {line.description && (
                                <>
                                  {" "}
                                  · <bdi>{line.description}</bdi>
                                </>
                              )}
                            </TableCell>
                            <TableCell data-numeric>
                              {line.debit ? (
                                <Money amount={line.debit} showCurrency={false} />
                              ) : null}
                            </TableCell>
                            <TableCell data-numeric>
                              {line.credit ? (
                                <Money amount={line.credit} showCurrency={false} />
                              ) : null}
                            </TableCell>
                            <TableCell data-numeric>
                              <Money amount={line.balance} showCurrency={false} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ) : statementQuery.isLoading ? (
        <div aria-busy="true" aria-label={t["reportCenter.partyStatementLoading"]}>
          <TableSkeleton rows={4} columns={5} />
        </div>
      ) : null}
    </div>
  );
}
