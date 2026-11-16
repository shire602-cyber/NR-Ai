import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  FileText,
  FileCheck,
  FileX,
  Calculator,
  BookOpen,
  Sparkles,
  BarChart3,
  Shield,
  CheckCircle2,
  ArrowRight,
  Users,
  Building2,
  Briefcase,
  Store,
  Home,
  Rocket,
  Phone,
  MessageSquare,
  Award,
  Clock,
  Handshake,
  Languages,
  TrendingUp,
  Star,
  Brain,
  Zap,
  ScanLine,
  Bot,
  LineChart,
  Target,
  Mic,
  FileSearch,
  AlertTriangle,
  Workflow,
} from "lucide-react";
import { useHasMounted } from "@/hooks/use-has-mounted";
import { useI18n, useTranslation } from "@/lib/i18n";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";

export default function Services() {
  const mounted = useHasMounted();
  const { locale } = useI18n();
  const { t: tr } = useTranslation();

  const t = {
    nav: {
      languageToggle: locale === "en" ? "العربية" : "EN",
      login: locale === "en" ? "Login" : "تسجيل الدخول",
      getStarted: tr["marketing.servicesStartFree"],
    },
    hero: {
      badge: locale === "en" ? "Dubai-Based Accounting Firm" : "شركة محاسبة مقرها دبي",
      headline: locale === "en" ? "Accounting & Tax Services" : "خدمات المحاسبة والضرائب",
      headlineAccent: tr["marketing.servicesBackedByExperts"],
      subheadline:
        locale === "en"
          ? "Operating in Dubai since 2017 — combining human expertise with AI automation for modern UAE businesses."
          : "نعمل في دبي منذ 2017 — نجمع بين الخبرة البشرية والأتمتة الذكية للشركات الإماراتية الحديثة.",
      ctaPrimary: tr["marketing.servicesBookAFreeConsultation"],
      ctaSecondary: tr["marketing.servicesGetStarted"],
      licensed:
        locale === "en" ? "Licensed & Registered in Dubai, UAE" : "مرخص ومسجل في دبي، الإمارات",
    },
    stats: {
      clients: locale === "en" ? "VAT Workflows" : "سير عمل ضريبة القيمة المضافة",
      yearsExp: locale === "en" ? "CT Schedules" : "جداول ضريبة الشركات",
      accuracy: locale === "en" ? "CSV Bank Imports" : "استيراد كشوف البنك CSV",
      satisfaction: tr["marketing.servicesGuidedSupport"],
    },
    services: {
      badge: tr["marketing.servicesOurServices"],
      headline: tr["marketing.servicesFeaturedCoreServices"],
      subheadline: tr["marketing.servicesComprehensiveAccountingAndTaxSolutionsTailored"],
    },
    whyChoose: {
      badge: tr["marketing.servicesWhyChooseUs"],
      headline: tr["marketing.servicesYourTrustedPartner"],
      subheadline: tr["marketing.servicesExperienceTheDifferenceWithOurProven"],
    },
    clients: {
      badge: tr["marketing.servicesWhoWeServe"],
      headline: tr["marketing.servicesClientTypesWeServe"],
      subheadline:
        locale === "en"
          ? "From freelancers to enterprises, we support businesses of all sizes"
          : "من المستقلين إلى المؤسسات، ندعم الشركات بجميع أحجامها",
    },
    ai: {
      badge: locale === "en" ? "AI Capabilities" : "قدرات الذكاء الاصطناعي",
      headline: tr["marketing.servicesPoweredByAi"],
      subheadline:
        locale === "en"
          ? "Cutting-edge artificial intelligence that transforms your bookkeeping experience"
          : "ذكاء اصطناعي متطور يحول تجربة مسك الدفاتر الخاصة بك",
      currentBadge: tr["marketing.servicesAvailableNow"],
      futureBadge: tr["marketing.servicesComingSoon"],
    },
    cta: {
      headline:
        locale === "en"
          ? "Need help with VAT or Tax Setup?"
          : "تحتاج مساعدة في إعداد ضريبة القيمة المضافة أو الضرائب؟",
      subheadline:
        locale === "en"
          ? "Get expert guidance from our Dubai-based accounting team. We'll help you navigate UAE tax regulations with confidence."
          : "احصل على إرشادات خبراء من فريق المحاسبة لدينا في دبي. سنساعدك على التنقل في اللوائح الضريبية الإماراتية بثقة.",
      primary: tr["marketing.servicesBookAFreeConsultation"],
      secondary: tr["marketing.servicesTalkToAnExpert"],
      freeConsult: tr["marketing.servicesFreeInitialConsultation"],
      response: locale === "en" ? "Response within 24 hours" : "رد خلال 24 ساعة",
      noCommitment: tr["marketing.servicesNoCommitmentRequired"],
    },
  };

  const coreServices = [
    {
      icon: FileText,
      title: locale === "en" ? "VAT Registration & Filing" : "تسجيل وتقديم ضريبة القيمة المضافة",
      description:
        locale === "en"
          ? "Complete VAT registration with FTA and ongoing quarterly/monthly filing support."
          : "تسجيل كامل لضريبة القيمة المضافة مع الهيئة الاتحادية للضرائب ودعم التقديم الربعي/الشهري.",
      bgColor: "bg-brand-50 dark:bg-brand-400/10",
    },
    {
      icon: Building2,
      title: tr["marketing.servicesCorporateTaxRegistration"],
      description:
        locale === "en"
          ? "UAE Corporate Tax registration and compliance setup for businesses over AED 375,000."
          : "تسجيل ضريبة الشركات الإماراتية وإعداد الامتثال للشركات التي تزيد عن 375,000 درهم.",
      bgColor: "bg-brand-50 dark:bg-brand-400/10",
    },
    {
      icon: FileX,
      title: locale === "en" ? "VAT Deregistration" : "إلغاء تسجيل ضريبة القيمة المضافة",
      description:
        locale === "en"
          ? "Smooth VAT deregistration process when your business no longer meets thresholds."
          : "عملية إلغاء تسجيل سلسة عندما لم يعد نشاطك يستوفي الحدود.",
      bgColor: "bg-brand-50 dark:bg-brand-400/10",
    },
    {
      icon: FileCheck,
      title: tr["marketing.servicesCorporateTaxDeregistration"],
      description:
        locale === "en"
          ? "Complete corporate tax deregistration for business closures or restructuring."
          : "إلغاء تسجيل ضريبة الشركات الكامل لإغلاق الأعمال أو إعادة الهيكلة.",
      bgColor: "bg-brand-50 dark:bg-brand-400/10",
    },
    {
      icon: Calculator,
      title:
        locale === "en" ? "VAT & Tax Return Filing" : "تقديم إقرارات ضريبة القيمة المضافة والضرائب",
      description:
        locale === "en"
          ? "Accurate and timely VAT and Corporate Tax return preparation and submission."
          : "إعداد وتقديم إقرارات ضريبة القيمة المضافة وضريبة الشركات بدقة وفي الوقت المحدد.",
      bgColor: "bg-brand-50 dark:bg-brand-400/10",
    },
    {
      icon: BookOpen,
      title: locale === "en" ? "Books Cleanup & Catch-up" : "تنظيف وتحديث الدفاتر",
      description:
        locale === "en"
          ? "Bring your books up to date with historical data entry and reconciliation."
          : "قم بتحديث دفاترك مع إدخال البيانات التاريخية والمطابقة.",
      bgColor: "bg-brand-50 dark:bg-brand-400/10",
    },
    {
      icon: Sparkles,
      title: locale === "en" ? "AI-Powered Bookkeeping" : "مسك الدفاتر بالذكاء الاصطناعي",
      description:
        locale === "en"
          ? "Modern bookkeeping with AI automation for expense categorization and data entry."
          : "مسك دفاتر حديث مع أتمتة الذكاء الاصطناعي لتصنيف المصروفات وإدخال البيانات.",
      bgColor: "bg-brand-50 dark:bg-brand-400/10",
    },
    {
      icon: BarChart3,
      title: tr["marketing.servicesFinancialStatementPreparation"],
      description:
        locale === "en"
          ? "Professional P&L statements, balance sheets, and cash flow reports."
          : "قوائم الأرباح والخسائر والميزانيات وتقارير التدفق النقدي الاحترافية.",
      bgColor: "bg-brand-50 dark:bg-brand-400/10",
    },
    {
      icon: Shield,
      title: locale === "en" ? "Compliance Review & Audit Support" : "مراجعة الامتثال ودعم التدقيق",
      description:
        locale === "en"
          ? "Pre-audit reviews and support during FTA audits and compliance checks."
          : "مراجعات ما قبل التدقيق والدعم أثناء تدقيقات الهيئة وفحوصات الامتثال.",
      bgColor: "bg-brand-50 dark:bg-brand-400/10",
    },
  ];

  const whyChooseUs = [
    {
      icon: Award,
      title: locale === "en" ? "Registered Firm Since 2017" : "شركة مسجلة منذ 2017",
      description:
        locale === "en"
          ? "Licensed accounting firm operating in Dubai with years of proven expertise."
          : "شركة محاسبة مرخصة تعمل في دبي مع سنوات من الخبرة المثبتة.",
    },
    {
      icon: Sparkles,
      title: locale === "en" ? "AI + Human Expertise" : "الذكاء الاصطناعي + الخبرة البشرية",
      description:
        locale === "en"
          ? "Best of both worlds - AI automation backed by experienced accountants."
          : "أفضل ما في العالمين - أتمتة الذكاء الاصطناعي مدعومة بمحاسبين ذوي خبرة.",
    },
    {
      icon: Shield,
      title: locale === "en" ? "UAE Tax Workflow Support" : "دعم سير العمل الضريبي الإماراتي",
      description:
        locale === "en"
          ? "Services structured around UAE tax recordkeeping, review, and submission support."
          : "خدمات منظمة حول حفظ السجلات الضريبية الإماراتية والمراجعة ودعم التقديم.",
    },
    {
      icon: Languages,
      title: tr["marketing.servicesBilingualSupport"],
      description:
        locale === "en"
          ? "Full support in English and Arabic for seamless communication."
          : "دعم كامل بالإنجليزية والعربية للتواصل السلس.",
    },
  ];

  const clientTypes = [
    { icon: Briefcase, title: locale === "en" ? "Freelancers" : "المستقلين" },
    { icon: Store, title: locale === "en" ? "SMEs" : "الشركات الصغيرة والمتوسطة" },
    { icon: Store, title: locale === "en" ? "E-commerce" : "التجارة الإلكترونية" },
    { icon: Building2, title: tr["marketing.servicesHoldingCompanies"] },
    { icon: Home, title: tr["marketing.servicesRealEstate"] },
    { icon: Rocket, title: locale === "en" ? "Startups" : "الشركات الناشئة" },
  ];

  const currentAiCapabilities = [
    {
      icon: ScanLine,
      title: locale === "en" ? "OCR Receipt Scanning" : "مسح الإيصالات بالتعرف الضوئي",
      description:
        locale === "en"
          ? "Instantly extract merchant, amount, date, and VAT from receipts using advanced OCR technology."
          : "استخراج فوري للتاجر والمبلغ والتاريخ وضريبة القيمة المضافة من الإيصالات باستخدام تقنية التعرف الضوئي المتقدمة.",
      bgColor: "bg-brand-50 dark:bg-brand-400/10",
      iconColor: "text-accent",
    },
    {
      icon: Brain,
      title: tr["marketing.servicesSmartExpenseCategorization"],
      description:
        locale === "en"
          ? "AI-assisted categorisation prompts help your team review expenses against the chart of accounts."
          : "تساعد تنبيهات التصنيف المدعومة بالذكاء الاصطناعي فريقك على مراجعة المصروفات مقابل دليل الحسابات.",
      bgColor: "bg-brand-50 dark:bg-brand-400/10",
      iconColor: "text-accent",
    },
    {
      icon: Zap,
      title: tr["marketing.servicesBulkReceiptProcessing"],
      description:
        locale === "en"
          ? "Upload multiple receipts at once. Our AI processes them in parallel for maximum efficiency."
          : "ارفع عدة إيصالات دفعة واحدة. الذكاء الاصطناعي يعالجها بالتوازي لأقصى كفاءة.",
      bgColor: "bg-brand-50 dark:bg-brand-400/10",
      iconColor: "text-accent",
    },
    {
      icon: FileSearch,
      title: tr["marketing.servicesIntelligentDataExtraction"],
      description:
        locale === "en"
          ? "Automatically extract and validate TRN numbers, invoice details, and payment terms."
          : "استخراج والتحقق تلقائياً من أرقام التسجيل الضريبي وتفاصيل الفواتير وشروط الدفع.",
      bgColor: "bg-brand-50 dark:bg-brand-400/10",
      iconColor: "text-accent",
    },
  ];

  const futureAiCapabilities = [
    {
      icon: Bot,
      title: locale === "en" ? "AI CFO / Financial Advisor" : "المدير المالي بالذكاء الاصطناعي",
      description:
        locale === "en"
          ? "Get personalized financial advice, cash flow predictions, and strategic recommendations from your AI advisor."
          : "احصل على نصائح مالية مخصصة وتنبؤات التدفق النقدي وتوصيات استراتيجية من مستشارك الذكي.",
      bgColor: "bg-brand-50 dark:bg-brand-400/10",
      iconColor: "text-accent",
    },
    {
      icon: LineChart,
      title: tr["marketing.servicesPredictiveAnalytics"],
      description:
        locale === "en"
          ? "AI-powered forecasting for revenue, expenses, and cash flow based on historical patterns."
          : "تنبؤات مدعومة بالذكاء الاصطناعي للإيرادات والمصروفات والتدفق النقدي بناءً على الأنماط التاريخية.",
      bgColor: "bg-brand-50 dark:bg-brand-400/10",
      iconColor: "text-accent",
    },
    {
      icon: AlertTriangle,
      title: tr["marketing.servicesAnomalyDetection"],
      description:
        locale === "en"
          ? "Automatically flag unusual transactions, duplicate payments, and potential fraud."
          : "تحديد تلقائي للمعاملات غير العادية والمدفوعات المكررة والاحتيال المحتمل.",
      bgColor: "bg-brand-50 dark:bg-brand-400/10",
      iconColor: "text-accent",
    },
    {
      icon: Mic,
      title: tr["marketing.servicesVoiceCommands"],
      description:
        locale === "en"
          ? "Create invoices, log expenses, and query reports using natural voice commands in English or Arabic."
          : "إنشاء الفواتير وتسجيل المصروفات والاستعلام عن التقارير باستخدام الأوامر الصوتية بالإنجليزية أو العربية.",
      bgColor: "bg-brand-50 dark:bg-brand-400/10",
      iconColor: "text-accent",
    },
    {
      icon: Target,
      title: tr["marketing.servicesSmartTaxOptimization"],
      description:
        locale === "en"
          ? "AI-assisted tax review prompts that help accountants spot planning and documentation gaps."
          : "تنبيهات مراجعة ضريبية مدعومة بالذكاء الاصطناعي تساعد المحاسبين على اكتشاف فجوات التخطيط والتوثيق.",
      bgColor: "bg-brand-50 dark:bg-brand-400/10",
      iconColor: "text-accent",
    },
    {
      icon: Workflow,
      title: tr["marketing.servicesAutomatedWorkflows"],
      description:
        locale === "en"
          ? "Set up automated rules for recurring transactions, approvals, and reminders."
          : "إعداد قواعد آلية للمعاملات المتكررة والموافقات والتذكيرات.",
      bgColor: "bg-brand-50 dark:bg-brand-400/10",
      iconColor: "text-accent",
    },
  ];

  const stats = [
    { value: "VAT", label: t.stats.clients, icon: Users },
    { value: "CT", label: t.stats.yearsExp, icon: Clock },
    { value: "CSV", label: t.stats.accuracy, icon: TrendingUp },
    { value: locale === "en" ? "Help" : "مساعدة", label: t.stats.satisfaction, icon: Star },
  ];

  return (
    <MarketingLayout
      titleKey="marketing.seoServicesTitle"
      descriptionKey="marketing.seoServicesDescription"
    >
      {/* Hero Section - Two Column Layout */}
      <section className="relative overflow-hidden pt-16 pb-20 lg:pt-24 lg:pb-28 flex items-center">
        <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8 w-full">
          <div className={`grid grid-cols-1 lg:grid-cols-5 gap-12 lg:gap-16 items-center`}>
            {/* Text Content - 60% */}
            <div
              className={`lg:col-span-3 text-start ${mounted ? "animate-in fade-in slide-in-from-bottom-4" : ""}`}
              style={{ animationDuration: "600ms" }}
            >
              <Badge
                className="mb-6 bg-primary/10 text-primary border-primary/20 px-4 py-1.5"
                data-testid="badge-hero"
              >
                <Award className={`w-4 h-4 me-2`} />
                {t.hero.badge}
              </Badge>

              <h1 className="mk-display mb-6" data-testid="text-hero-headline">
                <span>{t.hero.headline}</span>
                <br />
                <span className="mk-accent">{t.hero.headlineAccent}</span>
              </h1>

              <p className="mk-lead mb-8 max-w-2xl" data-testid="text-hero-subheadline">
                {t.hero.subheadline}
              </p>

              <div className={`flex flex-col sm:flex-row gap-4 justify-start`}>
                <Button asChild size="xl" data-testid="button-book-consultation">
                  <Link href="/register">
                    <Phone className="w-5 h-5" />
                    {t.hero.ctaPrimary}
                  </Link>
                </Button>
                <Button asChild size="xl" variant="outline" data-testid="button-hero-get-started">
                  <Link href="/login">
                    {t.hero.ctaSecondary}
                    <ArrowRight className={`w-5 h-5 rtl:-scale-x-100`} />
                  </Link>
                </Button>
              </div>

              <p
                className={`mt-6 text-sm text-muted-foreground flex items-center gap-2 justify-start`}
                data-testid="text-licensed"
              >
                <Shield className="w-4 h-4" />
                {t.hero.licensed}
              </p>
            </div>

            {/* Hero Visual - 40% with Glassmorphism */}
            <div
              className={`lg:col-span-2 ${mounted ? "animate-in fade-in slide-in-from-bottom-6" : ""}`}
              style={{ animationDelay: "200ms", animationDuration: "700ms" }}
            >
              <div className="relative">
                {/* Glassmorphic Card */}
                <div
                  className="relative rounded-xl border bg-card p-8 shadow-card-soft"
                  data-testid="hero-visual-card"
                >
                  <div className="relative z-10 space-y-6">
                    {/* Service Icons Grid */}
                    <div className="grid grid-cols-3 gap-4">
                      {[
                        {
                          icon: FileText,
                          color: "bg-brand-50 dark:bg-brand-400/10",
                          iconColor: "text-accent",
                        },
                        {
                          icon: Calculator,
                          color: "bg-brand-50 dark:bg-brand-400/10",
                          iconColor: "text-accent",
                        },
                        {
                          icon: BarChart3,
                          color: "bg-brand-50 dark:bg-brand-400/10",
                          iconColor: "text-accent",
                        },
                        {
                          icon: Shield,
                          color: "bg-brand-50 dark:bg-brand-400/10",
                          iconColor: "text-accent",
                        },
                        {
                          icon: Sparkles,
                          color: "bg-brand-50 dark:bg-brand-400/10",
                          iconColor: "text-accent",
                        },
                        {
                          icon: Building2,
                          color: "bg-brand-50 dark:bg-brand-400/10",
                          iconColor: "text-accent",
                        },
                      ].map((item, index) => (
                        <div
                          key={index}
                          className={`${item.color} rounded-xl p-4 flex items-center justify-center`}
                          data-testid={`hero-icon-${index}`}
                        >
                          <item.icon className={`w-6 h-6 ${item.iconColor}`} />
                        </div>
                      ))}
                    </div>

                    {/* Trust Indicators */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 text-sm" data-testid="hero-trust-1">
                        <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0" />
                        <span className="text-foreground/80">
                          {locale === "en"
                            ? "UAE Tax Workflow Support"
                            : "دعم سير عمل الضرائب في الإمارات"}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-sm" data-testid="hero-trust-2">
                        <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0" />
                        <span className="text-foreground/80">
                          {locale === "en" ? "AI-Powered Automation" : "أتمتة بالذكاء الاصطناعي"}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-sm" data-testid="hero-trust-3">
                        <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0" />
                        <span className="text-foreground/80">
                          {locale === "en"
                            ? "Bilingual Support (EN/AR)"
                            : "دعم ثنائي اللغة (EN/AR)"}
                        </span>
                      </div>
                    </div>

                    {/* Floating Badge */}
                    <div className="flex justify-center">
                      <Badge
                        className="bg-primary text-primary-foreground border-0 px-4 py-2 text-sm font-semibold"
                        data-testid="hero-badge-cta"
                      >
                        <Star className={`w-4 h-4 me-2`} />
                        {locale === "en" ? "Since 2017" : "منذ 2017"}
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 border-y bg-muted/20">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div
            className={`grid grid-cols-2 lg:grid-cols-4 gap-8 ${mounted ? "animate-in fade-in slide-in-from-bottom-4" : ""}`}
            style={{ animationDelay: "50ms", animationDuration: "600ms" }}
          >
            {stats.map((stat, index) => (
              <div key={stat.label} className="text-center" data-testid={`stat-${index}`}>
                <div className="flex items-center justify-center mb-2">
                  <stat.icon className="w-6 h-6 text-primary opacity-60" />
                </div>
                <div
                  className="text-xl font-semibold text-foreground mb-1"
                  data-testid={`stat-value-${index}`}
                >
                  {stat.value}
                </div>
                <div
                  className="text-sm text-muted-foreground font-medium"
                  data-testid={`stat-label-${index}`}
                >
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Core Services Section */}
      <section className="py-20 lg:py-28">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div
            className={`text-center mb-16 ${mounted ? "animate-in fade-in slide-in-from-bottom-4" : ""}`}
            style={{ animationDelay: "100ms", animationDuration: "600ms" }}
          >
            <Badge
              className="mb-4 bg-accent/10 text-accent border-accent/20 px-4 py-1.5"
              data-testid="badge-services"
            >
              {t.services.badge}
            </Badge>
            <h2 className="mk-h2 mb-4" data-testid="text-services-headline">
              {t.services.headline}
            </h2>
            <p
              className="text-lg text-muted-foreground max-w-2xl mx-auto"
              data-testid="text-services-subheadline"
            >
              {t.services.subheadline}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {coreServices.map((service, index) => (
              <Card
                key={index}
                className={`p-6 hover-elevate transition-all duration-300 group overflow-hidden relative border-border/50 ${mounted ? "animate-in fade-in slide-in-from-bottom-4" : ""}`}
                style={{ animationDelay: `${150 + index * 50}ms`, animationDuration: "600ms" }}
                data-testid={`card-service-${index}`}
              >
                <div className="absolute inset-0 dark:dark:dark:opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                <div
                  className={`w-14 h-14 rounded-xl ${service.bgColor} flex items-center justify-center mb-4 relative z-10`}
                >
                  <service.icon className="w-7 h-7 text-primary" />
                </div>

                <h3
                  className="text-xl font-semibold mb-2 relative z-10 group-hover:text-primary transition-colors"
                  data-testid={`text-service-title-${index}`}
                >
                  {service.title}
                </h3>

                <p
                  className="text-muted-foreground relative z-10 leading-relaxed"
                  data-testid={`text-service-description-${index}`}
                >
                  {service.description}
                </p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Why Choose Us Section */}
      <section className="py-20 lg:py-28 bg-muted/30">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div
            className={`text-center mb-16 ${mounted ? "animate-in fade-in slide-in-from-bottom-4" : ""}`}
            style={{ animationDelay: "200ms", animationDuration: "600ms" }}
          >
            <Badge
              className="mb-4 bg-success/10 text-success border-success/20 px-4 py-1.5"
              data-testid="badge-why-choose"
            >
              <CheckCircle2 className={`w-4 h-4 me-2`} />
              {t.whyChoose.badge}
            </Badge>
            <h2 className="mk-h2 mb-4" data-testid="text-why-choose-headline">
              {t.whyChoose.headline}
            </h2>
            <p
              className="text-lg text-muted-foreground max-w-2xl mx-auto"
              data-testid="text-why-choose-subheadline"
            >
              {t.whyChoose.subheadline}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {whyChooseUs.map((item, index) => (
              <div
                key={index}
                className={`text-center p-6 rounded-xl border bg-card hover-elevate transition-all duration-300 ${mounted ? "animate-in fade-in slide-in-from-bottom-4" : ""}`}
                style={{ animationDelay: `${250 + index * 75}ms`, animationDuration: "600ms" }}
                data-testid={`card-why-${index}`}
              >
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <item.icon className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2" data-testid={`text-why-title-${index}`}>
                  {item.title}
                </h3>
                <p
                  className="text-sm text-muted-foreground"
                  data-testid={`text-why-description-${index}`}
                >
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* AI Capabilities Section */}
      <section className="py-20 lg:py-28 relative overflow-hidden">
        <div className="absolute inset-0 dark:" />

        <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8">
          <div
            className={`text-center mb-16 ${mounted ? "animate-in fade-in slide-in-from-bottom-4" : ""}`}
            style={{ animationDelay: "250ms", animationDuration: "600ms" }}
          >
            <Badge
              className="mb-4 bg-success-subtle text-success-subtle-foreground border-transparent px-4 py-1.5"
              data-testid="badge-ai"
            >
              <Brain className={`w-4 h-4 me-2`} />
              {t.ai.badge}
            </Badge>
            <h2 className="mk-h2 mb-4" data-testid="text-ai-headline">
              {t.ai.headline}
            </h2>
            <p
              className="text-lg text-muted-foreground max-w-2xl mx-auto"
              data-testid="text-ai-subheadline"
            >
              {t.ai.subheadline}
            </p>
          </div>

          {/* Current AI Capabilities */}
          <div className="mb-16">
            <div
              className={`flex items-center justify-center gap-3 mb-8 ${mounted ? "animate-in fade-in slide-in-from-bottom-4" : ""}`}
              style={{ animationDelay: "300ms", animationDuration: "600ms" }}
            >
              <Badge
                className="bg-success/20 text-success border-success/30 px-4 py-2 text-sm font-semibold"
                data-testid="badge-ai-current"
              >
                <CheckCircle2 className={`w-4 h-4 me-2`} />
                {t.ai.currentBadge}
              </Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {currentAiCapabilities.map((capability, index) => (
                <Card
                  key={index}
                  className={`p-6 hover-elevate transition-all duration-300 group border-border/50 ${mounted ? "animate-in fade-in slide-in-from-bottom-4" : ""}`}
                  style={{ animationDelay: `${350 + index * 75}ms`, animationDuration: "600ms" }}
                  data-testid={`card-ai-current-${index}`}
                >
                  <div
                    className={`w-12 h-12 rounded-xl ${capability.bgColor} flex items-center justify-center mb-4`}
                  >
                    <capability.icon className={`w-6 h-6 ${capability.iconColor}`} />
                  </div>
                  <h3
                    className="text-lg font-semibold mb-2 group-hover:text-primary transition-colors"
                    data-testid={`text-ai-current-title-${index}`}
                  >
                    {capability.title}
                  </h3>
                  <p
                    className="text-sm text-muted-foreground leading-relaxed"
                    data-testid={`text-ai-current-desc-${index}`}
                  >
                    {capability.description}
                  </p>
                </Card>
              ))}
            </div>
          </div>

          {/* Future AI Capabilities */}
          <div>
            <div
              className={`flex items-center justify-center gap-3 mb-8 ${mounted ? "animate-in fade-in slide-in-from-bottom-4" : ""}`}
              style={{ animationDelay: "500ms", animationDuration: "600ms" }}
            >
              <Badge
                className="bg-warning/20 text-warning border-warning/30 px-4 py-2 text-sm font-semibold"
                data-testid="badge-ai-future"
              >
                <Rocket className={`w-4 h-4 me-2`} />
                {t.ai.futureBadge}
              </Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {futureAiCapabilities.map((capability, index) => (
                <Card
                  key={index}
                  className={`p-6 hover-elevate transition-all duration-300 group border-border/50 border-dashed ${mounted ? "animate-in fade-in slide-in-from-bottom-4" : ""}`}
                  style={{ animationDelay: `${550 + index * 75}ms`, animationDuration: "600ms" }}
                  data-testid={`card-ai-future-${index}`}
                >
                  <div className="flex items-start gap-4">
                    <div
                      className={`w-12 h-12 rounded-xl ${capability.bgColor} flex items-center justify-center flex-shrink-0`}
                    >
                      <capability.icon className={`w-6 h-6 ${capability.iconColor}`} />
                    </div>
                    <div>
                      <h3
                        className="text-lg font-semibold mb-2 group-hover:text-primary transition-colors"
                        data-testid={`text-ai-future-title-${index}`}
                      >
                        {capability.title}
                      </h3>
                      <p
                        className="text-sm text-muted-foreground leading-relaxed"
                        data-testid={`text-ai-future-desc-${index}`}
                      >
                        {capability.description}
                      </p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Client Types Section */}
      <section className="py-20 lg:py-28 bg-muted/30">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div
            className={`text-center mb-16 ${mounted ? "animate-in fade-in slide-in-from-bottom-4" : ""}`}
            style={{ animationDelay: "300ms", animationDuration: "600ms" }}
          >
            <Badge
              className="mb-4 border-transparent bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300 px-4 py-1.5"
              data-testid="badge-clients"
            >
              <Users className={`w-4 h-4 me-2`} />
              {t.clients.badge}
            </Badge>
            <h2 className="mk-h2 mb-4" data-testid="text-clients-headline">
              {t.clients.headline}
            </h2>
            <p
              className="text-lg text-muted-foreground max-w-2xl mx-auto"
              data-testid="text-clients-subheadline"
            >
              {t.clients.subheadline}
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {clientTypes.map((client, index) => (
              <div
                key={index}
                className={`flex flex-col items-center p-6 rounded-xl border bg-card hover-elevate transition-all duration-300 group ${mounted ? "animate-in fade-in slide-in-from-bottom-4" : ""}`}
                style={{ animationDelay: `${350 + index * 50}ms`, animationDuration: "600ms" }}
                data-testid={`card-client-${index}`}
              >
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                  <client.icon className="w-6 h-6 text-primary" />
                </div>
                <span
                  className="text-sm font-medium text-center"
                  data-testid={`text-client-${index}`}
                >
                  {client.title}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="py-20 lg:py-28 relative overflow-hidden">
        <div
          className={`relative z-10 max-w-4xl mx-auto px-6 lg:px-8 text-center ${mounted ? "animate-in fade-in slide-in-from-bottom-4" : ""}`}
          style={{ animationDelay: "400ms", animationDuration: "600ms" }}
        >
          <h2 className="mk-h2 mb-6" data-testid="text-cta-headline">
            {t.cta.headline}
          </h2>
          <p
            className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto"
            data-testid="text-cta-subheadline"
          >
            {t.cta.subheadline}
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Button asChild size="xl" data-testid="button-cta-consultation">
              <Link href="/register">
                <Phone className="w-5 h-5" />
                {t.cta.primary}
              </Link>
            </Button>
            <Button
              asChild
              size="xl"
              variant="outline"
              className="gap-2 px-8 py-6 text-lg backdrop-blur-sm"
              data-testid="button-cta-expert"
            >
              <Link href="/login">
                <MessageSquare className="w-5 h-5" />
                {t.cta.secondary}
              </Link>
            </Button>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
            <span className="flex items-center gap-2" data-testid="text-cta-free">
              <CheckCircle2 className="w-4 h-4 text-success" />
              {t.cta.freeConsult}
            </span>
            <span className="flex items-center gap-2" data-testid="text-cta-response">
              <Clock className="w-4 h-4 text-accent" />
              {t.cta.response}
            </span>
            <span className="flex items-center gap-2" data-testid="text-cta-commitment">
              <Handshake className="w-4 h-4 text-accent" />
              {t.cta.noCommitment}
            </span>
          </div>
        </div>
      </section>

      <p className="sr-only" data-testid="text-footer">
        {locale === "en"
          ? "Muhasib.ai accounting services by Najma Al Raeda Accounting LLC, Dubai"
          : "الخدمات المحاسبية من محاسب بواسطة نجمة الرائدة للمحاسبة ذ.م.م، دبي"}
      </p>
    </MarketingLayout>
  );
}
