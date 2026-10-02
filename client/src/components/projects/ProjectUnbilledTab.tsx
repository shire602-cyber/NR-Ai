import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProjectInvoiceDialog } from "@/components/projects/ProjectInvoiceDialog";
import { useTranslation } from "@/lib/i18n";
import { CALENDAR_DATE_SHORT_FORMAT, formatCurrency, formatDate } from "@/lib/format";
import type { Project, UnbilledResponse } from "@/lib/purchasing-hr";
import { messages } from "@/pages/ProjectDetail.i18n";

const round2 = (n: number) => Math.round(n * 100) / 100;

export function ProjectUnbilledTab({ project }: { project: Project }) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const { data, isLoading } = useQuery<UnbilledResponse>({ queryKey: ["/api/projects", project.id, "unbilled"] });
  const [timeIds, setTimeIds] = useState<Set<string>>(new Set());
  const [expenseIds, setExpenseIds] = useState<Set<string>>(new Set());
  const [invoicing, setInvoicing] = useState(false);

  // Everything is selected when the list loads or changes, so "Create invoice" bills it all unless the user unticks.
  useEffect(() => {
    if (!data) return;
    setTimeIds(new Set(data.timeEntries.map((e) => e.id)));
    setExpenseIds(new Set(data.expenses.map((e) => e.id)));
  }, [data]);

  const selected = useMemo(() => {
    const time = (data?.timeEntries ?? []).filter((e) => timeIds.has(e.id));
    const costs = (data?.expenses ?? []).filter((e) => expenseIds.has(e.id));
    return {
      hours: round2(time.reduce((s, e) => s + e.hours, 0)),
      timeAmount: round2(time.reduce((s, e) => s + e.amount, 0)),
      expenseAmount: round2(costs.reduce((s, e) => s + e.amountAed, 0)),
    };
  }, [data, timeIds, expenseIds]);

  const toggle = (set: Set<string>, id: string, apply: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  };

  if (isLoading || !data) return <Skeleton className="h-40 w-full" aria-label={tr("loading")} />;
  const empty = data.timeEntries.length === 0 && data.expenses.length === 0;

  return (
    <div className="space-y-4" data-testid="tab-unbilled">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">{tr("unbilledHours")}</p>
          <p className="text-xl font-semibold tabular-nums" data-testid="text-unbilled-hours">{data.unbilledHours.toFixed(2)}</p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">{tr("unbilledAmount")}</p>
          <p className="text-xl font-semibold tabular-nums" data-testid="text-unbilled-amount">{formatCurrency(data.unbilledAmount, project.currency, locale)}</p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">{tr("unbilledCosts")}</p>
          <p className="text-xl font-semibold tabular-nums" data-testid="text-unbilled-costs">{formatCurrency(data.unbilledExpenses, "AED", locale)}</p>
        </div>
      </div>

      {empty ? (
        <EmptyState icon={FileText} title={tr("unbilledEmpty")} compact testId="empty-unbilled" />
      ) : (
        <>
          {data.timeEntries.length > 0 && (
            <section className="space-y-2">
              <h3 className="font-medium">{tr("unbilledTimeTitle")}</h3>
              <div className="overflow-x-auto rounded-md border stack-table">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          aria-label={tr("selectAll")}
                          checked={timeIds.size === data.timeEntries.length}
                          onCheckedChange={(c) => setTimeIds(c ? new Set(data.timeEntries.map((e) => e.id)) : new Set())}
                        />
                      </TableHead>
                      <TableHead>{tr("colDate")}</TableHead>
                      <TableHead>{tr("colTask")}</TableHead>
                      <TableHead>{tr("colNotes")}</TableHead>
                      <TableHead className="text-end">{tr("colHours")}</TableHead>
                      <TableHead className="text-end">{tr("colRate")}</TableHead>
                      <TableHead className="text-end">{tr("colAmount")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.timeEntries.map((e) => (
                      <TableRow key={e.id} data-testid={`row-unbilled-time-${e.id}`}>
                        <TableCell>
                          <Checkbox checked={timeIds.has(e.id)} onCheckedChange={() => toggle(timeIds, e.id, setTimeIds)} aria-label={e.entryDate} />
                        </TableCell>
                        <TableCell>{formatDate(e.entryDate, locale, CALENDAR_DATE_SHORT_FORMAT)}</TableCell>
                        <TableCell>{e.taskName}</TableCell>
                        <TableCell className="max-w-[220px] truncate">{e.notes}</TableCell>
                        <TableCell className="text-end tabular-nums">{e.hours.toFixed(2)}</TableCell>
                        <TableCell className="text-end tabular-nums">{formatCurrency(e.rate ?? 0, project.currency, locale)}</TableCell>
                        <TableCell className="text-end tabular-nums">{formatCurrency(e.amount, project.currency, locale)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          )}

          {data.expenses.length > 0 && (
            <section className="space-y-2">
              <h3 className="font-medium">{tr("unbilledCostsTitle")}</h3>
              <div className="overflow-x-auto rounded-md border stack-table">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          aria-label={tr("selectAll")}
                          checked={expenseIds.size === data.expenses.length}
                          onCheckedChange={(c) => setExpenseIds(c ? new Set(data.expenses.map((e) => e.id)) : new Set())}
                        />
                      </TableHead>
                      <TableHead>{tr("colDate")}</TableHead>
                      <TableHead>{tr("colDescription")}</TableHead>
                      <TableHead>{tr("colSource")}</TableHead>
                      <TableHead className="text-end">{tr("colAmount")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.expenses.map((e) => (
                      <TableRow key={e.id} data-testid={`row-unbilled-expense-${e.id}`}>
                        <TableCell>
                          <Checkbox checked={expenseIds.has(e.id)} onCheckedChange={() => toggle(expenseIds, e.id, setExpenseIds)} aria-label={e.description} />
                        </TableCell>
                        <TableCell>{formatDate(e.expenseDate, locale, CALENDAR_DATE_SHORT_FORMAT)}</TableCell>
                        <TableCell>{e.description}</TableCell>
                        <TableCell>{e.sourceType === "bill_line" ? tr("sourceBillLine") : tr("sourceClaim")}</TableCell>
                        <TableCell className="text-end tabular-nums">{formatCurrency(e.amountAed, "AED", locale)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 p-3">
            <div>
              <p className="text-sm font-medium" data-testid="text-selected-net">{tr("selectedNet", { amount: formatCurrency(selected.timeAmount + selected.expenseAmount, project.currency, locale) })}</p>
              {!project.contactId && <p className="text-xs text-destructive">{tr("needsCustomer")}</p>}
            </div>
            <Button onClick={() => setInvoicing(true)} disabled={!project.contactId || (timeIds.size === 0 && expenseIds.size === 0)} data-testid="button-create-invoice">
              <FileText className="h-4 w-4 me-2" />
              {tr("createInvoice")}
            </Button>
          </div>
        </>
      )}

      <ProjectInvoiceDialog
        open={invoicing}
        project={project}
        timeEntryIds={[...timeIds]}
        expenseIds={[...expenseIds]}
        hours={selected.hours}
        timeAmount={selected.timeAmount}
        expenseAmount={selected.expenseAmount}
        onClose={() => setInvoicing(false)}
      />
    </div>
  );
}
