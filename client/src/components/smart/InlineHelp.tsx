import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { HelpCircle, Lightbulb, BookOpen, ChevronRight } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface InlineHelpProps {
  title: string;
  titleAr?: string;
  content: string;
  contentAr?: string;
  tips?: string[];
  tipsAr?: string[];
  example?: string;
  exampleAr?: string;
  learnMoreUrl?: string;
  variant?: 'icon' | 'badge' | 'inline';
  className?: string;
}

export function InlineHelp({
  title,
  titleAr,
  content,
  contentAr,
  tips,
  tipsAr,
  example,
  exampleAr,
  learnMoreUrl,
  variant = 'icon',
  className,
}: InlineHelpProps) {
  const { locale } = useTranslation();
  const [open, setOpen] = useState(false);

  const displayTitle = locale === 'ar' && titleAr ? titleAr : title;
  const displayContent = locale === 'ar' && contentAr ? contentAr : content;
  const displayTips = locale === 'ar' && tipsAr ? tipsAr : tips;
  const displayExample = locale === 'ar' && exampleAr ? exampleAr : example;

  const helpContent = (
    <div className="space-y-3 max-w-xs">
      <div>
        <h4 className="font-medium text-sm mb-1">{displayTitle}</h4>
        <p className="text-sm text-muted-foreground">{displayContent}</p>
      </div>

      {displayTips && displayTips.length > 0 && (
        <div>
          <div className="flex items-center gap-1 text-xs font-medium text-yellow-600 dark:text-yellow-400 mb-1">
            <Lightbulb className="w-3 h-3" />
            <span>{locale === 'ar' ? 'نصائح' : 'Tips'}</span>
          </div>
          <ul className="space-y-1">
            {displayTips.map((tip, i) => (
              <li key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                <ChevronRight className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {displayExample && (
        <div>
          <div className="flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 mb-1">
            <BookOpen className="w-3 h-3" />
            <span>{locale === 'ar' ? 'مثال' : 'Example'}</span>
          </div>
          <p className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
            {displayExample}
          </p>
        </div>
      )}

      {learnMoreUrl && (
        <a 
          href={learnMoreUrl} 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          {locale === 'ar' ? 'اعرف المزيد' : 'Learn more'}
          <ChevronRight className="w-3 h-3" />
        </a>
      )}
    </div>
  );

  if (variant === 'icon') {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-6 w-6 text-muted-foreground hover:text-foreground", className)}
            type="button"
          >
            <HelpCircle className="w-4 h-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent side="right" align="start" className="w-80">
          {helpContent}
        </PopoverContent>
      </Popover>
    );
  }

  if (variant === 'badge') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant="secondary" 
            className={cn("cursor-help text-xs", className)}
          >
            <HelpCircle className="w-3 h-3 mr-1" />
            {locale === 'ar' ? 'مساعدة' : 'Help'}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="w-80 p-3">
          {helpContent}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className={cn("text-xs text-muted-foreground flex items-start gap-1", className)}>
      <HelpCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
      <span>{displayContent}</span>
    </div>
  );
}

export const helpContent = {
  invoice: {
    customerName: {
      title: 'Customer Name',
      titleAr: 'اسم العميل',
      content: 'Enter the full legal name of the customer or company.',
      contentAr: 'أدخل الاسم القانوني الكامل للعميل أو الشركة.',
      tips: [
        'Use the registered business name for B2B invoices',
        'Autocomplete suggests previously used customers',
      ],
      tipsAr: [
        'استخدم اسم الشركة المسجل للفواتير التجارية',
        'الإكمال التلقائي يقترح العملاء المستخدمين سابقاً',
      ],
    },
    customerTRN: {
      title: 'Tax Registration Number (TRN)',
      titleAr: 'رقم التسجيل الضريبي',
      content: 'The 15-digit UAE Tax Registration Number for VAT registered businesses.',
      contentAr: 'رقم التسجيل الضريبي المكون من 15 رقماً للشركات المسجلة في ضريبة القيمة المضافة.',
      tips: [
        'Required for VAT-registered businesses',
        'Format: 100XXXXXXXXXXX (15 digits)',
      ],
      tipsAr: [
        'مطلوب للشركات المسجلة في الضريبة',
        'التنسيق: 100XXXXXXXXXXX (15 رقم)',
      ],
      example: '100123456789012',
    },
    vat: {
      title: 'VAT (Value Added Tax)',
      titleAr: 'ضريبة القيمة المضافة',
      content: 'UAE VAT is calculated at 5% of the subtotal amount.',
      contentAr: 'يتم احتساب ضريبة القيمة المضافة في الإمارات بنسبة 5% من المجموع الفرعي.',
      tips: [
        'VAT is automatically calculated',
        'Report and pay VAT quarterly to FTA',
      ],
      tipsAr: [
        'يتم احتساب الضريبة تلقائياً',
        'قم بالإبلاغ ودفع الضريبة فصلياً للهيئة الاتحادية للضرائب',
      ],
    },
  },
  expense: {
    merchant: {
      title: 'Merchant / Vendor',
      titleAr: 'التاجر / المورد',
      content: 'The business name where the expense was made.',
      contentAr: 'اسم الشركة التي تم فيها الإنفاق.',
      tips: [
        'Autocomplete suggests previously used merchants',
        'AI will learn your categorization patterns',
      ],
      tipsAr: [
        'الإكمال التلقائي يقترح التجار المستخدمين سابقاً',
        'الذكاء الاصطناعي سيتعلم أنماط التصنيف الخاصة بك',
      ],
    },
    category: {
      title: 'Expense Category',
      titleAr: 'فئة المصروفات',
      content: 'Categorize the expense for proper accounting and reporting.',
      contentAr: 'صنف المصروف للمحاسبة والتقارير الصحيحة.',
      tips: [
        'Categories help in expense analysis',
        'AI can suggest categories based on merchant',
      ],
      tipsAr: [
        'الفئات تساعد في تحليل المصروفات',
        'الذكاء الاصطناعي يمكنه اقتراح فئات بناءً على التاجر',
      ],
    },
  },
  journal: {
    debitCredit: {
      title: 'Debit & Credit',
      titleAr: 'مدين ودائن',
      content: 'Double-entry bookkeeping requires debits to equal credits.',
      contentAr: 'القيد المزدوج يتطلب أن تتساوى المدين مع الدائن.',
      tips: [
        'Assets increase with debits',
        'Liabilities increase with credits',
        'Revenue increases with credits',
        'Expenses increase with debits',
      ],
      tipsAr: [
        'الأصول تزيد بالمدين',
        'الخصوم تزيد بالدائن',
        'الإيرادات تزيد بالدائن',
        'المصروفات تزيد بالمدين',
      ],
    },
    memo: {
      title: 'Memo / Description',
      titleAr: 'الملاحظة / الوصف',
      content: 'A brief description of the transaction for future reference.',
      contentAr: 'وصف موجز للمعاملة للرجوع إليها مستقبلاً.',
      tips: [
        'Include invoice numbers for easy reference',
        'Autocomplete suggests previously used descriptions',
      ],
      tipsAr: [
        'أضف أرقام الفواتير للرجوع إليها بسهولة',
        'الإكمال التلقائي يقترح الأوصاف المستخدمة سابقاً',
      ],
      example: 'Office supplies purchase - INV-2024-001',
      exampleAr: 'شراء مستلزمات مكتبية - INV-2024-001',
    },
  },
  account: {
    type: {
      title: 'Account Type',
      titleAr: 'نوع الحساب',
      content: 'The category of the account in the chart of accounts.',
      contentAr: 'فئة الحساب في دليل الحسابات.',
      tips: [
        'Assets: Things you own (cash, inventory)',
        'Liabilities: What you owe (loans, payables)',
        'Equity: Owner investment and retained earnings',
        'Income: Revenue from sales and services',
        'Expenses: Costs of running the business',
      ],
      tipsAr: [
        'الأصول: ما تملكه (النقد، المخزون)',
        'الخصوم: ما تدين به (القروض، الذمم الدائنة)',
        'حقوق الملكية: استثمار المالك والأرباح المحتجزة',
        'الإيرادات: العوائد من المبيعات والخدمات',
        'المصروفات: تكاليف تشغيل الأعمال',
      ],
    },
  },
};
