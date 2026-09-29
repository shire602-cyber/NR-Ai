import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Scan,
  FileCheck,
  RefreshCw,
  Globe,
  Languages,
  LayoutDashboard,
  FileText,
  Users,
  CheckCircle2,
  ArrowRight,
  Building2,
  Shield,
  Award,
  Phone,
  Mail,
  MapPin,
  Check,
  Zap,
  ChevronRight,
  Menu,
  X,
} from "lucide-react";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ScrollReveal,
  StaggerContainer,
  StaggerItem,
  AnimatedNumber,
  hoverLift,
} from "@/lib/animations";
import { useI18n } from "@/lib/i18n";
import { messages as pageMessages } from "./LandingPage.i18n";

// ──────────────────────────────────────────────
// Data
// ──────────────────────────────────────────────

const getFeatures = () => [
  {
    icon: Scan,
    title: pageMessages.t("aiReceiptOcr"),
    description: pageMessages.t("photographReceiptsAndReviewAiExtracted"),
    color: "text-chart-5",
    bg: "bg-chart-5/10",
  },
  {
    icon: FileCheck,
    title: pageMessages.t("vatWorkflows"),
    description: pageMessages.t("vat201WorkpapersEInvoicingSupport"),
    color: "text-info",
    bg: "bg-info/10",
  },
  {
    icon: RefreshCw,
    title: pageMessages.t("bankReconciliation"),
    description: pageMessages.t("csvStatementImportsWithSmartMatching"),
    color: "text-success",
    bg: "bg-success/10",
  },
  {
    icon: Globe,
    title: pageMessages.t("multiCurrency"),
    description: pageMessages.t("aedAsHomeCurrencyWithReal"),
    color: "text-warning",
    bg: "bg-warning/10",
  },
  {
    icon: Languages,
    title: pageMessages.t("arabicEnglish"),
    description: pageMessages.t("fullBilingualInterfaceAndDocumentsSwitch"),
    color: "text-destructive",
    bg: "bg-destructive/10",
  },
  {
    icon: LayoutDashboard,
    title: pageMessages.t("realTimeDashboard"),
    description: pageMessages.t("cashFlowPLVatLiability"),
    color: "text-info",
    bg: "bg-info/10",
  },
  {
    icon: FileText,
    title: pageMessages.t("invoiceManagement"),
    description: pageMessages.t("createVatReadyTaxInvoicesSend"),
    color: "text-info",
    bg: "bg-info/10",
  },
  {
    icon: Users,
    title: pageMessages.t("payrollWpsSif"),
    description: pageMessages.t("generateWpsCompliantSifFilesCalculate"),
    color: "text-chart-5",
    bg: "bg-chart-5/10",
  },
];

const getSteps = () => [
  {
    number: "01",
    title: pageMessages.t("signUp"),
    description: pageMessages.t("createYourAccountInUnder2"),
    icon: CheckCircle2,
  },
  {
    number: "02",
    title: pageMessages.t("importYourStatement"),
    description: pageMessages.t("useTheSampleCsvOrUpload"),
    icon: Shield,
  },
  {
    number: "03",
    title: pageMessages.t("reviewSuggestedWork"),
    description: pageMessages.t("reviewSuggestedCategoriesVatExtractionInvoice"),
    icon: Zap,
  },
];

