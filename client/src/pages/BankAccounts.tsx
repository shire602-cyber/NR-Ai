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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { StatementDialog } from "./bank-accounts/StatementDialog";
import { sectionState } from "./bank-accounts/query-states";
import { RefreshFailed } from "./bank-accounts/RefreshFailed";
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
import { matchesSearchText } from "@shared/arabic-text";
import { useTranslation } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Building2, FileSpreadsheet, Link2, Plus, RotateCcw, Scale, Search } from "lucide-react";

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
  fileName: string | null;
  rowCount: number;
  importedCount: number;
  status: string;
  continuityWarning: string | null;
  createdAt: string;
  removedCount: number | null;
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
  // The search is scoped to the company it was typed under; an in-place company switch shows an
  // empty search (the scoped term may reappear if the user returns to that company).
  const [searchState, setSearchState] = useState({ companyId, value: "" });
  const search = searchState.companyId === companyId ? searchState.value : "";
  const setSearch = (value: string) => setSearchState({ companyId, value });

  const accountsQuery = useQuery<BankAccount[]>({
    queryKey: ["/api/companies", companyId, "bank-accounts"],
    enabled: !!companyId,
  });
  const { data: accounts, refetch: refetchAccounts } = accountsQuery;
  const accountsState = sectionState(accountsQuery);
  const { data: glAccounts } = useQuery<GlAccount[]>({
    queryKey: ["/api/companies", companyId, "accounts"],
    enabled: !!companyId,
  });
  const { data: suggestions } = useQuery<{ suggestions: string[] }>({
    queryKey: ["/api/companies", companyId, "bank-accounts", "bank-name-suggestions"],
    enabled: !!companyId,
  });
  const importsQuery = useQuery<ImportBatch[]>({
    queryKey: ["/api/companies", companyId, "bank-statements", "imports"],
    enabled: !!companyId,
  });
  const { data: imports, refetch: refetchImports } = importsQuery;
  const importsState = sectionState(importsQuery);

  const filteredAccounts = useMemo(() => {
    if (!search.trim()) return accounts ?? [];
    // Arabic-aware: Arabic-Indic digits, alef/yeh/teh-marbuta spellings and "ال" are folded.
    return (accounts ?? []).filter((a) =>
      matchesSearchText(search, a.nameEn, a.bankName, a.iban, a.accountNumber, a.currency)
    );
  }, [accounts, search]);
  const searching = search.trim() !== "";

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
        eyebrow={tr("shell.nav.banking")}
        title={tr("banking.accounts.title")}
        description={tr("banking.accounts.description")}
        actions={
          <Button onClick={() => setCreateOpen(true)} data-testid="button-add-bank-account">
            <Plus className="w-4 h-4" />
            {tr("banking.accounts.add")}
          </Button>
        }
      />

      {(accounts?.length ?? 0) > 0 && (
        // Icon and padding share the wrapper direction; dir="auto" follows the typed text.
        <div className="relative w-full sm:w-80 [&:dir(ltr)>input:dir(ltr)]:ps-9 [&:dir(ltr)>input:dir(rtl)]:pe-9 [&:dir(rtl)>input:dir(ltr)]:pe-9 [&:dir(rtl)>input:dir(rtl)]:ps-9">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            dir="auto"
            className="h-9 text-start"
            placeholder={tr("banking.accounts.searchPlaceholder")}
            aria-label={tr("banking.accounts.search")}
            data-testid="input-search-bank-accounts"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {accountsState.refreshFailed && (
        <RefreshFailed
          message={tr("banking.common.refreshFailed")}
          onRetry={() => void refetchAccounts()}
          testId="bank-accounts-refresh-error"
        />
      )}
      <DataTableCard
        status={
          accountsState.kind === "ready"
            ? filteredAccounts.length === 0
              ? "empty"
              : "ready"
            : accountsState.kind === "loading"
              ? "loading"
              : "error"
        }
        error={
          accountsState.kind === "offline"
            ? {
                title: tr("banking.common.offline"),
                description: tr("banking.common.offlineBody"),
                onRetry: () => void refetchAccounts(),
                testId: "bank-accounts-offline",
              }
            : {
                title: tr("banking.accounts.loadError"),
                description: tr("banking.accounts.loadErrorBody"),
                onRetry: () => void refetchAccounts(),
                testId: "bank-accounts-error",
              }
        }
        empty={
          searching && (accounts?.length ?? 0) > 0
            ? {
                icon: Search,
                title: tr("banking.accounts.noMatch"),
                description: tr("banking.accounts.noMatchBody"),
              }
            : {
                icon: Building2,
                title: tr("banking.accounts.none"),
                action: { label: tr("banking.accounts.add"), onClick: () => setCreateOpen(true) },
              }
        }
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
            {filteredAccounts.map((a) => {
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
                      maxInline={1}
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
        {importsState.refreshFailed && (
          <RefreshFailed
            message={tr("banking.common.refreshFailed")}
            onRetry={() => void refetchImports()}
            testId="bank-imports-refresh-error"
          />
        )}
        <DataTableCard
          status={
            importsState.kind === "ready"
              ? (imports ?? []).length === 0
                ? "empty"
                : "ready"
              : importsState.kind === "loading"
                ? "loading"
                : "error"
          }
          error={
            importsState.kind === "offline"
              ? {
                  title: tr("banking.common.offline"),
                  description: tr("banking.common.offlineBody"),
                  onRetry: () => void refetchImports(),
                  testId: "bank-imports-offline",
                }
              : {
                  title: tr("banking.imports.loadError"),
                  description: tr("banking.accounts.loadErrorBody"),
                  onRetry: () => void refetchImports(),
                  testId: "bank-imports-error",
                }
          }
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
                    {b.fileName ? <bdi>{b.fileName}</bdi> : tr("banking.imports.sourceImport")}
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
                      <RowActions maxInline={1} collapseOnMobile>
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
