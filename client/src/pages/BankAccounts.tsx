import { accountDisplayName } from "@/lib/account-name";
import { useMemo, useState } from "react";
import {
  ErrorSummary,
  Field,
  FormActions,
  FormGrid,
  FormSection,
  formSpanFull,
} from "@/components/ui/form-layout";
import { useFormGate } from "@/hooks/use-form-gate";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { DataTableCard } from "@/components/ui/data-table";
import { RowActions, RowActionButton } from "@/components/ui/row-actions";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useTranslation } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Building2, FileDown, FileSpreadsheet, Link2, Plus, RotateCcw, Scale } from "lucide-react";

interface BankAccount {
  id: string;
  nameEn: string;
  bankName: string;
  accountNumber: string | null;
  iban: string | null;
  currency: string;
  glAccountId: string | null;
  isActive: boolean;
  openingBalance: number;
  openingBalanceDate: string | null;
}

interface GlAccount {
  id: string;
  code: string;
  nameEn: string;
  type: string;
  subType: string | null;
  isActive: boolean;
}

interface ImportBatch {
  id: string;
  bankAccountId: string | null;
  source: string;
  fileName: string | null;
  rowCount: number;
  importedCount: number;
  status: string;
  continuityWarning: string | null;
  createdAt: string;
  removedCount: number | null;
}

interface StatementItem {
  id: string;
  date: string;
  description: string;
  amount: string;
}

interface Statement {
  totals: Record<string, string>;
  differenceFils: number;
  depositsInTransit: StatementItem[];
  outstandingPayments: StatementItem[];
  unrecordedReceipts: StatementItem[];
  unrecordedPayments: StatementItem[];
}

interface SavedReconciliation {
  id: string;
  periodEnd: string;
  statementClosingBalance: number;
  difference: number;
  status: string;
  signedOffAt: string | null;
}

const EMPTY_FORM = {
  nameEn: "",
  bankName: "",
  accountNumber: "",
  iban: "",
  currency: "AED",
  glAccountId: "auto",
  openingBalance: "",
  openingBalanceDate: "",
};

