import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
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
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ScrollReveal,
  StaggerContainer,
  StaggerItem,
  AnimatedNumber,
  hoverLift,
} from '@/lib/animations';
import { useI18n } from '@/lib/i18n';

// ──────────────────────────────────────────────
// Data
// ──────────────────────────────────────────────

const features = [
  {
    icon: Scan,
    title: 'AI Receipt OCR',
    description:
      'Photograph receipts and let AI extract vendor, amount, date, and VAT automatically. No manual entry.',
    color: 'text-violet-500',
    bg: 'bg-violet-500/10',
  },
  {
    icon: FileCheck,
    title: 'FTA-Compliant VAT',
    description:
      'VAT 201 returns, e-invoicing, and audit-ready ledgers. Stay compliant with UAE Federal Tax Authority rules.',
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
  },
  {
    icon: RefreshCw,
    title: 'Bank Reconciliation',
    description:
      'Smart transaction matching across UAE major banks. Reconcile months of statements in minutes.',
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/10',
  },
  {
    icon: Globe,
    title: 'Multi-Currency',
    description:
      'AED as home currency with real-time FX rates for USD, EUR, GBP, and 150+ more. Gain/loss auto-posted.',
    color: 'text-orange-500',
    bg: 'bg-orange-500/10',
  },
  {
    icon: Languages,
    title: 'Arabic + English',
    description:
      'Full bilingual interface and documents. Switch between Arabic and English with one click.',
    color: 'text-rose-500',
    bg: 'bg-rose-500/10',
  },
  {
    icon: LayoutDashboard,
    title: 'Real-Time Dashboard',
    description:
      'Cash flow, P&L, VAT liability, and KPIs updated live. Spot issues before month-end.',
    color: 'text-indigo-500',
    bg: 'bg-indigo-500/10',
  },
  {
    icon: FileText,
    title: 'Invoice Management',
    description:
      'Create FTA-compliant tax invoices, send via email or WhatsApp, and track payment status automatically.',
    color: 'text-cyan-500',
    bg: 'bg-cyan-500/10',
  },
  {
    icon: Users,
    title: 'Payroll (WPS SIF)',
    description:
      'Generate WPS-compliant SIF files, calculate end-of-service gratuity, and manage leave accruals.',
    color: 'text-fuchsia-500',
    bg: 'bg-fuchsia-500/10',
  },
];

const steps = [
  {
    number: '01',
    title: 'Sign Up',
    description:
      'Create your account in under 2 minutes. No credit card required for the free tier.',
    icon: CheckCircle2,
  },
  {
    number: '02',
    title: 'Connect Your Bank',
    description:
      'Securely link your Emirates NBD, ADCB, FAB, or any UAE bank account via encrypted feeds.',
    icon: Shield,
  },
  {
    number: '03',
    title: 'Let AI Do the Rest',
    description:
      'Transactions are categorized, VAT extracted, invoices matched, and reports generated automatically.',
    icon: Zap,
  },
];

const plans = [
  {
    name: 'Free',
    price: '0',
    period: 'forever',
    description: 'Perfect for sole traders and freelancers getting started.',
    cta: 'Start Free',
    href: '/register',
    popular: false,
    features: [
      '50 transactions / month',
      '5 invoices / month',
      'Receipt OCR (10/mo)',
      'VAT calculator',
      'English only',
      'Email support',
    ],
  },
  {
    name: 'Professional',
    price: '99',
    period: '/month',
    description: 'Everything a growing UAE SME needs — fully automated.',
    cta: 'Start Free Trial',
    href: '/register',
    popular: true,
    features: [
      'Unlimited transactions',
      'Unlimited invoices',
      'Unlimited Receipt OCR',
      'FTA VAT 201 filing',
      'Bank reconciliation',
      'Multi-currency (AED + 150+)',
      'Arabic + English UI',
      'WPS Payroll (SIF)',
      'Real-time dashboard',
      'WhatsApp notifications',
      'Priority support',
    ],
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    description: 'For accounting firms and multi-entity businesses.',
    cta: 'Contact Us',
    href: 'mailto:hello@muhasib.ai',
    popular: false,
    features: [
      'Everything in Professional',
      'Multi-entity / group companies',
      'Dedicated account manager',
      'Custom integrations',
      'SLA-backed uptime',
      'On-site training',
      'FTA audit representation',
    ],
  },
];

