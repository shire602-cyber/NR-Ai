import { useMemo, useState } from "react";
import {
  ErrorSummary,
  Field,
  FormActions,
  FormGrid,
  FormSection,
} from "@/components/ui/form-layout";
import { useFormGate } from "@/hooks/use-form-gate";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui/page-header";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDate } from "@/lib/format";
import { filterVendors } from "@/lib/vendor-filter";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { TableSkeleton } from "@/components/ui/loading-skeletons";
import {
  QueryNoCompany,
  QueryStaleNotice,
  QueryTableCard,
  QueryWaiting,
} from "@/components/contacts/query-state";
import { queryView } from "@/lib/query-view";
import { Money, MoneyCell } from "@/components/ui/money";
import { RowActions, RowActionButton } from "@/components/ui/row-actions";
import { FileText, Link2, Plus, Search, Truck } from "lucide-react";

// Vendor master (W3-B, R04-16): TRN-validated, deduplicated suppliers with statements and aging.

const COPY = {
  en: {
    title: "Suppliers",
    subtitle: "Supplier master: TRN, payment terms, bank details, statements and aging",
    newVendor: "New supplier",
    name: "Name",
    nameAr: "Arabic name",
    trn: "TRN (15 digits)",
    email: "Email",
    phone: "Phone",
    terms: "Payment terms (days)",
    currency: "Currency",
    iban: "IBAN",
    bank: "Bank",
    save: "Save",
    cancel: "Cancel",
    saved: "Supplier saved",
    list: "Suppliers",
    aging: "Payables aging",
    statement: "Statement",
    noVendors: "No suppliers yet",
    linkLegacy: "Link existing bills by name",
    linked: "Bills linked",
    balance: "Balance",
    date: "Date",
    type: "Type",
    reference: "Reference",
    charge: "Charge",
    credit: "Credit",
    total: "Total",
    reconciled: "Reconciled to GL 2010",
    notReconciled: "Difference to GL 2010",
    unappliedCredits: "Unapplied supplier credits",
    close: "Close",
    emptyBody: "Add your suppliers once; bills link to them by TRN or name.",
    trnShort: "TRN",
    termsShort: "Terms",
    daysValue: "{n} days",
    noPayables: "Nothing owed to suppliers",
    noPayablesBody: "Approved, unpaid bills appear here by supplier.",
  },
  ar: {
    title: "الموردون",
    subtitle: "سجل الموردين: الرقم الضريبي وشروط الدفع والبيانات البنكية والكشوف والأعمار",
    newVendor: "مورد جديد",
    name: "الاسم",
    nameAr: "الاسم بالعربية",
    trn: "الرقم الضريبي (15 رقمًا)",
    email: "البريد الإلكتروني",
    phone: "الهاتف",
    terms: "شروط الدفع (أيام)",
    currency: "العملة",
    iban: "رقم الآيبان",
    bank: "البنك",
    save: "حفظ",
    cancel: "إلغاء",
    saved: "تم حفظ المورد",
    list: "الموردون",
    aging: "أعمار الذمم الدائنة",
    statement: "كشف حساب",
    noVendors: "لا يوجد موردون بعد",
    linkLegacy: "ربط الفواتير الحالية بالاسم",
    linked: "الفواتير المرتبطة",
    balance: "الرصيد",
    date: "التاريخ",
    type: "النوع",
    reference: "المرجع",
    charge: "مدين",
    credit: "دائن",
    total: "الإجمالي",
    reconciled: "مطابق لحساب 2010",
    notReconciled: "الفرق مع حساب 2010",
    unappliedCredits: "أرصدة دائنة غير مطبقة",
    close: "إغلاق",
    emptyBody: "أضف مورديك مرة واحدة، وتُربط الفواتير بهم بالرقم الضريبي أو الاسم.",
    trnShort: "الرقم الضريبي",
    termsShort: "شروط الدفع",
    daysValue: "{n} يومًا",
    noPayables: "لا توجد مبالغ مستحقة للموردين",
    noPayablesBody: "تظهر هنا فواتير الموردين المعتمدة وغير المدفوعة حسب المورد.",
  },
} as const;

interface Vendor {
  id: string;
  name: string;
  nameAr: string | null;
  trn: string | null;
  email: string | null;
  phone: string | null;
  paymentTermsDays: number;
  currency: string;
  iban: string | null;
}

interface StatementLine {
  date: string;
  type: string;
  reference: string | null;
  documentId: string;
  charge: number;
  credit: number;
  balance: number;
}

interface VendorAging {
  vendors: Array<{ vendorId: string | null; name: string; total: number }>;
  unappliedCredits: number;
  reconciliation: {
    glBalance: number;
    agingTotal: number;
    difference: number;
    isReconciled: boolean;
  };
}