export default function BankAccounts() {
  const { t, locale } = useTranslation();
  const tr = (k: string) => t[k] ?? k;
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [relinkFor, setRelinkFor] = useState<BankAccount | null>(null);
  const gate = useFormGate([
    { id: "ba-name", label: tr("banking.accounts.name"), invalid: !form.nameEn },
    { id: "ba-bank", label: tr("banking.accounts.bankName"), invalid: !form.bankName },
  ]);
  const [relinkGl, setRelinkGl] = useState("");
  const [statementFor, setStatementFor] = useState<BankAccount | null>(null);

  const { data: accounts, isLoading } = useQuery<BankAccount[]>({
    queryKey: ["/api/companies", companyId, "bank-accounts"],
    enabled: !!companyId,
  });
  const { data: glAccounts } = useQuery<GlAccount[]>({
    queryKey: ["/api/companies", companyId, "accounts"],
    enabled: !!companyId,
  });
  const { data: suggestions } = useQuery<{ suggestions: string[] }>({
    queryKey: ["/api/companies", companyId, "bank-accounts", "bank-name-suggestions"],
    enabled: !!companyId,
  });
  const { data: imports } = useQuery<ImportBatch[]>({
    queryKey: ["/api/companies", companyId, "bank-statements", "imports"],
    enabled: !!companyId,
  });

  const bankGlAccounts = useMemo(
    () =>
      (glAccounts ?? []).filter(
        (a) => a.type === "asset" && (a.subType === "bank" || a.subType === "cash") && a.isActive
      ),
    [glAccounts]
  );
  const glById = useMemo(() => new Map((glAccounts ?? []).map((a) => [a.id, a])), [glAccounts]);
  const accountName = (id: string | null) => accounts?.find((a) => a.id === id)?.nameEn ?? "—";

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "bank-accounts"] });
    queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "accounts"] });
    queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "bank-statements"] });
  };
  const onError = (err: Error) =>
    toast({ variant: "destructive", title: tr("banking.common.error"), description: err?.message });

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/bank-accounts`, {
        nameEn: form.nameEn,
        bankName: form.bankName,
        accountNumber: form.accountNumber || null,
        iban: form.iban || null,
        currency: form.currency || "AED",
        ...(form.glAccountId !== "auto" ? { glAccountId: form.glAccountId } : {}),
        ...(form.openingBalance ? { openingBalance: form.openingBalance } : {}),
        ...(form.openingBalanceDate ? { openingBalanceDate: form.openingBalanceDate } : {}),
      }),
    onSuccess: () => {
      toast({ title: tr("banking.accounts.created") });
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      invalidate();
    },
    onError,
  });

  const relinkMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/bank-accounts/${relinkFor!.id}/relink`, {
        glAccountId: relinkGl,
      }),
    onSuccess: () => {
      toast({ title: tr("banking.accounts.relinked") });
      setRelinkFor(null);
      invalidate();
    },
    onError,
  });

  const undoMutation = useMutation({
    mutationFn: (batchId: string) =>
      apiRequest("POST", `/api/companies/${companyId}/bank-statements/imports/${batchId}/undo`, {}),
    onSuccess: () => {
      toast({ title: tr("banking.imports.undoDone") });
      invalidate();
    },
    onError,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={tr("banking.feeds.connections")}
        title={tr("banking.accounts.title")}
        description={tr("banking.accounts.description")}
        actions={
          <Button onClick={() => setCreateOpen(true)} data-testid="button-add-bank-account">
            <Plus className="w-4 h-4" />
            {tr("banking.accounts.add")}
          </Button>
        }
      />

      <DataTableCard
        status={isLoading ? "loading" : !accounts || accounts.length === 0 ? "empty" : "ready"}
        empty={{
          icon: Building2,
          title: tr("banking.accounts.none"),
          action: { label: tr("banking.accounts.add"), onClick: () => setCreateOpen(true) },
        }}
      >
        <Table className="row-cards">
          <TableHeader>
            <TableRow>
              <TableHead className="w-full">{tr("banking.accounts.name")}</TableHead>
              <TableHead>{tr("banking.accounts.bankName")}</TableHead>
              <TableHead>{tr("banking.accounts.iban")}</TableHead>
              <TableHead>{tr("banking.accounts.currency")}</TableHead>
              <TableHead>{tr("banking.accounts.glAccount")}</TableHead>
              <TableHead>
                <span className="sr-only">{tr("banking.common.actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(accounts ?? []).map((a) => {
              const gl = a.glAccountId ? glById.get(a.glAccountId) : undefined;
              return (
                <TableRow key={a.id}>
                  <TableCell data-truncate="" data-cell="title" className="font-medium">
                    <span dir="auto">{a.nameEn}</span>
                    {!a.isActive && (
                      <Badge variant="neutral" className="ms-2">
                        {tr("banking.accounts.inactive")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell data-nowrap="" data-cell="meta" className="text-muted-foreground">
                    {a.bankName}
                  </TableCell>
                  <TableCell data-nowrap="" data-cell="meta" className="text-muted-foreground">
                    <span dir="ltr" className="tabular-nums [unicode-bidi:isolate]">
                      {a.iban ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell data-nowrap="" data-cell="status" className="text-muted-foreground">
                    {a.currency}
                  </TableCell>
                  <TableCell data-nowrap="" className="text-muted-foreground">
                    {gl ? (
                      <>
                        <span className="tabular-nums">{gl.code}</span>{" "}
                        {accountDisplayName(gl, locale)}
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell data-cell="actions">
                    <RowActions
                      collapseOnMobile
                      menu={
                        <DropdownMenuItem
                          onSelect={() => {
                            setRelinkFor(a);
                            setRelinkGl(a.glAccountId ?? "");
                          }}
                        >
                          <Link2 aria-hidden />
                          {tr("banking.accounts.relink")}
                        </DropdownMenuItem>
                      }
                    >
                      <RowActionButton
                        label={tr("banking.statement.title")}
                        icon={Scale}
                        onClick={() => setStatementFor(a)}
                      />
                    </RowActions>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </DataTableCard>

      <section className="space-y-3">
        <h2 className="text-h2 text-foreground">{tr("banking.imports.title")}</h2>
        <DataTableCard
          status={!imports || imports.length === 0 ? "empty" : "ready"}
          empty={{ icon: FileSpreadsheet, title: tr("banking.imports.none") }}
        >
          <Table className="row-cards">
            <TableHeader>
              <TableRow>
                <TableHead>{tr("banking.common.date")}</TableHead>
                <TableHead>{tr("banking.accounts.name")}</TableHead>
                <TableHead className="w-full">{tr("banking.imports.file")}</TableHead>
                <TableHead data-numeric="">{tr("banking.imports.rows")}</TableHead>
                <TableHead data-numeric="">{tr("banking.imports.imported")}</TableHead>
                <TableHead>{tr("banking.common.status")}</TableHead>
                <TableHead>
                  <span className="sr-only">{tr("banking.common.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(imports ?? []).map((b) => (
                <TableRow key={b.id}>
                  <TableCell data-nowrap="" data-cell="meta" className="text-muted-foreground">
                    {formatDate(b.createdAt, locale)}
                  </TableCell>
                  <TableCell data-nowrap="" data-cell="meta" className="text-muted-foreground">
                    {accountName(b.bankAccountId)}
                  </TableCell>
                  <TableCell data-truncate="" data-cell="title">
                    <span dir="ltr" className="[unicode-bidi:isolate]">
                      {b.fileName ?? b.source}
                    </span>
                    {b.continuityWarning && (
                      <p className="truncate text-caption text-warning" title={b.continuityWarning}>
                        {tr("banking.imports.continuity")}: {b.continuityWarning}
                      </p>
                    )}
                  </TableCell>
                  <TableCell data-numeric="" className="text-muted-foreground">
                    {b.rowCount}
                  </TableCell>
                  <TableCell data-numeric="" data-cell="amount">
                    {b.importedCount}
                  </TableCell>
                  <TableCell data-nowrap="" data-cell="status">
                    {b.status === "undone" ? (
                      <Badge variant="neutral" dot>
                        {tr("banking.imports.undone")}
                      </Badge>
                    ) : (
                      <StatusBadge status={b.status} />
                    )}
                  </TableCell>
                  <TableCell data-cell="actions">
                    {b.status !== "undone" && (
                      <RowActions collapseOnMobile>
                        <RowActionButton
                          label={tr("banking.imports.undo")}
                          icon={RotateCcw}
                          onClick={() => undoMutation.mutate(b.id)}
                          disabled={undoMutation.isPending}
                        />
                      </RowActions>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataTableCard>
      </section>

      {/* Create */}
      <Dialog
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) gate.reset();
        }}
      >
        <DialogContent size="md" data-testid="dialog-bank-account-form">
          <DialogHeader>
            <DialogTitle>{tr("banking.accounts.add")}</DialogTitle>
            <DialogDescription>{tr("banking.accounts.description")}</DialogDescription>
          </DialogHeader>
          <form
            noValidate
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (createMutation.isPending || !gate.attempt()) return;
              createMutation.mutate();
            }}
          >
            <ErrorSummary items={gate.summary} />
            <FormSection title={t["forms.section.account"]}>
              <FormGrid>
                <Field
                  id="ba-name"
                  label={tr("banking.accounts.name")}
                  required
                  error={gate.errorFor("ba-name")}
                  className={formSpanFull}
                >
                  <Input
                    dir="auto"
                    value={form.nameEn}
                    onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
                  />
                </Field>
                <Field
                  id="ba-bank"
                  label={tr("banking.accounts.bankName")}
                  required
                  help={tr("banking.accounts.bankNameHint")}
                  error={gate.errorFor("ba-bank")}
                >
                  <Input
                    dir="auto"
                    list="bank-name-suggestions"
                    value={form.bankName}
                    onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                  />
                </Field>
                <datalist id="bank-name-suggestions">
                  {(suggestions?.suggestions ?? []).map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
                <Field id="ba-currency" label={tr("banking.accounts.currency")}>
                  <Input
                    ltr
                    maxLength={3}
                    value={form.currency}
                    onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                  />
                </Field>
                <Field id="ba-number" label={tr("banking.accounts.accountNumber")}>
                  <Input
                    ltr
                    autoComplete="off"
                    value={form.accountNumber}
                    onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
                  />
                </Field>
                <Field
                  id="ba-iban"
                  label={tr("banking.accounts.iban")}
                  help={t["forms.bank.ibanHelp"]}
                >
                  <Input
                    ltr
                    autoComplete="off"
                    value={form.iban}
                    onChange={(e) => setForm({ ...form, iban: e.target.value })}
                  />
                </Field>
              </FormGrid>
            </FormSection>

            <FormSection
              title={t["forms.section.accounting"]}
              description={t["forms.section.accountingDesc"]}
            >
              <FormGrid>
                <Field id="ba-gl" label={tr("banking.accounts.glAccount")} className={formSpanFull}>
                  <Select
                    value={form.glAccountId}
                    onValueChange={(v) => setForm({ ...form, glAccountId: v })}
                  >
                    <SelectTrigger id="ba-gl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">{tr("banking.accounts.glAuto")}</SelectItem>
                      {bankGlAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.code} {accountDisplayName(a, locale)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field id="ba-ob" label={tr("banking.accounts.openingBalance")}>
                  <Input
                    inputMode="decimal"
                    value={form.openingBalance}
                    onChange={(e) => setForm({ ...form, openingBalance: e.target.value })}
                  />
                </Field>
                <Field id="ba-obd" label={tr("banking.accounts.openingBalanceDate")}>
                  <DatePicker
                    value={form.openingBalanceDate}
                    onChange={(value) => setForm({ ...form, openingBalanceDate: value })}
                  />
                </Field>
              </FormGrid>
            </FormSection>

            <FormActions sticky>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                {tr("banking.common.cancel")}
              </Button>
              <Button type="submit" className="sm:min-w-32" disabled={createMutation.isPending}>
                {createMutation.isPending ? t["forms.saving"] : tr("banking.common.save")}
              </Button>
            </FormActions>
          </form>
        </DialogContent>
      </Dialog>

      {/* Relink */}
      <Dialog open={!!relinkFor} onOpenChange={(o) => !o && setRelinkFor(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{tr("banking.accounts.relink")}</DialogTitle>
            <DialogDescription>{tr("banking.accounts.relinkHint")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (relinkGl && !relinkMutation.isPending) relinkMutation.mutate();
            }}
          >
            <Select value={relinkGl} onValueChange={setRelinkGl}>
              <SelectTrigger aria-label={tr("banking.accounts.glAccount")}>
                <SelectValue placeholder={tr("banking.accounts.glAccount")} />
              </SelectTrigger>
              <SelectContent>
                {bankGlAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.code} {accountDisplayName(a, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormActions>
              <Button type="button" variant="outline" onClick={() => setRelinkFor(null)}>
                {tr("banking.common.cancel")}
              </Button>
              <Button type="submit" disabled={!relinkGl || relinkMutation.isPending}>
                {tr("banking.common.save")}
              </Button>
            </FormActions>
          </form>
        </DialogContent>
      </Dialog>

      {statementFor && companyId && (
        <StatementDialog
          companyId={companyId}
          account={statementFor}
          onClose={() => setStatementFor(null)}
        />
      )}
    </div>
  );
}

function StatementDialog({
  companyId,
  account,
  onClose,
}: {
  companyId: string;
  account: BankAccount;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const tr = (k: string) => t[k] ?? k;
  const { toast } = useToast();
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState(new Date().toISOString().slice(0, 10));
  const [closing, setClosing] = useState("");
  const [statement, setStatement] = useState<Statement | null>(null);
  const historyKey = ["/api/companies", companyId, "bank-accounts", account.id, "reconciliations"];
  const { data: history } = useQuery<SavedReconciliation[]>({ queryKey: historyKey });
  const onError = (err: Error) =>
    toast({ variant: "destructive", title: tr("banking.common.error"), description: err?.message });

  const previewMutation = useMutation({
    mutationFn: async () => {
      const q = new URLSearchParams({ periodEnd, statementClosingBalance: closing });
      if (periodStart) q.set("periodStart", periodStart);
      return (await apiRequest(
        "GET",
        `/api/companies/${companyId}/bank-accounts/${account.id}/reconciliation-statement?${q}`
      )) as Statement;
    },
    onSuccess: setStatement,
    onError,
  });
  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest(
        "POST",
        `/api/companies/${companyId}/bank-accounts/${account.id}/reconciliations`,
        {
          periodEnd,
          statementClosingBalance: closing,
          ...(periodStart ? { periodStart } : {}),
        }
      ),
    onSuccess: (row: { statement: Statement }) => {
      setStatement(row.statement);
      queryClient.invalidateQueries({ queryKey: historyKey });
    },
    onError,
  });
  const signMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/companies/${companyId}/bank-reconciliations/${id}/sign-off`, {}),
    onSuccess: () => {
      toast({ title: tr("banking.statement.signedOff") });
      queryClient.invalidateQueries({ queryKey: historyKey });
    },
    onError,
  });

  const rows: Array<[string, string, StatementItem[] | null]> = statement
    ? [
        ["banking.statement.bankBalance", statement.totals.statementClosingBalance, null],
        [
          "banking.statement.depositsInTransit",
          statement.totals.depositsInTransit,
          statement.depositsInTransit,
        ],
        [
          "banking.statement.outstandingPayments",
          statement.totals.outstandingPayments,
          statement.outstandingPayments,
        ],
        ["banking.statement.adjustedBank", statement.totals.adjustedBankBalance, null],
        ["banking.statement.glBalance", statement.totals.glBalance, null],
        [
          "banking.statement.unrecordedReceipts",
          statement.totals.unrecordedReceipts,
          statement.unrecordedReceipts,
        ],
        [
          "banking.statement.unrecordedPayments",
          statement.totals.unrecordedPayments,
          statement.unrecordedPayments,
        ],
        ["banking.statement.adjustedBook", statement.totals.adjustedBookBalance, null],
        ["banking.statement.difference", statement.totals.difference, null],
      ]
    : [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            {tr("banking.statement.title")} — {account.nameEn}
          </DialogTitle>
          <DialogDescription>{tr("banking.statement.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label htmlFor="st-start">{tr("banking.statement.periodStart")}</Label>
            <DatePicker id="st-start" value={periodStart} onChange={setPeriodStart} />
          </div>
          <div>
            <Label htmlFor="st-end">{tr("banking.statement.periodEnd")}</Label>
            <DatePicker id="st-end" value={periodEnd} onChange={setPeriodEnd} />
          </div>
          <div>
            <Label htmlFor="st-close">{tr("banking.statement.closingBalance")}</Label>
            <Input
              id="st-close"
              inputMode="decimal"
              value={closing}
              onChange={(e) => setClosing(e.target.value)}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => previewMutation.mutate()}
            disabled={!closing || !periodEnd || previewMutation.isPending}
          >
            {tr("banking.statement.preview")}
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!closing || !periodEnd || saveMutation.isPending}
          >
            {tr("banking.statement.saveDraft")}
          </Button>
        </div>
        {statement && (
          <Card>
            <CardHeader>
              <CardDescription>
                {statement.differenceFils === 0
                  ? tr("banking.statement.reconciled")
                  : tr("banking.statement.notReconciled")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {rows.map(([key, value, items]) => (
                <div key={key}>
                  <div className="flex justify-between font-medium">
                    <span>{tr(key)}</span>
                    <span>{value}</span>
                  </div>
                  {items?.map((it) => (
                    <div
                      key={it.id}
                      className="flex justify-between text-xs text-muted-foreground ps-4"
                    >
                      <span className="truncate">
                        {it.date} {it.description}
                      </span>
                      <span>{it.amount}</span>
                    </div>
                  ))}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
        <div>
          <p className="text-sm font-semibold mb-2">{tr("banking.statement.history")}</p>
          <Table>
            <TableBody>
              {(history ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.periodEnd}</TableCell>
                  <TableCell>{r.statementClosingBalance}</TableCell>
                  <TableCell>{r.difference}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === "signed_off" ? "default" : "outline"}>
                      {r.status === "signed_off"
                        ? tr("banking.statement.signedOff")
                        : tr("banking.statement.draft")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-end space-x-1 rtl:space-x-reverse">
                    {r.status !== "signed_off" && (
                      <Button
                        size="sm"
                        onClick={() => signMutation.mutate(r.id)}
                        disabled={signMutation.isPending}
                      >
                        {tr("banking.statement.signOff")}
                      </Button>
                    )}
                    {(["pdf", "xlsx"] as const).map((f) => (
                      <Button key={f} size="sm" variant="outline" asChild>
                        <a
                          href={`/api/companies/${companyId}/bank-reconciliations/${r.id}/export?format=${f}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <FileDown className="w-3 h-3" />
                          {f === "pdf"
                            ? tr("banking.statement.exportPdf")
                            : tr("banking.statement.exportXlsx")}
                        </a>
                      </Button>
                    ))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tr("banking.common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
