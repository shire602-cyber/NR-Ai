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
import { Download, Mail, ScrollText } from "lucide-react";
import { T } from "@/components/layout/T";
import { PageHeader } from "@/components/ui/page-header";
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
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest } from "@/lib/queryClient";
import { apiUrl } from "@/lib/api";
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
  const { t } = useTranslation();
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  const [kind, setKind] = useState<PartyKind>("customer");
  const [partyId, setPartyId] = useState("");
  const [from, setFrom] = useState("");
  const [asOf, setAsOf] = useState("");

  const { data: customers = [] } = useQuery<Party[]>({
    queryKey: ["/api/companies", companyId, "customer-contacts"],
    enabled: !!companyId && kind === "customer",
  });
  const { data: vendors = [] } = useQuery<Party[]>({
    queryKey: ["/api/companies", companyId, "vendors"],
    enabled: !!companyId && kind === "supplier",
  });
  const parties = kind === "customer" ? customers : vendors;
  const range = useMemo(() => ({ from: from || undefined, asOf: asOf || undefined }), [from, asOf]);
  const url = companyId && partyId ? statementUrl(companyId, kind, partyId, range) : null;
  const { data: statement, isLoading } = useQuery<Statement>({
    queryKey: [url],
    queryFn: () => apiRequest("GET", url!),
    enabled: !!url,
  });
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
        icon={ScrollText}
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
              <SelectTrigger data-testid="select-statement-kind">
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
              <SelectTrigger data-testid="select-statement-party">
                <SelectValue placeholder={t["reportCenter.partySelect"]} />
              </SelectTrigger>
              <SelectContent>
                {parties.map((p) => (
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

      {!partyId ? (
        <p className="text-sm text-muted-foreground">
          <T k="reportCenter.partyStatementPick" />
        </p>
      ) : isLoading ? null : statement ? (
        <Card data-testid="card-party-statement">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">
              {statement.party.name} · {statement.asOf}
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
              <p className="text-sm text-muted-foreground">
                <T k="reportCenter.partyStatementEmpty" />
              </p>
            ) : (
              statement.sections.map((section) => (
                <div key={section.currency} className="space-y-2">
                  <p className="text-sm font-medium" dir="ltr">
                    {section.currency} ·{" "}
                    <Money amount={section.openingBalance} currency={section.currency} /> →{" "}
                    <Money amount={section.closingBalance} currency={section.currency} />
                  </p>
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
                          <TableCell className="text-xs">{line.date}</TableCell>
                          <TableCell className="text-xs">
                            {line.reference}
                            {line.description ? ` · ${line.description}` : ""}
                          </TableCell>
                          <TableCell data-numeric className=" tabular-nums">
                            {line.debit ? line.debit.toFixed(2) : ""}
                          </TableCell>
                          <TableCell data-numeric className=" tabular-nums">
                            {line.credit ? line.credit.toFixed(2) : ""}
                          </TableCell>
                          <TableCell data-numeric className=" tabular-nums">
                            {line.balance.toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
