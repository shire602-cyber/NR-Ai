import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface VAT201Data {
  box1aAbuDhabiAmount: number;
  box1aAbuDhabiVat: number;
  box1aAbuDhabiAdj: number;
  box1bDubaiAmount: number;
  box1bDubaiVat: number;
  box1bDubaiAdj: number;
  box1cSharjahAmount: number;
  box1cSharjahVat: number;
  box1cSharjahAdj: number;
  box1dAjmanAmount: number;
  box1dAjmanVat: number;
  box1dAjmanAdj: number;
  box1eUmmAlQuwainAmount: number;
  box1eUmmAlQuwainVat: number;
  box1eUmmAlQuwainAdj: number;
  box1fRasAlKhaimahAmount: number;
  box1fRasAlKhaimahVat: number;
  box1fRasAlKhaimahAdj: number;
  box1gFujairahAmount: number;
  box1gFujairahVat: number;
  box1gFujairahAdj: number;
  box2TouristRefundAmount: number;
  box2TouristRefundVat: number;
  box3ReverseChargeAmount: number;
  box3ReverseChargeVat: number;
  box4ZeroRatedAmount: number;
  box5ExemptAmount: number;
  box6ImportsAmount: number;
  box6ImportsVat: number;
  box7ImportsAdjAmount: number;
  box7ImportsAdjVat: number;
  box9ExpensesAmount: number;
  box9ExpensesVat: number;
  box9ExpensesAdj: number;
  box10ReverseChargeAmount: number;
  box10ReverseChargeVat: number;
}

interface Props {
  data: VAT201Data;
  onChange: (data: VAT201Data) => void;
  companyInfo: {
    nameEn: string;
    nameAr?: string;
    trnNumber?: string;
    address?: string;
    phone?: string;
  };
  periodInfo: {
    periodStart: string;
    periodEnd: string;
    dueDate: string;
    taxYearEnd?: string;
    vatStagger?: string;
  };
  readOnly?: boolean;
  /** Where the sticky 12–14 summary rests (above a page's own sticky action bar). */
  summaryOffsetClassName?: string;
}

const EMIRATES = [
  { key: "1a", en: "Abu Dhabi", ar: "أبو ظبي", prefix: "box1aAbuDhabi" },
  { key: "1b", en: "Dubai", ar: "دبي", prefix: "box1bDubai" },
  { key: "1c", en: "Sharjah", ar: "الشارقة", prefix: "box1cSharjah" },
  { key: "1d", en: "Ajman", ar: "عجمان", prefix: "box1dAjman" },
  { key: "1e", en: "Umm Al Quwain", ar: "أم القيوين", prefix: "box1eUmmAlQuwain" },
  { key: "1f", en: "Ras Al Khaimah", ar: "رأس الخيمة", prefix: "box1fRasAlKhaimah" },
  { key: "1g", en: "Fujairah", ar: "الفجيرة", prefix: "box1gFujairah" },
];