const stats = [
  { value: 12000, suffix: '+', label: 'Invoices Generated' },
  { value: 99, suffix: '%', label: 'AI Accuracy Rate' },
  { value: 20, suffix: 'hrs', label: 'Saved Per Month' },
  { value: 500, suffix: '+', label: 'UAE Businesses' },
];

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { locale, setLocale } = useI18n();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const toggleLocale = () => setLocale(locale === 'en' ? 'ar' : 'en');

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Navbar ── */}
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled ? 'bg-background/95 backdrop-blur border-b shadow-sm' : 'bg-transparent'
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
              <a href="#features" className="text-muted-foreground hover:text-foreground transition-colors">
                Features
              </a>
              <a href="#how-it-works" className="text-muted-foreground hover:text-foreground transition-colors">
                How it works
              </a>
              <a href="#pricing" className="text-muted-foreground hover:text-foreground transition-colors">
                Pricing
              </a>
              <a href="#contact" className="text-muted-foreground hover:text-foreground transition-colors">
                Contact
              </a>
            </nav>

            {/* Desktop CTA */}
            <div className="hidden md:flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleLocale}
                aria-label={locale === 'en' ? 'Switch to Arabic' : 'Switch to English'}
                data-testid="button-language-toggle"
                className="gap-1.5"
              >
                <Languages className="w-4 h-4" />
                <span className="text-xs font-semibold">{locale === 'en' ? 'العربية' : 'English'}</span>
              </Button>
              <Link href="/login">
                <Button variant="ghost" size="sm">Sign In</Button>
              </Link>
              <Link href="/register">
                <Button size="sm" className="bg-primary hover:bg-primary/90">
                  Start Free Trial
                </Button>
              </Link>
            </div>

            {/* Mobile hamburger */}
            <button
              className="md:hidden p-2 rounded-md hover:bg-muted transition-colors"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Toggle menu"
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
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="md:hidden bg-background border-b overflow-hidden"
            >
              <div className="px-4 py-4 flex flex-col gap-3">
                <a href="#features" onClick={() => setMenuOpen(false)} className="text-sm font-medium py-2">Features</a>
                <a href="#how-it-works" onClick={() => setMenuOpen(false)} className="text-sm font-medium py-2">How it works</a>
                <a href="#pricing" onClick={() => setMenuOpen(false)} className="text-sm font-medium py-2">Pricing</a>
                <a href="#contact" onClick={() => setMenuOpen(false)} className="text-sm font-medium py-2">Contact</a>
                <Separator />
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-2"
                  onClick={() => { toggleLocale(); setMenuOpen(false); }}
                  data-testid="button-language-toggle-mobile"
                >
                  <Languages className="w-4 h-4" />
                  {locale === 'en' ? 'العربية' : 'English'}
                </Button>
                <Link href="/login">
                  <Button variant="outline" className="w-full" onClick={() => setMenuOpen(false)}>Sign In</Button>
                </Link>
                <Link href="/register">
                  <Button className="w-full bg-primary" onClick={() => setMenuOpen(false)}>Start Free Trial</Button>
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
          <div className="absolute top-20 right-0 w-[400px] h-[400px] bg-violet-500/5 rounded-full blur-3xl" />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <ScrollReveal>
            <Badge variant="outline" className="mb-6 px-4 py-1.5 text-sm font-medium border-primary/30 text-primary bg-primary/5">
              <Award className="w-3.5 h-3.5 mr-1.5" />
              Powered by Najma Al Raeda — Registered UAE Accounting Firm
            </Badge>
          </ScrollReveal>

          <ScrollReveal delay={0.1}>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-tight mb-6">
              AI Bookkeeping{' '}
              <span className="text-primary">Built for</span>
              <br className="hidden sm:block" />
              {' '}UAE Businesses
            </h1>
          </ScrollReveal>

          <ScrollReveal delay={0.2}>
            <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
              FTA-compliant VAT automation, AI receipt scanning, and full Arabic support —
              everything an Emirati business needs, in one platform.
            </p>
          </ScrollReveal>

          <ScrollReveal delay={0.3}>
            <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
              <Link href="/register">
                <motion.div whileHover={hoverLift}>
                  <Button size="lg" className="bg-primary hover:bg-primary/90 px-8 text-base h-12 shadow-lg shadow-primary/25">
                    Start Free Trial
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </motion.div>
              </Link>
              <a href="mailto:hello@muhasib.ai">
                <motion.div whileHover={hoverLift}>
                  <Button size="lg" variant="outline" className="px-8 text-base h-12">
                    Book a Demo
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </motion.div>
              </a>
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              No credit card required · Cancel anytime · FTA-compliant from day one
            </p>
          </ScrollReveal>

          {/* Stats */}
          <div className="mt-16 grid grid-cols-2 sm:grid-cols-4 gap-6 max-w-3xl mx-auto">
            {stats.map((stat, i) => (
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
              Powerful Features
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              Everything You Need to Run Your Finances
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              Built from the ground up for UAE businesses — FTA-compliant, bilingual, and AI-powered.
            </p>
          </ScrollReveal>

          <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {features.map((f) => {
              const Icon = f.icon;
              return (
                <StaggerItem key={f.title}>
                  <motion.div whileHover={hoverLift} className="h-full">
                    <Card className="h-full border border-border/60 hover:border-primary/30 hover:shadow-lg transition-all duration-300 bg-background">
                      <CardHeader className="pb-3">
                        <div className={`w-10 h-10 rounded-xl ${f.bg} flex items-center justify-center mb-3`}>
                          <Icon className={`w-5 h-5 ${f.color}`} />
                        </div>
                        <h3 className="font-semibold text-base">{f.title}</h3>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
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
              Simple Setup
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              Up and Running in Minutes
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              Three steps from sign-up to automated bookkeeping.
            </p>
          </ScrollReveal>

          <div className="relative">
            {/* Connector line (desktop) */}
            <div className="hidden lg:block absolute top-16 left-1/6 right-1/6 h-px bg-gradient-to-r from-primary/10 via-primary/40 to-primary/10" />

            <StaggerContainer className="grid grid-cols-1 lg:grid-cols-3 gap-10">
              {steps.map((step, i) => {
                const Icon = step.icon;
                return (
                  <StaggerItem key={step.number}>
                    <div className="flex flex-col items-center text-center px-4">
                      <div className="relative mb-6">
                        <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shadow-lg shadow-primary/10">
                          <Icon className="w-7 h-7 text-primary" />
                        </div>
                        <span className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center shadow">
                          {i + 1}
                        </span>
                      </div>
                      <div className="text-xs font-mono font-bold text-primary/60 mb-2 tracking-widest">
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
              <Button size="lg" className="bg-primary hover:bg-primary/90 px-10 shadow-lg shadow-primary/25">
                Get Started Free
                <ArrowRight className="w-4 h-4 ml-2" />
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
              Simple Pricing
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              Start Free, Scale as You Grow
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              No hidden fees. No setup costs. Cancel anytime.
            </p>
          </ScrollReveal>

          <StaggerContainer className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {plans.map((plan) => (
              <StaggerItem key={plan.name}>
                <motion.div whileHover={hoverLift} className="h-full">
                  <Card
                    className={`h-full flex flex-col relative transition-all duration-300 ${
                      plan.popular
                        ? 'border-primary shadow-xl shadow-primary/15 bg-background ring-2 ring-primary ring-offset-2'
                        : 'border-border/60 hover:border-primary/30 hover:shadow-lg bg-background'
                    }`}
                  >
                    {plan.popular && (
                      <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                        <Badge className="bg-primary text-white px-4 py-1 text-xs font-semibold shadow-lg">
                          Most Popular
                        </Badge>
                      </div>
                    )}

                    <CardHeader className="pb-4 pt-6">
                      <h3 className="text-lg font-bold">{plan.name}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{plan.description}</p>
                      <div className="mt-4 flex items-baseline gap-1">
                        {plan.price === 'Custom' ? (
                          <span className="text-3xl font-bold">Custom</span>
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
                              ? 'bg-primary hover:bg-primary/90 shadow-md shadow-primary/20'
                              : ''
                          }`}
                          variant={plan.popular ? 'default' : 'outline'}
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
              <div className="flex-1 text-center lg:text-left">
                <Badge variant="outline" className="mb-3 border-primary/30 text-primary bg-primary/5">
                  Trusted Partner
                </Badge>
                <h2 className="text-2xl lg:text-3xl font-bold mb-3">
                  Powered by Najma Al Raeda Accounting
                </h2>
                <p className="text-muted-foreground leading-relaxed max-w-2xl">
                  Muhasib.ai is the official digital platform of <strong>Najma Al Raeda (NRA) Accounting</strong> —
                  a UAE-registered accounting firm with over a decade of experience serving Emirati businesses.
                  NRA is an FTA-registered Tax Agent, ensuring your filings meet every regulatory requirement.
                </p>

                <div className="mt-6 flex flex-wrap gap-4 justify-center lg:justify-start">
                  {[
                    { icon: Shield, text: 'FTA-Registered Tax Agent' },
                    { icon: Award, text: 'UAE Registered Firm' },
                    { icon: CheckCircle2, text: 'Serving UAE since 2017' },
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
              Ready to Automate Your Bookkeeping?
            </h2>
            <p className="text-primary-foreground/80 text-lg mb-8">
              Join 500+ UAE businesses already saving 20+ hours a month with Muhasib.ai.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/register">
                <Button size="lg" variant="secondary" className="px-10 h-12 text-base font-semibold shadow-lg">
                  Start Free Trial
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
              <a href="mailto:hello@muhasib.ai">
                <Button
                  size="lg"
                  variant="outline"
                  className="px-10 h-12 text-base border-white/40 text-white hover:bg-white/10 hover:text-white"
                >
                  Book a Demo
                </Button>
              </a>
            </div>
            <p className="text-primary-foreground/60 text-sm mt-4">
              Free plan available · No credit card required · Cancel anytime
            </p>
          </ScrollReveal>
        </div>
      </section>

      {/* ── Contact ── */}
      <section id="contact" className="py-20 lg:py-24 bg-muted/30 border-t">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <ScrollReveal className="text-center mb-12">
            <Badge variant="outline" className="mb-4 border-primary/30 text-primary bg-primary/5">
              Get in Touch
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              Talk to Our Team
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              Questions about VAT, onboarding, or pricing? Our UAE-based team is here to help.
            </p>
          </ScrollReveal>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="bg-background border-border/60">
              <CardContent className="p-6 text-center">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <Mail className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-semibold text-base mb-1">Email</h3>
                <a href="mailto:hello@muhasib.ai" className="text-sm text-primary hover:underline" data-testid="link-contact-email">
                  hello@muhasib.ai
                </a>
                <p className="text-xs text-muted-foreground mt-2">Replies within 1 business day</p>
              </CardContent>
            </Card>

            <Card className="bg-background border-border/60">
              <CardContent className="p-6 text-center">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <Phone className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-semibold text-base mb-1">Phone</h3>
                <a href="tel:+97141234567" className="text-sm text-primary hover:underline" data-testid="link-contact-phone">
                  +971 4 123 4567
                </a>
                <p className="text-xs text-muted-foreground mt-2">Sun – Thu, 9:00 – 18:00 GST</p>
              </CardContent>
            </Card>

            <Card className="bg-background border-border/60">
              <CardContent className="p-6 text-center">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <MapPin className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-semibold text-base mb-1">Office</h3>
                <p className="text-sm text-foreground">Dubai, UAE</p>
                <p className="text-xs text-muted-foreground mt-2">Najma Al Raeda Accounting LLC</p>
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
                AI-powered accounting for UAE businesses. FTA-compliant, bilingual, automated.
              </p>
            </div>

            {/* Product */}
            <div>
              <h4 className="font-semibold text-sm mb-3">Product</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#features" className="hover:text-foreground transition-colors">Features</a></li>
                <li><a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a></li>
                <li><Link href="/login" className="hover:text-foreground transition-colors">Sign In</Link></li>
                <li><Link href="/register" className="hover:text-foreground transition-colors">Sign Up</Link></li>
              </ul>
            </div>

            {/* Compliance */}
            <div>
              <h4 className="font-semibold text-sm mb-3">Compliance</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>FTA VAT 201 Returns</li>
                <li>Corporate Tax (CT)</li>
                <li>E-Invoicing (Phase 1 & 2)</li>
                <li>WPS Payroll (SIF)</li>
                <li>IFRS-Ready Reports</li>
              </ul>
              <h4 className="font-semibold text-sm mt-5 mb-3">Legal</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link></li>
                <li><Link href="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link></li>
                <li><Link href="/cookies" className="hover:text-foreground transition-colors">Cookie Policy</Link></li>
              </ul>
            </div>

            {/* Contact */}
            <div>
              <h4 className="font-semibold text-sm mb-3">Contact NRA</h4>
              <ul className="space-y-2.5 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
                  <span>Dubai, United Arab Emirates</span>
                </li>
                <li className="flex items-center gap-2">
                  <Phone className="w-3.5 h-3.5 shrink-0 text-primary" />
                  <a href="tel:+97141234567" className="hover:text-foreground transition-colors">+971 4 123 4567</a>
                </li>
                <li className="flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5 shrink-0 text-primary" />
                  <a href="mailto:hello@muhasib.ai" className="hover:text-foreground transition-colors">hello@muhasib.ai</a>
                </li>
                <li className="flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5 shrink-0 text-primary" />
                  <a href="mailto:support@muhasib.ai" className="hover:text-foreground transition-colors">support@muhasib.ai</a>
                </li>
              </ul>

              {/* Social placeholders */}
              <div className="flex gap-3 mt-4">
                {['LinkedIn', 'X', 'Instagram'].map((s) => (
                  <div
                    key={s}
                    title={s}
                    className="w-8 h-8 rounded-full bg-muted border border-border flex items-center justify-center cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-colors"
                  >
                    <span className="text-[10px] font-bold text-muted-foreground">
                      {s[0]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <Separator className="mb-6" />

          <div className="flex flex-col sm:flex-row justify-between items-center gap-3 text-xs text-muted-foreground">
            <span>© {new Date().getFullYear()} Muhasib.ai · Powered by Najma Al Raeda Accounting LLC</span>
            <div className="flex gap-4">
              <Link href="/privacy" className="hover:text-foreground transition-colors" data-testid="link-footer-privacy">Privacy Policy</Link>
              <Link href="/terms" className="hover:text-foreground transition-colors" data-testid="link-footer-terms">Terms of Service</Link>
              <Link href="/cookies" className="hover:text-foreground transition-colors" data-testid="link-footer-cookies">Cookie Policy</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
