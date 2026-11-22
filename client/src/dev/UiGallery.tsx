/**
 * WP-A design-system gallery (`/__ui`). Used only to screenshot every primitive in en/ar ×
 * light/dark × desktop/mobile for the design review. It is routed only when the build sets
 * `VITE_UI_GALLERY=1` (see App.tsx), so production bundles never contain it. Sample copy is
 * inline and bilingual because this page is a specimen sheet, not product UI.
 */
import * as React from "react";
import { useSearch } from "wouter";
import {
  Area,
  ComposedChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download, FileText, Landmark, Pencil, Send, Trash2 } from "lucide-react";
import { BANK_RECONCILIATION_COPY } from "@shared/bank-reconciliation-copy";

import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
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
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { SetupNotice } from "@/components/ui/setup-notice";
import { Alert } from "@/components/ui/alert";
import { ScrollTabs } from "@/components/ui/scroll-tabs";
import { DatePicker } from "@/components/ui/date-picker";
import { FileDrop } from "@/components/ui/file-drop";
import { RankedBars } from "@/components/ui/ranked-bars";
import { chartTheme, ChartTooltipContent, formatAxisCompact } from "@/components/ui/chart-theme";
import { EditorShell } from "@/components/ui/editor-shell";
import { RowActions, RowActionButton } from "@/components/ui/row-actions";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Money, MoneyCell } from "@/components/ui/money";
import { SettingsLayout } from "@/components/layout/SettingsLayout";
import { TaxReadyModal } from "@/components/einvoice/TaxReadyModal";
import { useTaxReadyPrompt } from "@/components/einvoice/use-tax-ready-prompt";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";

const SERIES = [
  { m: "Jun", income: 61200, expenses: 48100 },
  { m: "Jul", income: 64800, expenses: 50400 },
  { m: "Aug", income: 59900, expenses: 47300 },
  { m: "Sep", income: 72300, expenses: 51800 },
  { m: "Oct", income: 76900, expenses: 53200 },
  { m: "Nov", income: 83388, expenses: 55950 },
];

