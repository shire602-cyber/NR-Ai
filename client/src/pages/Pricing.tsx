import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Link } from 'wouter';
import {
  Check,
  Minus,
  Zap,
  Crown,
  Rocket,
  Building2,
  ArrowRight,
  Shield,
  Globe,
  MessageSquare,
  Sparkles,
  Star,
  ChevronRight,
  Phone,
  Lock,
  CreditCard,
  Users,
  Brain,
  BarChart3,
  Receipt,
  FileText,
  Calculator,
  Briefcase,
  TrendingUp,
  Bot,
  Gem,
} from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { motion, AnimatePresence } from 'framer-motion';
import { ScrollReveal, StaggerContainer, StaggerItem, hoverLift } from '@/lib/animations';

// ── Pricing Data ───────────────────────────────────────────────────────

interface PricingTier {
  id: string;
  icon: React.ElementType;
  monthlyPrice: number;
  yearlyPrice: number;
  companies: string;
  users: string;
  badge?: string;
  badgeVariant?: 'default' | 'secondary' | 'outline';
  ctaVariant: 'outline' | 'default';
  highlight: boolean;
  gradient: string;
  iconColor: string;
}

const tiers: PricingTier[] = [
  {
    id: 'free',
    icon: Zap,
    monthlyPrice: 0,
    yearlyPrice: 0,
    companies: '1',
    users: '1',
    ctaVariant: 'outline',
    highlight: false,
    gradient: 'from-slate-500/10 to-slate-600/5',
    iconColor: 'text-slate-600',
  },
  {
    id: 'starter',
    icon: Rocket,
    monthlyPrice: 49,
    yearlyPrice: 39,
    companies: '1',
    users: '3',
    badge: 'recommended',
    badgeVariant: 'secondary',
    ctaVariant: 'default',
    highlight: false,
    gradient: 'from-blue-500/10 to-blue-600/5',
    iconColor: 'text-blue-600',
  },
  {
    id: 'professional',
    icon: Crown,
    monthlyPrice: 149,
    yearlyPrice: 119,
    companies: '3',
    users: '10',
    badge: 'mostPopular',
    badgeVariant: 'default',
    ctaVariant: 'default',
    highlight: true,
    gradient: 'from-emerald-500/10 to-emerald-600/5',
    iconColor: 'text-emerald-600',
  },
  {
    id: 'enterprise',
    icon: Building2,
    monthlyPrice: 299,
    yearlyPrice: 239,
    companies: 'unlimited',
    users: 'unlimited',
    ctaVariant: 'outline',
    highlight: false,
    gradient: 'from-purple-500/10 to-purple-600/5',
    iconColor: 'text-purple-600',
  },
];

// Feature matrix: true = included, false = not included
type FeatureKey = string;
interface FeatureRow {
  key: FeatureKey;
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
    categoryKey: 'coreAccounting',
    features: [
      { key: 'invoicing', free: true, starter: true, professional: true, enterprise: true },
      { key: 'receiptScanning', free: true, starter: true, professional: true, enterprise: true },
      { key: 'bankReconciliation', free: true, starter: true, professional: true, enterprise: true },
      { key: 'vatFiling', free: true, starter: true, professional: true, enterprise: true },
      { key: 'recurringInvoices', free: false, starter: true, professional: true, enterprise: true },
      { key: 'billPay', free: false, starter: true, professional: true, enterprise: true },
      { key: 'inventoryManagement', free: false, starter: true, professional: true, enterprise: true },
      { key: 'monthEndClose', free: false, starter: false, professional: true, enterprise: true },
      { key: 'fixedAssets', free: false, starter: false, professional: true, enterprise: true },
      { key: 'budgeting', free: false, starter: false, professional: true, enterprise: true },
      { key: 'expenseClaims', free: false, starter: false, professional: true, enterprise: true },
    ],
  },
  {
    categoryKey: 'aiIntelligence',
    features: [
      { key: 'basicAICategorization', free: true, starter: true, professional: true, enterprise: true },
      { key: 'aiOCR', free: false, starter: true, professional: true, enterprise: true },
      { key: 'autonomousGL', free: false, starter: false, professional: true, enterprise: true },
      { key: 'aiCFO', free: false, starter: false, professional: true, enterprise: true },
      { key: 'aiAnomalyDetection', free: false, starter: false, professional: true, enterprise: true },
      { key: 'aiCashFlowForecast', free: false, starter: false, professional: true, enterprise: true },
      { key: 'smartReconciliation', free: false, starter: false, professional: true, enterprise: true },
      { key: 'priorityAI', free: false, starter: false, professional: false, enterprise: true },
    ],
  },
  {
    categoryKey: 'hrPayroll',
    features: [
      { key: 'payrollWPS', free: false, starter: false, professional: true, enterprise: true },
    ],
  },
  {
    categoryKey: 'uaeCompliance',
    features: [
      { key: 'vatFilingCompliance', free: true, starter: true, professional: true, enterprise: true },
      { key: 'corporateTax', free: false, starter: false, professional: true, enterprise: true },
      { key: 'eInvoicing', free: false, starter: false, professional: true, enterprise: true },
    ],
  },
  {
    categoryKey: 'communication',
    features: [
      { key: 'whatsappTemplates', free: false, starter: true, professional: true, enterprise: true },
      { key: 'clientPortal', free: false, starter: false, professional: true, enterprise: true },
    ],
  },
  {
    categoryKey: 'platform',
    features: [
      { key: 'multiCompany', free: false, starter: false, professional: true, enterprise: true },
      { key: 'dedicatedManager', free: false, starter: false, professional: false, enterprise: true },
      { key: 'customIntegrations', free: false, starter: false, professional: false, enterprise: true },
      { key: 'slaGuarantee', free: false, starter: false, professional: false, enterprise: true },
      { key: 'advancedAnalytics', free: false, starter: false, professional: false, enterprise: true },
      { key: 'multiBranch', free: false, starter: false, professional: false, enterprise: true },
      { key: 'apiAccess', free: false, starter: false, professional: false, enterprise: true },
    ],
  },
];

