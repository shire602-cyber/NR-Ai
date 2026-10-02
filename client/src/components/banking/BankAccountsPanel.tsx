import { useQuery } from "@tanstack/react-query";
import { Landmark, Pencil, Plus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/lib/i18n";
import { accountName } from "@/lib/account-name";
import { formatCalendarDate } from "@/lib/calendar-date";
import type { BankAccount, LedgerAccount } from "@/lib/banking-api-types";
import { messages } from "./BankAccountsPanel.i18n";

interface Props {
  companyId: string;
  bankAccounts: BankAccount[];
  onAdd: () => void;
  onEdit: (account: BankAccount) => void;
}

export function BankAccountsPanel({ companyId, bankAccounts, onAdd, onEdit }: Props) {
  const tr = messages.useT();
  const locale = useI18n((s) => s.locale);
  const { data: accounts = [] } = useQuery<LedgerAccount[]>({ queryKey: ["/api/companies", companyId, "accounts"], enabled: !!companyId });
  const ledger = (id: string | null) => {
    const a = accounts.find((x) => x.id === id);
    return a ? `${a.code} ${accountName(a, locale)}` : tr("noLedger");
  };

  return (
    <Card data-testid="bank-accounts-panel">
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Landmark className="h-5 w-5" />
              {tr("title")}
            </CardTitle>
            <CardDescription>{tr("description")}</CardDescription>
          </div>
          <Button onClick={onAdd} data-testid="button-add-bank-account">
            <Plus className="h-4 w-4 me-2" />
            {tr("add")}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {bankAccounts.length === 0 ? (
          <EmptyState icon={Landmark} title={tr("empty")} description={tr("emptyHint")} testId="empty-bank-accounts" />
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr("colName")}</TableHead>
                  <TableHead>{tr("colBank")}</TableHead>
                  <TableHead>{tr("colCurrency")}</TableHead>
                  <TableHead>{tr("colLedger")}</TableHead>
                  <TableHead>{tr("colFrom")}</TableHead>
                  <TableHead>{tr("colStatus")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {bankAccounts.map((a) => (
                  <TableRow key={a.id} data-testid={`bank-account-${a.id}`}>
                    <TableCell className="font-medium" dir="auto">
                      {a.nameEn}
                      {a.iban && (
                        <span dir="ltr" className="block text-xs font-mono text-muted-foreground text-start">
                          {a.iban}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{a.bankName}</TableCell>
                    <TableCell className="text-sm font-mono">{a.currency}</TableCell>
                    <TableCell className="text-sm" dir="auto">
                      {ledger(a.glAccountId)}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{a.reconcileFrom ? formatCalendarDate(a.reconcileFrom, locale, "short") : ""}</TableCell>
                    <TableCell>
                      <StatusBadge tone={a.isActive ? "success" : "neutral"}>{a.isActive ? tr("active") : tr("inactive")}</StatusBadge>
                    </TableCell>
                    <TableCell className="text-end">
                      <Button variant="ghost" size="icon" aria-label={tr("edit")} onClick={() => onEdit(a)} data-testid={`button-edit-bank-${a.id}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