export default function VAT201Form({
  data,
  onChange,
  companyInfo,
  periodInfo,
  readOnly = false,
  summaryOffsetClassName = "bottom-0",
}: Props) {
  const { locale: _locale } = useTranslation();

  const formatNumber = (num: number) =>
    num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const handleFieldChange = (field: keyof VAT201Data, value: string) => {
    const numValue = parseFloat(value) || 0;
    const newData = { ...data, [field]: numValue };

    if (field.endsWith("Amount") && !field.includes("ZeroRated") && !field.includes("Exempt")) {
      const vatField = field.replace("Amount", "Vat") as keyof VAT201Data;
      if (vatField in newData) {
        (newData as any)[vatField] = numValue * 0.05;
      }
    }

    onChange(newData);
  };

  const calculateTotalSalesAmount = () => {
    return (
      EMIRATES.reduce((sum, e) => sum + (data as any)[`${e.prefix}Amount`], 0) +
      data.box2TouristRefundAmount +
      data.box3ReverseChargeAmount +
      data.box4ZeroRatedAmount +
      data.box5ExemptAmount +
      data.box6ImportsAmount +
      data.box7ImportsAdjAmount
    );
  };

  const calculateTotalSalesVat = () => {
    return (
      EMIRATES.reduce((sum, e) => sum + (data as any)[`${e.prefix}Vat`], 0) +
      data.box2TouristRefundVat +
      data.box3ReverseChargeVat +
      data.box6ImportsVat +
      data.box7ImportsAdjVat
    );
  };

  const calculateTotalSalesAdj = () => {
    return EMIRATES.reduce((sum, e) => sum + (data as any)[`${e.prefix}Adj`], 0);
  };

  const calculateTotalInputVat = () => {
    return data.box9ExpensesVat + data.box10ReverseChargeVat;
  };

  // Box 12 = Box 8 VAT + Box 8 adjustments; Box 13 = Box 11 VAT + Box 11 adjustments (W4-E).
  const calculateDueTax = () => calculateTotalSalesVat() + calculateTotalSalesAdj();
  const calculateRecoverableTax = () => calculateTotalInputVat() + (data.box9ExpensesAdj || 0);

  const calculateNetVat = () => {
    return calculateDueTax() - calculateRecoverableTax();
  };

  // Spec 3.12 (WP-D): the VAT 201 workbook. Sections are cards; each box is one row (box chip,
  // English label over the Arabic one, amount, VAT, adjustment); the summary (boxes 12-14) is
  // sticky at the bottom. On mobile each box stacks: label, then its figures. Layout only: the
  // box values and the totals above are unchanged.
  const field = (key: keyof VAT201Data, opts: { derived?: boolean } = {}) => (
    <BoxValue
      value={data[key]}
      readOnly={readOnly}
      derived={opts.derived}
      onChange={(v) => handleFieldChange(key, v)}
      testId={`input-${String(key).replace(/(Amount|Vat|Adj)$/, (m) => `-${m.toLowerCase()}`)}`}
    />
  );
  const net = calculateNetVat();

  return (
    <div className="space-y-5 text-sm tabular-nums" data-testid="vat201-workbook">
      <section className="rounded-xl border border-border bg-card p-5 shadow-card-soft">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-border pb-3">
          {/* i18n-ignore: FTA VAT 201 bilingual form title, English is paired with a fixed Arabic line */}
          <h2 className="text-h3 font-semibold text-foreground">VAT 201 return</h2>
          <span dir="rtl" lang="ar" className="text-small text-muted-foreground">
            إقرار ضريبة القيمة المضافة
          </span>
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Meta en="TRN" ar="رقم تسجيل الضريبة">
            <bdi className="money">{companyInfo.trnNumber || "—"}</bdi>
          </Meta>
          <Meta en="Legal name (English)" ar="الاسم القانوني بالإنجليزية">
            {companyInfo.nameEn}
          </Meta>
          <Meta en="Legal name (Arabic)" ar="الاسم القانوني بالعربية">
            <span dir="rtl">{companyInfo.nameAr || "—"}</span>
          </Meta>
          <Meta en="Address" ar="العنوان">
            {companyInfo.address || "—"}
          </Meta>
          <Meta en="Return period" ar="فترة الإقرار الضريبي">
            <bdi className="money">
              {periodInfo.periodStart} – {periodInfo.periodEnd}
            </bdi>
          </Meta>
          <Meta en="VAT stagger" ar="الفترة الضريبية">
            {periodInfo.vatStagger || "—"}
          </Meta>
          <Meta en="Return due date" ar="تاريخ استحقاق الإقرار">
            <bdi className="money">{periodInfo.dueDate}</bdi>
          </Meta>
          <Meta en="Tax year end" ar="نهاية السنة الضريبية">
            <bdi className="money">{periodInfo.taxYearEnd || "—"}</bdi>
          </Meta>
        </dl>
      </section>

      <BoxSection
        en="VAT on sales and all other outputs"
        ar="ضريبة القيمة المضافة على المبيعات وجميع المخرجات الأخرى"
      >
        {EMIRATES.map((emirate) => (
          <BoxRow
            key={emirate.key}
            box={emirate.key}
            en={`Standard rated supplies in ${emirate.en}`}
            ar={`التوريدات الخاضعة للنسبة الأساسية في ${emirate.ar}`}
            amount={field(`${emirate.prefix}Amount` as keyof VAT201Data)}
            vat={field(`${emirate.prefix}Vat` as keyof VAT201Data, { derived: true })}
            adjustment={field(`${emirate.prefix}Adj` as keyof VAT201Data)}
          />
        ))}
        <BoxRow
          box="2"
          en="Tax refunds provided to tourists"
          ar="المبالغ التي تم ردها للسياح"
          amount={field("box2TouristRefundAmount")}
          vat={field("box2TouristRefundVat")}
        />
        <BoxRow
          box="3"
          en="Supplies subject to the reverse charge provisions"
          ar="التوريدات الخاضعة لأحكام الاحتساب العكسي"
          amount={field("box3ReverseChargeAmount")}
          vat={field("box3ReverseChargeVat")}
        />
        <BoxRow
          box="4"
          en="Zero rated supplies"
          ar="توريدات خاضعة للنسبة الصفرية"
          amount={field("box4ZeroRatedAmount")}
        />
        <BoxRow
          box="5"
          en="Exempt supplies"
          ar="التوريدات المعفاة"
          amount={field("box5ExemptAmount")}
        />
        <BoxRow
          box="6"
          en="Goods imported into the UAE"
          ar="البضائع الواردة إلى الدولة"
          amount={field("box6ImportsAmount")}
          vat={field("box6ImportsVat")}
        />
        <BoxRow
          box="7"
          en="Adjustments to goods imported into the UAE"
          ar="تسوية على البضائع المستوردة"
          amount={field("box7ImportsAdjAmount")}
          vat={field("box7ImportsAdjVat")}
        />
        <BoxRow
          box="8"
          en="Totals"
          ar="المجموع"
          total
          amount={<Figure text={formatNumber(calculateTotalSalesAmount())} />}
          vat={<Figure text={formatNumber(calculateTotalSalesVat())} />}
          adjustment={<Figure text={formatNumber(calculateTotalSalesAdj())} />}
        />
      </BoxSection>

      <BoxSection
        en="VAT on expenses and all other inputs"
        ar="ضريبة القيمة المضافة على المصروفات وجميع المدخلات الأخرى"
      >
        <BoxRow
          box="9"
          en="Standard rated expenses"
          ar="النفقات الخاضعة للنسبة الأساسية"
          amount={field("box9ExpensesAmount")}
          vat={field("box9ExpensesVat")}
          adjustment={field("box9ExpensesAdj")}
        />
        <BoxRow
          box="10"
          en="Supplies subject to the reverse charge provisions"
          ar="التوريدات الخاضعة لأحكام الاحتساب العكسي"
          amount={field("box10ReverseChargeAmount")}
          vat={field("box10ReverseChargeVat")}
        />
        <BoxRow
          box="11"
          en="Totals"
          ar="المجموع"
          total
          amount={
            <Figure text={formatNumber(data.box9ExpensesAmount + data.box10ReverseChargeAmount)} />
          }
          vat={<Figure text={formatNumber(calculateTotalInputVat())} />}
          adjustment={<Figure text={formatNumber(data.box9ExpensesAdj)} />}
        />
      </BoxSection>

      <section
        className={`sticky ${summaryOffsetClassName} z-10 rounded-xl border border-border bg-card/95 p-4 shadow-card-soft backdrop-blur supports-[backdrop-filter]:bg-card/85`}
        aria-label={SUMMARY_LABELS.section}
        data-testid="vat201-summary"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryCell box="12" en="Total due tax" ar="إجمالي الضريبة المستحقة">
            {formatNumber(calculateDueTax())}
          </SummaryCell>
          <SummaryCell box="13" en="Total recoverable tax" ar="إجمالي الضريبة القابلة للاسترداد">
            {formatNumber(calculateRecoverableTax())}
          </SummaryCell>
          <SummaryCell
            box="14"
            en={net >= 0 ? SUMMARY_LABELS.payable.en : SUMMARY_LABELS.refundable.en}
            ar={net >= 0 ? SUMMARY_LABELS.payable.ar : SUMMARY_LABELS.refundable.ar}
            emphasis
          >
            {net >= 0 ? "" : "("}
            {formatNumber(Math.abs(net))}
            {net >= 0 ? "" : ")"}
          </SummaryCell>
        </div>
      </section>

      <footer className="space-y-1 border-t border-border pt-4 text-center text-caption text-muted-foreground">
        <p>www.tax.gov.ae | @uaetax</p>
        {/* i18n-ignore: bilingual FTA VAT 201 form footer; the Arabic text follows */}
        <p>This is a system generated document and does not need to be signed.</p>
        <p dir="rtl" lang="ar">
          هذه وثيقة تم إنشاؤها بواسطة النظام ولا تحتاج إلى التوقيع.
        </p>
      </footer>
    </div>
  );
}

