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
import { Fragment, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollReveal, StaggerContainer, StaggerItem, hoverLift } from "@/lib/animations";
import { messages as pageMessages } from "./Pricing.i18n";
import {
  FEATURE_MIN_PLAN,
  PLAN_LIMITS,
  PLAN_PRICES,
  TRIAL_DAYS,
  UNLIMITED,
  planIncludes,
  type GatedFeature,
  type PlanId,
  type PlanLimits,
} from "@/lib/plan-catalog";

// ── Pricing Data ───────────────────────────────────────────────────────

interface PricingTier {
  id: PlanId;
  icon: React.ElementType;
  monthlyPrice: number;
  yearlyPrice: number;
  badge?: string;
  badgeVariant?: "default" | "secondary" | "outline";
  ctaVariant: "outline" | "default";
  highlight: boolean;
  gradient: string;
  iconColor: string;
}

// Prices come from the shared plan catalog, so the landing page can never show
// a different number from this page.
const tiers: PricingTier[] = [
  {
    id: "free",
    icon: Zap,
    monthlyPrice: PLAN_PRICES.free.monthly,
    yearlyPrice: PLAN_PRICES.free.yearly,
    ctaVariant: "outline",
    highlight: false,
    gradient: "from-slate-500/10 to-slate-600/5",
    iconColor: "text-muted-foreground",
  },
  {
    id: "starter",
    icon: Rocket,
    monthlyPrice: PLAN_PRICES.starter.monthly,
    yearlyPrice: PLAN_PRICES.starter.yearly,
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
    monthlyPrice: PLAN_PRICES.professional.monthly,
    yearlyPrice: PLAN_PRICES.professional.yearly,
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
    monthlyPrice: PLAN_PRICES.enterprise.monthly,
    yearlyPrice: PLAN_PRICES.enterprise.yearly,
    ctaVariant: "outline",
    highlight: false,
    gradient: "from-purple-500/10 to-purple-600/5",
    iconColor: "text-chart-5",
  },
];

// Comparison rows. Every row is either a usage limit read from PLAN_LIMITS or a
// feature the server really gates (FEATURE_MIN_PLAN), so the table cannot claim
// more than the code enforces. Sales-led terms (account manager, support terms)
// are the only rows not backed by a code gate.
type LimitKey = keyof PlanLimits;
type MessageKey = keyof typeof pageMessages.tables.en;

type MatrixRow =
  | { kind: "limit"; labelKey: MessageKey; limit: LimitKey }
  | { kind: "feature"; labelKey: MessageKey; feature: GatedFeature }
  | { kind: "terms"; labelKey: MessageKey; plans: readonly PlanId[] };

interface MatrixCategory {
  categoryKey: MessageKey;
  rows: MatrixRow[];
}

const featureMatrix: MatrixCategory[] = [
  {
    categoryKey: "usageLimits",
    rows: [
      { kind: "limit", labelKey: "rowCompanies", limit: "maxCompanies" },
      { kind: "limit", labelKey: "rowUsers", limit: "maxUsers" },
      { kind: "limit", labelKey: "rowInvoices", limit: "maxInvoicesPerMonth" },
      { kind: "limit", labelKey: "rowReceipts", limit: "maxReceiptsPerMonth" },
    ],
  },
  {
    categoryKey: "coreAccounting",
    rows: [
      { kind: "feature", labelKey: "bankImportReconciliation", feature: "bankImport" },
      { kind: "feature", labelKey: "quotes", feature: "quotes" },
      { kind: "feature", labelKey: "creditNotes", feature: "creditNotes" },
      { kind: "feature", labelKey: "invoiceTemplates", feature: "invoiceTemplates" },
      { kind: "feature", labelKey: "recurringInvoices", feature: "recurringInvoices" },
      { kind: "feature", labelKey: "multiCurrency", feature: "multiCurrency" },
      { kind: "feature", labelKey: "purchaseOrders", feature: "purchaseOrders" },
      { kind: "feature", labelKey: "bulkOperations", feature: "bulkOps" },
      { kind: "feature", labelKey: "costCentres", feature: "costCenters" },
      { kind: "feature", labelKey: "projectsTimeBilling", feature: "projects" },
      { kind: "feature", labelKey: "approvalRules", feature: "approvals" },
      { kind: "feature", labelKey: "fixedAssetsDepreciation", feature: "fixedAssets" },
    ],
  },
  {
    categoryKey: "reporting",
    rows: [{ kind: "feature", labelKey: "financialStatements", feature: "advancedReports" }],
  },
  {
    categoryKey: "hrPayroll",
    rows: [{ kind: "feature", labelKey: "payrollWpsPayslips", feature: "payroll" }],
  },
  {
    categoryKey: "platform",
    rows: [
      { kind: "feature", labelKey: "outboundWebhooks", feature: "apiAccess" },
      { kind: "terms", labelKey: "dedicatedAccountManager2", plans: ["enterprise"] },
      { kind: "terms", labelKey: "enterpriseSupportTerms2", plans: ["enterprise"] },
    ],
  },
];

