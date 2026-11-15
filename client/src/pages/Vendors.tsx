import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { formatCurrency } from "@/lib/format";
import { Plus, Truck } from "lucide-react";

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
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader title={c.title} description={c.subtitle} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setOpen(true)}>
          <Plus className="w-4 h-4 me-2" />
          {c.newVendor}
        </Button>
        <Button variant="outline" onClick={() => backfill.mutate()} disabled={backfill.isPending}>
          {c.linkLegacy}
        </Button>
      </div>
      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">{c.list}</TabsTrigger>
          <TabsTrigger value="aging">{c.aging}</TabsTrigger>
        </TabsList>
        <TabsContent value="list">
          <Card>
            <CardContent className="pt-6 overflow-x-auto">
              {vendors.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                  <Truck className="w-8 h-8" />
                  {c.noVendors}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{c.name}</TableHead>
                      <TableHead>{c.trn}</TableHead>
                      <TableHead>{c.terms}</TableHead>
                      <TableHead>{c.currency}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vendors.map((v) => (
                      <TableRow key={v.id}>
                        <TableCell>{locale === "ar" && v.nameAr ? v.nameAr : v.name}</TableCell>
                        <TableCell className="font-mono">{v.trn ?? "-"}</TableCell>
                        <TableCell>{v.paymentTermsDays}</TableCell>
                        <TableCell>{v.currency}</TableCell>
                        <TableCell className="text-end">
                          <Button variant="ghost" size="sm" onClick={() => setStatementFor(v)}>
                            {c.statement}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="aging">
          <Card>
            <CardHeader>
              <CardTitle>{c.aging}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{c.name}</TableHead>
                    <TableHead className="text-end">{c.total}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(aging?.vendors ?? []).map((v) => (
                    <TableRow key={v.vendorId ?? v.name}>
                      <TableCell>{v.name}</TableCell>
                      <TableCell className="text-end">{formatCurrency(v.total, "AED")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {aging && (
                <div className="text-sm text-muted-foreground space-y-1">
                  <div>
                    {c.unappliedCredits}: {formatCurrency(aging.unappliedCredits, "AED")}
                  </div>
                  <div>
                    {aging.reconciliation.isReconciled
                      ? c.reconciled
                      : `${c.notReconciled}: ${formatCurrency(aging.reconciliation.difference, "AED")}`}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{c.newVendor}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {field("name", c.name)}
            {field("name_ar", c.nameAr, { dir: "rtl" })}
            {field("trn", c.trn, { inputMode: "numeric", maxLength: "15" })}
            {field("email", c.email, { type: "email" })}
            {field("phone", c.phone)}
            {field("payment_terms_days", c.terms, { inputMode: "numeric" })}
            {field("currency", c.currency, { maxLength: "3" })}
            {field("iban", c.iban)}
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
              {c.statement}: {statementFor?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{c.date}</TableHead>
                  <TableHead>{c.type}</TableHead>
                  <TableHead>{c.reference}</TableHead>
                  <TableHead className="text-end">{c.charge}</TableHead>
                  <TableHead className="text-end">{c.credit}</TableHead>
                  <TableHead className="text-end">{c.balance}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(statement?.lines ?? []).map((l) => (
                  <TableRow key={`${l.type}-${l.documentId}`}>
                    <TableCell>{l.date}</TableCell>
                    <TableCell>{l.type.replace(/_/g, " ")}</TableCell>
                    <TableCell>{l.reference ?? "-"}</TableCell>
                    <TableCell className="text-end">{formatCurrency(l.charge, "AED")}</TableCell>
                    <TableCell className="text-end">{formatCurrency(l.credit, "AED")}</TableCell>
                    <TableCell className="text-end">{formatCurrency(l.balance, "AED")}</TableCell>
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