/** FTA VAT 201 bilingual labels for the summary (fixed English over Arabic, as on the form). */
const SUMMARY_LABELS = {
  section: "Net VAT due / صافي ضريبة القيمة المضافة المستحقة",
  payable: { en: "Payable tax for the period", ar: "الضريبة المستحقة الدفع للفترة" },
  refundable: { en: "Refundable tax for the period", ar: "الضريبة المستردة للفترة" },
};

function Meta({ en, ar, children }: { en: string; ar: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-muted-foreground">
        <span className="block">{en}</span>
        <span className="block" lang="ar">
          {ar}
        </span>
      </dt>
      <dd className="mt-0.5 break-words font-medium text-foreground">{children}</dd>
    </div>
  );
}

function BoxSection({ en, ar, children }: { en: string; ar: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-card-soft">
      <div className="flex flex-col gap-0.5 border-b border-border px-5 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
        <h3 className="text-h3 font-semibold text-foreground">{en}</h3>
        <span className="text-small text-muted-foreground" dir="rtl" lang="ar">
          {ar}
        </span>
      </div>
      {/* Column captions on desktop; mobile rows carry their own. */}
      <div className="hidden grid-cols-[minmax(0,1fr)_9rem_9rem_9rem] gap-4 border-b border-border bg-surface-sunken/60 px-5 py-2 text-caption text-muted-foreground md:grid">
        <span />
        <ColumnCaption en="Amount (AED)" ar="المبلغ (درهم)" />
        <ColumnCaption en="VAT (AED)" ar="الضريبة (درهم)" />
        <ColumnCaption en="Adjustment (AED)" ar="التسوية (درهم)" />
      </div>
      <ul className="divide-y divide-border/70">{children}</ul>
    </section>
  );
}

