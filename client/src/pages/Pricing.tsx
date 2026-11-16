import { Switch } from "@/components/ui/switch";
import { Link } from "wouter";
import { ArrowRight, Check, Minus, Plus, Mail, Zap, Crown, Rocket, Building2 } from "lucide-react";
import { Fragment, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";

// ── Pricing Data ───────────────────────────────────────────────────────

interface PricingTier {
  id: string;
  icon: React.ElementType;
  monthlyPrice: number;
  yearlyPrice: number;
  companies: string;
  users: string;
  badge?: string;
  badgeVariant?: "default" | "secondary" | "outline";
  ctaVariant: "outline" | "default";
  highlight: boolean;
  gradient: string;
  iconColor: string;
}

const tiers: PricingTier[] = [
  {
    id: "free",
    icon: Zap,
    monthlyPrice: 0,
    yearlyPrice: 0,
    companies: "1",
    users: "1",
    ctaVariant: "outline",
    highlight: false,
    gradient: "from-slate-500/10 to-slate-600/5",
    iconColor: "text-muted-foreground",
  },
  {
    id: "starter",
    icon: Rocket,
    monthlyPrice: 49,
    yearlyPrice: 39,
    companies: "1",
    users: "3",
    ctaVariant: "default",
    highlight: false,
    gradient: "from-blue-500/10 to-blue-600/5",
    iconColor: "text-info",
  },
  {
    id: "professional",
    icon: Crown,
    monthlyPrice: 149,
    yearlyPrice: 119,
    companies: "3",
    users: "10",
    badge: "mostPopular",
    badgeVariant: "default",
    ctaVariant: "default",
    highlight: true,
    gradient: "from-emerald-500/10 to-emerald-600/5",
    iconColor: "text-success",
  },
  {
    id: "enterprise",
    icon: Building2,
    monthlyPrice: 299,
    yearlyPrice: 239,
    companies: "unlimited",
    users: "unlimited",
    ctaVariant: "outline",
    highlight: false,
    gradient: "from-purple-500/10 to-purple-600/5",
    iconColor: "text-chart-5",
  },
];

// Feature matrix: true = included, false = not included
type FeatureKey = string;
interface FeatureRow {
  key: FeatureKey;
  /** TIER_FEATURES flag enforced by server/middleware/featureGate.ts (kept in sync by a test). */
  gate?: string;
  free: boolean;
  starter: boolean;
  professional: boolean;
  enterprise: boolean;
}

interface FeatureCategory {
  categoryKey: string;
  features: FeatureRow[];
}

const featureMatrix: FeatureCategory[] = [
  {
    categoryKey: "coreAccounting",
    features: [
      { key: "invoicing", free: true, starter: true, professional: true, enterprise: true },
      { key: "receiptScanning", free: true, starter: true, professional: true, enterprise: true },
      {
        key: "bankReconciliation",
        free: true,
        starter: true,
        professional: true,
        enterprise: true,
      },
      { key: "vatFiling", free: true, starter: true, professional: true, enterprise: true },
      {
        key: "recurringInvoices",
        gate: "recurringInvoices",
        free: false,
        starter: true,
        professional: true,
        enterprise: true,
      },
      { key: "billPay", free: false, starter: true, professional: true, enterprise: true },
      {
        key: "inventoryManagement",
        free: false,
        starter: true,
        professional: true,
        enterprise: true,
      },
      { key: "monthEndClose", free: false, starter: false, professional: true, enterprise: true },
      {
        key: "fixedAssets",
        gate: "fixedAssets",
        free: false,
        starter: false,
        professional: true,
        enterprise: true,
      },
      {
        key: "multiCurrency",
        gate: "multiCurrency",
        free: false,
        starter: true,
        professional: true,
        enterprise: true,
      },
      {
        key: "onlinePayments",
        gate: "invoicePayment",
        free: false,
        starter: true,
        professional: true,
        enterprise: true,
      },
      {
        key: "bulkOps",
        gate: "bulkOps",
        free: false,
        starter: false,
        professional: true,
        enterprise: true,
      },
      { key: "budgeting", free: false, starter: false, professional: true, enterprise: true },
      { key: "expenseClaims", free: false, starter: false, professional: true, enterprise: true },
    ],
  },
  {
    categoryKey: "aiIntelligence",
    features: [
      {
        key: "basicAICategorization",
        free: true,
        starter: true,
        professional: true,
        enterprise: true,
      },
      { key: "aiOCR", free: false, starter: true, professional: true, enterprise: true },
      { key: "autonomousGL", free: false, starter: false, professional: true, enterprise: true },
      { key: "aiCFO", free: false, starter: false, professional: true, enterprise: true },
      {
        key: "aiAnomalyDetection",
        free: false,
        starter: false,
        professional: true,
        enterprise: true,
      },
      {
        key: "aiCashFlowForecast",
        free: false,
        starter: false,
        professional: true,
        enterprise: true,
      },
      {
        key: "smartReconciliation",
        free: false,
        starter: false,
        professional: true,
        enterprise: true,
      },
      { key: "priorityAI", free: false, starter: false, professional: false, enterprise: true },
    ],
  },
  {
    categoryKey: "hrPayroll",
    features: [
      {
        key: "payrollWPS",
        gate: "payroll",
        free: false,
        starter: false,
        professional: true,
        enterprise: true,
      },
    ],
  },
  {
    categoryKey: "uaeCompliance",
    features: [
      {
        key: "vatFilingCompliance",
        free: true,
        starter: true,
        professional: true,
        enterprise: true,
      },
      { key: "corporateTax", free: false, starter: false, professional: true, enterprise: true },
      { key: "eInvoicing", free: false, starter: false, professional: true, enterprise: true },
    ],
  },
  {
    categoryKey: "communication",
    features: [
      { key: "clientPortal", free: false, starter: false, professional: true, enterprise: true },
    ],
  },
  {
    categoryKey: "platform",
    features: [
      { key: "multiCompany", free: false, starter: false, professional: true, enterprise: true },
      {
        key: "dedicatedManager",
        free: false,
        starter: false,
        professional: false,
        enterprise: true,
      },
      {
        key: "customIntegrations",
        free: false,
        starter: false,
        professional: false,
        enterprise: true,
      },
      { key: "slaGuarantee", free: false, starter: false, professional: false, enterprise: true },
      {
        key: "advancedAnalytics",
        free: false,
        starter: false,
        professional: false,
        enterprise: true,
      },
      { key: "multiBranch", free: false, starter: false, professional: false, enterprise: true },
      {
        key: "apiAccess",
        gate: "apiAccess",
        free: false,
        starter: false,
        professional: false,
        enterprise: true,
      },
      {
        key: "webhooks",
        gate: "webhooks",
        free: false,
        starter: false,
        professional: false,
        enterprise: true,
      },
    ],
  },
];

// ── Component ──────────────────────────────────────────────────────────

export default function Pricing() {
  const { locale } = useI18n();
  const [isYearly, setIsYearly] = useState(false);

  // ── Translations ────────────────────────────────────────────────────

  const t = {
    header: {
      title: locale === "en" ? "Simple pricing that grows with you" : "أسعار بسيطة تنمو معك",
      billingLabel: locale === "en" ? "Billing period" : "فترة الفوترة",
      subtitle:
        locale === "en"
          ? "Start on the free plan and move up when you need more companies, users or payroll."
          : "ابدأ بالخطة المجانية وانتقل إلى خطة أعلى عندما تحتاج إلى شركات أو مستخدمين أو رواتب أكثر.",
      monthly: locale === "en" ? "Monthly" : "شهري",
      yearly: locale === "en" ? "Yearly" : "سنوي",
      save20: locale === "en" ? "Save 20%" : "وفّر 20%",
      perMonth: locale === "en" ? "/mo" : "/شهر",
      free: locale === "en" ? "Free" : "مجاني",
    },
    tiers: {
      free: {
        name: locale === "en" ? "Free" : "مجاني",
        description: locale === "en" ? "For freelancers getting started" : "للمستقلين المبتدئين",
        cta: locale === "en" ? "Get Started Free" : "ابدأ مجاناً",
      },
      starter: {
        name: locale === "en" ? "Starter" : "المبتدئ",
        description:
          locale === "en" ? "For small businesses scaling up" : "للشركات الصغيرة في مرحلة النمو",
        cta: locale === "en" ? "Start 14-Day Trial" : "ابدأ تجربة 14 يوم",
      },
      professional: {
        name: locale === "en" ? "Professional" : "الاحترافي",
        description:
          locale === "en" ? "For growing companies with teams" : "للشركات المتنامية مع فرق عمل",
        cta: locale === "en" ? "Start 14-Day Trial" : "ابدأ تجربة 14 يوم",
      },
      enterprise: {
        name: locale === "en" ? "Enterprise" : "المؤسسات",
        description: locale === "en" ? "For large organizations" : "للمؤسسات الكبرى",
        cta: locale === "en" ? "Contact Sales" : "تواصل مع المبيعات",
      },
    },
    badges: {
      recommended: locale === "en" ? "Recommended" : "موصى به",
      mostPopular: locale === "en" ? "Best for growing teams" : "الأنسب للفرق المتنامية",
    },
    limits: {
      companies: locale === "en" ? "company" : "شركة",
      companiesPlural: locale === "en" ? "companies" : "شركات",
      users: locale === "en" ? "user" : "مستخدم",
      usersPlural: locale === "en" ? "users" : "مستخدمين",
      unlimited: locale === "en" ? "Unlimited" : "غير محدود",
      invoicesMonth: locale === "en" ? "invoices/mo" : "فاتورة/شهر",
      receiptsMonth: locale === "en" ? "receipts/mo" : "إيصال/شهر",
    },
    tierFeatures: {
      free: {
        features:
          locale === "en"
            ? [
                "1 company, 1 user",
                "50 invoices/month",
                "20 receipts/month",
                "Basic AI categorization",
                "VAT filing",
                "Bank reconciliation (manual)",
              ]
            : [
                "شركة واحدة، مستخدم واحد",
                "50 فاتورة/شهر",
                "20 إيصال/شهر",
                "تصنيف ذكي أساسي",
                "تقديم ضريبة القيمة المضافة",
                "تسوية بنكية (يدوية)",
              ],
      },
      starter: {
        features:
          locale === "en"
            ? [
                "1 company, 3 users",
                "200 invoices/month",
                "100 receipts/month",
                "AI OCR scanning",
                "AI categorization",
                "Recurring invoices",
                "Bill pay",
                "Inventory management",
              ]
            : [
                "شركة واحدة، 3 مستخدمين",
                "200 فاتورة/شهر",
                "100 إيصال/شهر",
                "مسح OCR بالذكاء الاصطناعي",
                "تصنيف ذكي",
                "فواتير متكررة",
                "دفع الفواتير",
                "إدارة المخزون",
              ],
      },
      professional: {
        header:
          locale === "en" ? "Everything in Starter, plus:" : "كل ميزات المبتدئ، بالإضافة إلى:",
        features:
          locale === "en"
            ? [
                "3 companies, 10 users",
                "Unlimited invoices",
                "Unlimited receipts",
                "Autonomous GL (AI auto-posting)",
                "AI CFO & Financial Advisor",
                "AI Anomaly Detection",
                "AI Cash Flow Forecast",
                "Smart Reconciliation",
                "Month-End Close automation",
                "Payroll & WPS",
                "Fixed Assets & Depreciation",
                "Budgeting & Variance",
                "Expense Claims",
                "Corporate Tax (9%)",
                "E-Invoicing (PINT AE)",
                "Client Portal",
              ]
            : [
                "3 شركات، 10 مستخدمين",
                "فواتير غير محدودة",
                "إيصالات غير محدودة",
                "قيود تلقائية بالذكاء الاصطناعي",
                "مستشار مالي ذكي",
                "كشف الحالات الشاذة",
                "توقعات التدفق النقدي",
                "تسوية ذكية",
                "أتمتة إقفال نهاية الشهر",
                "الرواتب وحماية الأجور",
                "الأصول الثابتة والإهلاك",
                "الميزانيات والتحليل",
                "مطالبات المصروفات",
                "ضريبة الشركات (9%)",
                "الفوترة الإلكترونية (PINT AE)",
                "بوابة العميل",
              ],
      },
      enterprise: {
        header:
          locale === "en"
            ? "Everything in Professional, plus:"
            : "كل ميزات الاحترافي، بالإضافة إلى:",
        features:
          locale === "en"
            ? [
                "Unlimited companies, unlimited users",
                "Priority AI processing",
                "Dedicated account manager",
                "Custom integrations",
                "Enterprise support terms",
                "Advanced analytics",
                "Multi-branch support",
                "API access",
              ]
            : [
                "شركات ومستخدمين غير محدودين",
                "أولوية معالجة الذكاء الاصطناعي",
                "مدير حساب مخصص",
                "تكاملات مخصصة",
                "شروط دعم المؤسسات",
                "تحليلات متقدمة",
                "دعم متعدد الفروع",
                "وصول API",
              ],
      },
    },
    comparison: {
      title: locale === "en" ? "Complete Feature Comparison" : "مقارنة الميزات الكاملة",
      subtitle: locale === "en" ? "Every feature across every plan" : "كل ميزة في كل خطة",
    },
    featureCategories: {
      coreAccounting: locale === "en" ? "Core Accounting" : "المحاسبة الأساسية",
      aiIntelligence: locale === "en" ? "AI & Intelligence" : "الذكاء الاصطناعي",
      hrPayroll: locale === "en" ? "HR & Payroll" : "الموارد البشرية والرواتب",
      uaeCompliance: locale === "en" ? "UAE Compliance" : "الامتثال الإماراتي",
      communication: locale === "en" ? "Communication" : "التواصل",
      platform: locale === "en" ? "Platform" : "المنصة",
    },
    featureNames: {
      invoicing: locale === "en" ? "Invoicing" : "الفواتير",
      receiptScanning: locale === "en" ? "Receipt Scanning" : "مسح الإيصالات",
      bankReconciliation: locale === "en" ? "Bank Reconciliation" : "التسوية البنكية",
      vatFiling: locale === "en" ? "VAT Filing" : "تقديم ضريبة القيمة المضافة",
      recurringInvoices: locale === "en" ? "Recurring Invoices" : "الفواتير المتكررة",
      billPay: locale === "en" ? "Bill Pay" : "دفع الفواتير",
      inventoryManagement: locale === "en" ? "Inventory Management" : "إدارة المخزون",
      monthEndClose: locale === "en" ? "Month-End Close" : "إقفال نهاية الشهر",
      fixedAssets: locale === "en" ? "Fixed Assets & Depreciation" : "الأصول الثابتة والإهلاك",
      budgeting: locale === "en" ? "Budgeting & Variance" : "الميزانيات والتحليل",
      expenseClaims: locale === "en" ? "Expense Claims" : "مطالبات المصروفات",
      basicAICategorization: locale === "en" ? "Basic AI Categorization" : "تصنيف ذكي أساسي",
      aiOCR: locale === "en" ? "AI OCR Scanning" : "مسح OCR بالذكاء الاصطناعي",
      autonomousGL: locale === "en" ? "Autonomous GL (Auto-posting)" : "قيود تلقائية",
      aiCFO: locale === "en" ? "AI CFO & Financial Advisor" : "مستشار مالي ذكي",
      aiAnomalyDetection: locale === "en" ? "AI Anomaly Detection" : "كشف الحالات الشاذة",
      aiCashFlowForecast: locale === "en" ? "AI Cash Flow Forecast" : "توقعات التدفق النقدي",
      smartReconciliation: locale === "en" ? "Smart Reconciliation" : "التسوية الذكية",
      priorityAI: locale === "en" ? "Priority AI Processing" : "أولوية معالجة الذكاء الاصطناعي",
      payrollWPS: locale === "en" ? "Payroll & WPS" : "الرواتب وحماية الأجور",
      vatFilingCompliance: locale === "en" ? "VAT Filing (5%)" : "ضريبة القيمة المضافة (5%)",
      corporateTax: locale === "en" ? "Corporate Tax (9%)" : "ضريبة الشركات (9%)",
      eInvoicing: locale === "en" ? "E-Invoicing (PINT AE)" : "الفوترة الإلكترونية (PINT AE)",
      clientPortal: locale === "en" ? "Client Portal" : "بوابة العميل",
      multiCompany: locale === "en" ? "Multi-Company" : "شركات متعددة",
      dedicatedManager: locale === "en" ? "Dedicated Account Manager" : "مدير حساب مخصص",
      customIntegrations: locale === "en" ? "Custom Integrations" : "تكاملات مخصصة",
      slaGuarantee: locale === "en" ? "Enterprise Support Terms" : "شروط دعم المؤسسات",
      advancedAnalytics: locale === "en" ? "Advanced Analytics" : "تحليلات متقدمة",
      multiBranch: locale === "en" ? "Multi-Branch Support" : "دعم متعدد الفروع",
      apiAccess: locale === "en" ? "API Access" : "وصول API",
      webhooks: locale === "en" ? "Signed Webhooks" : "خطافات ويب موقّعة",
      multiCurrency: locale === "en" ? "Multi-Currency Documents" : "مستندات متعددة العملات",
      onlinePayments:
        locale === "en" ? "Online Invoice Payment Links" : "روابط دفع الفواتير عبر الإنترنت",
      bulkOps: locale === "en" ? "Bulk Operations" : "العمليات المجمّعة",
    },
    faq: {
      title: locale === "en" ? "Frequently Asked Questions" : "الأسئلة الشائعة",
      subtitle:
        locale === "en"
          ? "Everything you need to know about our pricing"
          : "كل ما تحتاج معرفته عن أسعارنا",
      questions: [
        {
          q: locale === "en" ? "Can I switch plans anytime?" : "هل يمكنني تغيير الخطة في أي وقت؟",
          a:
            locale === "en"
              ? "Yes! You can upgrade or downgrade your plan at any time. When upgrading, you'll get immediate access to new features. When downgrading, the change takes effect at your next billing cycle."
              : "نعم! يمكنك ترقية أو تخفيض خطتك في أي وقت. عند الترقية، ستحصل على وصول فوري للميزات الجديدة. عند التخفيض، يسري التغيير في دورة الفوترة التالية.",
        },
        {
          q: locale === "en" ? "Is there a free trial?" : "هل توجد فترة تجريبية مجانية؟",
          a:
            locale === "en"
              ? "Yes. Your first paid subscription starts with a 14-day free trial; your card is charged only when the trial ends, and you can cancel before then. You can also use the Free plan indefinitely."
              : "نعم. يبدأ أول اشتراك مدفوع بفترة تجريبية مجانية لمدة 14 يوماً؛ لا تُخصم البطاقة إلا عند انتهاء الفترة التجريبية ويمكنك الإلغاء قبل ذلك. كما يمكنك استخدام الخطة المجانية بدون قيود زمنية.",
        },
        {
          q: locale === "en" ? "What payment methods do you accept?" : "ما طرق الدفع المقبولة؟",
          a:
            locale === "en"
              ? "We accept all major credit and debit cards via Stripe, including Visa, Mastercard, and American Express. All payments are securely processed."
              : "نقبل جميع بطاقات الائتمان والخصم الرئيسية عبر Stripe، بما في ذلك فيزا، ماستركارد، وأمريكان إكسبريس. تتم معالجة جميع المدفوعات بشكل آمن.",
        },
        {
          q: locale === "en" ? "Is my data secure?" : "هل بياناتي آمنة؟",
          a:
            locale === "en"
              ? "We use TLS for data in transit, role-based access, audit logs, encrypted connected-service secrets, and managed infrastructure controls. SOC 2 and ISO 27001 are roadmap items, not current certifications."
              : "نستخدم TLS للبيانات أثناء النقل، وصلاحيات قائمة على الأدوار، وسجلات تدقيق، وتشفير أسرار الخدمات المتصلة، وضوابط بنية تحتية مدارة. شهادتا SOC 2 و ISO 27001 ضمن خارطة الطريق وليستا شهادات حالية.",
        },
      ],
    },
    footerCta: {
      title: locale === "en" ? "Start on the free plan today." : "ابدأ بالخطة المجانية اليوم.",
      subtitle:
        locale === "en"
          ? "Set up your company in minutes, or talk to us about migration and the plan that fits."
          : "أعدّ شركتك في دقائق، أو تحدث إلينا عن نقل بياناتك والخطة المناسبة لك.",
      startFree: locale === "en" ? "Start Free" : "ابدأ مجاناً",
      bookDemo: locale === "en" ? "Talk to us" : "تحدث إلينا",
      guarantee:
        locale === "en"
          ? "Free plan available · 14-day trial on your first paid plan · Prices in AED"
          : "خطة مجانية متاحة · تجربة 14 يوماً لأول خطة مدفوعة · الأسعار بالدرهم",
    },
    nav: {
      home: locale === "en" ? "Home" : "الرئيسية",
      pricing: locale === "en" ? "Pricing" : "الأسعار",
      login: locale === "en" ? "Login" : "تسجيل الدخول",
      languageToggle: locale === "en" ? "العربية" : "EN",
    },
  };

  // ── Render helpers ──────────────────────────────────────────────────

  const formatPrice = (price: number) => {
    if (price === 0) return t.header.free;
    return `AED ${price}`;
  };

  const getPrice = (tier: PricingTier) => {
    return isYearly ? tier.yearlyPrice : tier.monthlyPrice;
  };

  const renderCheckOrDash = (included: boolean) =>
    included ? (
      <span className="mk-ptable__yes">
        <Check aria-hidden="true" />
        <span className="sr-only">{locale === "en" ? "Included" : "مشمول"}</span>
      </span>
    ) : (
      <span className="mk-ptable__no">
        <Minus aria-hidden="true" />
        <span className="sr-only">{locale === "en" ? "Not included" : "غير مشمول"}</span>
      </span>
    );

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <MarketingLayout
      titleKey="marketing.seoPricingTitle"
      descriptionKey="marketing.seoPricingDescription"
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="mk-pagehead" style={{ borderBlockEnd: 0, textAlign: "center" }}>
        <div className="mk-container">
          <p className="mk-eyebrow">{locale === "en" ? "Pricing in AED" : "الأسعار بالدرهم"}</p>
          <h1 className="mk-h1" style={{ marginInline: "auto", maxInlineSize: "18ch" }}>
            {t.header.title}
          </h1>
          <p className="mk-lead" style={{ marginInline: "auto" }}>
            {t.header.subtitle}
          </p>

          {/* Monthly / Yearly toggle */}
          <div className="mk-billing" role="group" aria-label={t.header.billingLabel}>
            <span data-active={!isYearly}>{t.header.monthly}</span>
            <Switch
              checked={isYearly}
              onCheckedChange={setIsYearly}
              aria-label={t.header.yearly}
              data-testid="switch-billing-period"
            />
            <span data-active={isYearly}>{t.header.yearly}</span>
            <span className="mk-badge" data-tone="success" data-visible={isYearly}>
              {t.header.save20}
            </span>
          </div>
        </div>
      </header>

      {/* ── Plan cards ─────────────────────────────────────────────────── */}
      <section className="mk-container" style={{ paddingBlockEnd: "var(--section)" }}>
        <div className="mk-tiers">
          {tiers.map((tier) => {
            const tierKey = tier.id as keyof typeof t.tiers;
            const tierT = t.tiers[tierKey];
            const tierFeatures = t.tierFeatures[tierKey];
            const price = getPrice(tier);
            return (
              <article
                key={tier.id}
                className="mk-card mk-tier"
                data-featured={tier.highlight ? "true" : undefined}
                data-testid={`card-plan-${tier.id}`}
              >
                <div className="mk-tier__top">
                  <h2 className="mk-tier__name">{tierT.name}</h2>
                  {tier.badge && (
                    <span className="mk-plan__tag">
                      {t.badges[tier.badge as keyof typeof t.badges]}
                    </span>
                  )}
                </div>
                <p className="mk-small">{tierT.description}</p>
                <p className="mk-tier__price">
                  <strong className="mk-num">{formatPrice(price)}</strong>
                  {price > 0 && <span>{t.header.perMonth}</span>}
                </p>
                <p className="mk-small mk-tier__billed">
                  {price > 0 && isYearly
                    ? locale === "en"
                      ? `Billed AED ${price * 12} a year`
                      : `يُفوتر ${price * 12} درهم سنوياً`
                    : " "}
                </p>
                {tier.id === "enterprise" ? (
                  <a
                    href="mailto:hello@muhasib.ai?subject=Muhasib.ai%20Enterprise"
                    className="mk-btn mk-btn--secondary"
                    data-testid={`button-plan-${tier.id}`}
                  >
                    {tierT.cta}
                    <ArrowRight className="mk-flip" aria-hidden="true" />
                  </a>
                ) : (
                  <Link
                    href="/register"
                    className={`mk-btn ${tier.highlight ? "mk-btn--primary" : "mk-btn--secondary"}`}
                    data-testid={`button-plan-${tier.id}`}
                  >
                    {tierT.cta}
                    <ArrowRight className="mk-flip" aria-hidden="true" />
                  </Link>
                )}
                {"header" in tierFeatures && (
                  <p className="mk-tier__inherit">{(tierFeatures as { header: string }).header}</p>
                )}
                <ul className="mk-checklist mk-tier__features">
                  {tierFeatures.features.map((feature) => (
                    <li key={feature}>
                      <Check aria-hidden="true" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
        <p className="mk-small" style={{ textAlign: "center", marginBlockStart: "2rem" }}>
          {t.footerCta.guarantee}
        </p>
      </section>

      {/* ── Feature comparison ─────────────────────────────────────────── */}
      <section className="mk-section mk-section--sunken" aria-labelledby="mk-compare-title">
        <div className="mk-container">
          <div className="mk-heading mk-heading--center">
            <h2 id="mk-compare-title" className="mk-h2">
              {t.comparison.title}
            </h2>
            <p className="mk-lead">{t.comparison.subtitle}</p>
          </div>
          <div
            className="mk-card mk-ptable-wrap"
            tabIndex={0}
            role="region"
            aria-labelledby="mk-compare-title"
          >
            <table className="mk-ptable">
              <caption className="sr-only">{t.comparison.title}</caption>
              <thead>
                <tr>
                  <th scope="col">{locale === "en" ? "Feature" : "الميزة"}</th>
                  {tiers.map((tier) => (
                    <th
                      key={tier.id}
                      scope="col"
                      data-featured={tier.highlight ? "true" : undefined}
                    >
                      <span>{t.tiers[tier.id as keyof typeof t.tiers].name}</span>
                      <small className="mk-num">
                        {getPrice(tier) === 0
                          ? t.header.free
                          : `AED ${getPrice(tier)}${t.header.perMonth}`}
                      </small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {featureMatrix.map((category) => (
                  <Fragment key={category.categoryKey}>
                    <tr className="mk-ptable__group">
                      <td colSpan={5}>
                        {
                          t.featureCategories[
                            category.categoryKey as keyof typeof t.featureCategories
                          ]
                        }
                      </td>
                    </tr>
                    {category.features.map((feature) => (
                      <tr key={feature.key}>
                        <td>{t.featureNames[feature.key as keyof typeof t.featureNames]}</td>
                        <td>{renderCheckOrDash(feature.free)}</td>
                        <td>{renderCheckOrDash(feature.starter)}</td>
                        <td>{renderCheckOrDash(feature.professional)}</td>
                        <td>{renderCheckOrDash(feature.enterprise)}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Competitor comparison table removed: it made specific, unverified and
          in several cases false claims about named competitors (e.g. that Zoho Books
          lacks UAE VAT, corporate tax, Arabic and e-invoicing — all of which it has).
          Do not re-add a comparison unless every cell is backed by a dated screenshot
          from the competitor's own public documentation, with the verification date shown. */}

      {/* ── FAQ ─────────────────────────────────────────────────────────── */}
      <section className="mk-section" aria-labelledby="mk-pfaq-title">
        <div className="mk-container mk-container--narrow">
          <div className="mk-heading mk-heading--center">
            <h2 id="mk-pfaq-title" className="mk-h2">
              {t.faq.title}
            </h2>
            <p className="mk-lead">{t.faq.subtitle}</p>
          </div>
          <div className="mk-faq">
            {t.faq.questions.map((item) => (
              <details key={item.q}>
                <summary>
                  <span>{item.q}</span>
                  <Plus aria-hidden="true" />
                </summary>
                <div className="mk-faq__answer">
                  <p>{item.a}</p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Closing CTA ─────────────────────────────────────────────────── */}
      <section className="mk-section" style={{ paddingBlockStart: 0 }} id="contact">
        <div className="mk-container">
          <div className="mk-cta">
            <h2 className="mk-h2">{t.footerCta.title}</h2>
            <p className="mk-lead">{t.footerCta.subtitle}</p>
            <div className="mk-hero__ctas">
              <Link href="/register" className="mk-btn mk-btn--primary mk-btn--lg">
                {t.footerCta.startFree}
                <ArrowRight className="mk-flip" aria-hidden="true" />
              </Link>
              <a
                href="mailto:hello@muhasib.ai?subject=Muhasib.ai%20demo%20request"
                className="mk-btn mk-btn--secondary mk-btn--lg"
              >
                <Mail aria-hidden="true" />
                {t.footerCta.bookDemo}
              </a>
            </div>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