const EMPTY = {
  name: "",
  name_ar: "",
  trn: "",
  email: "",
  phone: "",
  payment_terms_days: "30",
  currency: "AED",
  iban: "",
  bank_name: "",
};

export default function Vendors() {
  const { t, locale } = useTranslation();
  const c = COPY[locale === "ar" ? "ar" : "en"];
  const { toast } = useToast();
  const { companyId, isLoading: companyLoading, error: companyError } = useDefaultCompany();
  const { gate: permissionGate } = useCompanyPermission();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ ...EMPTY });
  const [searchTerm, setSearchTerm] = useState("");
  const [statementFor, setStatementFor] = useState<Vendor | null>(null);

  const vendorsQuery = useQuery<Vendor[]>({
    queryKey: ["/api/companies", companyId, "vendors"],
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/vendors`),
    enabled: !!companyId,
  });
  const agingQuery = useQuery<VendorAging>({
    queryKey: ["/api/companies", companyId, "vendors", "aging"],
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/vendors/aging`),
    enabled: !!companyId,
  });
  const statementQuery = useQuery<{ lines: StatementLine[]; closingBalance: number }>({
    queryKey: ["/api/companies", companyId, "vendors", statementFor?.id, "statement"],
    queryFn: () =>
      apiRequest("GET", `/api/companies/${companyId}/vendors/${statementFor!.id}/statement`),
    enabled: !!companyId && !!statementFor,
  });

  const vendors = vendorsQuery.data ?? [];
  const aging = agingQuery.data;
  const statement = statementQuery.data;
  const filteredVendors = useMemo(
    () => filterVendors(vendorsQuery.data ?? [], searchTerm),
    [vendorsQuery.data, searchTerm]
  );
  const company = { companyId, isLoading: companyLoading, error: companyError };
  const listView = queryView(vendorsQuery, company);
  const agingView = queryView(agingQuery, company);
  const statementView = queryView(statementQuery, company);
  const noMatch = !!searchTerm.trim() && vendors.length > 0;
  const statementTypeLabel = (type: string) => {
    const key = `pages.vendorsStatementType.${type}`;
    const label = t[key];
    // While catalogs preload, a missing key reads as the key itself: never show that.
    return label && label !== key ? label : type.replace(/_/g, " ");
  };

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "vendors"] });

  const create = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/vendors`, {
        name: form.name,
        name_ar: form.name_ar || null,
        trn: form.trn || null,
        email: form.email || null,
        phone: form.phone || null,
        payment_terms_days: Number(form.payment_terms_days) || 0,
        currency: form.currency || "AED",
        iban: form.iban || null,
        bank_name: form.bank_name || null,
      }),
    onSuccess: () => {
      invalidate();
      toast({ title: c.saved });
      setOpen(false);
      setForm({ ...EMPTY });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: e.message }),
  });

  const backfill = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/vendors/backfill`, {}),
    onSuccess: (r: { billsLinked: number }) => {
      invalidate();
      toast({ title: `${c.linked}: ${r.billsLinked}` });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: e.message }),
  });

  const gate = useFormGate([{ id: "vendor-name", label: c.name, invalid: !form.name }]);
  const field = (
    key: keyof typeof EMPTY,
    label: string,
    props: Record<string, string> = {},
    opts: { required?: boolean; help?: string; ltr?: boolean } = {}
  ) => (
    <Field
      id={`vendor-${key}`}
      label={label}
      required={opts.required}
      help={opts.help}
      error={gate.errorFor(`vendor-${key}`)}
    >
      <Input
        ltr={opts.ltr}
        value={form[key] ?? ""}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        {...props}
      />
    </Field>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t["pages.vendorsEyebrow"]}
        title={c.title}
        description={c.subtitle}
        primaryAction={
          <Button onClick={() => setOpen(true)} {...permissionGate("documents.write")}>
            <Plus aria-hidden />
            {c.newVendor}
          </Button>
        }
        overflow={
          <DropdownMenuItem onSelect={() => backfill.mutate()} disabled={backfill.isPending}>
            <Link2 aria-hidden />
            {c.linkLegacy}
          </DropdownMenuItem>
        }
      />
      <Tabs defaultValue="list" className="space-y-4">
        <TabsList>
          <TabsTrigger value="list">{c.list}</TabsTrigger>
          <TabsTrigger value="aging">{c.aging}</TabsTrigger>
        </TabsList>
        <TabsContent value="list">
          {vendors.length > 0 && (
            <div className="relative max-w-sm">
              <Search
                aria-hidden
                className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                className="ps-9"
                placeholder={t["pages.vendorsSearchPlaceholder"]}
                aria-label={t["pages.vendorsSearchPlaceholder"]}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                data-testid="input-search-vendors"
              />
            </div>
          )}
          <QueryStaleNotice view={listView} onRetry={() => void vendorsQuery.refetch()} />
          <QueryTableCard
            view={listView}
            rowCount={filteredVendors.length}
            onRetry={() => void vendorsQuery.refetch()}
            columnLabels={[c.name, c.trnShort, c.email, c.termsShort, c.currency]}
            empty={
              listView.kind === "data" && listView.stale
                ? {
                    icon: noMatch ? Search : Truck,
                    title: noMatch
                      ? t["pages.listStaleNoMatchTitle"]
                      : t["pages.listStaleEmptyTitle"],
                    description: t["pages.listStaleEmptyBody"],
                    secondaryAction: noMatch
                      ? { label: t["pages.vendorsClearSearch"], onClick: () => setSearchTerm("") }
                      : undefined,
                  }
                : noMatch
                  ? {
                      icon: Search,
                      title: t["pages.vendorsNoMatchTitle"],
                      description: t["pages.vendorsNoMatchBody"],
                      secondaryAction: {
                        label: t["pages.vendorsClearSearch"],
                        onClick: () => setSearchTerm(""),
                      },
                    }
                  : {
                      icon: Truck,
                      title: c.noVendors,
                      description: c.emptyBody,
                      action: {
                        label: c.newVendor,
                        onClick: () => setOpen(true),
                        permission: "documents.write",
                      },
                    }
            }
          >
            <Table className="row-cards">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-full">{c.name}</TableHead>
                  <TableHead>{c.trnShort}</TableHead>
                  <TableHead>{c.email}</TableHead>
                  <TableHead data-numeric="">{c.termsShort}</TableHead>
                  <TableHead>{c.currency}</TableHead>
                  <TableHead>
                    <span className="sr-only">{c.statement}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredVendors.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell
                      data-truncate=""
                      data-cell="title"
                      dir="auto"
                      className="font-medium"
                    >
                      {locale === "ar" && v.nameAr ? v.nameAr : v.name}
                    </TableCell>
                    <TableCell data-nowrap="" data-cell="meta">
                      {v.trn ? (
                        <span dir="ltr" className="[unicode-bidi:isolate]">
                          {v.trn}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell data-truncate="" className="text-muted-foreground">
                      {v.email ? (
                        <span dir="ltr" className="[unicode-bidi:isolate]">
                          {v.email}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell data-numeric="" data-cell="meta" className="text-muted-foreground">
                      {c.daysValue.replace("{n}", String(v.paymentTermsDays))}
                    </TableCell>
                    <TableCell data-nowrap="" className="text-muted-foreground">
                      {v.currency}
                    </TableCell>
                    <TableCell data-cell="actions" className="text-end">
                      <RowActions collapseOnMobile>
                        <RowActionButton
                          label={c.statement}
                          icon={FileText}
                          onClick={() => setStatementFor(v)}
                        />
                      </RowActions>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </QueryTableCard>
        </TabsContent>
        <TabsContent value="aging" className="space-y-3">
          <QueryStaleNotice view={agingView} onRetry={() => void agingQuery.refetch()} />
          <QueryTableCard
            view={agingView}
            rowCount={aging?.vendors.length ?? 0}
            onRetry={() => void agingQuery.refetch()}
            columnLabels={[c.name, c.total]}
            empty={
              agingView.kind === "data" && agingView.stale
                ? {
                    icon: Truck,
                    title: t["pages.listStaleEmptyTitle"],
                    description: t["pages.listStaleEmptyBody"],
                  }
                : { icon: Truck, title: c.noPayables, description: c.noPayablesBody }
            }
            footer={
              aging ? (
                <>
                  <span>
                    {c.unappliedCredits}: <Money amount={aging.unappliedCredits} />
                  </span>
                  <span
                    className={aging.reconciliation.isReconciled ? "text-success" : "text-warning"}
                  >
                    {aging.reconciliation.isReconciled ? (
                      c.reconciled
                    ) : (
                      <>
                        {c.notReconciled}: <Money amount={aging.reconciliation.difference} />
                      </>
                    )}
                  </span>
                </>
              ) : undefined
            }
          >
            <Table className="mobile-fit">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-full">{c.name}</TableHead>
                  <TableHead data-numeric="">{c.total}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(aging?.vendors ?? []).map((v) => (
                  <TableRow key={v.vendorId ?? v.name}>
                    <TableCell data-truncate="" dir="auto">
                      {v.name}
                    </TableCell>
                    <MoneyCell amount={v.total} />
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </QueryTableCard>
        </TabsContent>
      </Tabs>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) gate.reset();
        }}
      >
        <DialogContent size="md" data-testid="dialog-vendor-form">
          <DialogHeader>
            <DialogTitle>{c.newVendor}</DialogTitle>
            <DialogDescription>{t["forms.vendor.desc"]}</DialogDescription>
          </DialogHeader>
          <form
            noValidate
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (create.isPending || !gate.attempt()) return;
              create.mutate();
            }}
          >
            <ErrorSummary items={gate.summary} />
            <FormSection title={t["forms.section.vendor"]}>
              <FormGrid>
                {field("name", c.name, { dir: "auto" }, { required: true })}
                {field("name_ar", c.nameAr, { dir: "rtl", lang: "ar" })}
              </FormGrid>
            </FormSection>
            <FormSection title={t["forms.section.tax"]} description={t["forms.section.taxDesc"]}>
              <FormGrid>
                {field(
                  "trn",
                  c.trn,
                  { inputMode: "numeric", maxLength: "15" },
                  { ltr: true, help: t["forms.contact.trnHelp"] }
                )}
                {field(
                  "payment_terms_days",
                  c.terms,
                  { inputMode: "numeric" },
                  { ltr: true, help: t["forms.vendor.termsHelp"] }
                )}
                {field("currency", c.currency, { maxLength: "3" }, { ltr: true })}
              </FormGrid>
            </FormSection>
            <FormSection title={t["forms.section.contact"]}>
              <FormGrid>
                {field("email", c.email, { type: "email", dir: "ltr", autoComplete: "email" })}
                {field("phone", c.phone, { type: "tel", dir: "ltr", autoComplete: "tel" })}
              </FormGrid>
            </FormSection>
            <FormSection title={t["forms.section.bank"]}>
              <FormGrid>
                {field("iban", c.iban, { autoComplete: "off" }, { ltr: true })}
                {field("bank_name", c.bank, { dir: "auto" })}
              </FormGrid>
            </FormSection>
            <FormActions sticky>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {c.cancel}
              </Button>
              <Button type="submit" className="sm:min-w-32" disabled={create.isPending}>
                {create.isPending ? t["forms.saving"] : c.save}
              </Button>
            </FormActions>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!statementFor} onOpenChange={(o) => !o && setStatementFor(null)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>
              {c.statement}: <span dir="auto">{statementFor?.name}</span>
            </DialogTitle>
          </DialogHeader>
          {statementFor && (
            <QueryStaleNotice view={statementView} onRetry={() => void statementQuery.refetch()} />
          )}
          <div className="overflow-hidden rounded-lg border border-border">
            {!statementFor ? null : statementView.kind === "loading" ? (
              <TableSkeleton
                rows={3}
                columnLabels={[c.date, c.type, c.reference, c.charge, c.credit, c.balance]}
              />
            ) : statementView.kind === "noCompany" ? (
              <QueryNoCompany />
            ) : statementView.kind === "waiting" ? (
              <QueryWaiting />
            ) : statementView.kind === "error" ? (
              <LoadErrorState
                compact
                error={statementView.error}
                onRetry={statementView.canRetry ? () => void statementQuery.refetch() : undefined}
              />
            ) : (statement?.lines ?? []).length === 0 ? (
              <p
                className="p-4 text-center text-sm text-muted-foreground"
                data-testid="statement-empty"
              >
                {statementView.stale
                  ? t["pages.vendorsStatementStaleEmpty"]
                  : t["pages.vendorsStatementEmpty"]}
              </p>
            ) : (
              <Table density="compact" className="mobile-fit">
                <TableHeader>
                  <TableRow>
                    <TableHead>{c.date}</TableHead>
                    <TableHead>{c.type}</TableHead>
                    <TableHead>{c.reference}</TableHead>
                    <TableHead data-numeric="">{c.charge}</TableHead>
                    <TableHead data-numeric="">{c.credit}</TableHead>
                    <TableHead data-numeric="">{c.balance}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(statement?.lines ?? []).map((l) => (
                    <TableRow key={`${l.type}-${l.documentId}`}>
                      <TableCell data-nowrap="">{formatDate(l.date, locale)}</TableCell>
                      <TableCell data-nowrap="" className="text-muted-foreground">
                        {statementTypeLabel(l.type)}
                      </TableCell>
                      <TableCell data-nowrap="">
                        <span dir="ltr" className="[unicode-bidi:isolate]">
                          {l.reference ?? "—"}
                        </span>
                      </TableCell>
                      <MoneyCell amount={l.charge} showCurrency={false} />
                      <MoneyCell amount={l.credit} showCurrency={false} />
                      <MoneyCell amount={l.balance} showCurrency={false} className="font-medium" />
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatementFor(null)}>
              {c.close}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
