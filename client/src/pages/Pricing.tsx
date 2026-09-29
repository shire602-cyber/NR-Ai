import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Link } from "wouter";
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
  Bot,
  Gem,
} from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollReveal, StaggerContainer, StaggerItem, hoverLift } from "@/lib/animations";
import { messages as pageMessages } from "./Pricing.i18n";

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
    badge: "recommended",
    badgeVariant: "secondary",
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
      { key: "fixedAssets", free: false, starter: false, professional: true, enterprise: true },
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
      { key: "payrollWPS", free: false, starter: false, professional: true, enterprise: true },
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
      { key: "apiAccess", free: false, starter: false, professional: false, enterprise: true },
    ],
  },
];

// ── Component ──────────────────────────────────────────────────────────

export default function Pricing() {
  const tr = pageMessages.useT();

  const { locale, setLocale } = useI18n();
  const [isYearly, setIsYearly] = useState(false);
  const isRTL = locale === "ar";

  const toggleLanguage = () => {
    setLocale(locale === "en" ? "ar" : "en");
  };

  // ── Translations ────────────────────────────────────────────────────

  const t = {
    header: {
      title: tr("simpleTransparentPricing"),
      subtitle: tr("startFreeScaleAsYouGrow"),
      monthly: tr("monthly"),
      yearly: tr("yearly"),
      save20: tr("save20"),
      perMonth: tr("mo"),
      free: tr("free"),
    },
    tiers: {
      free: {
        name: tr("free"),
        description: tr("forFreelancersGettingStarted"),
        cta: tr("getStartedFree"),
      },
      starter: {
        name: tr("starter"),
        description: tr("forSmallBusinessesScalingUp"),
        cta: tr("start14DayTrial"),
      },
      professional: {
        name: tr("professional"),
        description: tr("forGrowingCompaniesWithTeams"),
        cta: tr("start14DayTrial"),
      },
      enterprise: {
        name: tr("enterprise"),
        description: tr("forLargeOrganizations"),
        cta: tr("contactSales"),
      },
    },
    badges: {
      recommended: tr("recommended"),
      mostPopular: tr("mostPopular"),
    },
    limits: {
      companies: tr("company"),
      companiesPlural: tr("companies"),
      users: tr("user"),
      usersPlural: tr("users"),
      unlimited: tr("unlimited"),
      invoicesMonth: tr("invoicesMo"),
      receiptsMonth: tr("receiptsMo"),
    },
    tierFeatures: {
      free: {
        features:
          locale === "en"
            ? [
                tr("n1Company1User"),
                tr("n50InvoicesMonth"),
                tr("n20ReceiptsMonth"),
                tr("basicAiCategorization"),
                tr("vatFiling"),
                tr("bankReconciliationManual"),
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
                tr("n1Company3Users"),
                tr("n200InvoicesMonth"),
                tr("n100ReceiptsMonth"),
                tr("aiOcrScanning"),
                tr("aiCategorization"),
                tr("recurringInvoices"),
                tr("billPay"),
                tr("inventoryManagement"),
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
        header: tr("everythingInStarterPlus"),
        features:
          locale === "en"
            ? [
                tr("n3Companies10Users"),
                tr("unlimitedInvoices"),
                tr("unlimitedReceipts"),
                tr("autonomousGlAiAutoPosting"),
                tr("aiCfoFinancialAdvisor"),
                tr("aiAnomalyDetection"),
                tr("aiCashFlowForecast"),
                tr("smartReconciliation"),
                tr("monthEndCloseAutomation"),
                tr("payrollWps"),
                tr("fixedAssetsDepreciation"),
                tr("budgetingVariance"),
                tr("expenseClaims"),
                tr("corporateTax9"),
                tr("eInvoicingPintAe"),
                tr("clientPortal"),
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
        header: tr("everythingInProfessionalPlus"),
        features:
          locale === "en"
            ? [
                tr("unlimitedCompaniesUnlimitedUsers"),
                tr("priorityAiProcessing"),
                tr("dedicatedAccountManager"),
                tr("customIntegrations"),
                tr("enterpriseSupportTerms"),
                tr("advancedAnalytics"),
                tr("multiBranchSupport"),
                tr("apiAccess"),
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
      title: tr("completeFeatureComparison"),
      subtitle: tr("everyFeatureAcrossEveryPlan"),
    },
    featureCategories: {
      coreAccounting: tr("coreAccounting"),
      aiIntelligence: tr("aiIntelligence"),
      hrPayroll: tr("hrPayroll"),
      uaeCompliance: tr("uaeCompliance"),
      communication: tr("communication"),
      platform: tr("platform"),
    },
    featureNames: {
      invoicing: tr("invoicing"),
      receiptScanning: tr("receiptScanning"),
      bankReconciliation: tr("bankReconciliation"),
      vatFiling: tr("vatFiling2"),
      recurringInvoices: tr("recurringInvoices2"),
      billPay: tr("billPay2"),
      inventoryManagement: tr("inventoryManagement2"),
      monthEndClose: tr("monthEndClose"),
      fixedAssets: tr("fixedAssetsDepreciation"),
      budgeting: tr("budgetingVariance"),
      expenseClaims: tr("expenseClaims"),
      basicAICategorization: tr("basicAiCategorization2"),
      aiOCR: tr("aiOcrScanning2"),
      autonomousGL: tr("autonomousGlAutoPosting"),
      aiCFO: tr("aiCfoFinancialAdvisor"),
      aiAnomalyDetection: tr("aiAnomalyDetection"),
      aiCashFlowForecast: tr("aiCashFlowForecast"),
      smartReconciliation: tr("smartReconciliation"),
      priorityAI: tr("priorityAiProcessing2"),
      payrollWPS: tr("payrollWps"),
      vatFilingCompliance: tr("vatFiling5"),
      corporateTax: tr("corporateTax9"),
      eInvoicing: tr("eInvoicingPintAe"),
      clientPortal: tr("clientPortal"),
      multiCompany: tr("multiCompany"),
      dedicatedManager: tr("dedicatedAccountManager2"),
      customIntegrations: tr("customIntegrations2"),
      slaGuarantee: tr("enterpriseSupportTerms2"),
      advancedAnalytics: tr("advancedAnalytics2"),
      multiBranch: tr("multiBranchSupport2"),
      apiAccess: tr("apiAccess2"),
    },
    faq: {
      title: tr("frequentlyAskedQuestions"),
      subtitle: tr("everythingYouNeedToKnowAbout"),
      questions: [
        {
          q: tr("canISwitchPlansAnytime"),
          a: tr("yesYouCanUpgradeOrDowngrade"),
        },
        {
          q: tr("isThereAFreeTrial"),
          a: tr("yesWeOfferA14Day"),
        },
        {
          q: tr("whatPaymentMethodsDoYouAccept"),
          a: tr("weAcceptAllMajorCreditAnd"),
        },
        {
          q: tr("doYouOfferRefunds"),
          a: tr("absolutelyWeOfferA30Day"),
        },
        {
          q: tr("isMyDataSecure"),
          a: tr("weUseTlsForDataIn"),
        },
      ],
    },
    footerCta: {
      title: tr("readyToAutomateYourAccounting"),
      subtitle: tr("startWithGuidedOnboardingVatReady"),
      startFree: tr("startFree"),
      bookDemo: tr("bookADemo"),
      guarantee: tr("n14DayFreeTrialNoCredit"),
    },
    nav: {
      home: tr("home"),
      pricing: tr("pricing"),
      login: tr("login"),
      // The switch label names the OTHER language in its own script.
      languageToggle: tr.locale === "en" ? "العربية" : "EN",
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
          <div className="h-6 w-6 rounded-full bg-success-subtle flex items-center justify-center">
            <Check className="h-3.5 w-3.5 text-success " />
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
    <div
      className={`min-h-screen bg-background ${isRTL ? "rtl" : "ltr"}`}
      dir={isRTL ? "rtl" : "ltr"}
    >
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
              <Button variant="ghost" size="sm">
                {t.nav.login}
              </Button>
            </Link>
            <Link href="/register">
              <Button
                size="sm"
                className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-700 hover:to-teal-700"
              >
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
              {tr("launchPricingForUaeSmes")}
            </Badge>
          </ScrollReveal>
          <ScrollReveal delay={0.1}>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-4">
              {t.header.title}
            </h1>
          </ScrollReveal>
          <ScrollReveal delay={0.2}>
            <p className="text-lg md:text-xl text-muted-foreground mb-10">{t.header.subtitle}</p>
          </ScrollReveal>

          {/* Monthly / Yearly Toggle */}
          <ScrollReveal delay={0.3}>
            <div className="flex items-center justify-center gap-3">
              <span
                className={`text-sm font-medium transition-colors ${!isYearly ? "text-foreground" : "text-muted-foreground"}`}
              >
                {t.header.monthly}
              </span>
              <Switch
                checked={isYearly}
                onCheckedChange={setIsYearly}
                className="data-[state=checked]:bg-success"
              />
              <span
                className={`text-sm font-medium transition-colors ${isYearly ? "text-foreground" : "text-muted-foreground"}`}
              >
                {t.header.yearly}
              </span>
              <AnimatePresence>
                {isYearly && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8, x: -10 }}
                    animate={{ opacity: 1, scale: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.8, x: -10 }}
                    transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  >
                    <Badge className="bg-success-subtle text-success border-success/30 ">
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
                          ? "border-success shadow-lg shadow-emerald-500/10 ring-1 ring-success/20 scale-[1.02] lg:scale-105"
                          : "hover:border-foreground/20"
                      }`}
                    >
                      {/* Gradient top accent */}
                      <div
                        className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${
                          tier.id === "free"
                            ? "from-slate-400 to-slate-500"
                            : tier.id === "starter"
                              ? "from-blue-400 to-blue-600"
                              : tier.id === "professional"
                                ? "from-emerald-400 to-teal-600"
                                : "from-purple-400 to-purple-600"
                        }`}
                      />

                      <CardHeader className="pb-4">
                        {/* Badge */}
                        {tier.badge && (
                          <div className="mb-3">
                            <Badge
                              variant={tier.badgeVariant}
                              className={
                                tier.badge === "mostPopular"
                                  ? "bg-success text-white border-success hover:bg-success"
                                  : ""
                              }
                            >
                              {tier.badge === "mostPopular" && <Star className="h-3 w-3 me-1" />}
                              {t.badges[tier.badge as keyof typeof t.badges]}
                            </Badge>
                          </div>
                        )}

                        {/* Icon + Name */}
                        <div className="flex items-center gap-3 mb-2">
                          <div
                            className={`h-10 w-10 rounded-xl bg-gradient-to-br ${tier.gradient} flex items-center justify-center`}
                          >
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
                            <span className="text-muted-foreground text-sm">
                              {t.header.perMonth}
                            </span>
                          )}
                        </div>
                        {price > 0 && isYearly && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {locale === "en"
                              ? `Billed AED ${price * 12}/year`
                              : `يُفوتر ${price * 12} درهم/سنة`}
                          </p>
                        )}
                      </CardHeader>

                      <CardContent className="flex-1 pb-4">
                        {/* Upsell from Starter */}
                        {"header" in tierFeatures && (
                          <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
                            {(tierFeatures as { header: string }).header}
                          </p>
                        )}

                        <ul className="space-y-2.5">
                          {tierFeatures.features.map((feature, idx) => (
                            <li key={idx} className="flex items-start gap-2 text-sm">
                              <Check
                                className={`h-4 w-4 mt-0.5 shrink-0 ${
                                  tier.highlight ? "text-success " : "text-muted-foreground"
                                }`}
                              />
                              <span>{feature}</span>
                            </li>
                          ))}
                        </ul>
                      </CardContent>

                      <CardFooter className="pt-2 pb-6">
                        <Link
                          href={tier.id === "enterprise" ? "#contact" : "/register"}
                          className="w-full"
                        >
                          <Button
                            variant={tier.ctaVariant}
                            className={`w-full ${
                              tier.highlight
                                ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-700 hover:to-teal-700 shadow-lg shadow-emerald-500/25"
                                : tier.id === "starter"
                                  ? "bg-info text-white hover:bg-info"
                                  : ""
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
                        {tr("feature")}
                      </TableHead>
                      {tiers.map((tier) => (
                        <TableHead key={tier.id} className="text-center min-w-[120px]">
                          <div className="flex flex-col items-center gap-1">
                            <span
                              className={`font-semibold text-foreground ${tier.highlight ? "text-success " : ""}`}
                            >
                              {t.tiers[tier.id as keyof typeof t.tiers].name}
                            </span>
                            <span className="text-xs text-muted-foreground font-normal">
                              {getPrice(tier) === 0
                                ? t.header.free
                                : `AED ${getPrice(tier)}${t.header.perMonth}`}
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
                          <TableCell
                            colSpan={5}
                            className="font-semibold text-sm text-foreground py-3"
                          >
                            {
                              t.featureCategories[
                                category.categoryKey as keyof typeof t.featureCategories
                              ]
                            }
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

      {/* Competitor comparison table removed: it made specific, unverified and
          in several cases false claims about named competitors (e.g. that Zoho Books
          lacks UAE VAT, corporate tax, Arabic and e-invoicing — all of which it has).
          Do not re-add a comparison unless every cell is backed by a dated screenshot
          from the competitor's own public documentation, with the verification date shown. */}

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
                    <AccordionTrigger className="text-start text-base hover:no-underline">
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
                <div className="absolute -top-24 -end-24 h-64 w-64 rounded-full bg-card" />
                <div className="absolute -bottom-16 -start-16 h-48 w-48 rounded-full bg-card" />
              </div>

              <CardContent className="relative py-12 md:py-16 text-center">
                <h2 className="text-3xl md:text-4xl font-bold mb-4">{t.footerCta.title}</h2>
                <p className="text-success-foreground text-lg mb-8 max-w-xl mx-auto">
                  {t.footerCta.subtitle}
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-6">
                  <Link href="/register">
                    <Button
                      size="lg"
                      className="bg-card text-success hover:bg-success-subtle shadow-xl min-w-[180px]"
                    >
                      {t.footerCta.startFree}
                      <ArrowRight className="h-4 w-4 ms-2" />
                    </Button>
                  </Link>
                  <a href="mailto:hello@muhasib.ai?subject=Muhasib.ai%20demo%20request">
                    <Button
                      size="lg"
                      variant="outline"
                      className="border-white/30 text-white hover:bg-card/10 min-w-[180px]"
                    >
                      <Phone className="h-4 w-4 me-2" />
                      {t.footerCta.bookDemo}
                    </Button>
                  </a>
                </div>
                <p className="text-success-foreground text-sm flex items-center justify-center gap-2">
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
            <span>{tr("muhasibAiByNrAccountingServices")}</span>
          </div>
          <div className="flex items-center gap-4">
            <Lock className="h-3.5 w-3.5" />
            <span>{tr("tlsSecuredAccess")}</span>
            <span className="text-muted-foreground/40">|</span>
            <span>{tr("uaeHosted")}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