const getPlans = () => [
  {
    name: "Free",
    price: "0",
    period: "forever",
    description: pageMessages.t("perfectForSoleTradersAndFreelancers"),
    cta: pageMessages.t("startFree"),
    href: "/register",
    popular: false,
    features: [
      pageMessages.t("n50TransactionsMonth"),
      pageMessages.t("n5InvoicesMonth"),
      pageMessages.t("receiptOcr10Mo"),
      pageMessages.t("vatCalculator"),
      pageMessages.t("englishOnly"),
      pageMessages.t("emailSupport"),
    ],
  },
  {
    name: "Professional",
    price: "99",
    period: "/month",
    description: pageMessages.t("everythingAGrowingUaeSmeNeeds"),
    cta: pageMessages.t("startFreeTrial"),
    href: "/register",
    popular: true,
    features: [
      pageMessages.t("unlimitedTransactions"),
      pageMessages.t("unlimitedInvoices"),
      pageMessages.t("unlimitedReceiptOcr"),
      pageMessages.t("vat201WorkpaperExport"),
      pageMessages.t("bankReconciliation2"),
      pageMessages.t("multiCurrencyAed150"),
      pageMessages.t("arabicEnglishUi"),
      pageMessages.t("wpsPayrollSif"),
      pageMessages.t("realTimeDashboard2"),
      pageMessages.t("emailNotifications"),
      pageMessages.t("prioritySupport"),
    ],
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    description: pageMessages.t("forAccountingFirmsAndMultiEntity"),
    cta: pageMessages.t("contactUs"),
    href: "mailto:hello@muhasib.ai",
    popular: false,
    features: [
      pageMessages.t("everythingInProfessional"),
      pageMessages.t("multiEntityGroupCompanies"),
      pageMessages.t("dedicatedAccountManager"),
      pageMessages.t("customIntegrations"),
      pageMessages.t("enterpriseSupportTerms"),
      pageMessages.t("onSiteTraining"),
      pageMessages.t("taxAuditPreparationSupport"),
    ],
  },
];

const getStats = () => [
  { value: 12000, suffix: "+", label: pageMessages.t("invoicesGenerated") },
  { value: 99, suffix: "%", label: pageMessages.t("aiAccuracyRate") },
  { value: 20, suffix: "hrs", label: pageMessages.t("savedPerMonth") },
  { value: 500, suffix: "+", label: pageMessages.t("uaeBusinesses") },
];

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