// ── Competitor comparison data ─────────────────────────────────────────

interface CompetitorRow {
  featureKey: string;
  muhasib: string | boolean;
  digits: string | boolean;
  wafeq: string | boolean;
  zoho: string | boolean;
}

const competitorData: CompetitorRow[] = [
  { featureKey: 'startingPrice', muhasib: 'AED 0', digits: '$29/mo', wafeq: 'AED 99/mo', zoho: '$15/mo' },
  { featureKey: 'arabicSupport', muhasib: true, digits: false, wafeq: true, zoho: false },
  { featureKey: 'uaeVATBuiltIn', muhasib: true, digits: false, wafeq: true, zoho: false },
  { featureKey: 'corporateTaxComp', muhasib: true, digits: false, wafeq: false, zoho: false },
  { featureKey: 'aiCategorization', muhasib: true, digits: true, wafeq: false, zoho: false },
  { featureKey: 'aiCFOComp', muhasib: true, digits: false, wafeq: false, zoho: false },
  { featureKey: 'whatsappInteg', muhasib: true, digits: false, wafeq: false, zoho: false },
  { featureKey: 'eInvoicingComp', muhasib: true, digits: false, wafeq: true, zoho: false },
  { featureKey: 'wpsPayroll', muhasib: true, digits: false, wafeq: false, zoho: false },
  { featureKey: 'freeTier', muhasib: true, digits: false, wafeq: false, zoho: true },
];

// ── Component ──────────────────────────────────────────────────────────

