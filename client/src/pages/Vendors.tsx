import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
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
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDate } from "@/lib/format";
import { DataTableCard } from "@/components/ui/data-table";
import { Money, MoneyCell } from "@/components/ui/money";
import { RowActions, RowActionButton } from "@/components/ui/row-actions";
import { FileText, Link2, Plus, Truck } from "lucide-react";

// Vendor master (W3-B, R04-16): TRN-validated, deduplicated suppliers with statements and aging.

const COPY = {
  en: {
    title: "Vendors",
    subtitle: "Supplier master: TRN, payment terms, bank details, statements and aging",
    newVendor: "New vendor",
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
    saved: "Vendor saved",
    list: "Vendors",
    aging: "Payables aging",
    statement: "Statement",
    noVendors: "No vendors yet",
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
    unappliedCredits: "Unapplied vendor credits",
    close: "Close",
    emptyBody: "Add your suppliers once; bills link to them by TRN or name.",
    trnShort: "TRN",
    termsShort: "Terms",
    daysValue: "{n} days",
    noPayables: "Nothing owed to vendors",
    noPayablesBody: "Approved, unpaid vendor bills appear here by supplier.",
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
  const { locale } = useTranslation();
  const c = COPY[locale === "ar" ? "ar" : "en"];
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ ...EMPTY });
  const [statementFor, setStatementFor] = useState<Vendor | null>(null);

  const { data: vendors = [] } = useQuery<Vendor[]>({
    queryKey: ["/api/companies", companyId, "vendors"],
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/vendors`),
    enabled: !!companyId,
  });
  const { data: aging } = useQuery<VendorAging>({
    queryKey: ["/api/companies", companyId, "vendors", "aging"],
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/vendors/aging`),
    enabled: !!companyId,
  });
  const { data: statement } = useQuery<{ lines: StatementLine[]; closingBalance: number }>({
    queryKey: ["/api/companies", companyId, "vendors", statementFor?.id, "statement"],
    queryFn: () =>
      apiRequest("GET", `/api/companies/${companyId}/vendors/${statementFor!.id}/statement`),
    enabled: !!companyId && !!statementFor,
  });

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

  const field = (key: keyof typeof EMPTY, label: string, props: Record<string, string> = {}) => (
    <div className="space-y-1">
      <Label htmlFor={`vendor-${key}`}>{label}</Label>
      <Input
        id={`vendor-${key}`}
        value={form[key] ?? ""}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        {...props}
      />
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Purchases"
        title={c.title}
        description={c.subtitle}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => backfill.mutate()}
              disabled={backfill.isPending}
            >
              <Link2 aria-hidden />
              {c.linkLegacy}
            </Button>
            <Button onClick={() => setOpen(true)}>
              <Plus aria-hidden />
              {c.newVendor}
            </Button>
          </>
        }
      />
      <Tabs defaultValue="list" className="space-y-4">
        <TabsList>
          <TabsTrigger value="list">{c.list}</TabsTrigger>
          <TabsTrigger value="aging">{c.aging}</TabsTrigger>
        </TabsList>
        <TabsContent value="list">
          <DataTableCard
            status={vendors.length === 0 ? "empty" : "ready"}
            empty={{
              icon: Truck,
              title: c.noVendors,
              description: c.emptyBody,
              action: { label: c.newVendor, onClick: () => setOpen(true) },
            }}
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
                {vendors.map((v) => (
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
          </DataTableCard>
        </TabsContent>
        <TabsContent value="aging" className="space-y-3">
          <DataTableCard
            status={(aging?.vendors ?? []).length === 0 ? "empty" : "ready"}
            empty={{ icon: Truck, title: c.noPayables, description: c.noPayablesBody }}
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
          </DataTableCard>
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{c.newVendor}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field("name", c.name)}
            {field("name_ar", c.nameAr, { dir: "rtl" })}
            {field("trn", c.trn, { inputMode: "numeric", maxLength: "15", dir: "ltr" })}
            {field("email", c.email, { type: "email", dir: "ltr" })}
            {field("phone", c.phone, { dir: "ltr" })}
            {field("payment_terms_days", c.terms, { inputMode: "numeric", dir: "ltr" })}
            {field("currency", c.currency, { maxLength: "3", dir: "ltr" })}
            {field("iban", c.iban, { dir: "ltr" })}
            {field("bank_name", c.bank)}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {c.cancel}
            </Button>
            <Button onClick={() => create.mutate()} disabled={!form.name || create.isPending}>
              {c.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!statementFor} onOpenChange={(o) => !o && setStatementFor(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {c.statement}: <span dir="auto">{statementFor?.name}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-hidden rounded-lg border border-border">
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
                      {l.type.replace(/_/g, " ")}
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