export default function LandingPage() {
  const tr = pageMessages.useT();

  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { locale, setLocale } = useI18n();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const toggleLocale = () => setLocale(locale === "en" ? "ar" : "en");

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Navbar ── */}
      <header
        className={`fixed top-0 start-0 end-0 z-50 transition-all duration-300 ${
          scrolled ? "bg-background/95 backdrop-blur border-b shadow-sm" : "bg-transparent"
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link href="/">
              <div className="flex items-center gap-2 cursor-pointer">
                <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                  <span className="text-white font-bold text-sm">م</span>
                </div>
                <span className="font-bold text-lg tracking-tight">Muhasib.ai</span>
              </div>
            </Link>

            {/* Desktop nav */}
            <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
              <a
                href="#features"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {tr("features")}
              </a>
              <a
                href="#how-it-works"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {tr("howItWorks")}
              </a>
              <a
                href="#pricing"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {tr("pricing")}
              </a>
              <a
                href="#contact"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {tr("contact")}
              </a>
            </nav>

            {/* Desktop CTA */}
            <div className="hidden md:flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleLocale}
                aria-label={locale === "en" ? tr("switchToArabic") : tr("switchToEnglish")}
                data-testid="button-language-toggle"
                className="gap-1.5"
              >
                <Languages className="w-4 h-4" />
                <span className="text-xs font-semibold">
                  {/* The switch label names the OTHER language in its own script. */}
                  {tr.locale === "en" ? "العربية" : "English"}
                </span>
              </Button>
              <Link href="/login">
                <Button variant="ghost" size="sm">
                  {tr("signIn")}
                </Button>
              </Link>
              <Link href="/register">
                <Button size="sm" className="bg-primary hover:bg-primary/90">
                  {tr("startFreeTrial")}
                </Button>
              </Link>
            </div>

            {/* Mobile hamburger */}
            <button
              className="md:hidden p-2 rounded-md hover:bg-muted transition-colors"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label={tr("toggleMenu")}
            >
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="md:hidden bg-background border-b overflow-hidden"
            >
              <div className="px-4 py-4 flex flex-col gap-3">
                <a
                  href="#features"
                  onClick={() => setMenuOpen(false)}
                  className="text-sm font-medium py-2"
                >
                  {tr("features")}
                </a>
                <a
                  href="#how-it-works"
                  onClick={() => setMenuOpen(false)}
                  className="text-sm font-medium py-2"
                >
                  {tr("howItWorks")}
                </a>
                <a
                  href="#pricing"
                  onClick={() => setMenuOpen(false)}
                  className="text-sm font-medium py-2"
                >
                  {tr("pricing")}
                </a>
                <a
                  href="#contact"
                  onClick={() => setMenuOpen(false)}
                  className="text-sm font-medium py-2"
                >
                  {tr("contact")}
                </a>
                <Separator />
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-2"
                  onClick={() => {
                    toggleLocale();
                    setMenuOpen(false);
                  }}
                  data-testid="button-language-toggle-mobile"
                >
                  <Languages className="w-4 h-4" />
                  {tr.locale === "en" ? "العربية" : "English"}
                </Button>
                <Link href="/login">
                  <Button variant="outline" className="w-full" onClick={() => setMenuOpen(false)}>
                    {tr("signIn")}
                  </Button>
                </Link>
                <Link href="/register">
                  <Button className="w-full bg-primary" onClick={() => setMenuOpen(false)}>
                    {tr("startFreeTrial")}
                  </Button>
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* ── Hero ── */}
      <section className="relative pt-28 pb-20 lg:pt-36 lg:pb-28 overflow-hidden">
        {/* Background gradient blobs */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-primary/5 rounded-full blur-3xl" />
          <div className="absolute top-20 end-0 w-[400px] h-[400px] bg-chart-5/5 rounded-full blur-3xl" />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <ScrollReveal>
            <Badge
              variant="outline"
              className="mb-6 px-4 py-1.5 text-sm font-medium border-primary/30 text-primary bg-primary/5"
            >
              <Award className="w-3.5 h-3.5 me-1.5" />
              {tr("poweredByNajmaAlRaedaRegistered")}
            </Badge>
          </ScrollReveal>

          <ScrollReveal delay={0.1}>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-tight mb-6">
              {tr("aiBookkeeping")} <span className="text-primary">{tr("builtFor")}</span>
              <br className="hidden sm:block" /> {tr("uaeBusinesses")}
            </h1>
          </ScrollReveal>

          <ScrollReveal delay={0.2}>
            <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
              {tr("vatWorkflowSupportAiReceiptScanning")}
            </p>
          </ScrollReveal>

          <ScrollReveal delay={0.3}>
            <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
              <Link href="/register">
                <motion.div whileHover={hoverLift}>
                  <Button
                    size="lg"
                    className="bg-primary hover:bg-primary/90 px-8 text-base h-12 shadow-lg shadow-primary/25"
                  >
                    {tr("startFreeTrial")}
                    <ArrowRight className="w-4 h-4 ms-2" />
                  </Button>
                </motion.div>
              </Link>
              <a href="mailto:hello@muhasib.ai">
                <motion.div whileHover={hoverLift}>
                  <Button size="lg" variant="outline" className="px-8 text-base h-12">
                    {tr("bookADemo")}
                    <ChevronRight className="w-4 h-4 ms-1" />
                  </Button>
                </motion.div>
              </a>
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              {tr("noCreditCardRequiredCancelAnytime")}
            </p>
          </ScrollReveal>

          {/* Stats */}
          <div className="mt-16 grid grid-cols-2 sm:grid-cols-4 gap-6 max-w-3xl mx-auto">
            {getStats().map((stat, i) => (
              <ScrollReveal key={stat.label} delay={0.1 * i}>
                <div className="text-center">
                  <div className="text-3xl font-bold text-primary">
                    <AnimatedNumber value={stat.value} />
                    {stat.suffix}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">{stat.label}</div>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="py-20 lg:py-28 bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <ScrollReveal className="text-center mb-14">
            <Badge variant="outline" className="mb-4 border-primary/30 text-primary bg-primary/5">
              {tr("powerfulFeatures")}
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              {tr("everythingYouNeedToRunYour")}
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              {tr("builtFromTheGroundUpFor")}
            </p>
          </ScrollReveal>

          <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {getFeatures().map((f) => {
              const Icon = f.icon;
              return (
                <StaggerItem key={f.title}>
                  <motion.div whileHover={hoverLift} className="h-full">
                    <Card className="h-full border border-border/60 hover:border-primary/30 hover:shadow-lg transition-all duration-300 bg-background">
                      <CardHeader className="pb-3">
                        <div
                          className={`w-10 h-10 rounded-xl ${f.bg} flex items-center justify-center mb-3`}
                        >
                          <Icon className={`w-5 h-5 ${f.color}`} />
                        </div>
                        <h3 className="font-semibold text-base">{f.title}</h3>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          {f.description}
                        </p>
                      </CardContent>
                    </Card>
                  </motion.div>
                </StaggerItem>
              );
            })}
          </StaggerContainer>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how-it-works" className="py-20 lg:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <ScrollReveal className="text-center mb-14">
            <Badge variant="outline" className="mb-4 border-primary/30 text-primary bg-primary/5">
              {tr("simpleSetup")}
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              {tr("upAndRunningInMinutes")}
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              {tr("threeStepsFromSignUpTo")}
            </p>
          </ScrollReveal>

          <div className="relative">
            {/* Connector line (desktop) */}
            <div className="hidden lg:block absolute top-16 start-1/6 end-1/6 h-px bg-gradient-to-r from-primary/10 via-primary/40 to-primary/10" />

            <StaggerContainer className="grid grid-cols-1 lg:grid-cols-3 gap-10">
              {getSteps().map((step, i) => {
                const Icon = step.icon;
                return (
                  <StaggerItem key={step.number}>
                    <div className="flex flex-col items-center text-center px-4">
                      <div className="relative mb-6">
                        <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shadow-lg shadow-primary/10">
                          <Icon className="w-7 h-7 text-primary" />
                        </div>
                        <span className="absolute -top-2 -end-2 w-6 h-6 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center shadow">
                          {i + 1}
                        </span>
                      </div>
                      <div
                        dir="ltr"
                        className="text-xs font-mono font-bold text-primary/60 mb-2 tracking-widest"
                      >
                        {step.number}
                      </div>
                      <h3 className="text-xl font-semibold mb-3">{step.title}</h3>
                      <p className="text-muted-foreground leading-relaxed">{step.description}</p>
                    </div>
                  </StaggerItem>
                );
              })}
            </StaggerContainer>
          </div>

          <ScrollReveal delay={0.3} className="text-center mt-12">
            <Link href="/register">
              <Button
                size="lg"
                className="bg-primary hover:bg-primary/90 px-10 shadow-lg shadow-primary/25"
              >
                {tr("getStartedFree")}
                <ArrowRight className="w-4 h-4 ms-2" />
              </Button>
            </Link>
          </ScrollReveal>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="py-20 lg:py-28 bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <ScrollReveal className="text-center mb-14">
            <Badge variant="outline" className="mb-4 border-primary/30 text-primary bg-primary/5">
              {tr("simplePricing")}
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              {tr("startFreeScaleAsYouGrow")}
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              {tr("noHiddenFeesNoSetupCosts")}
            </p>
          </ScrollReveal>

          <StaggerContainer className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {getPlans().map((plan) => (
              <StaggerItem key={plan.name}>
                <motion.div whileHover={hoverLift} className="h-full">
                  <Card
                    className={`h-full flex flex-col relative transition-all duration-300 ${
                      plan.popular
                        ? "border-primary shadow-xl shadow-primary/15 bg-background ring-2 ring-primary ring-offset-2"
                        : "border-border/60 hover:border-primary/30 hover:shadow-lg bg-background"
                    }`}
                  >
                    {plan.popular && (
                      <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                        <Badge className="bg-primary text-white px-4 py-1 text-xs font-semibold shadow-lg">
                          {tr("mostPopular")}
                        </Badge>
                      </div>
                    )}

                    <CardHeader className="pb-4 pt-6">
                      <h3 className="text-lg font-bold">{plan.name}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{plan.description}</p>
                      <div className="mt-4 flex items-baseline gap-1">
                        {plan.price === "Custom" ? (
                          <span className="text-3xl font-bold">{tr("custom")}</span>
                        ) : (
                          <>
                            <span className="text-sm font-medium text-muted-foreground">AED</span>
                            <span className="text-4xl font-bold">{plan.price}</span>
                            <span className="text-sm text-muted-foreground">{plan.period}</span>
                          </>
                        )}
                      </div>
                    </CardHeader>

                    <CardContent className="flex flex-col flex-1">
                      <ul className="space-y-2.5 mb-8 flex-1">
                        {plan.features.map((f) => (
                          <li key={f} className="flex items-start gap-2.5 text-sm">
                            <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>

                      <a href={plan.href}>
                        <Button
                          className={`w-full ${
                            plan.popular
                              ? "bg-primary hover:bg-primary/90 shadow-md shadow-primary/20"
                              : ""
                          }`}
                          variant={plan.popular ? "default" : "outline"}
                          size="lg"
                        >
                          {plan.cta}
                        </Button>
                      </a>
                    </CardContent>
                  </Card>
                </motion.div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* ── Trust / Firm section ── */}
      <section className="py-20 lg:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <ScrollReveal>
            <div className="rounded-2xl border border-border/60 bg-muted/20 p-8 lg:p-12 flex flex-col lg:flex-row items-center gap-8 lg:gap-12">
              {/* Logo / emblem */}
              <div className="shrink-0">
                <div className="w-20 h-20 lg:w-24 lg:h-24 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shadow-lg">
                  <Building2 className="w-10 h-10 lg:w-12 lg:h-12 text-primary" />
                </div>
              </div>

              {/* Text */}
              <div className="flex-1 text-center lg:text-start">
                <Badge
                  variant="outline"
                  className="mb-3 border-primary/30 text-primary bg-primary/5"
                >
                  {tr("trustedPartner")}
                </Badge>
                <h2 className="text-2xl lg:text-3xl font-bold mb-3">
                  {tr("poweredByNajmaAlRaedaAccounting")}
                </h2>
                <p className="text-muted-foreground leading-relaxed max-w-2xl">
                  {tr("muhasibAiIsTheOfficialDigital")}
                  <strong>{tr("najmaAlRaedaNraAccounting")}</strong>{" "}
                  {tr("aUaeRegisteredAccountingFirmWith")}
                </p>

                <div className="mt-6 flex flex-wrap gap-4 justify-center lg:justify-start">
                  {[
                    { icon: Shield, text: tr("qualifiedAccountingReview") },
                    { icon: Award, text: tr("uaeRegisteredFirm") },
                    { icon: CheckCircle2, text: tr("servingUaeSince2017") },
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.text} className="flex items-center gap-2 text-sm font-medium">
                        <Icon className="w-4 h-4 text-primary" />
                        <span>{item.text}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="py-20 lg:py-24 bg-primary">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <ScrollReveal>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              {tr("readyToAutomateYourBookkeeping")}
            </h2>
            <p className="text-primary-foreground/80 text-lg mb-8">
              {tr("startWithGuidedOnboardingSampleData")}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/register">
                <Button
                  size="lg"
                  variant="secondary"
                  className="px-10 h-12 text-base font-semibold shadow-lg"
                >
                  {tr("startFreeTrial")}
                  <ArrowRight className="w-4 h-4 ms-2" />
                </Button>
              </Link>
              <a href="mailto:hello@muhasib.ai">
                <Button
                  size="lg"
                  variant="outline"
                  className="px-10 h-12 text-base border-white/40 text-white hover:bg-card/10 hover:text-white"
                >
                  {tr("bookADemo")}
                </Button>
              </a>
            </div>
            <p className="text-primary-foreground/60 text-sm mt-4">
              {tr("freePlanAvailableNoCreditCard")}
            </p>
          </ScrollReveal>
        </div>
      </section>

      {/* ── Contact ── */}
      <section id="contact" className="py-20 lg:py-24 bg-muted/30 border-t">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <ScrollReveal className="text-center mb-12">
            <Badge variant="outline" className="mb-4 border-primary/30 text-primary bg-primary/5">
              {tr("getInTouch")}
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              {tr("talkToOurTeam")}
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              {tr("questionsAboutVatOnboardingOrPricing")}
            </p>
          </ScrollReveal>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="bg-background border-border/60">
              <CardContent className="p-6 text-center">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <Mail className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-semibold text-base mb-1">{tr("email")}</h3>
                <a
                  href="mailto:hello@muhasib.ai"
                  className="text-sm text-primary hover:underline"
                  data-testid="link-contact-email"
                >
                  hello@muhasib.ai
                </a>
                <p className="text-xs text-muted-foreground mt-2">
                  {tr("repliesWithin1BusinessDay")}
                </p>
              </CardContent>
            </Card>

            <Card className="bg-background border-border/60">
              <CardContent className="p-6 text-center">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <Phone className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-semibold text-base mb-1">{tr("phone")}</h3>
                <a
                  href="tel:+97141234567"
                  className="text-sm text-primary hover:underline"
                  data-testid="link-contact-phone"
                >
                  +971 4 123 4567
                </a>
                <p className="text-xs text-muted-foreground mt-2">{tr("sunThu9001800")}</p>
              </CardContent>
            </Card>

            <Card className="bg-background border-border/60">
              <CardContent className="p-6 text-center">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <MapPin className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-semibold text-base mb-1">{tr("office")}</h3>
                <p className="text-sm text-foreground">Dubai, UAE</p>
                <p className="text-xs text-muted-foreground mt-2">
                  {tr("najmaAlRaedaAccountingLlc")}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t bg-muted/20 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">
            {/* Brand */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
                  <span className="text-white font-bold text-xs">م</span>
                </div>
                <span className="font-bold text-base">Muhasib.ai</span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {tr("aiAssistedAccountingForUaeBusinesses")}
              </p>
            </div>

            {/* Product */}
            <div>
              <h4 className="font-semibold text-sm mb-3">{tr("product")}</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
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
                  <Link href="/login" className="hover:text-foreground transition-colors">
                    {tr("signIn")}
                  </Link>
                </li>
                <li>
                  <Link href="/register" className="hover:text-foreground transition-colors">
                    {tr("signUp")}
                  </Link>
                </li>
              </ul>
            </div>

            {/* Compliance */}
            <div>
              <h4 className="font-semibold text-sm mb-3">{tr("compliance")}</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>{tr("vat201WorkpaperExports")}</li>
                <li>{tr("corporateTaxCt")}</li>
                <li>{tr("eInvoicingPhase12")}</li>
                <li>{tr("wpsPayrollSif")}</li>
                <li>{tr("ifrsReadyReports")}</li>
              </ul>
              <h4 className="font-semibold text-sm mt-5 mb-3">{tr("legal")}</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <Link href="/privacy" className="hover:text-foreground transition-colors">
                    {tr("privacyPolicy")}
                  </Link>
                </li>
                <li>
                  <Link href="/terms" className="hover:text-foreground transition-colors">
                    {tr("termsOfService")}
                  </Link>
                </li>
                <li>
                  <Link href="/cookies" className="hover:text-foreground transition-colors">
                    {tr("cookiePolicy")}
                  </Link>
                </li>
              </ul>
            </div>

            {/* Contact */}
            <div>
              <h4 className="font-semibold text-sm mb-3">{tr("contactNra")}</h4>
              <ul className="space-y-2.5 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
                  <span>{tr("dubaiUnitedArabEmirates")}</span>
                </li>
                <li className="flex items-center gap-2">
                  <Phone className="w-3.5 h-3.5 shrink-0 text-primary" />
                  <a href="tel:+97141234567" className="hover:text-foreground transition-colors">
                    +971 4 123 4567
                  </a>
                </li>
                <li className="flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5 shrink-0 text-primary" />
                  <a
                    href="mailto:hello@muhasib.ai"
                    className="hover:text-foreground transition-colors"
                  >
                    hello@muhasib.ai
                  </a>
                </li>
                <li className="flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5 shrink-0 text-primary" />
                  <a
                    href="mailto:support@muhasib.ai"
                    className="hover:text-foreground transition-colors"
                  >
                    support@muhasib.ai
                  </a>
                </li>
              </ul>

              {/* Social placeholders */}
              <div className="flex gap-3 mt-4">
                {["LinkedIn", "X", "Instagram"].map((s) => (
                  <div
                    key={s}
                    title={s}
                    className="w-8 h-8 rounded-full bg-muted border border-border flex items-center justify-center cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-colors"
                  >
                    <span className="text-[10px] font-bold text-muted-foreground">{s[0]}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <Separator className="mb-6" />

          <div className="flex flex-col sm:flex-row justify-between items-center gap-3 text-xs text-muted-foreground">
            <span>
              {tr("muhasibAiPoweredByNajmaAl", { getFullYear: new Date().getFullYear() })}
            </span>
            <div className="flex gap-4">
              <Link
                href="/privacy"
                className="hover:text-foreground transition-colors"
                data-testid="link-footer-privacy"
              >
                {tr("privacyPolicy")}
              </Link>
              <Link
                href="/terms"
                className="hover:text-foreground transition-colors"
                data-testid="link-footer-terms"
              >
                {tr("termsOfService")}
              </Link>
              <Link
                href="/cookies"
                className="hover:text-foreground transition-colors"
                data-testid="link-footer-cookies"
              >
                {tr("cookiePolicy")}
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
