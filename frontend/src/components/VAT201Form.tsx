import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { useTranslation } from '@/lib/i18n';

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
}

const EMIRATES = [
  { key: '1a', en: 'Abu Dhabi', ar: 'أبو ظبي', prefix: 'box1aAbuDhabi' },
  { key: '1b', en: 'Dubai', ar: 'دبي', prefix: 'box1bDubai' },
  { key: '1c', en: 'Sharjah', ar: 'الشارقة', prefix: 'box1cSharjah' },
  { key: '1d', en: 'Ajman', ar: 'عجمان', prefix: 'box1dAjman' },
  { key: '1e', en: 'Umm Al Quwain', ar: 'أم القيوين', prefix: 'box1eUmmAlQuwain' },
  { key: '1f', en: 'Ras Al Khaimah', ar: 'رأس الخيمة', prefix: 'box1fRasAlKhaimah' },
  { key: '1g', en: 'Fujairah', ar: 'الفجيرة', prefix: 'box1gFujairah' },
];

export default function VAT201Form({ data, onChange, companyInfo, periodInfo, readOnly = false }: Props) {
  const { locale } = useTranslation();
  
  const formatNumber = (num: number) => num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  
  const handleFieldChange = (field: keyof VAT201Data, value: string) => {
    const numValue = parseFloat(value) || 0;
    const newData = { ...data, [field]: numValue };
    
    if (field.endsWith('Amount') && !field.includes('ZeroRated') && !field.includes('Exempt')) {
      const vatField = field.replace('Amount', 'Vat') as keyof VAT201Data;
      if (vatField in newData) {
        (newData as any)[vatField] = numValue * 0.05;
      }
    }
    
    onChange(newData);
  };
  
  const calculateTotalSalesAmount = () => {
    return EMIRATES.reduce((sum, e) => sum + (data as any)[`${e.prefix}Amount`], 0) +
      data.box2TouristRefundAmount +
      data.box3ReverseChargeAmount +
      data.box4ZeroRatedAmount +
      data.box5ExemptAmount +
      data.box6ImportsAmount +
      data.box7ImportsAdjAmount;
  };
  
  const calculateTotalSalesVat = () => {
    return EMIRATES.reduce((sum, e) => sum + (data as any)[`${e.prefix}Vat`], 0) +
      data.box2TouristRefundVat +
      data.box3ReverseChargeVat +
      data.box6ImportsVat +
      data.box7ImportsAdjVat;
  };
  
  const calculateTotalSalesAdj = () => {
    return EMIRATES.reduce((sum, e) => sum + (data as any)[`${e.prefix}Adj`], 0);
  };
  
  const calculateTotalInputVat = () => {
    return data.box9ExpensesVat + data.box10ReverseChargeVat;
  };
  
  const calculateNetVat = () => {
    return calculateTotalSalesVat() - calculateTotalInputVat();
  };

  return (
    <div className="space-y-6 font-mono text-sm">
      <Card className="border-2">
        <CardHeader className="bg-gradient-to-r from-green-800 to-green-600 text-white py-3">
          <CardTitle className="text-center text-lg">
            <div className="flex justify-between items-center">
              <span>VAT 201 Return</span>
              <span dir="rtl">إقرار ضريبة القيمة المضافة</span>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <h3 className="font-bold mb-2">Taxpayer Information / معلومات دافعي الضرائب</h3>
              <Table>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium w-1/3">TRN<br/><span className="text-muted-foreground">رقم تسجيل الضريبة</span></TableCell>
                    <TableCell>{companyInfo.trnNumber || 'N/A'}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Legal Name (English)<br/><span className="text-muted-foreground">الاسم القانوني للكيان بالإنجليزية</span></TableCell>
                    <TableCell>{companyInfo.nameEn}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Legal Name (Arabic)<br/><span className="text-muted-foreground">الاسم القانوني للكيان بالعربية</span></TableCell>
                    <TableCell dir="rtl">{companyInfo.nameAr || '-'}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Address<br/><span className="text-muted-foreground">عنوان</span></TableCell>
                    <TableCell>{companyInfo.address || '-'}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <div>
              <h3 className="font-bold mb-2">&nbsp;</h3>
              <Table>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium w-1/2">VAT Return Period<br/><span className="text-muted-foreground">فترة الإقرار الضريبي</span></TableCell>
                    <TableCell>{periodInfo.periodStart} - {periodInfo.periodEnd}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">VAT Stagger<br/><span className="text-muted-foreground">الفترة الضريبية</span></TableCell>
                    <TableCell>{periodInfo.vatStagger || 'Quarterly'}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">VAT Return Due Date<br/><span className="text-muted-foreground">تاريخ استحقاق الإقرار</span></TableCell>
                    <TableCell>{periodInfo.dueDate}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Tax Year End<br/><span className="text-muted-foreground">نهاية السنة الضريبية</span></TableCell>
                    <TableCell>{periodInfo.taxYearEnd || '-'}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>
      
      <Card className="border-2">
        <CardHeader className="bg-muted py-2">
          <CardTitle className="text-sm flex justify-between">
            <span>VAT on Sales and All Other Outputs</span>
            <span dir="rtl">ضريبة القيمة المضافة على المبيعات وجميع المخرجات الأخرى</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-[40%]">Description / وصف</TableHead>
                <TableHead className="text-right w-[20%]">Amount (AED)<br/><span className="text-muted-foreground text-xs">المبلغ (درهم)</span></TableHead>
                <TableHead className="text-right w-[20%]">VAT Amount (AED)<br/><span className="text-muted-foreground text-xs">قيمة الضريبة (درهم)</span></TableHead>
                <TableHead className="text-right w-[20%]">Adjustment (AED)<br/><span className="text-muted-foreground text-xs">تسوية (درهم)</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {EMIRATES.map((emirate) => (
                <TableRow key={emirate.key}>
                  <TableCell>
                    <span className="font-medium">{emirate.key}</span> Standard Rated Supplies in {emirate.en}
                    <br/><span className="text-muted-foreground text-xs" dir="rtl">التوريدات الخاضعة للنسبة الأساسية في {emirate.ar}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      step="0.01"
                      className="text-right h-8"
                      value={(data as any)[`${emirate.prefix}Amount`] || ''}
                      onChange={(e) => handleFieldChange(`${emirate.prefix}Amount` as keyof VAT201Data, e.target.value)}
                      disabled={readOnly}
                      data-testid={`input-${emirate.prefix}-amount`}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      step="0.01"
                      className="text-right h-8 bg-muted"
                      value={(data as any)[`${emirate.prefix}Vat`] || ''}
                      onChange={(e) => handleFieldChange(`${emirate.prefix}Vat` as keyof VAT201Data, e.target.value)}
                      disabled={readOnly}
                      data-testid={`input-${emirate.prefix}-vat`}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      step="0.01"
                      className="text-right h-8"
                      value={(data as any)[`${emirate.prefix}Adj`] || ''}
                      onChange={(e) => handleFieldChange(`${emirate.prefix}Adj` as keyof VAT201Data, e.target.value)}
                      disabled={readOnly}
                      data-testid={`input-${emirate.prefix}-adj`}
                    />
                  </TableCell>
                </TableRow>
              ))}
              
              <TableRow>
                <TableCell>
                  <span className="font-medium">2</span> Tax Refunds provided to Tourists
                  <br/><span className="text-muted-foreground text-xs" dir="rtl">المبالغ التي تم ردها للسياح</span>
                </TableCell>
                <TableCell className="text-right">
                  <Input type="number" step="0.01" className="text-right h-8" value={data.box2TouristRefundAmount || ''} onChange={(e) => handleFieldChange('box2TouristRefundAmount', e.target.value)} disabled={readOnly} />
                </TableCell>
                <TableCell className="text-right">
                  <Input type="number" step="0.01" className="text-right h-8 bg-muted" value={data.box2TouristRefundVat || ''} onChange={(e) => handleFieldChange('box2TouristRefundVat', e.target.value)} disabled={readOnly} />
                </TableCell>
                <TableCell></TableCell>
              </TableRow>
              
              <TableRow>
                <TableCell>
                  <span className="font-medium">3</span> Supplies subject to the reverse charge provisions
                  <br/><span className="text-muted-foreground text-xs" dir="rtl">تخضع التوريدات لأحكام الاحتساب العكسي</span>
                </TableCell>
                <TableCell className="text-right">
                  <Input type="number" step="0.01" className="text-right h-8" value={data.box3ReverseChargeAmount || ''} onChange={(e) => handleFieldChange('box3ReverseChargeAmount', e.target.value)} disabled={readOnly} />
                </TableCell>
                <TableCell className="text-right">
                  <Input type="number" step="0.01" className="text-right h-8 bg-muted" value={data.box3ReverseChargeVat || ''} onChange={(e) => handleFieldChange('box3ReverseChargeVat', e.target.value)} disabled={readOnly} />
                </TableCell>
                <TableCell></TableCell>
              </TableRow>
              
              <TableRow>
                <TableCell>
                  <span className="font-medium">4</span> Zero Rated Supplies
                  <br/><span className="text-muted-foreground text-xs" dir="rtl">توريدات خاضعة للنسبة الصفرية</span>
                </TableCell>
                <TableCell className="text-right">
                  <Input type="number" step="0.01" className="text-right h-8" value={data.box4ZeroRatedAmount || ''} onChange={(e) => handleFieldChange('box4ZeroRatedAmount', e.target.value)} disabled={readOnly} />
                </TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
              </TableRow>
              
              <TableRow>
                <TableCell>
                  <span className="font-medium">5</span> Exempt Supplies
                  <br/><span className="text-muted-foreground text-xs" dir="rtl">التوريدات المعفاة</span>
                </TableCell>
                <TableCell className="text-right">
                  <Input type="number" step="0.01" className="text-right h-8" value={data.box5ExemptAmount || ''} onChange={(e) => handleFieldChange('box5ExemptAmount', e.target.value)} disabled={readOnly} />
                </TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
              </TableRow>
              
              <TableRow>
                <TableCell>
                  <span className="font-medium">6</span> Goods imported into the UAE
                  <br/><span className="text-muted-foreground text-xs" dir="rtl">البضائع الواردة إلى الدولة</span>
                </TableCell>
                <TableCell className="text-right">
                  <Input type="number" step="0.01" className="text-right h-8" value={data.box6ImportsAmount || ''} onChange={(e) => handleFieldChange('box6ImportsAmount', e.target.value)} disabled={readOnly} />
                </TableCell>
                <TableCell className="text-right">
                  <Input type="number" step="0.01" className="text-right h-8 bg-muted" value={data.box6ImportsVat || ''} onChange={(e) => handleFieldChange('box6ImportsVat', e.target.value)} disabled={readOnly} />
                </TableCell>
                <TableCell></TableCell>
              </TableRow>
              
              <TableRow>
                <TableCell>
                  <span className="font-medium">7</span> Adjustments to goods imported into the UAE
                  <br/><span className="text-muted-foreground text-xs" dir="rtl">تسوية على البضائع المستوردة</span>
                </TableCell>
                <TableCell className="text-right">
                  <Input type="number" step="0.01" className="text-right h-8" value={data.box7ImportsAdjAmount || ''} onChange={(e) => handleFieldChange('box7ImportsAdjAmount', e.target.value)} disabled={readOnly} />
                </TableCell>
                <TableCell className="text-right">
                  <Input type="number" step="0.01" className="text-right h-8 bg-muted" value={data.box7ImportsAdjVat || ''} onChange={(e) => handleFieldChange('box7ImportsAdjVat', e.target.value)} disabled={readOnly} />
                </TableCell>
                <TableCell></TableCell>
              </TableRow>
              
              <TableRow className="bg-muted/50 font-bold">
                <TableCell>
                  <span className="font-medium">8</span> Totals
                  <br/><span className="text-muted-foreground text-xs" dir="rtl">المجموع</span>
                </TableCell>
                <TableCell className="text-right">{formatNumber(calculateTotalSalesAmount())}</TableCell>
                <TableCell className="text-right">{formatNumber(calculateTotalSalesVat())}</TableCell>
                <TableCell className="text-right">{formatNumber(calculateTotalSalesAdj())}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      
      <Card className="border-2">
        <CardHeader className="bg-muted py-2">
          <CardTitle className="text-sm flex justify-between">
            <span>VAT on Expenses and All Other Inputs</span>
            <span dir="rtl">ضريبة القيمة المضافة على المصروفات وجميع المدخلات الأخرى</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-[40%]">Description / وصف</TableHead>
                <TableHead className="text-right w-[20%]">Amount (AED)<br/><span className="text-muted-foreground text-xs">المبلغ (درهم)</span></TableHead>
                <TableHead className="text-right w-[20%]">VAT Amount (AED)<br/><span className="text-muted-foreground text-xs">قيمة الضريبة (درهم)</span></TableHead>
                <TableHead className="text-right w-[20%]">Adjustment (AED)<br/><span className="text-muted-foreground text-xs">تسوية (درهم)</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>
                  <span className="font-medium">9</span> Standard Rated Expenses
                  <br/><span className="text-muted-foreground text-xs" dir="rtl">النفقات الخاضعة للنسبة الأساسية</span>
                </TableCell>
                <TableCell className="text-right">
                  <Input type="number" step="0.01" className="text-right h-8" value={data.box9ExpensesAmount || ''} onChange={(e) => handleFieldChange('box9ExpensesAmount', e.target.value)} disabled={readOnly} />
                </TableCell>
                <TableCell className="text-right">
                  <Input type="number" step="0.01" className="text-right h-8 bg-muted" value={data.box9ExpensesVat || ''} onChange={(e) => handleFieldChange('box9ExpensesVat', e.target.value)} disabled={readOnly} />
                </TableCell>
                <TableCell className="text-right">
                  <Input type="number" step="0.01" className="text-right h-8" value={data.box9ExpensesAdj || ''} onChange={(e) => handleFieldChange('box9ExpensesAdj', e.target.value)} disabled={readOnly} />
                </TableCell>
              </TableRow>
              
              <TableRow>
                <TableCell>
                  <span className="font-medium">10</span> Supplies subject to the reverse charge provisions
                  <br/><span className="text-muted-foreground text-xs" dir="rtl">تخضع التوريدات لأحكام الاحتساب العكسي</span>
                </TableCell>
                <TableCell className="text-right">
                  <Input type="number" step="0.01" className="text-right h-8" value={data.box10ReverseChargeAmount || ''} onChange={(e) => handleFieldChange('box10ReverseChargeAmount', e.target.value)} disabled={readOnly} />
                </TableCell>
                <TableCell className="text-right">
                  <Input type="number" step="0.01" className="text-right h-8 bg-muted" value={data.box10ReverseChargeVat || ''} onChange={(e) => handleFieldChange('box10ReverseChargeVat', e.target.value)} disabled={readOnly} />
                </TableCell>
                <TableCell></TableCell>
              </TableRow>
              
              <TableRow className="bg-muted/50 font-bold">
                <TableCell>
                  <span className="font-medium">11</span> Totals
                  <br/><span className="text-muted-foreground text-xs" dir="rtl">المجموع</span>
                </TableCell>
                <TableCell className="text-right">{formatNumber(data.box9ExpensesAmount + data.box10ReverseChargeAmount)}</TableCell>
                <TableCell className="text-right">{formatNumber(calculateTotalInputVat())}</TableCell>
                <TableCell className="text-right">{formatNumber(data.box9ExpensesAdj)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      
      <Card className="border-2 border-green-600">
        <CardHeader className="bg-green-50 dark:bg-green-900/20 py-2">
          <CardTitle className="text-sm flex justify-between text-green-800 dark:text-green-200">
            <span>Net VAT Due</span>
            <span dir="rtl">صافي ضريبة القيمة المضافة المستحقة</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <Table>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">
                  <span className="font-bold">12</span> Total value of due tax for the period
                  <br/><span className="text-muted-foreground text-xs" dir="rtl">إجمالي قيمة الضريبة المستحقة للفترة</span>
                </TableCell>
                <TableCell className="text-right text-lg font-bold">{formatNumber(calculateTotalSalesVat())}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">
                  <span className="font-bold">13</span> Total value of recoverable tax for the period
                  <br/><span className="text-muted-foreground text-xs" dir="rtl">إجمالي قيمة الضريبة القابلة للاسترداد</span>
                </TableCell>
                <TableCell className="text-right text-lg font-bold">{formatNumber(calculateTotalInputVat())}</TableCell>
              </TableRow>
              <TableRow className="bg-green-100 dark:bg-green-900/40">
                <TableCell className="font-bold">
                  <span className="font-bold">14</span> Payable Tax for the period
                  <br/><span className="text-muted-foreground text-xs" dir="rtl">الضريبة المستحقة الدفع للفترة</span>
                </TableCell>
                <TableCell className={`text-right text-xl font-bold ${calculateNetVat() >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {calculateNetVat() >= 0 ? '' : '('}{formatNumber(Math.abs(calculateNetVat()))}{calculateNetVat() >= 0 ? '' : ')'}
                  <span className="text-xs ml-2 font-normal text-muted-foreground">
                    {calculateNetVat() >= 0 ? 'Payable / مستحق الدفع' : 'Refundable / مسترد'}
                  </span>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      
      <div className="text-xs text-muted-foreground text-center p-4 border-t">
        <p>www.tax.gov.ae | @uaetax</p>
        <p className="mt-1">Federal Authority | هيئة اتحادية</p>
        <p className="mt-2">
          This is a system generated document and does not need to be signed. The Taxpayer is solely responsible for the usage of this document.
          <br/>
          <span dir="rtl">هذه وثيقة تم إنشاؤها بواسطة النظام ولا تحتاج إلى التوقيع. دافع الضرائب هو المسؤول الوحيد عن استخدام هذه الوثيقة.</span>
        </p>
      </div>
    </div>
  );
}