export default function Pricing() {
  const { locale, setLocale } = useI18n();
  const [isYearly, setIsYearly] = useState(false);
  const isRTL = locale === 'ar';

  const toggleLanguage = () => {
    setLocale(locale === 'en' ? 'ar' : 'en');
  };

  // ── Translations ────────────────────────────────────────────────────

  const t = {
    header: {
      title: locale === 'en' ? 'Simple, Transparent Pricing' : 'أسعار بسيطة وشفافة',
      subtitle: locale === 'en' ? 'Start free. Scale as you grow. No hidden fees.' : 'ابدأ مجاناً. توسّع مع نموك. بدون رسوم خفية.',
      monthly: locale === 'en' ? 'Monthly' : 'شهري',
      yearly: locale === 'en' ? 'Yearly' : 'سنوي',
      save20: locale === 'en' ? 'Save 20%' : 'وفّر 20%',
      perMonth: locale === 'en' ? '/mo' : '/شهر',
      free: locale === 'en' ? 'Free' : 'مجاني',
    },
    tiers: {
      free: {
        name: locale === 'en' ? 'Free' : 'مجاني',
        description: locale === 'en' ? 'For freelancers getting started' : 'للمستقلين المبتدئين',
        cta: locale === 'en' ? 'Get Started Free' : 'ابدأ مجاناً',
      },
      starter: {
        name: locale === 'en' ? 'Starter' : 'المبتدئ',
        description: locale === 'en' ? 'For small businesses scaling up' : 'للشركات الصغيرة في مرحلة النمو',
        cta: locale === 'en' ? 'Start 14-Day Trial' : 'ابدأ تجربة 14 يوم',
      },
      professional: {
        name: locale === 'en' ? 'Professional' : 'الاحترافي',
        description: locale === 'en' ? 'For growing companies with teams' : 'للشركات المتنامية مع فرق عمل',
        cta: locale === 'en' ? 'Start 14-Day Trial' : 'ابدأ تجربة 14 يوم',
      },
      enterprise: {
        name: locale === 'en' ? 'Enterprise' : 'المؤسسات',
        description: locale === 'en' ? 'For large organizations' : 'للمؤسسات الكبرى',
        cta: locale === 'en' ? 'Contact Sales' : 'تواصل مع المبيعات',
      },
    },
    badges: {
      recommended: locale === 'en' ? 'Recommended' : 'موصى به',
      mostPopular: locale === 'en' ? 'Most Popular' : 'الأكثر شعبية',
    },
    limits: {
      companies: locale === 'en' ? 'company' : 'شركة',
      companiesPlural: locale === 'en' ? 'companies' : 'شركات',
      users: locale === 'en' ? 'user' : 'مستخدم',
      usersPlural: locale === 'en' ? 'users' : 'مستخدمين',
      unlimited: locale === 'en' ? 'Unlimited' : 'غير محدود',
      invoicesMonth: locale === 'en' ? 'invoices/mo' : 'فاتورة/شهر',
      receiptsMonth: locale === 'en' ? 'receipts/mo' : 'إيصال/شهر',
    },
    tierFeatures: {
      free: {
        features: locale === 'en'
          ? ['1 company, 1 user', '50 invoices/month', '20 receipts/month', 'Basic AI categorization', 'VAT filing', 'Bank reconciliation (manual)']
          : ['شركة واحدة، مستخدم واحد', '50 فاتورة/شهر', '20 إيصال/شهر', 'تصنيف ذكي أساسي', 'تقديم ضريبة القيمة المضافة', 'تسوية بنكية (يدوية)'],
      },
      starter: {
        features: locale === 'en'
          ? ['1 company, 3 users', '200 invoices/month', '100 receipts/month', 'AI OCR scanning', 'AI categorization', 'Recurring invoices', 'Bill pay', 'Inventory management', 'WhatsApp templates']
          : ['شركة واحدة، 3 مستخدمين', '200 فاتورة/شهر', '100 إيصال/شهر', 'مسح OCR بالذكاء الاصطناعي', 'تصنيف ذكي', 'فواتير متكررة', 'دفع الفواتير', 'إدارة المخزون', 'قوالب واتساب'],
      },
      professional: {
        header: locale === 'en' ? 'Everything in Starter, plus:' : 'كل ميزات المبتدئ، بالإضافة إلى:',
        features: locale === 'en'
          ? ['3 companies, 10 users', 'Unlimited invoices', 'Unlimited receipts', 'Autonomous GL (AI auto-posting)', 'AI CFO & Financial Advisor', 'AI Anomaly Detection', 'AI Cash Flow Forecast', 'Smart Reconciliation', 'Month-End Close automation', 'Payroll & WPS', 'Fixed Assets & Depreciation', 'Budgeting & Variance', 'Expense Claims', 'Corporate Tax (9%)', 'E-Invoicing (PINT AE)', 'Client Portal']
          : ['3 شركات، 10 مستخدمين', 'فواتير غير محدودة', 'إيصالات غير محدودة', 'قيود تلقائية بالذكاء الاصطناعي', 'مستشار مالي ذكي', 'كشف الحالات الشاذة', 'توقعات التدفق النقدي', 'تسوية ذكية', 'أتمتة إقفال نهاية الشهر', 'الرواتب وحماية الأجور', 'الأصول الثابتة والإهلاك', 'الميزانيات والتحليل', 'مطالبات المصروفات', 'ضريبة الشركات (9%)', 'الفوترة الإلكترونية (PINT AE)', 'بوابة العميل'],
      },
      enterprise: {
        header: locale === 'en' ? 'Everything in Professional, plus:' : 'كل ميزات الاحترافي، بالإضافة إلى:',
        features: locale === 'en'
          ? ['Unlimited companies, unlimited users', 'Priority AI processing', 'Dedicated account manager', 'Custom integrations', 'SLA guarantee', 'Advanced analytics', 'Multi-branch support', 'API access']
          : ['شركات ومستخدمين غير محدودين', 'أولوية معالجة الذكاء الاصطناعي', 'مدير حساب مخصص', 'تكاملات مخصصة', 'ضمان مستوى الخدمة', 'تحليلات متقدمة', 'دعم متعدد الفروع', 'وصول API'],
      },
    },
    comparison: {
      title: locale === 'en' ? 'Complete Feature Comparison' : 'مقارنة الميزات الكاملة',
      subtitle: locale === 'en' ? 'Every feature across every plan' : 'كل ميزة في كل خطة',
    },
    featureCategories: {
      coreAccounting: locale === 'en' ? 'Core Accounting' : 'المحاسبة الأساسية',
      aiIntelligence: locale === 'en' ? 'AI & Intelligence' : 'الذكاء الاصطناعي',
      hrPayroll: locale === 'en' ? 'HR & Payroll' : 'الموارد البشرية والرواتب',
      uaeCompliance: locale === 'en' ? 'UAE Compliance' : 'الامتثال الإماراتي',
      communication: locale === 'en' ? 'Communication' : 'التواصل',
      platform: locale === 'en' ? 'Platform' : 'المنصة',
    },
    featureNames: {
      invoicing: locale === 'en' ? 'Invoicing' : 'الفواتير',
      receiptScanning: locale === 'en' ? 'Receipt Scanning' : 'مسح الإيصالات',
      bankReconciliation: locale === 'en' ? 'Bank Reconciliation' : 'التسوية البنكية',
      vatFiling: locale === 'en' ? 'VAT Filing' : 'تقديم ضريبة القيمة المضافة',
      recurringInvoices: locale === 'en' ? 'Recurring Invoices' : 'الفواتير المتكررة',
      billPay: locale === 'en' ? 'Bill Pay' : 'دفع الفواتير',
      inventoryManagement: locale === 'en' ? 'Inventory Management' : 'إدارة المخزون',
      monthEndClose: locale === 'en' ? 'Month-End Close' : 'إقفال نهاية الشهر',
      fixedAssets: locale === 'en' ? 'Fixed Assets & Depreciation' : 'الأصول الثابتة والإهلاك',
      budgeting: locale === 'en' ? 'Budgeting & Variance' : 'الميزانيات والتحليل',
      expenseClaims: locale === 'en' ? 'Expense Claims' : 'مطالبات المصروفات',
      basicAICategorization: locale === 'en' ? 'Basic AI Categorization' : 'تصنيف ذكي أساسي',
      aiOCR: locale === 'en' ? 'AI OCR Scanning' : 'مسح OCR بالذكاء الاصطناعي',
      autonomousGL: locale === 'en' ? 'Autonomous GL (Auto-posting)' : 'قيود تلقائية',
      aiCFO: locale === 'en' ? 'AI CFO & Financial Advisor' : 'مستشار مالي ذكي',
      aiAnomalyDetection: locale === 'en' ? 'AI Anomaly Detection' : 'كشف الحالات الشاذة',
      aiCashFlowForecast: locale === 'en' ? 'AI Cash Flow Forecast' : 'توقعات التدفق النقدي',
      smartReconciliation: locale === 'en' ? 'Smart Reconciliation' : 'التسوية الذكية',
      priorityAI: locale === 'en' ? 'Priority AI Processing' : 'أولوية معالجة الذكاء الاصطناعي',
      payrollWPS: locale === 'en' ? 'Payroll & WPS' : 'الرواتب وحماية الأجور',
      vatFilingCompliance: locale === 'en' ? 'VAT Filing (5%)' : 'ضريبة القيمة المضافة (5%)',
      corporateTax: locale === 'en' ? 'Corporate Tax (9%)' : 'ضريبة الشركات (9%)',
      eInvoicing: locale === 'en' ? 'E-Invoicing (PINT AE)' : 'الفوترة الإلكترونية (PINT AE)',
      whatsappTemplates: locale === 'en' ? 'WhatsApp Templates' : 'قوالب واتساب',
      clientPortal: locale === 'en' ? 'Client Portal' : 'بوابة العميل',
      multiCompany: locale === 'en' ? 'Multi-Company' : 'شركات متعددة',
      dedicatedManager: locale === 'en' ? 'Dedicated Account Manager' : 'مدير حساب مخصص',
      customIntegrations: locale === 'en' ? 'Custom Integrations' : 'تكاملات مخصصة',
      slaGuarantee: locale === 'en' ? 'SLA Guarantee' : 'ضمان مستوى الخدمة',
      advancedAnalytics: locale === 'en' ? 'Advanced Analytics' : 'تحليلات متقدمة',
      multiBranch: locale === 'en' ? 'Multi-Branch Support' : 'دعم متعدد الفروع',
      apiAccess: locale === 'en' ? 'API Access' : 'وصول API',
    },
    competitor: {
      title: locale === 'en' ? 'How We Compare' : 'كيف نقارن',
      subtitle: locale === 'en' ? 'See why UAE businesses choose Muhasib.ai over the competition' : 'اكتشف لماذا تختار الشركات الإماراتية محاسب.ai',
      feature: locale === 'en' ? 'Feature' : 'الميزة',
      muhasib: 'Muhasib.ai',
      digits: 'Digits',
      wafeq: 'Wafeq',
      zoho: 'Zoho Books',
    },
    competitorFeatures: {
      startingPrice: locale === 'en' ? 'Starting Price' : 'السعر المبدئي',
      arabicSupport: locale === 'en' ? 'Arabic UI & Reports' : 'واجهة وتقارير عربية',
      uaeVATBuiltIn: locale === 'en' ? 'UAE VAT Built-in' : 'ضريبة القيمة المضافة مدمجة',
      corporateTaxComp: locale === 'en' ? 'Corporate Tax (9%)' : 'ضريبة الشركات (9%)',
      aiCategorization: locale === 'en' ? 'AI Categorization' : 'تصنيف ذكي',
      aiCFOComp: locale === 'en' ? 'AI CFO Advisor' : 'مستشار مالي ذكي',
      whatsappInteg: locale === 'en' ? 'WhatsApp Integration' : 'تكامل واتساب',
      eInvoicingComp: locale === 'en' ? 'E-Invoicing (FTA)' : 'الفوترة الإلكترونية (الهيئة)',
      wpsPayroll: locale === 'en' ? 'WPS Payroll' : 'رواتب حماية الأجور',
      freeTier: locale === 'en' ? 'Free Tier Available' : 'خطة مجانية متاحة',
    },
    faq: {
      title: locale === 'en' ? 'Frequently Asked Questions' : 'الأسئلة الشائعة',
      subtitle: locale === 'en' ? 'Everything you need to know about our pricing' : 'كل ما تحتاج معرفته عن أسعارنا',
      questions: [
        {
          q: locale === 'en' ? 'Can I switch plans anytime?' : 'هل يمكنني تغيير الخطة في أي وقت؟',
          a: locale === 'en'
            ? 'Yes! You can upgrade or downgrade your plan at any time. When upgrading, you\'ll get immediate access to new features. When downgrading, the change takes effect at your next billing cycle.'
            : 'نعم! يمكنك ترقية أو تخفيض خطتك في أي وقت. عند الترقية، ستحصل على وصول فوري للميزات الجديدة. عند التخفيض، يسري التغيير في دورة الفوترة التالية.',
        },
        {
          q: locale === 'en' ? 'Is there a free trial?' : 'هل توجد فترة تجريبية مجانية؟',
          a: locale === 'en'
            ? 'Yes! We offer a 14-day free trial on both the Starter and Professional plans. No credit card required to start. You can also use the Free plan indefinitely.'
            : 'نعم! نقدم فترة تجريبية مجانية لمدة 14 يوماً على خطتي المبتدئ والاحترافي. لا حاجة لبطاقة ائتمان للبدء. كما يمكنك استخدام الخطة المجانية بدون قيود زمنية.',
        },
        {
          q: locale === 'en' ? 'What payment methods do you accept?' : 'ما طرق الدفع المقبولة؟',
          a: locale === 'en'
            ? 'We accept all major credit and debit cards via Stripe, including Visa, Mastercard, and American Express. All payments are securely processed.'
            : 'نقبل جميع بطاقات الائتمان والخصم الرئيسية عبر Stripe، بما في ذلك فيزا، ماستركارد، وأمريكان إكسبريس. تتم معالجة جميع المدفوعات بشكل آمن.',
        },
        {
          q: locale === 'en' ? 'Do you offer refunds?' : 'هل تقدمون استرداد أموال؟',
          a: locale === 'en'
            ? 'Absolutely. We offer a 30-day money-back guarantee on all paid plans. If you\'re not satisfied, contact us within 30 days for a full refund, no questions asked.'
            : 'بالتأكيد. نقدم ضمان استرداد الأموال لمدة 30 يوماً على جميع الخطط المدفوعة. إذا لم تكن راضياً، تواصل معنا خلال 30 يوماً لاسترداد كامل المبلغ.',
        },
        {
          q: locale === 'en' ? 'Is my data secure?' : 'هل بياناتي آمنة؟',
          a: locale === 'en'
            ? 'Yes. We use bank-level AES-256 encryption for all data at rest and TLS 1.3 for data in transit. Our servers are hosted in the UAE on AWS Middle East (Bahrain) region, ensuring compliance with UAE data residency requirements.'
            : 'نعم. نستخدم تشفير AES-256 بمستوى البنوك لجميع البيانات المخزنة و TLS 1.3 للبيانات المنقولة. خوادمنا مستضافة في الإمارات على منطقة AWS الشرق الأوسط (البحرين)، مما يضمن الامتثال لمتطلبات إقامة البيانات الإماراتية.',
        },
      ],
    },
    footerCta: {
      title: locale === 'en' ? 'Ready to automate your accounting?' : 'مستعد لأتمتة محاسبتك؟',
      subtitle: locale === 'en'
        ? 'Join hundreds of UAE businesses saving 20+ hours per month with AI-powered accounting.'
        : 'انضم لمئات الشركات الإماراتية التي توفر 20+ ساعة شهرياً مع المحاسبة المدعومة بالذكاء الاصطناعي.',
      startFree: locale === 'en' ? 'Start Free' : 'ابدأ مجاناً',
      bookDemo: locale === 'en' ? 'Book a Demo' : 'احجز عرض توضيحي',
      guarantee: locale === 'en' ? '14-day free trial  |  No credit card required  |  30-day money-back guarantee' : 'تجربة مجانية 14 يوم  |  لا حاجة لبطاقة ائتمان  |  ضمان استرداد 30 يوم',
    },
    nav: {
      home: locale === 'en' ? 'Home' : 'الرئيسية',
      pricing: locale === 'en' ? 'Pricing' : 'الأسعار',
      login: locale === 'en' ? 'Login' : 'تسجيل الدخول',
      languageToggle: locale === 'en' ? 'العربية' : 'EN',
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

  const renderCheckOrDash = (included: boolean) => {
    if (included) {
      return (
        <div className="flex justify-center">
          <div className="h-6 w-6 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
            <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          </div>
        </div>
      );
    }
    return (
      <div className="flex justify-center">
        <Minus className="h-4 w-4 text-muted-foreground/40" />
      </div>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className={`min-h-screen bg-background ${isRTL ? 'rtl' : 'ltr'}`} dir={isRTL ? 'rtl' : 'ltr'}>
      {/* ── Mini Nav ─────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto flex h-16 items-center justify-between px-4 md:px-6">
          <Link href="/">
            <div className="flex items-center gap-2 cursor-pointer">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                <Calculator className="h-4 w-4 text-white" />
              </div>
              <span className="font-bold text-lg">Muhasib.ai</span>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={toggleLanguage}>
              <Globe className="h-4 w-4 me-1" />
              {t.nav.languageToggle}
            </Button>
            <Link href="/login">
              <Button variant="ghost" size="sm">{t.nav.login}</Button>
            </Link>
            <Link href="/register">
              <Button size="sm" className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-700 hover:to-teal-700">
                {t.footerCta.startFree}
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Header Section ───────────────────────────────────────────── */}
      <section className="py-16 md:py-24 px-4">
        <div className="container mx-auto text-center max-w-3xl">
          <ScrollReveal>
            <Badge variant="secondary" className="mb-4 px-4 py-1.5 text-sm">
              <Sparkles className="h-3.5 w-3.5 me-1.5" />
              {locale === 'en' ? 'Trusted by 500+ UAE businesses' : 'موثوق من 500+ شركة إماراتية'}
            </Badge>
          </ScrollReveal>
          <ScrollReveal delay={0.1}>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-4">
              {t.header.title}
            </h1>
          </ScrollReveal>
          <ScrollReveal delay={0.2}>
            <p className="text-lg md:text-xl text-muted-foreground mb-10">
              {t.header.subtitle}
            </p>
          </ScrollReveal>

          {/* Monthly / Yearly Toggle */}
          <ScrollReveal delay={0.3}>
            <div className="flex items-center justify-center gap-3">
              <span className={`text-sm font-medium transition-colors ${!isYearly ? 'text-foreground' : 'text-muted-foreground'}`}>
                {t.header.monthly}
              </span>
              <Switch
                checked={isYearly}
                onCheckedChange={setIsYearly}
                className="data-[state=checked]:bg-emerald-600"
              />
              <span className={`text-sm font-medium transition-colors ${isYearly ? 'text-foreground' : 'text-muted-foreground'}`}>
                {t.header.yearly}
              </span>
              <AnimatePresence>
                {isYearly && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8, x: -10 }}
                    animate={{ opacity: 1, scale: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.8, x: -10 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                  >
                    <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800">
                      {t.header.save20}
                    </Badge>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* ── Pricing Cards ────────────────────────────────────────────── */}
      <section className="pb-20 px-4">
        <div className="container mx-auto">
          <StaggerContainer className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto">
            {tiers.map((tier) => {
              const tierKey = tier.id as keyof typeof t.tiers;
              const tierT = t.tiers[tierKey];
              const tierFeatures = t.tierFeatures[tierKey];
              const price = getPrice(tier);
              const TierIcon = tier.icon;

              return (
                <StaggerItem key={tier.id}>
                  <motion.div whileHover={hoverLift} className="h-full">
                    <Card
                      className={`relative h-full flex flex-col overflow-hidden transition-all duration-300 ${
                        tier.highlight
                          ? 'border-emerald-500 dark:border-emerald-400 shadow-lg shadow-emerald-500/10 ring-1 ring-emerald-500/20 scale-[1.02] lg:scale-105'
                          : 'hover:border-foreground/20'
                      }`}
                    >
                      {/* Gradient top accent */}
                      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${
                        tier.id === 'free' ? 'from-slate-400 to-slate-500' :
                        tier.id === 'starter' ? 'from-blue-400 to-blue-600' :
                        tier.id === 'professional' ? 'from-emerald-400 to-teal-600' :
                        'from-purple-400 to-purple-600'
                      }`} />

                      <CardHeader className="pb-4">
                        {/* Badge */}
                        {tier.badge && (
                          <div className="mb-3">
                            <Badge
                              variant={tier.badgeVariant}
                              className={
                                tier.badge === 'mostPopular'
                                  ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-600'
                                  : ''
                              }
                            >
                              {tier.badge === 'mostPopular' && <Star className="h-3 w-3 me-1" />}
                              {t.badges[tier.badge as keyof typeof t.badges]}
                            </Badge>
                          </div>
                        )}

                        {/* Icon + Name */}
                        <div className="flex items-center gap-3 mb-2">
                          <div className={`h-10 w-10 rounded-xl bg-gradient-to-br ${tier.gradient} flex items-center justify-center`}>
                            <TierIcon className={`h-5 w-5 ${tier.iconColor}`} />
                          </div>
                          <CardTitle className="text-xl">{tierT.name}</CardTitle>
                        </div>
                        <CardDescription className="text-sm">{tierT.description}</CardDescription>

                        {/* Price */}
                        <div className="mt-4 flex items-baseline gap-1">
                          <AnimatePresence mode="wait">
                            <motion.span
                              key={`${tier.id}-${isYearly}`}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -10 }}
                              transition={{ duration: 0.2 }}
                              className="text-4xl font-bold tracking-tight"
                            >
                              {formatPrice(price)}
                            </motion.span>
                          </AnimatePresence>
                          {price > 0 && (
                            <span className="text-muted-foreground text-sm">{t.header.perMonth}</span>
                          )}
                        </div>
                        {price > 0 && isYearly && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {locale === 'en'
                              ? `Billed AED ${price * 12}/year`
                              : `يُفوتر ${price * 12} درهم/سنة`}
                          </p>
                        )}
                      </CardHeader>

                      <CardContent className="flex-1 pb-4">
                        {/* Upsell from Starter */}
                        {'header' in tierFeatures && (
                          <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
                            {(tierFeatures as { header: string }).header}
                          </p>
                        )}

                        <ul className="space-y-2.5">
                          {tierFeatures.features.map((feature, idx) => (
                            <li key={idx} className="flex items-start gap-2 text-sm">
                              <Check className={`h-4 w-4 mt-0.5 shrink-0 ${
                                tier.highlight ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'
                              }`} />
                              <span>{feature}</span>
                            </li>
                          ))}
                        </ul>
                      </CardContent>

                      <CardFooter className="pt-2 pb-6">
                        <Link href={tier.id === 'enterprise' ? '#contact' : '/register'} className="w-full">
                          <Button
                            variant={tier.ctaVariant}
                            className={`w-full ${
                              tier.highlight
                                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-700 hover:to-teal-700 shadow-lg shadow-emerald-500/25'
                                : tier.id === 'starter'
                                ? 'bg-blue-600 text-white hover:bg-blue-700'
                                : ''
                            }`}
                            size="lg"
                          >
                            {tierT.cta}
                            <ArrowRight className="h-4 w-4 ms-2" />
                          </Button>
                        </Link>
                      </CardFooter>
                    </Card>
                  </motion.div>
                </StaggerItem>
              );
            })}
          </StaggerContainer>
        </div>
      </section>

      {/* ── Feature Comparison Table ─────────────────────────────────── */}
      <section className="py-20 px-4 bg-muted/30">
        <div className="container mx-auto max-w-6xl">
          <ScrollReveal>
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold mb-3">{t.comparison.title}</h2>
              <p className="text-muted-foreground text-lg">{t.comparison.subtitle}</p>
            </div>
          </ScrollReveal>

          <ScrollReveal delay={0.15}>
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="w-[280px] font-semibold text-foreground">
                        {locale === 'en' ? 'Feature' : 'الميزة'}
                      </TableHead>
                      {tiers.map((tier) => (
                        <TableHead key={tier.id} className="text-center min-w-[120px]">
                          <div className="flex flex-col items-center gap-1">
                            <span className={`font-semibold text-foreground ${tier.highlight ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>
                              {t.tiers[tier.id as keyof typeof t.tiers].name}
                            </span>
                            <span className="text-xs text-muted-foreground font-normal">
                              {getPrice(tier) === 0 ? t.header.free : `AED ${getPrice(tier)}${t.header.perMonth}`}
                            </span>
                          </div>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {featureMatrix.map((category) => (
                      <>
                        {/* Category header row */}
                        <TableRow key={category.categoryKey} className="bg-muted/20">
                          <TableCell colSpan={5} className="font-semibold text-sm text-foreground py-3">
                            {t.featureCategories[category.categoryKey as keyof typeof t.featureCategories]}
                          </TableCell>
                        </TableRow>
                        {/* Feature rows */}
                        {category.features.map((feature) => (
                          <TableRow key={feature.key}>
                            <TableCell className="text-sm">
                              {t.featureNames[feature.key as keyof typeof t.featureNames]}
                            </TableCell>
                            <TableCell>{renderCheckOrDash(feature.free)}</TableCell>
                            <TableCell>{renderCheckOrDash(feature.starter)}</TableCell>
                            <TableCell>{renderCheckOrDash(feature.professional)}</TableCell>
                            <TableCell>{renderCheckOrDash(feature.enterprise)}</TableCell>
                          </TableRow>
                        ))}
                      </>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </ScrollReveal>
        </div>
      </section>

      {/* ── Competitor Comparison ─────────────────────────────────────── */}
      <section className="py-20 px-4">
        <div className="container mx-auto max-w-5xl">
          <ScrollReveal>
            <div className="text-center mb-12">
              <Badge variant="outline" className="mb-4 px-4 py-1.5">
                <TrendingUp className="h-3.5 w-3.5 me-1.5" />
                {locale === 'en' ? 'Competitive Edge' : 'الميزة التنافسية'}
              </Badge>
              <h2 className="text-3xl md:text-4xl font-bold mb-3">{t.competitor.title}</h2>
              <p className="text-muted-foreground text-lg">{t.competitor.subtitle}</p>
            </div>
          </ScrollReveal>

          <ScrollReveal delay={0.15}>
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="w-[200px] font-semibold text-foreground">
                        {t.competitor.feature}
                      </TableHead>
                      <TableHead className="text-center min-w-[130px]">
                        <div className="flex flex-col items-center">
                          <span className="font-bold text-emerald-600 dark:text-emerald-400">{t.competitor.muhasib}</span>
                        </div>
                      </TableHead>
                      <TableHead className="text-center min-w-[110px]">
                        <span className="font-semibold text-muted-foreground">{t.competitor.digits}</span>
                      </TableHead>
                      <TableHead className="text-center min-w-[110px]">
                        <span className="font-semibold text-muted-foreground">{t.competitor.wafeq}</span>
                      </TableHead>
                      <TableHead className="text-center min-w-[110px]">
                        <span className="font-semibold text-muted-foreground">{t.competitor.zoho}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {competitorData.map((row) => (
                      <TableRow key={row.featureKey}>
                        <TableCell className="font-medium text-sm">
                          {t.competitorFeatures[row.featureKey as keyof typeof t.competitorFeatures]}
                        </TableCell>
                        {(['muhasib', 'digits', 'wafeq', 'zoho'] as const).map((col) => (
                          <TableCell key={col} className="text-center">
                            {typeof row[col] === 'string' ? (
                              <span className={`text-sm font-semibold ${col === 'muhasib' ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>
                                {row[col] as string}
                              </span>
                            ) : (
                              renderCheckOrDash(row[col] as boolean)
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </ScrollReveal>
        </div>
      </section>

      {/* ── FAQ Section ──────────────────────────────────────────────── */}
      <section className="py-20 px-4 bg-muted/30">
        <div className="container mx-auto max-w-3xl">
          <ScrollReveal>
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold mb-3">{t.faq.title}</h2>
              <p className="text-muted-foreground text-lg">{t.faq.subtitle}</p>
            </div>
          </ScrollReveal>

          <ScrollReveal delay={0.15}>
            <Card className="p-2 md:p-6">
              <Accordion type="single" collapsible className="w-full">
                {t.faq.questions.map((item, idx) => (
                  <AccordionItem key={idx} value={`faq-${idx}`}>
                    <AccordionTrigger className="text-left text-base hover:no-underline">
                      {item.q}
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground leading-relaxed">
                      {item.a}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </Card>
          </ScrollReveal>
        </div>
      </section>

      {/* ── Footer CTA ───────────────────────────────────────────────── */}
      <section className="py-20 px-4">
        <div className="container mx-auto max-w-3xl">
          <ScrollReveal>
            <Card className="relative overflow-hidden bg-gradient-to-br from-emerald-600 to-teal-700 text-white border-0">
              {/* Decorative background elements */}
              <div className="absolute inset-0 opacity-10">
                <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-white" />
                <div className="absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-white" />
              </div>

              <CardContent className="relative py-12 md:py-16 text-center">
                <h2 className="text-3xl md:text-4xl font-bold mb-4">
                  {t.footerCta.title}
                </h2>
                <p className="text-emerald-100 text-lg mb-8 max-w-xl mx-auto">
                  {t.footerCta.subtitle}
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-6">
                  <Link href="/register">
                    <Button size="lg" className="bg-white text-emerald-700 hover:bg-emerald-50 shadow-xl min-w-[180px]">
                      {t.footerCta.startFree}
                      <ArrowRight className="h-4 w-4 ms-2" />
                    </Button>
                  </Link>
                  <a href="https://wa.me/971552564788?text=I'd%20like%20a%20demo%20of%20Muhasib.ai" target="_blank" rel="noopener noreferrer">
                    <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10 min-w-[180px]">
                      <Phone className="h-4 w-4 me-2" />
                      {t.footerCta.bookDemo}
                    </Button>
                  </a>
                </div>
                <p className="text-emerald-200 text-sm flex items-center justify-center gap-2">
                  <Shield className="h-4 w-4" />
                  {t.footerCta.guarantee}
                </p>
              </CardContent>
            </Card>
          </ScrollReveal>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="border-t py-8 px-4">
        <div className="container mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <Calculator className="h-3 w-3 text-white" />
            </div>
            <span>Muhasib.ai by NR Accounting Services</span>
          </div>
          <div className="flex items-center gap-4">
            <Lock className="h-3.5 w-3.5" />
            <span>{locale === 'en' ? 'Bank-level encryption' : 'تشفير بمستوى البنوك'}</span>
            <span className="text-muted-foreground/40">|</span>
            <span>{locale === 'en' ? 'UAE-hosted' : 'مستضاف في الإمارات'}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