// What is true on every plan today (the server does not gate any of it).
const includedOnEveryPlan: MessageKey[] = [
  "vat201Evidence",
  "ftaAuditFile",
  "corporateTaxWorkpaper",
  "openingBalancesYearEnd",
  "arabicEnglishDocuments",
  "eInvoiceReady",
  "aiBookkeeping",
  "customerStatements",
  "vendorBillsCredits",
  "inventoryCogs",
  "expenseClaimsBudgets",
  "aiInsights",
  "csvExport",
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

  // ── Limit and feature labels (all read from the shared plan catalog) ──

  const companiesLabel = (n: number) =>
    n === UNLIMITED
      ? tr("unlimitedCompanies")
      : n === 1
        ? tr("oneCompany")
        : tr("nCompanies", { count: n });
  const usersLabel = (n: number) =>
    n === UNLIMITED ? tr("unlimitedUsers") : n === 1 ? tr("oneUser") : tr("nUsers", { count: n });
  const invoicesLabel = (n: number) =>
    n === UNLIMITED ? tr("unlimitedInvoices") : tr("nInvoicesMonth", { count: n });
  const receiptsLabel = (n: number) =>
    n === UNLIMITED ? tr("unlimitedReceipts") : tr("nReceiptsMonth", { count: n });

  /** Labels of the gated features that first unlock on `plan`. */
  const featuresFirstIncludedOn = (plan: PlanId): string[] =>
    featureMatrix
      .flatMap((category) => category.rows)
      .filter((row) => row.kind === "feature" && FEATURE_MIN_PLAN[row.feature] === plan)
      .map((row) => tr(row.labelKey));

  const limitCell = (plan: PlanId, limit: LimitKey): string => {
    const n = PLAN_LIMITS[plan][limit];
    return n === UNLIMITED ? tr("unlimited") : String(n);
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
        cta: tr("getStarter"),
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
    tierFeatures: {
      free: {
        features: [
          companiesLabel(PLAN_LIMITS.free.maxCompanies),
          usersLabel(PLAN_LIMITS.free.maxUsers),
          invoicesLabel(PLAN_LIMITS.free.maxInvoicesPerMonth),
          receiptsLabel(PLAN_LIMITS.free.maxReceiptsPerMonth),
          tr("everyPlanFeaturesNote"),
        ],
      },
      starter: {
        header: tr("everythingInFreePlus"),
        features: [
          companiesLabel(PLAN_LIMITS.starter.maxCompanies),
          usersLabel(PLAN_LIMITS.starter.maxUsers),
          invoicesLabel(PLAN_LIMITS.starter.maxInvoicesPerMonth),
          receiptsLabel(PLAN_LIMITS.starter.maxReceiptsPerMonth),
          ...featuresFirstIncludedOn("starter"),
        ],
      },
      professional: {
        header: tr("everythingInStarterPlus"),
        features: [
          companiesLabel(PLAN_LIMITS.professional.maxCompanies),
          usersLabel(PLAN_LIMITS.professional.maxUsers),
          invoicesLabel(PLAN_LIMITS.professional.maxInvoicesPerMonth),
          receiptsLabel(PLAN_LIMITS.professional.maxReceiptsPerMonth),
          ...featuresFirstIncludedOn("professional"),
        ],
      },
      enterprise: {
        header: tr("everythingInProfessionalPlus"),
        features: [
          tr("unlimitedCompaniesUnlimitedUsers"),
          ...featuresFirstIncludedOn("enterprise"),
          tr("dedicatedAccountManager"),
          tr("enterpriseSupportTerms"),
        ],
      },
    },
    comparison: {
      title: tr("completeFeatureComparison"),
      subtitle: tr("everyFeatureAcrossEveryPlan"),
    },
    included: {
      title: tr("includedOnEveryPlan"),
      subtitle: tr("includedOnEveryPlanSubtitle"),
      items: includedOnEveryPlan.map((key) => tr(key)),
    },
    notes: {
      pricesExVat: tr("pricesExVat"),
      trialBanner: tr("trialBanner", { days: TRIAL_DAYS }),
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
          a: tr("yesWeOfferA14Day", { days: TRIAL_DAYS }),
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
      guarantee: tr("trialNoCardNote", { days: TRIAL_DAYS }),
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
          <ScrollReveal delay={0.4}>
            <p className="mt-6 text-sm text-muted-foreground">{t.notes.trialBanner}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t.notes.pricesExVat}</p>
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
                            {tr("billedYearly", { amount: price * 12 })}
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

      {/* ── Included on every plan ───────────────────────────────────── */}
      <section className="pb-20 px-4">
        <div className="container mx-auto max-w-5xl">
          <ScrollReveal>
            <div className="text-center mb-10">
              <h2 className="text-3xl md:text-4xl font-bold mb-3">{t.included.title}</h2>
              <p className="text-muted-foreground text-lg">{t.included.subtitle}</p>
            </div>
          </ScrollReveal>
          <ScrollReveal delay={0.1}>
            <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {t.included.items.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm">
                  <Check className="h-4 w-4 mt-0.5 shrink-0 text-success" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </ScrollReveal>
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
                      <Fragment key={category.categoryKey}>
                        {/* Category header row */}
                        <TableRow className="bg-muted/20">
                          <TableCell
                            colSpan={5}
                            className="font-semibold text-sm text-foreground py-3"
                          >
                            {tr(category.categoryKey)}
                          </TableCell>
                        </TableRow>
                        {/* Rows: usage limits, gated features, sales-led terms */}
                        {category.rows.map((row) => (
                          <TableRow key={row.labelKey}>
                            <TableCell className="text-sm">{tr(row.labelKey)}</TableCell>
                            {tiers.map((tier) => (
                              <TableCell key={tier.id}>
                                {row.kind === "limit" ? (
                                  <div className="text-center text-sm">
                                    {limitCell(tier.id, row.limit)}
                                  </div>
                                ) : (
                                  renderCheckOrDash(
                                    row.kind === "feature"
                                      ? planIncludes(tier.id, row.feature)
                                      : row.plans.includes(tier.id)
                                  )
                                )}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </Fragment>
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
          </div>
        </div>
      </footer>
    </div>
  );
}