function ColumnCaption({ en, ar }: { en: string; ar: string }) {
  return (
    <span className="text-end">
      <span className="block">{en}</span>
      <span className="block" lang="ar">
        {ar}
      </span>
    </span>
  );
}

function BoxRow({
  box,
  en,
  ar,
  amount,
  vat,
  adjustment,
  total = false,
}: {
  box: string;
  en: string;
  ar: string;
  amount?: ReactNode;
  vat?: ReactNode;
  adjustment?: ReactNode;
  total?: boolean;
}) {
  return (
    <li
      className={cn(
        "grid grid-cols-1 gap-3 px-5 py-3 md:grid-cols-[minmax(0,1fr)_9rem_9rem_9rem] md:items-center md:gap-4",
        total && "bg-surface-sunken/60 font-semibold"
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 inline-flex h-6 min-w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background px-1.5 text-caption font-semibold text-foreground">
          {box}
        </span>
        <span className="min-w-0">
          <span className="block leading-snug text-foreground">{en}</span>
          <span className="block text-caption text-muted-foreground" lang="ar">
            {ar}
          </span>
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 ps-11 md:contents md:ps-0">
        <Cell caption="amount">{amount}</Cell>
        <Cell caption="vat">{vat}</Cell>
        <Cell caption="adjustment">{adjustment}</Cell>
      </div>
    </li>
  );
}

const CELL_CAPTIONS: Record<string, { en: string; ar: string }> = {
  amount: { en: "Amount", ar: "المبلغ" },
  vat: { en: "VAT", ar: "الضريبة" },
  adjustment: { en: "Adjustment", ar: "التسوية" },
};

function Cell({ caption, children }: { caption: string; children?: ReactNode }) {
  const { locale } = useTranslation();
  const label = CELL_CAPTIONS[caption];
  return (
    <div className="min-w-0 text-end">
      <span className="block text-caption text-muted-foreground md:hidden">
        {locale === "ar" ? label.ar : label.en}
      </span>
      {children ?? <span className="text-muted-foreground">—</span>}
    </div>
  );
}

function Figure({ text }: { text: string }) {
  return (
    <span className="money" dir="ltr">
      {text}
    </span>
  );
}

function BoxValue({
  value,
  readOnly,
  derived,
  onChange,
  testId,
}: {
  value: number;
  readOnly: boolean;
  derived?: boolean;
  onChange: (value: string) => void;
  testId: string;
}) {
  if (readOnly) {
    return (
      <span className="money" dir="ltr" data-testid={testId}>
        {formatBoxValue(value)}
      </span>
    );
  }
  return (
    <Input
      type="number"
      step="0.01"
      inputMode="decimal"
      dir="ltr"
      className={cn("h-9 text-end", derived && "bg-muted")}
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      data-testid={testId}
    />
  );
}

function formatBoxValue(value: number): string {
  return (value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function SummaryCell({
  box,
  en,
  ar,
  emphasis = false,
  children,
}: {
  box: string;
  en: string;
  ar: string;
  emphasis?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("rounded-lg px-3 py-2", emphasis && "bg-surface-sunken")}>
      <div className="flex items-start gap-2 text-caption text-muted-foreground">
        <span className="font-semibold text-foreground">{box}</span>
        <span className="min-w-0">
          <span className="block">{en}</span>
          <span className="block" lang="ar">
            {ar}
          </span>
        </span>
      </div>
      <div
        className={cn(
          "mt-1 text-end font-semibold text-foreground",
          emphasis ? "text-h2" : "text-h3"
        )}
      >
        <span className="money" dir="ltr">
          {children}
        </span>
      </div>
    </div>
  );
}
