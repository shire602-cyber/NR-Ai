import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { HelpCircle, Lightbulb, BookOpen, ChevronRight } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { messages as pageMessages } from "./InlineHelp.i18n";

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
  variant?: "icon" | "badge" | "inline";
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
  variant = "icon",
  className,
}: InlineHelpProps) {
  const tr = pageMessages.useT();

  const { locale } = useTranslation();
  const [open, setOpen] = useState(false);

  const displayTitle = locale === "ar" && titleAr ? titleAr : title;
  const displayContent = locale === "ar" && contentAr ? contentAr : content;
  const displayTips = locale === "ar" && tipsAr ? tipsAr : tips;
  const displayExample = locale === "ar" && exampleAr ? exampleAr : example;

  const helpContent = (
    <div className="space-y-3 max-w-xs">
      <div>
        <h4 className="font-medium text-sm mb-1">{displayTitle}</h4>
        <p className="text-sm text-muted-foreground">{displayContent}</p>
      </div>

      {displayTips && displayTips.length > 0 && (
        <div>
          <div className="flex items-center gap-1 text-xs font-medium text-warning mb-1">
            <Lightbulb className="w-3 h-3" />
            <span>{tr("tips")}</span>
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
          <div className="flex items-center gap-1 text-xs font-medium text-info mb-1">
            <BookOpen className="w-3 h-3" />
            <span>{tr("example")}</span>
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
          {tr("learnMore")}
          <ChevronRight className="w-3 h-3" />
        </a>
      )}
    </div>
  );

  if (variant === "icon") {
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

  if (variant === "badge") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="secondary" className={cn("cursor-help text-xs", className)}>
            <HelpCircle className="w-3 h-3 me-1" />
            {tr("help")}
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
      title: pageMessages.t("customerName"),
      titleAr: "اسم العميل",
      content: pageMessages.t("enterTheFullLegalNameOf"),
      contentAr: "أدخل الاسم القانوني الكامل للعميل أو الشركة.",
      tips: [
        pageMessages.t("useTheRegisteredBusinessNameFor"),
        pageMessages.t("autocompleteSuggestsPreviouslyUsedCustomers"),
      ],
      tipsAr: [
        "استخدم اسم الشركة المسجل للفواتير التجارية",
        "الإكمال التلقائي يقترح العملاء المستخدمين سابقاً",
      ],
    },
    customerTRN: {
      title: pageMessages.t("taxRegistrationNumberTrn"),
      titleAr: "رقم التسجيل الضريبي",
      content: pageMessages.t("the15DigitUaeTaxRegistration"),
      contentAr: "رقم التسجيل الضريبي المكون من 15 رقماً للشركات المسجلة في ضريبة القيمة المضافة.",
      tips: [
        pageMessages.t("requiredForVatRegisteredBusinesses"),
        pageMessages.t("format100xxxxxxxxxxx15Digits"),
      ],
      tipsAr: ["مطلوب للشركات المسجلة في الضريبة", "التنسيق: 100XXXXXXXXXXX (15 رقم)"],
      example: "100123456789012",
    },
    vat: {
      title: pageMessages.t("vatValueAddedTax"),
      titleAr: "ضريبة القيمة المضافة",
      content: pageMessages.t("uaeVatIsCalculatedAt5"),
      contentAr: "يتم احتساب ضريبة القيمة المضافة في الإمارات بنسبة 5% من المجموع الفرعي.",
      tips: [
        pageMessages.t("vatIsAutomaticallyCalculated"),
        pageMessages.t("reportAndPayVatQuarterlyTo"),
      ],
      tipsAr: [
        "يتم احتساب الضريبة تلقائياً",
        "قم بالإبلاغ ودفع الضريبة فصلياً للهيئة الاتحادية للضرائب",
      ],
    },
  },
  expense: {
    merchant: {
      title: pageMessages.t("merchantVendor"),
      titleAr: "التاجر / المورد",
      content: pageMessages.t("theBusinessNameWhereTheExpense"),
      contentAr: "اسم الشركة التي تم فيها الإنفاق.",
      tips: [
        pageMessages.t("autocompleteSuggestsPreviouslyUsedMerchants"),
        pageMessages.t("aiWillLearnYourCategorizationPatterns"),
      ],
      tipsAr: [
        "الإكمال التلقائي يقترح التجار المستخدمين سابقاً",
        "الذكاء الاصطناعي سيتعلم أنماط التصنيف الخاصة بك",
      ],
    },
    category: {
      title: pageMessages.t("expenseCategory"),
      titleAr: "فئة المصروفات",
      content: pageMessages.t("categorizeTheExpenseForProperAccounting"),
      contentAr: "صنف المصروف للمحاسبة والتقارير الصحيحة.",
      tips: [
        pageMessages.t("categoriesHelpInExpenseAnalysis"),
        pageMessages.t("aiCanSuggestCategoriesBasedOn"),
      ],
      tipsAr: [
        "الفئات تساعد في تحليل المصروفات",
        "الذكاء الاصطناعي يمكنه اقتراح فئات بناءً على التاجر",
      ],
    },
  },
  journal: {
    debitCredit: {
      title: pageMessages.t("debitCredit"),
      titleAr: "مدين ودائن",
      content: pageMessages.t("doubleEntryBookkeepingRequiresDebitsTo"),
      contentAr: "القيد المزدوج يتطلب أن تتساوى المدين مع الدائن.",
      tips: [
        pageMessages.t("assetsIncreaseWithDebits"),
        pageMessages.t("liabilitiesIncreaseWithCredits"),
        pageMessages.t("revenueIncreasesWithCredits"),
        pageMessages.t("expensesIncreaseWithDebits"),
      ],
      tipsAr: [
        "الأصول تزيد بالمدين",
        "الخصوم تزيد بالدائن",
        "الإيرادات تزيد بالدائن",
        "المصروفات تزيد بالمدين",
      ],
    },
    memo: {
      title: pageMessages.t("memoDescription"),
      titleAr: "الملاحظة / الوصف",
      content: pageMessages.t("aBriefDescriptionOfTheTransaction"),
      contentAr: "وصف موجز للمعاملة للرجوع إليها مستقبلاً.",
      tips: [
        pageMessages.t("includeInvoiceNumbersForEasyReference"),
        pageMessages.t("autocompleteSuggestsPreviouslyUsedDescriptions"),
      ],
      tipsAr: [
        "أضف أرقام الفواتير للرجوع إليها بسهولة",
        "الإكمال التلقائي يقترح الأوصاف المستخدمة سابقاً",
      ],
      example: pageMessages.t("officeSuppliesPurchaseInv2024001"),
      exampleAr: "شراء مستلزمات مكتبية - INV-2024-001",
    },
  },
  account: {
    type: {
      title: pageMessages.t("accountType"),
      titleAr: "نوع الحساب",
      content: pageMessages.t("theCategoryOfTheAccountIn"),
      contentAr: "فئة الحساب في دليل الحسابات.",
      tips: [
        pageMessages.t("assetsThingsYouOwnCashInventory"),
        pageMessages.t("liabilitiesWhatYouOweLoansPayables"),
        pageMessages.t("equityOwnerInvestmentAndRetainedEarnings"),
        pageMessages.t("incomeRevenueFromSalesAndServices"),
        pageMessages.t("expensesCostsOfRunningTheBusiness"),
      ],
      tipsAr: [
        "الأصول: ما تملكه (النقد، المخزون)",
        "الخصوم: ما تدين به (القروض، الذمم الدائنة)",
        "حقوق الملكية: استثمار المالك والأرباح المحتجزة",
        "الإيرادات: العوائد من المبيعات والخدمات",
        "المصروفات: تكاليف تشغيل الأعمال",
      ],
    },
  },
};
