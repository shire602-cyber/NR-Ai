import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Link } from 'wouter';
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
  Globe,
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
  Lightbulb,
  Mic,
  FileSearch,
  Banknote,
  AlertTriangle,
  Workflow
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useI18n } from '@/lib/i18n';

export default function Services() {
  const [mounted, setMounted] = useState(false);
  const { locale, setLocale } = useI18n();
  const isRTL = locale === 'ar';

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggleLanguage = () => {
    setLocale(locale === 'en' ? 'ar' : 'en');
  };

  const t = {
    nav: {
      languageToggle: locale === 'en' ? 'العربية' : 'EN',
      login: locale === 'en' ? 'Login' : 'تسجيل الدخول',
      getStarted: locale === 'en' ? 'Start Free' : 'ابدأ مجاناً',
    },
    hero: {
      badge: locale === 'en' ? 'Dubai-Based Accounting Firm' : 'شركة محاسبة مقرها دبي',
      headline: locale === 'en' ? 'Accounting & Tax Services' : 'خدمات المحاسبة والضرائب',
      headlineAccent: locale === 'en' ? 'Backed by Experts' : 'مدعوم من الخبراء',
      subheadline: locale === 'en'
        ? 'Operating in Dubai since 2017 — combining human expertise with AI automation for modern UAE businesses.'
        : 'نعمل في دبي منذ 2017 — نجمع بين الخبرة البشرية والأتمتة الذكية للشركات الإماراتية الحديثة.',
      ctaPrimary: locale === 'en' ? 'Book a Free Consultation' : 'احجز استشارة مجانية',
      ctaSecondary: locale === 'en' ? 'Get Started' : 'ابدأ الآن',
      licensed: locale === 'en' ? 'Licensed & Registered in Dubai, UAE' : 'مرخص ومسجل في دبي، الإمارات',
    },
    stats: {
      clients: locale === 'en' ? 'Clients Served' : 'عملاء تم خدمتهم',
      yearsExp: locale === 'en' ? 'Years Experience' : 'سنوات خبرة',
      accuracy: locale === 'en' ? 'Accuracy Rate' : 'نسبة الدقة',
      satisfaction: locale === 'en' ? 'Satisfaction' : 'رضا العملاء',
    },
    services: {
      badge: locale === 'en' ? 'Our Services' : 'خدماتنا',
      headline: locale === 'en' ? 'Featured Core Services' : 'الخدمات الأساسية المميزة',
      subheadline: locale === 'en' 
        ? 'Comprehensive accounting and tax solutions tailored for UAE businesses'
        : 'حلول محاسبية وضريبية شاملة مصممة للشركات الإماراتية',
    },
    whyChoose: {
      badge: locale === 'en' ? 'Why Choose Us' : 'لماذا تختارنا',
      headline: locale === 'en' ? 'Your Trusted Partner' : 'شريكك الموثوق',
      subheadline: locale === 'en'
        ? 'Experience the difference with our proven track record and modern approach'
        : 'اختبر الفرق مع سجلنا المثبت ونهجنا الحديث',
    },
    clients: {
      badge: locale === 'en' ? 'Who We Serve' : 'من نخدم',
      headline: locale === 'en' ? 'Client Types We Serve' : 'أنواع العملاء الذين نخدمهم',
      subheadline: locale === 'en'
        ? 'From freelancers to enterprises, we support businesses of all sizes'
        : 'من المستقلين إلى المؤسسات، ندعم الشركات بجميع أحجامها',
    },
    ai: {
      badge: locale === 'en' ? 'AI Capabilities' : 'قدرات الذكاء الاصطناعي',
      headline: locale === 'en' ? 'Powered by AI' : 'مدعوم بالذكاء الاصطناعي',
      subheadline: locale === 'en'
        ? 'Cutting-edge artificial intelligence that transforms your bookkeeping experience'
        : 'ذكاء اصطناعي متطور يحول تجربة مسك الدفاتر الخاصة بك',
      currentBadge: locale === 'en' ? 'Available Now' : 'متوفر الآن',
      futureBadge: locale === 'en' ? 'Coming Soon' : 'قريباً',
    },
    cta: {
      headline: locale === 'en' ? 'Need help with VAT or Tax Setup?' : 'تحتاج مساعدة في إعداد ضريبة القيمة المضافة أو الضرائب؟',
      subheadline: locale === 'en'
        ? "Get expert guidance from our Dubai-based accounting team. We'll help you navigate UAE tax regulations with confidence."
        : 'احصل على إرشادات خبراء من فريق المحاسبة لدينا في دبي. سنساعدك على التنقل في اللوائح الضريبية الإماراتية بثقة.',
      primary: locale === 'en' ? 'Book a Free Consultation' : 'احجز استشارة مجانية',
      secondary: locale === 'en' ? 'Talk to an Expert' : 'تحدث مع خبير',
      freeConsult: locale === 'en' ? 'Free initial consultation' : 'استشارة أولية مجانية',
      response: locale === 'en' ? 'Response within 24 hours' : 'رد خلال 24 ساعة',
      noCommitment: locale === 'en' ? 'No commitment required' : 'لا التزام مطلوب',
    },
  };

  const coreServices = [
    {
      icon: FileText,
      title: locale === 'en' ? 'VAT Registration & Filing' : 'تسجيل وتقديم ضريبة القيمة المضافة',
      description: locale === 'en' 
        ? 'Complete VAT registration with FTA and ongoing quarterly/monthly filing support.'
        : 'تسجيل كامل لضريبة القيمة المضافة مع الهيئة الاتحادية للضرائب ودعم التقديم الربعي/الشهري.',
      color: 'from-blue-500 to-cyan-600',
      bgColor: 'bg-blue-500/10',
    },
    {
      icon: Building2,
      title: locale === 'en' ? 'Corporate Tax Registration' : 'تسجيل ضريبة الشركات',
      description: locale === 'en'
        ? 'UAE Corporate Tax registration and compliance setup for businesses over AED 375,000.'
        : 'تسجيل ضريبة الشركات الإماراتية وإعداد الامتثال للشركات التي تزيد عن 375,000 درهم.',
      color: 'from-purple-500 to-violet-600',
      bgColor: 'bg-purple-500/10',
    },
    {
      icon: FileX,
      title: locale === 'en' ? 'VAT Deregistration' : 'إلغاء تسجيل ضريبة القيمة المضافة',
      description: locale === 'en'
        ? 'Smooth VAT deregistration process when your business no longer meets thresholds.'
        : 'عملية إلغاء تسجيل سلسة عندما لم يعد نشاطك يستوفي الحدود.',
      color: 'from-red-500 to-rose-600',
      bgColor: 'bg-red-500/10',
    },
    {
      icon: FileCheck,
      title: locale === 'en' ? 'Corporate Tax Deregistration' : 'إلغاء تسجيل ضريبة الشركات',
      description: locale === 'en'
        ? 'Complete corporate tax deregistration for business closures or restructuring.'
        : 'إلغاء تسجيل ضريبة الشركات الكامل لإغلاق الأعمال أو إعادة الهيكلة.',
      color: 'from-orange-500 to-amber-600',
      bgColor: 'bg-orange-500/10',
    },
    {
      icon: Calculator,
      title: locale === 'en' ? 'VAT & Tax Return Filing' : 'تقديم إقرارات ضريبة القيمة المضافة والضرائب',
      description: locale === 'en'
        ? 'Accurate and timely VAT and Corporate Tax return preparation and submission.'
        : 'إعداد وتقديم إقرارات ضريبة القيمة المضافة وضريبة الشركات بدقة وفي الوقت المحدد.',
      color: 'from-green-500 to-emerald-600',
      bgColor: 'bg-green-500/10',
    },
    {
      icon: BookOpen,
      title: locale === 'en' ? 'Books Cleanup & Catch-up' : 'تنظيف وتحديث الدفاتر',
      description: locale === 'en'
        ? 'Bring your books up to date with historical data entry and reconciliation.'
        : 'قم بتحديث دفاترك مع إدخال البيانات التاريخية والمطابقة.',
      color: 'from-teal-500 to-cyan-600',
      bgColor: 'bg-teal-500/10',
    },
    {
      icon: Sparkles,
      title: locale === 'en' ? 'AI-Powered Bookkeeping' : 'مسك الدفاتر بالذكاء الاصطناعي',
      description: locale === 'en'
        ? 'Modern bookkeeping with AI automation for expense categorization and data entry.'
        : 'مسك دفاتر حديث مع أتمتة الذكاء الاصطناعي لتصنيف المصروفات وإدخال البيانات.',
      color: 'from-violet-500 to-purple-600',
      bgColor: 'bg-violet-500/10',
    },
    {
      icon: BarChart3,
      title: locale === 'en' ? 'Financial Statement Preparation' : 'إعداد القوائم المالية',
      description: locale === 'en'
        ? 'Professional P&L statements, balance sheets, and cash flow reports.'
        : 'قوائم الأرباح والخسائر والميزانيات وتقارير التدفق النقدي الاحترافية.',
      color: 'from-indigo-500 to-blue-600',
      bgColor: 'bg-indigo-500/10',
    },
    {
      icon: Shield,
      title: locale === 'en' ? 'Compliance Review & Audit Support' : 'مراجعة الامتثال ودعم التدقيق',
      description: locale === 'en'
        ? 'Pre-audit reviews and support during FTA audits and compliance checks.'
        : 'مراجعات ما قبل التدقيق والدعم أثناء تدقيقات الهيئة وفحوصات الامتثال.',
      color: 'from-emerald-500 to-green-600',
      bgColor: 'bg-emerald-500/10',
    },
  ];

  const whyChooseUs = [
    {
      icon: Award,
      title: locale === 'en' ? 'Registered Firm Since 2017' : 'شركة مسجلة منذ 2017',
      description: locale === 'en'
        ? 'Licensed accounting firm operating in Dubai with years of proven expertise.'
        : 'شركة محاسبة مرخصة تعمل في دبي مع سنوات من الخبرة المثبتة.',
    },
    {
      icon: Sparkles,
      title: locale === 'en' ? 'AI + Human Expertise' : 'الذكاء الاصطناعي + الخبرة البشرية',
      description: locale === 'en'
        ? 'Best of both worlds - AI automation backed by experienced accountants.'
        : 'أفضل ما في العالمين - أتمتة الذكاء الاصطناعي مدعومة بمحاسبين ذوي خبرة.',
    },
    {
      icon: Shield,
      title: locale === 'en' ? 'FTA Compliant' : 'متوافق مع الهيئة الاتحادية للضرائب',
      description: locale === 'en'
        ? 'All services aligned with UAE Federal Tax Authority requirements.'
        : 'جميع الخدمات متوافقة مع متطلبات الهيئة الاتحادية للضرائب.',
    },
    {
      icon: Languages,
      title: locale === 'en' ? 'Bilingual Support' : 'دعم ثنائي اللغة',
      description: locale === 'en'
        ? 'Full support in English and Arabic for seamless communication.'
        : 'دعم كامل بالإنجليزية والعربية للتواصل السلس.',
    },
  ];

  const clientTypes = [
    { icon: Briefcase, title: locale === 'en' ? 'Freelancers' : 'المستقلين' },
    { icon: Store, title: locale === 'en' ? 'SMEs' : 'الشركات الصغيرة والمتوسطة' },
    { icon: Store, title: locale === 'en' ? 'E-commerce' : 'التجارة الإلكترونية' },
    { icon: Building2, title: locale === 'en' ? 'Holding Companies' : 'الشركات القابضة' },
    { icon: Home, title: locale === 'en' ? 'Real Estate' : 'العقارات' },
    { icon: Rocket, title: locale === 'en' ? 'Startups' : 'الشركات الناشئة' },
  ];

  const currentAiCapabilities = [
    {
      icon: ScanLine,
      title: locale === 'en' ? 'OCR Receipt Scanning' : 'مسح الإيصالات بالتعرف الضوئي',
      description: locale === 'en'
        ? 'Instantly extract merchant, amount, date, and VAT from receipts using advanced OCR technology.'
        : 'استخراج فوري للتاجر والمبلغ والتاريخ وضريبة القيمة المضافة من الإيصالات باستخدام تقنية التعرف الضوئي المتقدمة.',
      bgColor: 'bg-blue-500/10',
      iconColor: 'text-blue-500',
    },
    {
      icon: Brain,
      title: locale === 'en' ? 'Smart Expense Categorization' : 'تصنيف المصروفات الذكي',
      description: locale === 'en'
        ? 'AI automatically categorizes expenses into the correct chart of accounts with 95%+ accuracy.'
        : 'الذكاء الاصطناعي يصنف المصروفات تلقائياً في الحسابات الصحيحة بدقة تتجاوز 95%.',
      bgColor: 'bg-purple-500/10',
      iconColor: 'text-purple-500',
    },
    {
      icon: Zap,
      title: locale === 'en' ? 'Bulk Receipt Processing' : 'معالجة الإيصالات بالجملة',
      description: locale === 'en'
        ? 'Upload multiple receipts at once. Our AI processes them in parallel for maximum efficiency.'
        : 'ارفع عدة إيصالات دفعة واحدة. الذكاء الاصطناعي يعالجها بالتوازي لأقصى كفاءة.',
      bgColor: 'bg-amber-500/10',
      iconColor: 'text-amber-500',
    },
    {
      icon: FileSearch,
      title: locale === 'en' ? 'Intelligent Data Extraction' : 'استخراج البيانات الذكي',
      description: locale === 'en'
        ? 'Automatically extract and validate TRN numbers, invoice details, and payment terms.'
        : 'استخراج والتحقق تلقائياً من أرقام التسجيل الضريبي وتفاصيل الفواتير وشروط الدفع.',
      bgColor: 'bg-green-500/10',
      iconColor: 'text-green-500',
    },
  ];

  const futureAiCapabilities = [
    {
      icon: Bot,
      title: locale === 'en' ? 'AI CFO / Financial Advisor' : 'المدير المالي بالذكاء الاصطناعي',
      description: locale === 'en'
        ? 'Get personalized financial advice, cash flow predictions, and strategic recommendations from your AI advisor.'
        : 'احصل على نصائح مالية مخصصة وتنبؤات التدفق النقدي وتوصيات استراتيجية من مستشارك الذكي.',
      bgColor: 'bg-violet-500/10',
      iconColor: 'text-violet-500',
    },
    {
      icon: LineChart,
      title: locale === 'en' ? 'Predictive Analytics' : 'التحليلات التنبؤية',
      description: locale === 'en'
        ? 'AI-powered forecasting for revenue, expenses, and cash flow based on historical patterns.'
        : 'تنبؤات مدعومة بالذكاء الاصطناعي للإيرادات والمصروفات والتدفق النقدي بناءً على الأنماط التاريخية.',
      bgColor: 'bg-cyan-500/10',
      iconColor: 'text-cyan-500',
    },
    {
      icon: AlertTriangle,
      title: locale === 'en' ? 'Anomaly Detection' : 'كشف الشذوذ',
      description: locale === 'en'
        ? 'Automatically flag unusual transactions, duplicate payments, and potential fraud.'
        : 'تحديد تلقائي للمعاملات غير العادية والمدفوعات المكررة والاحتيال المحتمل.',
      bgColor: 'bg-red-500/10',
      iconColor: 'text-red-500',
    },
    {
      icon: Mic,
      title: locale === 'en' ? 'Voice Commands' : 'الأوامر الصوتية',
      description: locale === 'en'
        ? 'Create invoices, log expenses, and query reports using natural voice commands in English or Arabic.'
        : 'إنشاء الفواتير وتسجيل المصروفات والاستعلام عن التقارير باستخدام الأوامر الصوتية بالإنجليزية أو العربية.',
      bgColor: 'bg-pink-500/10',
      iconColor: 'text-pink-500',
    },
    {
      icon: Target,
      title: locale === 'en' ? 'Smart Tax Optimization' : 'تحسين الضرائب الذكي',
      description: locale === 'en'
        ? 'AI recommendations to minimize tax liability while maintaining full FTA compliance.'
        : 'توصيات ذكية لتقليل الالتزام الضريبي مع الحفاظ على الامتثال الكامل للهيئة الاتحادية للضرائب.',
      bgColor: 'bg-emerald-500/10',
      iconColor: 'text-emerald-500',
    },
    {
      icon: Workflow,
      title: locale === 'en' ? 'Automated Workflows' : 'سير العمل الآلي',
      description: locale === 'en'
        ? 'Set up automated rules for recurring transactions, approvals, and reminders.'
        : 'إعداد قواعد آلية للمعاملات المتكررة والموافقات والتذكيرات.',
      bgColor: 'bg-indigo-500/10',
      iconColor: 'text-indigo-500',
    },
  ];

  const stats = [
    { value: '500+', label: t.stats.clients, icon: Users },
    { value: '7+', label: t.stats.yearsExp, icon: Clock },
    { value: '99.8%', label: t.stats.accuracy, icon: TrendingUp },
    { value: '98%', label: t.stats.satisfaction, icon: Star },
  ];

  return (
    <div className={`min-h-screen bg-background ${isRTL ? 'rtl' : 'ltr'}`} dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-background/80 border-b">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/">
              <span className="text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent cursor-pointer" data-testid="link-logo">
                Muhasib.ai
              </span>
            </Link>
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={toggleLanguage} data-testid="button-language-toggle">
                <Globe className="w-4 h-4 mr-2" />
                {t.nav.languageToggle}
              </Button>
              <Link href="/login">
                <Button variant="ghost" size="sm" data-testid="button-login">
                  {t.nav.login}
                </Button>
              </Link>
              <Link href="/register">
                <Button size="sm" data-testid="button-get-started">
                  {t.nav.getStarted}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section - Two Column Layout */}
      <section className="relative overflow-hidden pt-32 pb-20 lg:pb-32 min-h-screen flex items-center">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5 dark:from-primary/10 dark:via-transparent dark:to-accent/10" />
        <div className="absolute inset-0 bg-grid-white/5 dark:bg-grid-white/5" style={{ backgroundSize: '40px 40px' }} />
        
        <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8 w-full">
          <div className={`grid grid-cols-1 lg:grid-cols-5 gap-12 lg:gap-16 items-center ${isRTL ? 'lg:flex-row-reverse' : ''}`}>
            {/* Text Content - 60% */}
            <div className={`lg:col-span-3 ${isRTL ? 'text-right' : 'text-left'} ${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`} style={{ animationDuration: '600ms' }}>
              <Badge className="mb-6 bg-primary/10 text-primary border-primary/20 px-4 py-1.5" data-testid="badge-hero">
                <Award className={`w-4 h-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                {t.hero.badge}
              </Badge>
              
              <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold mb-6 tracking-tight" data-testid="text-hero-headline">
                <span className="bg-gradient-to-r from-primary via-primary/80 to-accent bg-clip-text text-transparent">
                  {t.hero.headline}
                </span>
                <br />
                <span className="text-foreground">{t.hero.headlineAccent}</span>
              </h1>
              
              <p className="text-xl lg:text-2xl text-muted-foreground mb-8 max-w-2xl leading-relaxed" data-testid="text-hero-subheadline">
                {t.hero.subheadline}
              </p>
              
              <div className={`flex flex-col sm:flex-row gap-4 ${isRTL ? 'justify-end' : 'justify-start'}`}>
                <Link href="/register">
                  <Button size="lg" className="gap-2 px-8 py-6 text-lg" data-testid="button-book-consultation">
                    <Phone className="w-5 h-5" />
                    {t.hero.ctaPrimary}
                  </Button>
                </Link>
                <Link href="/login">
                  <Button size="lg" variant="outline" className="gap-2 px-8 py-6 text-lg" data-testid="button-hero-get-started">
                    {t.hero.ctaSecondary}
                    <ArrowRight className={`w-5 h-5 ${isRTL ? 'rotate-180' : ''}`} />
                  </Button>
                </Link>
              </div>
              
              <p className={`mt-6 text-sm text-muted-foreground flex items-center gap-2 ${isRTL ? 'justify-end' : 'justify-start'}`} data-testid="text-licensed">
                <Shield className="w-4 h-4" />
                {t.hero.licensed}
              </p>
            </div>

            {/* Hero Visual - 40% with Glassmorphism */}
            <div className={`lg:col-span-2 ${mounted ? 'animate-in fade-in slide-in-from-bottom-6' : ''}`} style={{ animationDelay: '200ms', animationDuration: '700ms' }}>
              <div className="relative">
                {/* Glassmorphic Card */}
                <div className="relative backdrop-blur-xl bg-white/10 dark:bg-white/5 border border-white/20 dark:border-white/10 rounded-3xl p-8 shadow-2xl" data-testid="hero-visual-card">
                  {/* Gradient Glow */}
                  <div className="absolute -inset-4 bg-gradient-to-br from-primary/30 via-accent/20 to-primary/30 rounded-3xl blur-2xl opacity-60" />
                  
                  <div className="relative z-10 space-y-6">
                    {/* Service Icons Grid */}
                    <div className="grid grid-cols-3 gap-4">
                      {[
                        { icon: FileText, color: 'bg-blue-500/20', iconColor: 'text-blue-500' },
                        { icon: Calculator, color: 'bg-green-500/20', iconColor: 'text-green-500' },
                        { icon: BarChart3, color: 'bg-purple-500/20', iconColor: 'text-purple-500' },
                        { icon: Shield, color: 'bg-amber-500/20', iconColor: 'text-amber-500' },
                        { icon: Sparkles, color: 'bg-violet-500/20', iconColor: 'text-violet-500' },
                        { icon: Building2, color: 'bg-teal-500/20', iconColor: 'text-teal-500' },
                      ].map((item, index) => (
                        <div 
                          key={index}
                          className={`${item.color} rounded-xl p-4 flex items-center justify-center hover:scale-110 transition-transform`}
                          data-testid={`hero-icon-${index}`}
                        >
                          <item.icon className={`w-6 h-6 ${item.iconColor}`} />
                        </div>
                      ))}
                    </div>
                    
                    {/* Trust Indicators */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 text-sm" data-testid="hero-trust-1">
                        <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                        <span className="text-foreground/80">
                          {locale === 'en' ? 'FTA Registered & Compliant' : 'مسجل ومتوافق مع الهيئة الاتحادية للضرائب'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-sm" data-testid="hero-trust-2">
                        <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                        <span className="text-foreground/80">
                          {locale === 'en' ? 'AI-Powered Automation' : 'أتمتة بالذكاء الاصطناعي'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-sm" data-testid="hero-trust-3">
                        <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                        <span className="text-foreground/80">
                          {locale === 'en' ? 'Bilingual Support (EN/AR)' : 'دعم ثنائي اللغة (EN/AR)'}
                        </span>
                      </div>
                    </div>

                    {/* Floating Badge */}
                    <div className="flex justify-center">
                      <Badge className="bg-gradient-to-r from-primary to-accent text-white border-0 px-4 py-2 text-sm font-semibold" data-testid="hero-badge-cta">
                        <Star className={`w-4 h-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                        {locale === 'en' ? 'Since 2017' : 'منذ 2017'}
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* Decorative Elements */}
                <div className="absolute -top-4 -right-4 w-24 h-24 bg-gradient-to-br from-primary/40 to-accent/40 rounded-full blur-2xl" />
                <div className="absolute -bottom-4 -left-4 w-32 h-32 bg-gradient-to-tr from-accent/30 to-primary/30 rounded-full blur-2xl" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 border-y bg-muted/20">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className={`grid grid-cols-2 lg:grid-cols-4 gap-8 ${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`} style={{ animationDelay: '50ms', animationDuration: '600ms' }}>
            {stats.map((stat, index) => (
              <div key={stat.label} className="text-center" data-testid={`stat-${index}`}>
                <div className="flex items-center justify-center mb-2">
                  <stat.icon className="w-6 h-6 text-primary opacity-60" />
                </div>
                <div className="text-4xl lg:text-5xl font-bold text-primary mb-1 font-mono" data-testid={`stat-value-${index}`}>
                  {stat.value}
                </div>
                <div className="text-sm text-muted-foreground font-medium" data-testid={`stat-label-${index}`}>
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
          <div className={`text-center mb-16 ${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`} style={{ animationDelay: '100ms', animationDuration: '600ms' }}>
            <Badge className="mb-4 bg-accent/10 text-accent border-accent/20 px-4 py-1.5" data-testid="badge-services">
              {t.services.badge}
            </Badge>
            <h2 className="text-4xl md:text-5xl font-bold mb-4" data-testid="text-services-headline">
              {t.services.headline}
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto" data-testid="text-services-subheadline">
              {t.services.subheadline}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {coreServices.map((service, index) => (
              <Card 
                key={index}
                className={`p-6 hover-elevate transition-all duration-300 group overflow-hidden relative border-border/50 ${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`}
                style={{ animationDelay: `${150 + index * 50}ms`, animationDuration: '600ms' }}
                data-testid={`card-service-${index}`}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-white/0 via-white/0 to-white/5 dark:from-white/0 dark:via-white/0 dark:to-white/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                
                <div className={`w-14 h-14 rounded-xl ${service.bgColor} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform relative z-10`}>
                  <service.icon className="w-7 h-7 text-primary" />
                </div>
                
                <h3 className="text-xl font-semibold mb-2 relative z-10 group-hover:text-primary transition-colors" data-testid={`text-service-title-${index}`}>
                  {service.title}
                </h3>
                
                <p className="text-muted-foreground relative z-10 leading-relaxed" data-testid={`text-service-description-${index}`}>
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
          <div className={`text-center mb-16 ${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`} style={{ animationDelay: '200ms', animationDuration: '600ms' }}>
            <Badge className="mb-4 bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20 px-4 py-1.5" data-testid="badge-why-choose">
              <CheckCircle2 className={`w-4 h-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t.whyChoose.badge}
            </Badge>
            <h2 className="text-4xl md:text-5xl font-bold mb-4" data-testid="text-why-choose-headline">
              {t.whyChoose.headline}
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto" data-testid="text-why-choose-subheadline">
              {t.whyChoose.subheadline}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {whyChooseUs.map((item, index) => (
              <div 
                key={index}
                className={`text-center p-6 rounded-2xl border bg-card hover-elevate transition-all duration-300 ${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`}
                style={{ animationDelay: `${250 + index * 75}ms`, animationDuration: '600ms' }}
                data-testid={`card-why-${index}`}
              >
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <item.icon className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2" data-testid={`text-why-title-${index}`}>
                  {item.title}
                </h3>
                <p className="text-sm text-muted-foreground" data-testid={`text-why-description-${index}`}>
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* AI Capabilities Section */}
      <section className="py-20 lg:py-28 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 via-transparent to-blue-500/5 dark:from-violet-500/10 dark:via-transparent dark:to-blue-500/10" />
        
        <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8">
          <div className={`text-center mb-16 ${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`} style={{ animationDelay: '250ms', animationDuration: '600ms' }}>
            <Badge className="mb-4 bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20 px-4 py-1.5" data-testid="badge-ai">
              <Brain className={`w-4 h-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t.ai.badge}
            </Badge>
            <h2 className="text-4xl md:text-5xl font-bold mb-4" data-testid="text-ai-headline">
              {t.ai.headline}
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto" data-testid="text-ai-subheadline">
              {t.ai.subheadline}
            </p>
          </div>

          {/* Current AI Capabilities */}
          <div className="mb-16">
            <div className={`flex items-center justify-center gap-3 mb-8 ${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`} style={{ animationDelay: '300ms', animationDuration: '600ms' }}>
              <Badge className="bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30 px-4 py-2 text-sm font-semibold" data-testid="badge-ai-current">
                <CheckCircle2 className={`w-4 h-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                {t.ai.currentBadge}
              </Badge>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {currentAiCapabilities.map((capability, index) => (
                <Card 
                  key={index}
                  className={`p-6 hover-elevate transition-all duration-300 group border-border/50 ${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`}
                  style={{ animationDelay: `${350 + index * 75}ms`, animationDuration: '600ms' }}
                  data-testid={`card-ai-current-${index}`}
                >
                  <div className={`w-12 h-12 rounded-xl ${capability.bgColor} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                    <capability.icon className={`w-6 h-6 ${capability.iconColor}`} />
                  </div>
                  <h3 className="text-lg font-semibold mb-2 group-hover:text-primary transition-colors" data-testid={`text-ai-current-title-${index}`}>
                    {capability.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed" data-testid={`text-ai-current-desc-${index}`}>
                    {capability.description}
                  </p>
                </Card>
              ))}
            </div>
          </div>

          {/* Future AI Capabilities */}
          <div>
            <div className={`flex items-center justify-center gap-3 mb-8 ${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`} style={{ animationDelay: '500ms', animationDuration: '600ms' }}>
              <Badge className="bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30 px-4 py-2 text-sm font-semibold" data-testid="badge-ai-future">
                <Rocket className={`w-4 h-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                {t.ai.futureBadge}
              </Badge>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {futureAiCapabilities.map((capability, index) => (
                <Card 
                  key={index}
                  className={`p-6 hover-elevate transition-all duration-300 group border-border/50 border-dashed ${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`}
                  style={{ animationDelay: `${550 + index * 75}ms`, animationDuration: '600ms' }}
                  data-testid={`card-ai-future-${index}`}
                >
                  <div className="flex items-start gap-4">
                    <div className={`w-12 h-12 rounded-xl ${capability.bgColor} flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform`}>
                      <capability.icon className={`w-6 h-6 ${capability.iconColor}`} />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold mb-2 group-hover:text-primary transition-colors" data-testid={`text-ai-future-title-${index}`}>
                        {capability.title}
                      </h3>
                      <p className="text-sm text-muted-foreground leading-relaxed" data-testid={`text-ai-future-desc-${index}`}>
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
          <div className={`text-center mb-16 ${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`} style={{ animationDelay: '300ms', animationDuration: '600ms' }}>
            <Badge className="mb-4 bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 px-4 py-1.5" data-testid="badge-clients">
              <Users className={`w-4 h-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t.clients.badge}
            </Badge>
            <h2 className="text-4xl md:text-5xl font-bold mb-4" data-testid="text-clients-headline">
              {t.clients.headline}
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto" data-testid="text-clients-subheadline">
              {t.clients.subheadline}
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {clientTypes.map((client, index) => (
              <div 
                key={index}
                className={`flex flex-col items-center p-6 rounded-xl border bg-card hover-elevate transition-all duration-300 group ${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`}
                style={{ animationDelay: `${350 + index * 50}ms`, animationDuration: '600ms' }}
                data-testid={`card-client-${index}`}
              >
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                  <client.icon className="w-6 h-6 text-primary" />
                </div>
                <span className="text-sm font-medium text-center" data-testid={`text-client-${index}`}>
                  {client.title}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="py-20 lg:py-28 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-accent/5 to-primary/10 dark:from-primary/20 dark:via-accent/10 dark:to-primary/20" />
        <div className="absolute inset-0 bg-grid-white/5 dark:bg-grid-white/5" style={{ backgroundSize: '40px 40px' }} />
        
        <div className={`relative z-10 max-w-4xl mx-auto px-6 lg:px-8 text-center ${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`} style={{ animationDelay: '400ms', animationDuration: '600ms' }}>
          <h2 className="text-4xl md:text-5xl font-bold mb-6" data-testid="text-cta-headline">
            {t.cta.headline}
          </h2>
          <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto" data-testid="text-cta-subheadline">
            {t.cta.subheadline}
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Link href="/register">
              <Button size="lg" className="gap-2 px-8 py-6 text-lg" data-testid="button-cta-consultation">
                <Phone className="w-5 h-5" />
                {t.cta.primary}
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="outline" className="gap-2 px-8 py-6 text-lg backdrop-blur-sm" data-testid="button-cta-expert">
                <MessageSquare className="w-5 h-5" />
                {t.cta.secondary}
              </Button>
            </Link>
          </div>
          
          <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
            <span className="flex items-center gap-2" data-testid="text-cta-free">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              {t.cta.freeConsult}
            </span>
            <span className="flex items-center gap-2" data-testid="text-cta-response">
              <Clock className="w-4 h-4 text-blue-500" />
              {t.cta.response}
            </span>
            <span className="flex items-center gap-2" data-testid="text-cta-commitment">
              <Handshake className="w-4 h-4 text-purple-500" />
              {t.cta.noCommitment}
            </span>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t bg-muted/30">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 text-center text-sm text-muted-foreground">
          <p data-testid="text-footer">
            {locale === 'en' 
              ? '© 2025 Muhasib.ai by NR Accounting Services - Licensed Accounting Firm in Dubai, UAE since 2017'
              : '© 2025 محاسب.ai من NR Accounting Services - شركة محاسبة مرخصة في دبي، الإمارات منذ 2017'}
          </p>
        </div>
      </footer>
    </div>
  );
}
