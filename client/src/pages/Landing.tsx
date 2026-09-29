import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  Sparkles,
  Zap,
  Shield,
  BarChart3,
  Receipt,
  FileText,
  CheckCircle2,
  ArrowRight,
  Globe,
  Brain,
  Clock,
  Star,
  Building2,
  Check,
  Briefcase,
  TrendingUp,
  ChevronRight,
  Lock,
  Bot,
  Award,
  Menu,
  Rocket,
  Target,
  X,
  Scan,
  FileCheck,
  PieChart,
  MessageSquare,
  Users,
  CreditCard,
  Play,
  Quote,
  Layers,
  CircleCheck,
  Crown,
  Gem,
  Timer,
  Wallet,
  ArrowUpRight,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { motion, useScroll, useTransform, AnimatePresence } from "framer-motion";
import {
  ScrollReveal,
  StaggerContainer,
  StaggerItem,
  Floating,
  hoverScale,
  hoverLift,
} from "@/lib/animations";
import { messages as pageMessages } from "./Landing.i18n";

export default function Landing() {
  const tr = pageMessages.useT();

  const { locale, setLocale } = useI18n();
  const [mounted, setMounted] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeTestimonial, setActiveTestimonial] = useState(0);

  useEffect(() => {
    setMounted(true);
    const interval = setInterval(() => {
      setActiveTestimonial((prev) => (prev + 1) % 3);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const toggleLanguage = () => {
    setLocale(locale === "en" ? "ar" : "en");
  };

  const isRTL = locale === "ar";

  const t = {
    nav: {
      features: tr("features"),
      pricing: tr("pricing"),
      testimonials: tr("testimonials"),
      login: tr("login"),
      getStarted: tr("startFree"),
      // The switch label names the OTHER language in its own script.
      languageToggle: tr.locale === "en" ? "العربية" : "EN",
    },
    hero: {
      badge: tr("servingUaeBusinessesSince2017Registered"),
      headline: tr("aiAssistedUaeTaxWorkflows"),
      headlineAccent: tr("fastReviewAiDrivenUaeTax"),
      subheadline: tr("trackTaxDeadlinesReviewAiAssisted"),
      ctaPrimary: tr("startNowForAed99Month"),
      ctaSecondary: tr("bookADemo"),
      noCreditCard: tr("talkToAnExpert"),
      cancelAnytime: tr("uaeTaxWorkflowSupport"),
    },
    stats: {
      invoices: tr("vatReadyInvoices"),
      accuracy: tr("reviewPrompts"),
      timeSaved: tr("csvBankImports"),
      businesses: tr("ctSchedules"),
    },
    features: {
      badge: tr("powerfulFeatures"),
      title: tr("everythingYouNeedToMasterYour"),
      subtitle: tr("builtFromTheGroundUpFor"),
    },
    testimonials: {
      badge: tr("lovedByBusinesses"),
      title: tr("whatOurCustomersSay"),
    },
    pricing: {
      badge: tr("simplePricing"),
      title: tr("chooseYourPlan"),
      subtitle: tr("startFreeScaleAsYouGrow"),
      monthly: tr("month"),
      popular: tr("mostPopular"),
      getStarted: tr("getStarted"),
      contactSales: tr("contactSales"),
    },
    cta: {
      title: tr("readyToTransformYourBusiness"),
      subtitle: tr("startWithGuidedOnboardingVatReady"),
      primary: tr("startYourFreeTrial"),
      secondary: tr("talkToSales"),
      guarantee: tr("n14DayFreeTrialNoCredit"),
    },
  };

  const features = [
    {
      icon: Bot,
      title: tr("aiExpenseCategorization"),
      description: tr("aiAssistedReviewPromptsHelpCategorize"),
      color: "from-violet-500 to-purple-600",
      bgColor: "bg-chart-5/10",
    },
    {
      icon: FileCheck,
      title: tr("smartInvoicing"),
      description: tr("createVatReadyInvoicesInSeconds"),
      color: "from-blue-500 to-cyan-600",
      bgColor: "bg-info/10",
    },
    {
      icon: Scan,
      title: tr("receiptOcrScanner"),
      description: tr("bulkUploadReceiptsAiAssistedExtraction"),
      color: "from-emerald-500 to-green-600",
      bgColor: "bg-success/10",
    },
    {
      icon: PieChart,
      title: tr("realTimeReports"),
      description: tr("accessPLBalanceSheetsAnd"),
      color: "from-orange-500 to-amber-600",
      bgColor: "bg-warning/10",
    },
    {
      icon: MessageSquare,
      title: tr("aiCfoAssistant"),
      description: tr("askQuestionsAboutYourFinancesIn"),
      color: "from-pink-500 to-rose-600",
      bgColor: "bg-chart-5/10",
    },
    {
      icon: Shield,
      title: tr("securityControls"),
      description: tr("roleBasedAccessAuditLogsManaged"),
      color: "from-slate-500 to-gray-600",
      bgColor: "bg-muted-foreground/10",
    },
  ];

  const testimonials = [
    {
      name: tr("ahmedK"),
      role: tr("eCommerceBusinessOwnerDubai"),
      image:
        "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop&crop=face",
      quote: tr("theGuidedSetupMadeInvoicesReceipt"),
      rating: 5,
      industry: tr("eCommerce"),
    },
    {
      name: tr("fatimaM"),
      role: tr("cfoRealEstateInvestmentFirm"),
      image:
        "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop&crop=face",
      quote: tr("managing15PropertiesWasANightmare"),
      rating: 5,
      industry: tr("realEstate"),
    },
    {
      name: tr("khalidS"),
      role: tr("freelanceConsultant"),
      image:
        "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop&crop=face",
      quote: tr("asAFreelancerINeededSomething"),
      rating: 5,
      industry: tr("consulting"),
    },
  ];

  const pricingPlans = [
    {
      name: tr("starter"),
      price: "AED 99",
      priceNote: tr("perMonth"),
      description: tr("perfectForFreelancersAndSmallBusinesses"),
      features: [
        tr("upTo100InvoicesMonth"),
        tr("aiExpenseCategorization2"),
        tr("unlimitedReceiptOcrScans"),
        tr("vatCtWorkpaperReports"),
        tr("emailChatSupport"),
      ],
      cta: tr("startNow"),
      popular: false,
      icon: Layers,
    },
    {
      name: tr("professional"),
      price: "AED 299",
      priceNote: tr("perMonth"),
      description: tr("forGrowingBusinessesThatNeedMore"),
      features: [
        tr("unlimitedInvoicesTransactions"),
        tr("aiCfoFinancialAdvisor"),
        tr("vatCtReviewWorkflows"),
        tr("multiCurrencySupport"),
        tr("bankReconciliation"),
        tr("priorityPhoneSupport"),
        tr("customFinancialReports"),
      ],
      cta: tr("startNow"),
      popular: true,
      icon: Crown,
    },
    {
      name: tr("enterprise"),
      price: tr("custom"),
      priceNote: tr("contactUs"),
      description: tr("forLargeOrganizationsWithComplexNeeds"),
      features: [
        tr("everythingInProfessional"),
        tr("multiCompanySupport"),
        tr("dedicatedAccountant"),
        tr("apiAccessIntegrations"),
        tr("whiteLabelOptions"),
        tr("enterpriseSupportTerms"),
      ],
      cta: tr("talkToAnExpert"),
      popular: false,
      icon: Gem,
    },
  ];

  // i18n-ignore: company names (logo strip) are proper names
  const logos = ["Emirates NBD", "ADNOC", "Etisalat", "Dubai Holding", "Majid Al Futtaim", "Emaar"];

  return (
    <div
      className={`min-h-screen bg-background ${isRTL ? "rtl" : "ltr"}`}
      dir={isRTL ? "rtl" : "ltr"}
    >
      {/* Premium Animated Background */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute top-0 start-1/4 w-[600px] h-[600px] bg-primary/20 rounded-full blur-[128px]"
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.3, 0.5, 0.3],
            x: [0, 50, 0],
            y: [0, 30, 0],
          }}
          transition={{
            duration: 8,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
        <motion.div
          className="absolute bottom-0 end-1/4 w-[500px] h-[500px] bg-chart-5/15 rounded-full blur-[128px]"
          animate={{
            scale: [1, 1.3, 1],
            opacity: [0.2, 0.4, 0.2],
            x: [0, -40, 0],
            y: [0, -50, 0],
          }}
          transition={{
            duration: 10,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 1,
          }}
        />
        <motion.div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-info/10 rounded-full blur-[128px]"
          animate={{
            scale: [1, 1.1, 1],
            opacity: [0.1, 0.3, 0.1],
            rotate: [0, 180, 360],
          }}
          transition={{
            duration: 15,
            repeat: Infinity,
            ease: "linear",
          }}
        />
      </div>

      {/* NAVBAR */}
      <motion.header
        className="sticky top-0 z-50 bg-background/60 backdrop-blur-2xl border-b border-white/10"
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <div className="container max-w-7xl mx-auto px-6 lg:px-8 h-20 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group" data-testid="link-logo">
            <motion.div
              className="relative"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <motion.div
                className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-violet-600 flex items-center justify-center shadow-lg shadow-primary/25"
                whileHover={{
                  boxShadow: "0 10px 40px -10px hsl(var(--primary) / 0.5)",
                  rotate: [0, -5, 5, -5, 0],
                }}
                transition={{ duration: 0.5 }}
              >
                <Briefcase className="w-5 h-5 text-white" />
              </motion.div>
              <motion.div
                className="absolute -top-1 -end-1 w-3 h-3 bg-success rounded-full border-2 border-background"
                animate={{
                  scale: [1, 1.2, 1],
                  opacity: [1, 0.7, 1],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
            </motion.div>
            <motion.div
              className="flex flex-col"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              <span className="font-bold text-xl leading-none tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
                Muhasib.ai
              </span>
              <span className="text-[10px] text-muted-foreground font-medium tracking-wider uppercase">
                {tr("byNrAccountingServices")}
              </span>
            </motion.div>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden lg:flex items-center gap-8">
            <a
              href="#features"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              data-testid="nav-features"
            >
              {t.nav.features}
            </a>
            <a
              href="#testimonials"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              data-testid="nav-testimonials"
            >
              {t.nav.testimonials}
            </a>
            <a
              href="#pricing"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              data-testid="nav-pricing"
            >
              {t.nav.pricing}
            </a>
          </nav>

          {/* Desktop Actions */}
          <motion.div
            className="hidden lg:flex items-center gap-4"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleLanguage}
                className="font-semibold transition-all duration-200"
                data-testid="button-language-toggle"
              >
                <motion.div
                  animate={{ rotate: [0, 360] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                >
                  <Globe className="w-4 h-4 me-2" />
                </motion.div>
                {t.nav.languageToggle}
              </Button>
            </motion.div>
            <Link href="/login">
              <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="button-login"
                  className="transition-all duration-200"
                >
                  {t.nav.login}
                </Button>
              </motion.div>
            </Link>
            <Link href="/register">
              <motion.div
                whileHover={{
                  scale: 1.05,
                  boxShadow: "0 10px 40px -10px hsl(var(--primary) / 0.4)",
                }}
                whileTap={{ scale: 0.95 }}
              >
                <Button
                  size="sm"
                  className="bg-gradient-to-r from-primary to-violet-600 hover:from-primary/90 hover:to-violet-600/90 shadow-lg shadow-primary/25 transition-all duration-200"
                  data-testid="button-get-started"
                >
                  {t.nav.getStarted}
                  <motion.div
                    animate={{ x: [0, 4, 0] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  >
                    <ArrowRight className="w-4 h-4 ms-2" />
                  </motion.div>
                </Button>
              </motion.div>
            </Link>
          </motion.div>

          {/* Mobile Menu Button */}
          <button
            className="lg:hidden p-2 hover-elevate active-elevate-2 rounded-lg"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            data-testid="button-mobile-menu"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-white/10 bg-background/95 backdrop-blur-2xl">
            <nav className="container max-w-7xl mx-auto px-6 py-6 flex flex-col gap-4">
              <a
                href="#features"
                className="text-base font-medium hover:text-primary transition-colors py-2"
                onClick={() => setMobileMenuOpen(false)}
                data-testid="mobile-nav-features"
              >
                {t.nav.features}
              </a>
              <a
                href="#testimonials"
                className="text-base font-medium hover:text-primary transition-colors py-2"
                onClick={() => setMobileMenuOpen(false)}
                data-testid="mobile-nav-testimonials"
              >
                {t.nav.testimonials}
              </a>
              <a
                href="#pricing"
                className="text-base font-medium hover:text-primary transition-colors py-2"
                onClick={() => setMobileMenuOpen(false)}
                data-testid="mobile-nav-pricing"
              >
                {t.nav.pricing}
              </a>
              <div className="flex flex-col gap-3 pt-4 border-t border-border/50">
                <Button
                  variant="ghost"
                  onClick={toggleLanguage}
                  data-testid="mobile-button-language-toggle"
                >
                  <Globe className="w-4 h-4 me-2" />
                  {t.nav.languageToggle}
                </Button>
                <Link href="/login">
                  <Button variant="ghost" className="w-full" data-testid="mobile-button-login">
                    {t.nav.login}
                  </Button>
                </Link>
                <Link href="/register">
                  <Button
                    className="w-full bg-gradient-to-r from-primary to-violet-600"
                    data-testid="mobile-button-get-started"
                  >
                    {t.nav.getStarted}
                    <ArrowRight className="w-4 h-4 ms-2" />
                  </Button>
                </Link>
              </div>
            </nav>
          </div>
        )}
      </motion.header>

      {/* HERO SECTION */}
      <section
        className="relative overflow-hidden pt-16 pb-24 lg:pt-24 lg:pb-32"
        data-testid="section-hero"
      >
        <div className="container max-w-7xl mx-auto px-6 lg:px-8 relative">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            {/* Text Content */}
            <ScrollReveal direction="up" delay={0.2}>
              <div className="max-w-2xl">
                {/* Trust Badge */}
                <motion.div
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-primary/10 to-violet-500/10 border border-primary/20 mb-8"
                  data-testid="badge-trust"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5 }}
                  whileHover={{ scale: 1.05 }}
                >
                  <div className="flex -space-x-2">
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className="w-6 h-6 rounded-full bg-gradient-to-br from-primary to-violet-600 border-2 border-background flex items-center justify-center"
                      >
                        <Users className="w-3 h-3 text-white" />
                      </div>
                    ))}
                  </div>
                  <span className="text-sm font-medium">{t.hero.badge}</span>
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Star key={i} className="w-3 h-3 fill-yellow-500 text-warning" />
                    ))}
                  </div>
                </motion.div>

                <motion.h1
                  className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-bold tracking-tight mb-4 leading-[1.1]"
                  data-testid="hero-headline"
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.3 }}
                >
                  <motion.span
                    className="bg-gradient-to-r from-foreground via-foreground to-foreground/50 bg-clip-text text-transparent"
                    animate={{
                      backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
                    }}
                    transition={{
                      duration: 5,
                      repeat: Infinity,
                      ease: "linear",
                    }}
                    style={{ backgroundSize: "200% 200%" }}
                  >
                    {t.hero.headline}
                  </motion.span>
                </motion.h1>
                <motion.p
                  className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-6 bg-gradient-to-r from-primary via-violet-500 to-cyan-500 bg-clip-text text-transparent animate-gradient"
                  data-testid="hero-headline-accent"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.4 }}
                >
                  {t.hero.headlineAccent}
                </motion.p>

                <motion.p
                  className="text-lg lg:text-xl text-muted-foreground leading-relaxed mb-10 max-w-xl"
                  data-testid="hero-subheadline"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.5 }}
                >
                  {t.hero.subheadline}
                </motion.p>

                <motion.div
                  className="flex flex-col sm:flex-row gap-4 mb-8"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.6 }}
                >
                  <Link href="/register">
                    <motion.div
                      whileHover={{
                        scale: 1.05,
                        boxShadow: "0 20px 60px -10px hsl(var(--primary) / 0.5)",
                      }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <Button
                        size="lg"
                        className="w-full sm:w-auto px-8 py-7 text-base font-semibold bg-gradient-to-r from-primary to-violet-600 hover:from-primary/90 hover:to-violet-600/90 shadow-2xl shadow-primary/30 transition-all"
                        data-testid="hero-button-start-trial"
                      >
                        {t.hero.ctaPrimary}
                        <motion.div
                          animate={{ x: [0, 5, 0] }}
                          transition={{ duration: 1.5, repeat: Infinity }}
                        >
                          <ArrowRight className="w-5 h-5 ms-2" />
                        </motion.div>
                      </Button>
                    </motion.div>
                  </Link>
                  <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                    <Button
                      size="lg"
                      variant="outline"
                      className="w-full sm:w-auto px-8 py-7 text-base font-semibold border-2 hover:bg-card/5 transition-all"
                      data-testid="hero-button-watch-demo"
                    >
                      <motion.div
                        animate={{ scale: [1, 1.1, 1] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      >
                        <Play className="w-5 h-5 me-2" />
                      </motion.div>
                      {t.hero.ctaSecondary}
                    </Button>
                  </motion.div>
                </motion.div>

                <div className="flex flex-wrap items-center gap-6 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <CircleCheck className="w-4 h-4 text-success" />
                    <span>{t.hero.noCreditCard}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CircleCheck className="w-4 h-4 text-success" />
                    <span>{t.hero.cancelAnytime}</span>
                  </div>
                </div>
              </div>
            </ScrollReveal>

            {/* Hero Visual - Premium 3D Dashboard Preview */}
            <ScrollReveal direction="right" delay={0.4}>
              <div className="relative lg:block" data-testid="hero-visual">
                {/* Main Dashboard Card */}
                <Floating intensity={15} duration={4}>
                  <div className="relative">
                    <motion.div
                      className="absolute inset-0 bg-gradient-to-r from-primary/30 to-violet-500/30 rounded-3xl blur-2xl transform rotate-2"
                      animate={{
                        rotate: [2, 4, 2],
                        scale: [1, 1.05, 1],
                      }}
                      transition={{
                        duration: 6,
                        repeat: Infinity,
                        ease: "easeInOut",
                      }}
                    />
                    <motion.div
                      className="relative rounded-2xl border border-white/20 bg-gradient-to-br from-card/90 to-card/50 backdrop-blur-xl p-6 shadow-2xl"
                      whileHover={{ scale: 1.02, rotate: 1 }}
                      transition={{ duration: 0.3 }}
                    >
                      {/* Dashboard Header */}
                      <div className="flex items-center justify-between mb-6 pb-4 border-b border-white/10">
                        <div className="flex items-center gap-3">
                          <div className="w-3 h-3 rounded-full bg-destructive" />
                          <div className="w-3 h-3 rounded-full bg-warning" />
                          <div className="w-3 h-3 rounded-full bg-success" />
                        </div>
                        <div dir="ltr" className="text-xs text-muted-foreground font-mono">
                          dashboard.bookkeep.ai
                        </div>
                      </div>

                      {/* Stats Row */}
                      <div className="grid grid-cols-3 gap-4 mb-6">
                        {[
                          {
                            label: tr("revenue"),
                            value: "AED 127,500",
                            color: "text-success",
                            icon: TrendingUp,
                          },
                          {
                            label: tr("expenses"),
                            value: "AED 43,200",
                            color: "text-warning",
                            icon: Wallet,
                          },
                          {
                            label: tr("profit"),
                            value: "AED 84,300",
                            color: "text-primary",
                            icon: BarChart3,
                          },
                        ].map((stat, i) => (
                          <div key={i} className="p-3 rounded-xl bg-card/5 border border-white/10">
                            <div className="flex items-center gap-2 mb-1">
                              <stat.icon className={`w-4 h-4 ${stat.color}`} />
                              <span className="text-xs text-muted-foreground">{stat.label}</span>
                            </div>
                            <div dir="ltr" className={`font-bold font-mono text-sm ${stat.color}`}>
                              {stat.value}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* AI Action */}
                      <div className="p-4 rounded-xl bg-gradient-to-r from-primary/10 to-violet-500/10 border border-primary/20 mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-violet-600 flex items-center justify-center">
                            <Bot className="w-5 h-5 text-white" />
                          </div>
                          <div className="flex-1">
                            <div className="text-sm font-medium mb-1">
                              {tr("aiJustCategorized12Expenses")}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {tr("savedYou15MinutesOfManual")}
                            </div>
                          </div>
                          <CheckCircle2 className="w-5 h-5 text-success" />
                        </div>
                      </div>

                      {/* Recent Invoices */}
                      <div className="space-y-2">
                        {[
                          { name: "Invoice #1247", amount: "AED 8,500", status: "Paid" },
                          { name: "Invoice #1248", amount: "AED 12,000", status: "Pending" },
                        ].map((inv, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between p-3 rounded-lg bg-card/5 border border-white/10"
                          >
                            <div className="flex items-center gap-3">
                              <FileText className="w-4 h-4 text-muted-foreground" />
                              <span className="text-sm">{inv.name}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span dir="ltr" className="font-mono text-sm">
                                {inv.amount}
                              </span>
                              <Badge
                                variant={inv.status === "Paid" ? "default" : "secondary"}
                                className="text-xs"
                              >
                                {inv.status}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  </div>
                </Floating>

                {/* Floating Elements */}
                <Floating intensity={20} duration={3}>
                  <motion.div
                    className="absolute -top-6 -end-6 w-20 h-20 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 shadow-xl shadow-green-500/30 flex items-center justify-center"
                    whileHover={{ scale: 1.1, rotate: 360 }}
                    transition={{ duration: 0.5 }}
                  >
                    <TrendingUp className="w-8 h-8 text-white" />
                  </motion.div>
                </Floating>
                <Floating intensity={15} duration={2}>
                  <motion.div
                    className="absolute -bottom-4 -start-4 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 shadow-xl shadow-violet-500/30 flex items-center gap-2"
                    animate={{
                      boxShadow: [
                        "0 10px 40px -10px hsl(262 83% 58% / 0.3)",
                        "0 20px 60px -10px hsl(262 83% 58% / 0.5)",
                        "0 10px 40px -10px hsl(262 83% 58% / 0.3)",
                      ],
                      scale: [1, 1.05, 1],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                  >
                    <Zap className="w-4 h-4 text-white" />
                    <span className="text-white text-sm font-medium">{tr("reviewQueueReady")}</span>
                  </motion.div>
                </Floating>
              </div>
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* LOGOS / SOCIAL PROOF */}
      <section
        className="py-12 border-y border-white/10 bg-card/[0.02]"
        data-testid="section-logos"
      >
        <div className="container max-w-7xl mx-auto px-6 lg:px-8">
          <p className="text-center text-sm text-muted-foreground mb-8">
            {tr("builtForUaeSmeAccountingWorkflows")}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-8 lg:gap-16 opacity-50">
            {logos.map((logo, i) => (
              <div key={i} className="text-lg font-bold text-muted-foreground tracking-wider">
                {logo}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* STATS SECTION */}
      <section className="py-20 lg:py-24" data-testid="section-stats">
        <div className="container max-w-7xl mx-auto px-6 lg:px-8">
          <StaggerContainer className="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
            {[
              {
                value: "VAT",
                label: t.stats.invoices,
                icon: FileText,
                color: "from-blue-500 to-cyan-500",
              },
              {
                value: "AI",
                label: t.stats.accuracy,
                icon: Target,
                color: "from-green-500 to-emerald-500",
              },
              {
                value: "CSV",
                label: t.stats.timeSaved,
                icon: Timer,
                color: "from-orange-500 to-amber-500",
              },
              {
                value: "CT",
                label: t.stats.businesses,
                icon: Building2,
                color: "from-violet-500 to-purple-500",
              },
            ].map((stat, i) => (
              <StaggerItem key={i} data-testid={`stat-${i}`}>
                <motion.div className="text-center group" whileHover={hoverLift}>
                  <motion.div
                    className={`w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br ${stat.color} flex items-center justify-center shadow-lg`}
                    whileHover={hoverScale}
                    animate={{
                      boxShadow: [
                        `0 10px 30px -10px hsl(var(--primary) / 0.2)`,
                        `0 20px 50px -10px hsl(var(--primary) / 0.4)`,
                        `0 10px 30px -10px hsl(var(--primary) / 0.2)`,
                      ],
                    }}
                    transition={{
                      boxShadow: { duration: 2, repeat: Infinity, ease: "easeInOut" },
                    }}
                  >
                    <stat.icon className="w-7 h-7 text-white" />
                  </motion.div>
                  <motion.div
                    dir="ltr"
                    className="text-4xl lg:text-5xl font-bold font-mono mb-2 bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ duration: 0.5, delay: i * 0.1 + 0.3, type: "spring" }}
                  >
                    {stat.value}
                  </motion.div>
                  <div className="text-sm text-muted-foreground">{stat.label}</div>
                </motion.div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* FEATURES SECTION */}
      <section id="features" className="py-24 lg:py-32 relative" data-testid="section-features">
        <div className="container max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16 lg:mb-20">
            <Badge
              className="mb-4 px-4 py-1.5 bg-primary/10 text-primary border-primary/20"
              variant="outline"
            >
              <Sparkles className="w-4 h-4 me-2" />
              {t.features.badge}
            </Badge>
            <h2 className="text-3xl lg:text-5xl font-bold mb-4" data-testid="features-title">
              {t.features.title}
            </h2>
            <p
              className="text-lg lg:text-xl text-muted-foreground max-w-3xl mx-auto"
              data-testid="features-subtitle"
            >
              {t.features.subtitle}
            </p>
          </div>

          <StaggerContainer className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
            {features.map((feature, index) => (
              <StaggerItem key={index} data-testid={`feature-card-${index}`}>
                <motion.div whileHover={hoverLift} transition={{ duration: 0.3 }}>
                  <Card className="group relative overflow-hidden p-8 border border-white/10 bg-card/[0.02] backdrop-blur-sm hover:bg-card/[0.05] hover:border-white/20 transition-all duration-500">
                    <motion.div
                      className={`absolute inset-0 bg-gradient-to-br ${feature.color}`}
                      initial={{ opacity: 0 }}
                      whileHover={{ opacity: 0.05 }}
                      transition={{ duration: 0.5 }}
                    />
                    <motion.div
                      className={`relative w-14 h-14 rounded-2xl bg-gradient-to-br ${feature.color} flex items-center justify-center mb-6 shadow-lg`}
                      whileHover={hoverScale}
                      animate={{
                        boxShadow: [
                          `0 10px 30px -10px hsl(var(--primary) / 0.2)`,
                          `0 20px 50px -10px hsl(var(--primary) / 0.4)`,
                          `0 10px 30px -10px hsl(var(--primary) / 0.2)`,
                        ],
                      }}
                      transition={{
                        boxShadow: { duration: 2, repeat: Infinity, ease: "easeInOut" },
                      }}
                    >
                      <feature.icon className="w-7 h-7 text-white" />
                    </motion.div>
                    <h3 className="text-xl font-semibold mb-3 group-hover:text-primary transition-colors">
                      {feature.title}
                    </h3>
                    <p className="text-muted-foreground leading-relaxed">{feature.description}</p>
                    <motion.div
                      className="absolute bottom-6 end-6"
                      initial={{ opacity: 0, scale: 0 }}
                      whileHover={{ opacity: 1, scale: 1, rotate: 45 }}
                      transition={{ duration: 0.3 }}
                    >
                      <ArrowUpRight className="w-5 h-5 text-primary" />
                    </motion.div>
                  </Card>
                </motion.div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* TESTIMONIALS SECTION */}
      <section
        id="testimonials"
        className="py-24 lg:py-32 bg-gradient-to-b from-transparent via-primary/5 to-transparent"
        data-testid="section-testimonials"
      >
        <div className="container max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <Badge
              className="mb-4 px-4 py-1.5 bg-primary/10 text-primary border-primary/20"
              variant="outline"
              data-testid="testimonials-badge"
            >
              <Quote className="w-4 h-4 me-2" />
              {t.testimonials.badge}
            </Badge>
            <h2 className="text-3xl lg:text-5xl font-bold mb-4" data-testid="testimonials-title">
              {t.testimonials.title}
            </h2>
          </div>

          <div className="grid lg:grid-cols-3 gap-8">
            {testimonials.map((testimonial, index) => (
              <Card
                key={index}
                className={`relative overflow-hidden p-8 border border-white/10 bg-card/[0.02] backdrop-blur-sm hover:bg-card/[0.05] transition-all duration-300 ${index === activeTestimonial ? "ring-2 ring-primary/50" : ""}`}
                data-testid={`testimonial-${index}`}
              >
                <div className="flex items-center gap-1 mb-6">
                  {[...Array(testimonial.rating)].map((_, i) => (
                    <Star key={i} className="w-5 h-5 fill-yellow-500 text-warning" />
                  ))}
                </div>
                <p className="text-lg leading-relaxed mb-8 text-foreground/90">
                  "{testimonial.quote}"
                </p>
                <div className="flex items-center gap-4">
                  <img
                    src={testimonial.image}
                    alt={testimonial.name}
                    className="w-12 h-12 rounded-full object-cover ring-2 ring-primary/20"
                  />
                  <div>
                    <div className="font-semibold">{testimonial.name}</div>
                    <div className="text-sm text-muted-foreground">{testimonial.role}</div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING SECTION */}
      <section id="pricing" className="py-24 lg:py-32" data-testid="section-pricing">
        <div className="container max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <Badge
              className="mb-4 px-4 py-1.5 bg-primary/10 text-primary border-primary/20"
              variant="outline"
              data-testid="pricing-badge"
            >
              <CreditCard className="w-4 h-4 me-2" />
              {t.pricing.badge}
            </Badge>
            <h2 className="text-3xl lg:text-5xl font-bold mb-4" data-testid="pricing-title">
              {t.pricing.title}
            </h2>
            <p
              className="text-lg text-muted-foreground max-w-2xl mx-auto"
              data-testid="pricing-subtitle"
            >
              {t.pricing.subtitle}
            </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {pricingPlans.map((plan, index) => (
              <Card
                key={index}
                className={`relative overflow-hidden p-8 border transition-all duration-300 hover:-translate-y-2 ${
                  plan.popular
                    ? "border-primary/50 bg-gradient-to-b from-primary/10 to-transparent shadow-xl shadow-primary/10"
                    : "border-white/10 bg-card/[0.02]"
                }`}
                data-testid={`pricing-${plan.name.toLowerCase()}`}
              >
                {plan.popular && (
                  <div className="absolute top-0 end-0 px-4 py-1.5 bg-gradient-to-r from-primary to-violet-600 text-white text-sm font-medium rounded-es-lg">
                    {t.pricing.popular}
                  </div>
                )}

                <div className="flex items-center gap-3 mb-4">
                  <div
                    className={`w-12 h-12 rounded-xl ${plan.popular ? "bg-gradient-to-br from-primary to-violet-600" : "bg-card/10"} flex items-center justify-center`}
                  >
                    <plan.icon
                      className={`w-6 h-6 ${plan.popular ? "text-white" : "text-foreground"}`}
                    />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold">{plan.name}</h3>
                    <p className="text-sm text-muted-foreground">{plan.description}</p>
                  </div>
                </div>

                <div className="mb-6 pb-6 border-b border-white/10">
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-bold">{plan.price}</span>
                    {plan.price !== "Free" && plan.price !== "Custom" && (
                      <span className="text-muted-foreground">{t.pricing.monthly}</span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{plan.priceNote}</p>
                </div>

                <ul className="space-y-4 mb-8">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <Check className="w-5 h-5 text-success flex-shrink-0 mt-0.5" />
                      <span className="text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>

                <Link href="/register">
                  <Button
                    className={`w-full py-6 font-semibold ${
                      plan.popular
                        ? "bg-gradient-to-r from-primary to-violet-600 hover:from-primary/90 hover:to-violet-600/90 shadow-lg shadow-primary/25"
                        : ""
                    }`}
                    variant={plan.popular ? "default" : "outline"}
                    data-testid={`pricing-button-${plan.name.toLowerCase()}`}
                  >
                    {plan.cta}
                    <ArrowRight className="w-4 h-4 ms-2" />
                  </Button>
                </Link>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA SECTION */}
      <section className="py-24 lg:py-32 relative overflow-hidden" data-testid="section-cta">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-violet-500/10 to-cyan-500/10" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent" />

        <div className="container max-w-7xl mx-auto px-6 lg:px-8 relative">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-card/10 backdrop-blur-sm border border-white/20 mb-8">
              <Rocket className="w-5 h-5 text-primary" />
              <span className="text-sm font-medium">{tr("launchYourFinancialTransformation")}</span>
            </div>

            <h2
              className="text-4xl lg:text-6xl font-bold mb-6 leading-tight"
              data-testid="cta-title"
            >
              {t.cta.title}
            </h2>
            <p
              className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto"
              data-testid="cta-subtitle"
            >
              {t.cta.subtitle}
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
              <Link href="/register">
                <Button
                  size="lg"
                  className="w-full sm:w-auto px-10 py-7 text-lg font-semibold bg-gradient-to-r from-primary to-violet-600 hover:from-primary/90 hover:to-violet-600/90 shadow-2xl shadow-primary/30 hover:shadow-primary/50 transition-all hover:scale-105"
                  data-testid="cta-button-start-trial"
                >
                  {t.cta.primary}
                  <ArrowRight className="w-5 h-5 ms-2" />
                </Button>
              </Link>
              <Button
                size="lg"
                variant="outline"
                className="w-full sm:w-auto px-10 py-7 text-lg font-semibold border-2 bg-card/5 hover:bg-card/10 backdrop-blur-sm"
                data-testid="cta-button-sales"
              >
                {t.cta.secondary}
              </Button>
            </div>

            <p className="text-sm text-muted-foreground" data-testid="cta-guarantee">
              {t.cta.guarantee}
            </p>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer
        className="border-t border-white/10 py-16 bg-black/20 backdrop-blur-sm"
        data-testid="section-footer"
      >
        <div className="container max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-12 mb-12">
            {/* Brand */}
            <div className="lg:col-span-2">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-violet-600 flex items-center justify-center">
                  <Briefcase className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="font-bold text-xl">Muhasib.ai</div>
                  <div className="text-xs text-muted-foreground">
                    {tr("byNrAccountingServices")}
                  </div>
                </div>
              </div>
              <p className="text-muted-foreground max-w-sm mb-6">
                {tr("registeredAccountingFirmServingUaeBusinesses")}
              </p>
              <div className="flex items-center gap-4">
                <Badge variant="outline" className="gap-1.5">
                  <Shield className="w-3 h-3" />
                  {tr("socIsoRoadmap")}
                </Badge>
                <Badge variant="outline" className="gap-1.5">
                  <Lock className="w-3 h-3" />
                  {tr("secureTransport")}
                </Badge>
                <Badge variant="outline" className="gap-1.5">
                  <Award className="w-3 h-3" />
                  {tr("vatReady")}
                </Badge>
              </div>
            </div>

            {/* Links */}
            <div>
              <h4 className="font-semibold mb-4">{tr("product")}</h4>
              <ul className="space-y-3 text-sm text-muted-foreground">
                <li>
                  <a href="#features" className="hover:text-foreground transition-colors">
                    {tr("features")}
                  </a>
                </li>
                <li>
                  <a href="#pricing" className="hover:text-foreground transition-colors">
                    {tr("pricing")}
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-foreground transition-colors">
                    {tr("security")}
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-foreground transition-colors">
                    {tr("roadmap")}
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4">{tr("company")}</h4>
              <ul className="space-y-3 text-sm text-muted-foreground">
                <li>
                  <a href="#" className="hover:text-foreground transition-colors">
                    {tr("about")}
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-foreground transition-colors">
                    {tr("blog")}
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-foreground transition-colors">
                    {tr("careers")}
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-foreground transition-colors">
                    {tr("contact")}
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="pt-8 border-t border-white/10 flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="text-sm text-muted-foreground">
              {tr("n2025MuhasibAiByNrAccounting")}
              {tr("allRightsReserved")}
            </div>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <a href="#" className="hover:text-foreground transition-colors">
                {tr("privacyPolicy")}
              </a>
              <a href="#" className="hover:text-foreground transition-colors">
                {tr("termsOfService")}
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