export default function UiGallery() {
  const { locale } = useTranslation();
  const ar = locale === "ar";
  const L = (en: string, arText: string) => (ar ? arText : en);
  const params = new URLSearchParams(useSearch());
  const view = params.get("view");
  const dialog = params.get("dialog") as "sm" | "md" | "lg" | null;
  const [tab, setTab] = React.useState("open");
  const [date, setDate] = React.useState("2026-11-17");
  const [file, setFile] = React.useState<string | null>(null);

  if (view === "editor") return <EditorDemo L={L} />;
  // WQ5: the first-invoice e-invoice details prompt on the signed-in company (real API).
  if (view === "tax-ready") return <TaxReadyPreview />;
  if (view === "settings") {
    return (
      <SettingsLayout>
        <div className="space-y-6">
          <PageHeader
            eyebrow="Settings"
            title={L("Security", "الأمان")}
            description={L(
              "Sign-in, devices and two-step verification.",
              "تسجيل الدخول والأجهزة والتحقق بخطوتين."
            )}
          />
          <SectionCard title={L("Two-step verification", "التحقق بخطوتين")}>
            <EmptyState
              size="sm"
              title={L("Two-step verification is off.", "التحقق بخطوتين غير مفعّل.")}
              action={{ label: L("Turn on", "تفعيل"), onClick: () => {} }}
            />
          </SectionCard>
        </div>
      </SettingsLayout>
    );
  }

  return (
    <div className="space-y-12" data-testid="ui-gallery">
      <PageHeader
        backHref="/dashboard"
        eyebrow="Workspace"
        title={L("Design system", "نظام التصميم")}
        description={L(
          "Every shared primitive, in one place.",
          "كل العناصر المشتركة في مكان واحد."
        )}
        secondaryActions={<Button variant="outline">{L("Export", "تصدير")}</Button>}
        overflow={
          <>
            <DropdownMenuItem>{L("Import from Excel", "استيراد من Excel")}</DropdownMenuItem>
            <DropdownMenuItem>{L("Audit evidence", "أدلة التدقيق")}</DropdownMenuItem>
          </>
        }
        primaryAction={<Button>{L("New invoice", "فاتورة جديدة")}</Button>}
      />

      <Section id="type" title={L("Type scale", "مقاييس الخطوط")}>
        <div className="space-y-3">
          <div className="text-display-xl text-balance text-foreground">
            {L("Books that close themselves.", "دفاتر تُقفل نفسها.")}
          </div>
          <div className="text-display text-balance text-foreground">
            {L("One plan for where your books are today.", "خطة واحدة تناسب دفاترك اليوم.")}
          </div>
          <p className="text-lead text-muted-foreground">
            {L("Start free for 14 days. No card needed.", "ابدأ مجانًا لمدة 14 يومًا دون بطاقة.")}
          </p>
          <h1 className="text-h1">{L("Invoices", "الفواتير")}</h1>
          <h2 className="text-h2">{L("Section title", "عنوان القسم")}</h2>
          <h3 className="text-h3">{L("Card title", "عنوان البطاقة")}</h3>
          <div className="text-kpi">
            <Money amount={83388} />
          </div>
          <p className="text-body">
            {L("Body text reads at 14 / 22.", "النص الأساسي بحجم 14 / 22.")}
          </p>
          <p className="text-small text-muted-foreground">
            {L("Help text and table cells, 13 / 20.", "نص المساعدة وخلايا الجداول 13 / 20.")}
          </p>
          <p className="text-caption text-muted-foreground">
            {L("Caption 12 / 16", "تسمية توضيحية 12 / 16")}
          </p>
          <div className="eyebrow text-accent">{L("Eyebrow", "عنوان فرعي")}</div>
        </div>
      </Section>

      <Section id="colour" title={L("Colour and surfaces", "الألوان والأسطح")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="relative isolate overflow-hidden rounded-xl bg-surface-inverse p-6 text-surface-inverse-foreground">
            <div className="bg-ledger-ruling on-inverse absolute inset-0 -z-10" aria-hidden />
            <div className="text-caption text-surface-inverse-muted">
              {L("Inverse surface", "سطح معكوس")}
            </div>
            <div className="mt-2 text-h2">{L("Your books, in order.", "دفاترك منظمة.")}</div>
            <Button className="mt-4">{L("Start free trial", "ابدأ التجربة المجانية")}</Button>
          </div>
          <div className="grid grid-cols-3 gap-2 text-caption">
            {(["1", "2", "3", "4", "5", "neutral"] as const).map((k) => (
              <div key={k} className="rounded-lg border border-border bg-card p-2">
                <div
                  className="h-8 rounded-md"
                  style={{ backgroundColor: `hsl(var(--chart-${k}))` }}
                />
                <div className="mt-1 text-muted-foreground" dir="ltr">
                  chart-{k}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button>{L("Primary", "أساسي")}</Button>
          <Button disabled>{L("Disabled", "معطّل")}</Button>
          <Button variant="outline">{L("Outline", "محدد")}</Button>
          <Button variant="ghost">{L("Ghost", "شفاف")}</Button>
          <Button variant="destructive">{L("Delete", "حذف")}</Button>
          <StatusBadge tone="success">{L("Paid", "مدفوعة")}</StatusBadge>
          <StatusBadge tone="danger">{L("Overdue", "متأخرة")}</StatusBadge>
          <StatusBadge tone="warning">{L("Due soon", "تستحق قريبًا")}</StatusBadge>
          <StatusBadge tone="neutral">{L("Draft", "مسودة")}</StatusBadge>
        </div>
      </Section>

      <Section id="stat" title="StatCard">
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatCard
            label={L("Revenue", "الإيرادات")}
            value={<Money amount={83388} />}
            delta={{
              label: "+8.4%",
              direction: "up",
              tone: "positive",
              context: L("vs last month", "مقارنة بالشهر الماضي"),
            }}
            hint={L("23 invoices", "23 فاتورة")}
            sparkline={SERIES.map((s) => s.income)}
          />
          <StatCard
            label={L("Expenses", "المصروفات")}
            value={<Money amount={55950} />}
            delta={{ label: "+5.2%", direction: "up", tone: "negative" }}
            hint={L("41 bills and receipts", "41 فاتورة وإيصالًا")}
            sparkline={SERIES.map((s) => s.expenses)}
            sparklineTone="neutral"
          />
          <StatCard
            label={L("Net profit", "صافي الربح")}
            value={<Money amount={27438} />}
            delta={{ label: "+15.1%", direction: "up", tone: "positive" }}
            hint={L("Margin 32.9%", "الهامش 32.9%")}
            sparkline={SERIES.map((s) => s.income - s.expenses)}
          />
          <StatCard
            label={L("Cash", "النقد")}
            value={<Money amount={214906.5} />}
            delta={{ label: "−1.3%", direction: "down", tone: "negative" }}
            hint={L("3 bank accounts", "3 حسابات بنكية")}
            sparkline={[220, 218, 225, 219, 217, 214.9]}
          />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatCard
            label={L("Receivable", "الذمم المدينة")}
            value={<Money amount={41250} />}
            hint={L("6 open invoices", "6 فواتير مفتوحة")}
          />
          <StatCard
            label={L("Payable", "الذمم الدائنة")}
            value={<Money amount={18730} />}
            hint={L("4 open bills", "4 فواتير موردين")}
          />
          <StatCard
            label={L("VAT due", "الضريبة المستحقة")}
            value={<Money amount={4169.4} />}
            hint={L("Q4 2026, due 28 Jan", "الربع 4 2026، تستحق 28 يناير")}
          />
          <StatCard label={L("Loading", "جارٍ التحميل")} value={null} loading />
        </div>
      </Section>

      <Section id="empty" title="EmptyState">
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <SectionCard title={L("Payroll runs", "مسيرات الرواتب")}>
            <EmptyState
              size="sm"
              title={L("No payroll runs yet.", "لا توجد مسيرات رواتب بعد.")}
              action={{ label: L("Run payroll", "تشغيل الرواتب"), onClick: () => {} }}
            />
          </SectionCard>
          <SectionCard flush>
            <EmptyState
              size="md"
              icon={FileText}
              title={L("No quotes yet", "لا توجد عروض أسعار بعد")}
              description={L(
                "Quotes you send will appear here.",
                "ستظهر هنا عروض الأسعار التي ترسلها."
              )}
              action={{ label: L("New quote", "عرض سعر جديد"), onClick: () => {} }}
              secondaryAction={{
                label: L("Import from Excel", "استيراد من Excel"),
                onClick: () => {},
              }}
            />
          </SectionCard>
        </div>
        <EmptyState
          className="mt-4"
          size="lg"
          icon={Landmark}
          title={L("Import a bank statement", "استورد كشف حساب بنكي")}
          description={L(BANK_RECONCILIATION_COPY.en, BANK_RECONCILIATION_COPY.ar)}
          action={{ label: L("Add bank account", "إضافة حساب بنكي"), onClick: () => {} }}
          secondaryAction={{ label: L("Import statement", "استيراد كشف"), onClick: () => {} }}
        />
      </Section>

      <Section id="notices" title={L("SetupNotice and Alert", "التنبيهات")}>
        <div className="space-y-3">
          <SetupNotice
            title={L("Not available yet.", "غير متاح بعد.")}
            action={{ label: L("Download reminders", "تنزيل التذكيرات"), onClick: () => {} }}
          >
            {L(
              "Reminders are prepared but not emailed yet. You can copy or download them.",
              "التذكيرات جاهزة لكنها لا تُرسل بالبريد بعد. يمكنك نسخها أو تنزيلها."
            )}
          </SetupNotice>
          <Alert tone="info" title={L("VAT period open", "فترة الضريبة مفتوحة")}>
            {L("Q4 2026 closes on 31 Dec.", "تُقفل فترة الربع الرابع 2026 في 31 ديسمبر.")}
          </Alert>
          <Alert tone="success" title={L("Books balanced", "الدفاتر متوازنة")}>
            {L("Trial balance ties to the ledger.", "ميزان المراجعة مطابق للأستاذ العام.")}
          </Alert>
          <Alert
            tone="warning"
            title={L("Period locked", "الفترة مقفلة")}
            action={
              <Button size="sm" variant="outline">
                {L("Review", "مراجعة")}
              </Button>
            }
          >
            {L("Entries before 30 Sep need a reason.", "القيود قبل 30 سبتمبر تحتاج إلى سبب.")}
          </Alert>
          <Alert tone="danger" title={L("Payment failed", "فشل الدفع")}>
            {L("The bank rejected the transfer.", "رفض البنك التحويل.")}
          </Alert>
        </div>
      </Section>

      <Section id="tabs" title="ScrollTabs">
        <Tabs value={tab} onValueChange={setTab}>
          <ScrollTabs
            aria-label={L("Invoice status", "حالة الفاتورة")}
            maxVisible={5}
            value={tab}
            onValueChange={setTab}
          >
            {[
              ["open", L("Open", "مفتوحة")],
              ["overdue", L("Overdue", "متأخرة")],
              ["paid", L("Paid", "مدفوعة")],
              ["draft", L("Draft", "مسودة")],
              ["credit", L("Credit notes", "إشعارات دائنة")],
              ["void", L("Void", "ملغاة")],
              ["all", L("All", "الكل")],
            ].map(([v, label]) => (
              <TabsTrigger key={v} value={v}>
                {label}
              </TabsTrigger>
            ))}
          </ScrollTabs>
          <TabsContent value={tab}>
            <ScrollTabs variant="line" aria-label={L("Sections", "الأقسام")}>
              <TabsTrigger value={tab}>{L("Summary", "الملخص")}</TabsTrigger>
              <TabsTrigger value="__b">{L("Activity", "النشاط")}</TabsTrigger>
              <TabsTrigger value="__c">{L("Attachments", "المرفقات")}</TabsTrigger>
            </ScrollTabs>
          </TabsContent>
        </Tabs>
      </Section>

      <Section id="forms" title={L("Form controls", "عناصر النماذج")}>
        <div className="grid max-w-narrow gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="g-name">{L("Customer", "العميل")} *</Label>
            <Input
              id="g-name"
              defaultValue={L("Al Noor Trading LLC", "شركة النور للتجارة ذ.م.م")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-date">{L("Due date", "تاريخ الاستحقاق")}</Label>
            <DatePicker id="g-date" value={date} onChange={setDate} />
          </div>
          <div className="space-y-1.5">
            <Label>{L("Language", "اللغة")}</Label>
            <Select defaultValue="en">
              <SelectTrigger aria-label={L("Language", "اللغة")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="ar">العربية</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 self-end pb-2">
            <Checkbox id="g-vat" defaultChecked />
            <Label htmlFor="g-vat">{L("VAT registered", "مسجّل في ضريبة القيمة المضافة")}</Label>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="g-file">{L("Bank statement", "كشف الحساب البنكي")}</Label>
            <FileDrop
              id="g-file"
              accept=".csv,.xlsx"
              value={file}
              onFiles={([f]) => setFile(f.name)}
              onClear={() => setFile(null)}
              label={L("Drop a CSV or Excel file", "أفلت ملف CSV أو Excel")}
              hint={L("CSV, XLSX · up to 10 MB", "CSV أو XLSX · حتى 10 ميغابايت")}
            />
          </div>
        </div>
      </Section>

      <Section id="charts" title={L("Charts", "الرسوم البيانية")}>
        <div className="grid gap-4 lg:grid-cols-3">
          <SectionCard
            className="lg:col-span-2"
            title={L("Revenue and expenses", "الإيرادات والمصروفات")}
          >
            <div className="h-64" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={SERIES} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid {...chartTheme.grid} />
                  <XAxis dataKey="m" {...chartTheme.xAxis} />
                  <YAxis {...chartTheme.yAxis} tickFormatter={formatAxisCompact} />
                  <Tooltip
                    {...chartTheme.tooltip}
                    content={<ChartTooltipContent currency="AED" />}
                  />
                  <Area
                    dataKey="income"
                    name={L("Revenue", "الإيرادات")}
                    {...chartTheme.area("brand")}
                  />
                  <Line
                    dataKey="expenses"
                    name={L("Expenses", "المصروفات")}
                    {...chartTheme.comparisonLine}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
          <SectionCard title={L("Expense breakdown", "توزيع المصروفات")}>
            <RankedBars
              aria-label={L("Expense breakdown", "توزيع المصروفات")}
              items={[
                { label: L("Salaries", "الرواتب"), value: 28400 },
                { label: L("Rent", "الإيجار"), value: 12000 },
                { label: L("Software", "البرمجيات"), value: 4350 },
                { label: L("Travel", "السفر"), value: 3920 },
                { label: L("Utilities", "المرافق"), value: 2210 },
                { label: L("Marketing", "التسويق"), value: 1890 },
                { label: L("Bank fees", "رسوم بنكية"), value: 640 },
              ]}
            />
          </SectionCard>
          <SectionCard
            className="lg:col-span-3"
            title={L("Cash in and out", "النقد الداخل والخارج")}
          >
            <div className="h-56" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={SERIES} {...chartTheme.barChart}>
                  <CartesianGrid {...chartTheme.grid} />
                  <XAxis dataKey="m" {...chartTheme.xAxis} />
                  <YAxis {...chartTheme.yAxis} tickFormatter={formatAxisCompact} />
                  <Tooltip
                    {...chartTheme.tooltip}
                    content={<ChartTooltipContent currency="AED" />}
                  />
                  <Bar dataKey="income" name={L("In", "داخل")} {...chartTheme.bar("brand")} />
                  <Bar dataKey="expenses" name={L("Out", "خارج")} {...chartTheme.bar("neutral")} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        </div>
      </Section>

      <Section id="table" title={L("Table and row actions", "الجدول وإجراءات الصفوف")}>
        <SectionCard flush>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{L("Invoice", "الفاتورة")}</TableHead>
                <TableHead>{L("Customer", "العميل")}</TableHead>
                <TableHead>{L("Status", "الحالة")}</TableHead>
                <TableHead className="text-end">{L("Amount", "المبلغ")}</TableHead>
                <TableHead className="w-24">
                  <span className="sr-only">{L("Actions", "الإجراءات")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                [
                  "INV-0142",
                  L("Al Noor Trading LLC", "شركة النور للتجارة"),
                  "success",
                  L("Paid", "مدفوعة"),
                  9500,
                ],
                [
                  "INV-0141",
                  L("Gulf Logistics FZE", "الخليج للخدمات اللوجستية"),
                  "danger",
                  L("Overdue", "متأخرة"),
                  12750.5,
                ],
                [
                  "INV-0140",
                  L("Palm Dental Clinic", "عيادة النخلة لطب الأسنان"),
                  "neutral",
                  L("Draft", "مسودة"),
                  3150,
                ],
              ].map(([n, c, tone, s, a]) => (
                <TableRow
                  key={n as string}
                  className={
                    tone === "danger"
                      ? "shadow-[inset_2px_0_0_hsl(var(--danger))] rtl:shadow-[inset_-2px_0_0_hsl(var(--danger))]"
                      : undefined
                  }
                >
                  <TableCell className="font-medium" dir="ltr">
                    {n}
                  </TableCell>
                  <TableCell>{c}</TableCell>
                  <TableCell>
                    <StatusBadge tone={tone as "success"}>{s}</StatusBadge>
                  </TableCell>
                  <MoneyCell amount={a as number} />
                  <TableCell>
                    <RowActions
                      maxInline={1}
                      menu={
                        <DropdownMenuItem className="text-destructive">
                          <Trash2 aria-hidden />
                          {L("Delete", "حذف")}
                        </DropdownMenuItem>
                      }
                    >
                      <RowActionButton label={L("Send", "إرسال")} icon={Send} />
                      <RowActionButton label={L("Download PDF", "تنزيل PDF")} icon={Download} />
                      <RowActionButton label={L("Edit", "تعديل")} icon={Pencil} />
                    </RowActions>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
      </Section>

      <Dialog open={!!dialog}>
        <DialogContent size={dialog ?? "md"}>
          <DialogHeader>
            <DialogTitle>{L("Record payment", "تسجيل دفعة")}</DialogTitle>
            <DialogDescription>
              {L("Apply a payment to INV-0141.", "تطبيق دفعة على الفاتورة INV-0141.")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="d-amount">{L("Amount", "المبلغ")}</Label>
              <Input id="d-amount" defaultValue="12,750.50" dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-date">{L("Payment date", "تاريخ الدفع")}</Label>
              <DatePicker id="d-date" value={date} onChange={setDate} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline">{L("Cancel", "إلغاء")}</Button>
            <Button>{L("Record payment", "تسجيل الدفعة")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="space-y-4">
      <h2 id={`${id}-title`} className="text-h2 text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function EditorDemo({ L }: { L: (en: string, ar: string) => string }) {
  const [date, setDate] = React.useState("2026-11-17");
  return (
    <EditorShell
      backHref="/__ui"
      backLabel={L("Design system", "نظام التصميم")}
      eyebrow="Sales"
      title={L("New invoice", "فاتورة جديدة")}
      status={<StatusBadge tone="neutral">{L("Draft", "مسودة")}</StatusBadge>}
      preview={
        <div className="rounded-xl border border-border bg-card p-6 shadow-card-soft">
          <div className="h-0.5 w-full bg-primary" />
          <div className="mt-4 flex items-start justify-between gap-4">
            <div className="text-small font-semibold">
              {L("Najm Studio LLC", "استوديو نجم ذ.م.م")}
            </div>
            <div className="text-end">
              <div className="text-h3">{L("Tax invoice", "فاتورة ضريبية")}</div>
              <div className="text-caption text-muted-foreground" dir="ltr">
                INV-0143
              </div>
            </div>
          </div>
          <div className="mt-6 space-y-2 text-small">
            <div className="flex justify-between">
              <span>{L("Brand workshop", "ورشة العلامة التجارية")}</span>
              <Money amount={9000} />
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>{L("VAT 5%", "ضريبة 5%")}</span>
              <Money amount={450} />
            </div>
            <div className="flex justify-between border-t border-border pt-2 font-semibold">
              <span>{L("Total", "الإجمالي")}</span>
              <Money amount={9450} />
            </div>
          </div>
        </div>
      }
      previewLabel={L("Live preview", "معاينة مباشرة")}
      footerSummary={
        <span>
          {L("Total", "الإجمالي")}{" "}
          <span className="font-semibold text-foreground">
            <Money amount={9450} />
          </span>
        </span>
      }
      footer={
        <>
          <Button variant="ghost">{L("Cancel", "إلغاء")}</Button>
          <Button variant="outline">{L("Save draft", "حفظ المسودة")}</Button>
          <Button>{L("Save and send", "حفظ وإرسال")}</Button>
        </>
      }
    >
      <SectionCard title={L("Customer", "العميل")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="e-c">{L("Customer", "العميل")}</Label>
            <Input id="e-c" defaultValue={L("Al Noor Trading LLC", "شركة النور للتجارة")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="e-d">{L("Issue date", "تاريخ الإصدار")}</Label>
            <DatePicker id="e-d" value={date} onChange={setDate} />
          </div>
        </div>
      </SectionCard>
      <SectionCard title={L("Lines", "البنود")} flush>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{L("Description", "الوصف")}</TableHead>
              <TableHead className="text-end">{L("Amount", "المبلغ")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>{L("Brand workshop", "ورشة العلامة التجارية")}</TableCell>
              <MoneyCell amount={9000} />
            </TableRow>
          </TableBody>
        </Table>
      </SectionCard>
      <SectionCard title={L("Attachments", "المرفقات")}>
        <EmptyState
          size="sm"
          title={L("No attachments.", "لا توجد مرفقات.")}
          action={{ label: L("Add a file", "إضافة ملف"), onClick: () => {} }}
        />
      </SectionCard>
    </EditorShell>
  );
}

/** WQ5: mounts the first-invoice prompt the way the invoice editor does (dev gallery only). */
function TaxReadyPreview() {
  const { companyId } = useDefaultCompany();
  const prompt = useTaxReadyPrompt(companyId, { enabled: true });
  return <TaxReadyModal {...prompt.modalProps} />;
}
