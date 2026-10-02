import { Fragment, useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { useTranslation } from "@/lib/i18n";
import { messages as pageMessages } from "./VAT201Form.i18n";
import { vat201TotalsForScreen, type Vat201Totals } from "@/lib/vat201-totals";
import VatJournalLineRows, { type VatReturnJournalLine } from "./vat/VatJournalLineRows";

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
  /** The manual VAT journals and taxable journal sales behind the boxes (the return's vatAdjustments), shown under the boxes they affect. */
  journalLines?: VatReturnJournalLine[] | null;
  /** The stored return's own totals (boxes 8, 11, 12-14): shown as they are until a box is changed on screen. */
  storedTotals?: Vat201Totals | null;
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
  journalLines,
  storedTotals,
}: Props) {
  const tr = pageMessages.useT();

  const { locale } = useTranslation();

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

  // The boxes as they were when this return was opened: while they are unchanged the screen shows the stored return's
  // totals; once a preparer edits a box the totals follow the edit, adjustments included (vat201-totals.ts).
  const storedKey = JSON.stringify(storedTotals ?? null);
  const baseline = useMemo(() => JSON.stringify(data), [storedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const totals = vat201TotalsForScreen(data as any, storedTotals, JSON.stringify(data) === baseline);
  const calculateTotalSalesAmount = () => totals.box8Amount;
  const calculateTotalSalesVat = () => totals.box8Vat;
  const calculateTotalSalesAdj = () => totals.box8Adj;
  const calculateTotalInputVat = () => totals.box11Vat;
  const calculateTotalInputAdj = () => totals.box11Adj;
  const calculateTotalInputAmount = () => totals.box11Amount;
  const calculateDueTax = () => totals.box12;
  const calculateRecoverableTax = () => totals.box13;
  const calculateNetVat = () => totals.box14;

  return (
    <div className="space-y-5 text-sm tabular-nums">
      <Card>
        <CardHeader className="border-b py-4">
          <CardTitle className="flex items-center justify-between text-base">
            <span className="font-display text-xl tracking-tight">{tr("vat201Return")}</span>
            <span dir="rtl" className="font-display text-lg text-muted-foreground">
              إقرار ضريبة القيمة المضافة
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              {/* i18n-ignore: bilingual heading copied from the official FTA VAT 201 form */}
              <h3 className="font-bold mb-2">Taxpayer Information / معلومات دافعي الضرائب</h3>
              <Table>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium w-1/3">
                      {tr("trn")}
                      <br />
                      <span className="text-muted-foreground">رقم تسجيل الضريبة</span>
                    </TableCell>
                    <TableCell>{companyInfo.trnNumber || "N/A"}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">
                      {tr("legalNameEnglish")}
                      <br />
                      <span className="text-muted-foreground">
                        الاسم القانوني للكيان بالإنجليزية
                      </span>
                    </TableCell>
                    <TableCell>{companyInfo.nameEn}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">
                      {tr("legalNameArabic")}
                      <br />
                      <span className="text-muted-foreground">الاسم القانوني للكيان بالعربية</span>
                    </TableCell>
                    <TableCell dir="rtl">{companyInfo.nameAr || "-"}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">
                      {tr("address")}
                      <br />
                      <span className="text-muted-foreground">عنوان</span>
                    </TableCell>
                    <TableCell>{companyInfo.address || "-"}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <div>
              <h3 className="font-bold mb-2">&nbsp;</h3>
              <Table>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium w-1/2">
                      {tr("vatReturnPeriod")}
                      <br />
                      <span className="text-muted-foreground">فترة الإقرار الضريبي</span>
                    </TableCell>
                    <TableCell>
                      {periodInfo.periodStart} - {periodInfo.periodEnd}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">
                      {tr("vatStagger")}
                      <br />
                      <span className="text-muted-foreground">الفترة الضريبية</span>
                    </TableCell>
                    <TableCell>{periodInfo.vatStagger || tr("quarterly")}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">
                      {tr("vatReturnDueDate")}
                      <br />
                      <span className="text-muted-foreground">تاريخ استحقاق الإقرار</span>
                    </TableCell>
                    <TableCell>{periodInfo.dueDate}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">
                      {tr("taxYearEnd")}
                      <br />
                      <span className="text-muted-foreground">نهاية السنة الضريبية</span>
                    </TableCell>
                    <TableCell>{periodInfo.taxYearEnd || "-"}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="bg-muted py-2">
          <CardTitle className="text-sm flex justify-between">
            <span>{tr("vatOnSalesAndAllOther")}</span>
            <span dir="rtl">ضريبة القيمة المضافة على المبيعات وجميع المخرجات الأخرى</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                {/* i18n-ignore: bilingual heading copied from the official FTA VAT 201 form */}
                <TableHead className="w-[40%]">Description / وصف</TableHead>
                <TableHead className="text-end w-[20%]">
                  {tr("amountAed")}
                  <br />
                  <span className="text-muted-foreground text-xs">المبلغ (درهم)</span>
                </TableHead>
                <TableHead className="text-end w-[20%]">
                  {tr("vatAmountAed")}
                  <br />
                  <span className="text-muted-foreground text-xs">قيمة الضريبة (درهم)</span>
                </TableHead>
                <TableHead className="text-end w-[20%]">
                  {tr("adjustmentAed")}
                  <br />
                  <span className="text-muted-foreground text-xs">تسوية (درهم)</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {EMIRATES.map((emirate) => (
                <Fragment key={emirate.key}>
                <TableRow>
                  <TableCell>
                    <span className="font-medium">{emirate.key}</span>{" "}
                    {tr("standardRatedSuppliesIn", { en: emirate.en })}
                    <br />
                    <span className="text-muted-foreground text-xs" dir="rtl">
                      التوريدات الخاضعة للنسبة الأساسية في {emirate.ar}
                    </span>
                  </TableCell>
                  <TableCell className="text-end">
                    <Input
                      type="number"
                      step="0.01"
                      className="text-end h-8"
                      value={(data as any)[`${emirate.prefix}Amount`] || ""}
                      onChange={(e) =>
                        handleFieldChange(
                          `${emirate.prefix}Amount` as keyof VAT201Data,
                          e.target.value
                        )
                      }
                      disabled={readOnly}
                      data-testid={`input-${emirate.prefix}-amount`}
                    />
                  </TableCell>
                  <TableCell className="text-end">
                    <Input
                      type="number"
                      step="0.01"
                      className="text-end h-8 bg-muted"
                      value={(data as any)[`${emirate.prefix}Vat`] || ""}
                      onChange={(e) =>
                        handleFieldChange(
                          `${emirate.prefix}Vat` as keyof VAT201Data,
                          e.target.value
                        )
                      }
                      disabled={readOnly}
                      data-testid={`input-${emirate.prefix}-vat`}
                    />
                  </TableCell>
                  <TableCell className="text-end">
                    <Input
                      type="number"
                      step="0.01"
                      className="text-end h-8"
                      value={(data as any)[`${emirate.prefix}Adj`] || ""}
                      onChange={(e) =>
                        handleFieldChange(
                          `${emirate.prefix}Adj` as keyof VAT201Data,
                          e.target.value
                        )
                      }
                      disabled={readOnly}
                      data-testid={`input-${emirate.prefix}-adj`}
                    />
                  </TableCell>
                </TableRow>
                <VatJournalLineRows lines={journalLines} boxes={[`${emirate.prefix}Amount`, `${emirate.prefix}Adj`]} />
                </Fragment>
              ))}

              <TableRow>
                <TableCell>
                  <span className="font-medium">2</span> {tr("taxRefundsProvidedToTourists")}
                  <br />
                  <span className="text-muted-foreground text-xs" dir="rtl">
                    المبالغ التي تم ردها للسياح
                  </span>
                </TableCell>
                <TableCell className="text-end">
                  <Input
                    type="number"
                    step="0.01"
                    className="text-end h-8"
                    value={data.box2TouristRefundAmount || ""}
                    onChange={(e) => handleFieldChange("box2TouristRefundAmount", e.target.value)}
                    disabled={readOnly}
                  />
                </TableCell>
                <TableCell className="text-end">
                  <Input
                    type="number"
                    step="0.01"
                    className="text-end h-8 bg-muted"
                    value={data.box2TouristRefundVat || ""}
                    onChange={(e) => handleFieldChange("box2TouristRefundVat", e.target.value)}
                    disabled={readOnly}
                  />
                </TableCell>
                <TableCell></TableCell>
              </TableRow>

              <TableRow>
                <TableCell>
                  <span className="font-medium">3</span> {tr("suppliesSubjectToTheReverseCharge")}
                  <br />
                  <span className="text-muted-foreground text-xs" dir="rtl">
                    تخضع التوريدات لأحكام الاحتساب العكسي
                  </span>
                </TableCell>
                <TableCell className="text-end">
                  <Input
                    type="number"
                    step="0.01"
                    className="text-end h-8"
                    value={data.box3ReverseChargeAmount || ""}
                    onChange={(e) => handleFieldChange("box3ReverseChargeAmount", e.target.value)}
                    disabled={readOnly}
                  />
                </TableCell>
                <TableCell className="text-end">
                  <Input
                    type="number"
                    step="0.01"
                    className="text-end h-8 bg-muted"
                    value={data.box3ReverseChargeVat || ""}
                    onChange={(e) => handleFieldChange("box3ReverseChargeVat", e.target.value)}
                    disabled={readOnly}
                  />
                </TableCell>
                <TableCell></TableCell>
              </TableRow>

              <TableRow>
                <TableCell>
                  <span className="font-medium">4</span> {tr("zeroRatedSupplies")}
                  <br />
                  <span className="text-muted-foreground text-xs" dir="rtl">
                    توريدات خاضعة للنسبة الصفرية
                  </span>
                </TableCell>
                <TableCell className="text-end">
                  <Input
                    type="number"
                    step="0.01"
                    className="text-end h-8"
                    value={data.box4ZeroRatedAmount || ""}
                    onChange={(e) => handleFieldChange("box4ZeroRatedAmount", e.target.value)}
                    disabled={readOnly}
                  />
                </TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
              </TableRow>

              <TableRow>
                <TableCell>
                  <span className="font-medium">5</span> {tr("exemptSupplies")}
                  <br />
                  <span className="text-muted-foreground text-xs" dir="rtl">
                    التوريدات المعفاة
                  </span>
                </TableCell>
                <TableCell className="text-end">
                  <Input
                    type="number"
                    step="0.01"
                    className="text-end h-8"
                    value={data.box5ExemptAmount || ""}
                    onChange={(e) => handleFieldChange("box5ExemptAmount", e.target.value)}
                    disabled={readOnly}
                  />
                </TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
              </TableRow>

              <TableRow>
                <TableCell>
                  <span className="font-medium">6</span> {tr("goodsImportedIntoTheUae")}
                  <br />
                  <span className="text-muted-foreground text-xs" dir="rtl">
                    البضائع الواردة إلى الدولة
                  </span>
                </TableCell>
                <TableCell className="text-end">
                  <Input
                    type="number"
                    step="0.01"
                    className="text-end h-8"
                    value={data.box6ImportsAmount || ""}
                    onChange={(e) => handleFieldChange("box6ImportsAmount", e.target.value)}
                    disabled={readOnly}
                  />
                </TableCell>
                <TableCell className="text-end">
                  <Input
                    type="number"
                    step="0.01"
                    className="text-end h-8 bg-muted"
                    value={data.box6ImportsVat || ""}
                    onChange={(e) => handleFieldChange("box6ImportsVat", e.target.value)}
                    disabled={readOnly}
                  />
                </TableCell>
                <TableCell></TableCell>
              </TableRow>

              <TableRow>
                <TableCell>
                  <span className="font-medium">7</span> {tr("adjustmentsToGoodsImportedIntoThe")}
                  <br />
                  <span className="text-muted-foreground text-xs" dir="rtl">
                    تسوية على البضائع المستوردة
                  </span>
                </TableCell>
                <TableCell className="text-end">
                  <Input
                    type="number"
                    step="0.01"
                    className="text-end h-8"
                    value={data.box7ImportsAdjAmount || ""}
                    onChange={(e) => handleFieldChange("box7ImportsAdjAmount", e.target.value)}
                    disabled={readOnly}
                  />
                </TableCell>
                <TableCell className="text-end">
                  <Input
                    type="number"
                    step="0.01"
                    className="text-end h-8 bg-muted"
                    value={data.box7ImportsAdjVat || ""}
                    onChange={(e) => handleFieldChange("box7ImportsAdjVat", e.target.value)}
                    disabled={readOnly}
                  />
                </TableCell>
                <TableCell></TableCell>
              </TableRow>

              <TableRow className="bg-muted/50 font-bold">
                <TableCell>
                  <span className="font-medium">8</span> {tr("totals")}
                  <br />
                  <span className="text-muted-foreground text-xs" dir="rtl">
                    المجموع
                  </span>
                </TableCell>
                <TableCell className="text-end">
                  {formatNumber(calculateTotalSalesAmount())}
                </TableCell>
                <TableCell className="text-end">{formatNumber(calculateTotalSalesVat())}</TableCell>
                <TableCell className="text-end">{formatNumber(calculateTotalSalesAdj())}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="bg-muted py-2">
          <CardTitle className="text-sm flex justify-between">
            <span>{tr("vatOnExpensesAndAllOther")}</span>
            <span dir="rtl">ضريبة القيمة المضافة على المصروفات وجميع المدخلات الأخرى</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                {/* i18n-ignore: bilingual heading copied from the official FTA VAT 201 form */}
                <TableHead className="w-[40%]">Description / وصف</TableHead>
                <TableHead className="text-end w-[20%]">
                  {tr("amountAed")}
                  <br />
                  <span className="text-muted-foreground text-xs">المبلغ (درهم)</span>
                </TableHead>
                <TableHead className="text-end w-[20%]">
                  {tr("vatAmountAed")}
                  <br />
                  <span className="text-muted-foreground text-xs">قيمة الضريبة (درهم)</span>
                </TableHead>
                <TableHead className="text-end w-[20%]">
                  {tr("adjustmentAed")}
                  <br />
                  <span className="text-muted-foreground text-xs">تسوية (درهم)</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>
                  <span className="font-medium">9</span> {tr("standardRatedExpenses")}
                  <br />
                  <span className="text-muted-foreground text-xs" dir="rtl">
                    النفقات الخاضعة للنسبة الأساسية
                  </span>
                </TableCell>
                <TableCell className="text-end">
                  <Input
                    type="number"
                    step="0.01"
                    className="text-end h-8"
                    value={data.box9ExpensesAmount || ""}
                    onChange={(e) => handleFieldChange("box9ExpensesAmount", e.target.value)}
                    disabled={readOnly}
                  />
                </TableCell>
                <TableCell className="text-end">
                  <Input
                    type="number"
                    step="0.01"
                    className="text-end h-8 bg-muted"
                    value={data.box9ExpensesVat || ""}
                    onChange={(e) => handleFieldChange("box9ExpensesVat", e.target.value)}
                    disabled={readOnly}
                  />
                </TableCell>
                <TableCell className="text-end">
                  <Input
                    type="number"
                    step="0.01"
                    className="text-end h-8"
                    value={data.box9ExpensesAdj || ""}
                    onChange={(e) => handleFieldChange("box9ExpensesAdj", e.target.value)}
                    disabled={readOnly}
                  />
                </TableCell>
              </TableRow>
              <VatJournalLineRows lines={journalLines} boxes={["box9ExpensesAmount", "box9ExpensesAdj"]} />

              <TableRow>
                <TableCell>
                  <span className="font-medium">10</span> {tr("suppliesSubjectToTheReverseCharge")}
                  <br />
                  <span className="text-muted-foreground text-xs" dir="rtl">
                    تخضع التوريدات لأحكام الاحتساب العكسي
                  </span>
                </TableCell>
                <TableCell className="text-end">
                  <Input
                    type="number"
                    step="0.01"
                    className="text-end h-8"
                    value={data.box10ReverseChargeAmount || ""}
                    onChange={(e) => handleFieldChange("box10ReverseChargeAmount", e.target.value)}
                    disabled={readOnly}
                  />
                </TableCell>
                <TableCell className="text-end">
                  <Input
                    type="number"
                    step="0.01"
                    className="text-end h-8 bg-muted"
                    value={data.box10ReverseChargeVat || ""}
                    onChange={(e) => handleFieldChange("box10ReverseChargeVat", e.target.value)}
                    disabled={readOnly}
                  />
                </TableCell>
                <TableCell></TableCell>
              </TableRow>

              <TableRow className="bg-muted/50 font-bold">
                <TableCell>
                  <span className="font-medium">11</span> {tr("totals")}
                  <br />
                  <span className="text-muted-foreground text-xs" dir="rtl">
                    المجموع
                  </span>
                </TableCell>
                <TableCell className="text-end">
                  {formatNumber(calculateTotalInputAmount())}
                </TableCell>
                <TableCell className="text-end">{formatNumber(calculateTotalInputVat())}</TableCell>
                <TableCell className="text-end">{formatNumber(calculateTotalInputAdj())}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-accent/40 bg-accent/[0.03]">
        <CardHeader className="bg-success-subtle py-2">
          <CardTitle className="text-sm flex justify-between text-success-subtle-foreground ">
            <span>{tr("netVatDue")}</span>
            <span dir="rtl">صافي ضريبة القيمة المضافة المستحقة</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <Table>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">
                  <span className="font-bold">12</span> {tr("totalValueOfDueTaxFor")}
                  <br />
                  <span className="text-muted-foreground text-xs" dir="rtl">
                    إجمالي قيمة الضريبة المستحقة للفترة
                  </span>
                </TableCell>
                <TableCell className="text-end text-lg font-bold" data-testid="vat201-box12">
                  {formatNumber(calculateDueTax())}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">
                  <span className="font-bold">13</span> {tr("totalValueOfRecoverableTaxFor")}
                  <br />
                  <span className="text-muted-foreground text-xs" dir="rtl">
                    إجمالي قيمة الضريبة القابلة للاسترداد
                  </span>
                </TableCell>
                <TableCell className="text-end text-lg font-bold" data-testid="vat201-box13">
                  {formatNumber(calculateRecoverableTax())}
                </TableCell>
              </TableRow>
              <TableRow className="bg-success-subtle ">
                <TableCell className="font-bold">
                  <span className="font-bold">14</span> {tr("payableTaxForThePeriod")}
                  <br />
                  <span className="text-muted-foreground text-xs" dir="rtl">
                    الضريبة المستحقة الدفع للفترة
                  </span>
                </TableCell>
                <TableCell
                  className={`text-end text-xl font-bold ${calculateNetVat() >= 0 ? "text-destructive" : "text-success"}`}
                  data-testid="vat201-box14"
                >
                  {calculateNetVat() >= 0 ? "" : "("}
                  {formatNumber(Math.abs(calculateNetVat()))}
                  {calculateNetVat() >= 0 ? "" : ")"}
                  <span className="text-xs ms-2 font-normal text-muted-foreground">
                    {/* i18n-ignore: bilingual label from the official FTA VAT 201 form */}
                    {calculateNetVat() >= 0 ? "Payable / مستحق الدفع" : "Refundable / مسترد"}
                  </span>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground text-center p-4 border-t">
        <p data-testid="vat201-worksheet-notice">{tr("thisIsASystemGeneratedDocument")}</p>
      </div>
    </div>
  );
}
