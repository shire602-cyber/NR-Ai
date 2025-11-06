import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Link } from 'wouter';
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
  Database,
  ChevronRight,
  Lock,
  Bot,
  Award,
  Menu,
  Rocket,
  Cpu,
  Target,
  X,
  Scan,
  FileCheck,
  PieChart,
  MessageSquare
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useI18n } from '@/lib/i18n';

export default function Landing() {
  const { locale, setLocale } = useI18n();
  const [mounted, setMounted] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggleLanguage = () => {
    setLocale(locale === 'en' ? 'ar' : 'en');
  };

  const isRTL = locale === 'ar';

  const t = {
    // Header
    nav: {
      features: locale === 'en' ? 'Features' : 'الميزات',
      advantages: locale === 'en' ? 'Advantages' : 'المزايا',
      roadmap: locale === 'en' ? 'Roadmap' : 'خارطة الطريق',
      login: locale === 'en' ? 'Login' : 'تسجيل الدخول',
      getStarted: locale === 'en' ? 'Get Started' : 'ابدأ الآن',
      languageToggle: locale === 'en' ? 'العربية' : 'EN',
    },
    // Hero
    hero: {
      headline: locale === 'en' 
        ? 'AI-Powered Bookkeeping for UAE Businesses'
        : 'محاسبة ذكية مدعومة بالذكاء الاصطناعي للشركات الإماراتية',
      subheadline: locale === 'en'
        ? 'Automate invoices, track expenses, and stay FTA-compliant with intelligent categorization. Save 20+ hours per month and eliminate costly errors.'
        : 'أتمتة الفواتير وتتبع المصروفات والامتثال للهيئة الاتحادية للضرائب بتصنيف ذكي. وفّر أكثر من 20 ساعة شهرياً وتجنب الأخطاء المكلفة.',
      ctaPrimary: locale === 'en' ? 'Start Free Trial' : 'ابدأ الإصدار التجريبي المجاني',
      ctaSecondary: locale === 'en' ? 'Schedule Demo' : 'حدد موعد عرض توضيحي',
      trustBadge: locale === 'en' ? 'No credit card required • UAE VAT compliant • 14-day trial' : 'لا حاجة لبطاقة ائتمان • متوافق مع ضريبة القيمة المضافة الإماراتية • تجربة مجانية لمدة 14 يوماً',
    },
    // Stats
    stats: {
      invoices: locale === 'en' ? 'Invoices Processed' : 'الفواتير المعالجة',
      accuracy: locale === 'en' ? 'AI Accuracy' : 'دقة الذكاء الاصطناعي',
      timeSaved: locale === 'en' ? 'Time Saved' : 'الوقت الموفر',
      businesses: locale === 'en' ? 'UAE Businesses' : 'الشركات الإماراتية',
    },
    // Features
    features: {
      title: locale === 'en' ? 'Everything You Need for Modern Bookkeeping' : 'كل ما تحتاجه للمحاسبة الحديثة',
      subtitle: locale === 'en' ? 'Built specifically for UAE businesses with AI-powered automation' : 'مصمم خصيصاً للشركات الإماراتية مع أتمتة مدعومة بالذكاء الاصطناعي',
      items: [
        {
          icon: Bot,
          title: locale === 'en' ? 'AI Expense Categorization' : 'تصنيف المصروفات بالذكاء الاصطناعي',
          description: locale === 'en' 
            ? 'Upload receipts and let GPT-4o instantly categorize expenses with 99.8% accuracy. No manual data entry required.'
            : 'ارفع الإيصالات ودع GPT-4o يصنف المصروفات فوراً بدقة 99.8%. لا حاجة لإدخال بيانات يدوي.',
        },
        {
          icon: FileCheck,
          title: locale === 'en' ? 'Smart Invoice Generation' : 'إنشاء فواتير ذكية',
          description: locale === 'en'
            ? 'Create FTA-compliant invoices in seconds with automatic VAT calculation and customizable templates.'
            : 'أنشئ فواتير متوافقة مع الهيئة الاتحادية للضرائب في ثوانٍ مع حساب تلقائي لضريبة القيمة المضافة وقوالب قابلة للتخصيص.',
        },
        {
          icon: Scan,
          title: locale === 'en' ? 'OCR Receipt Scanning' : 'مسح الإيصالات بتقنية OCR',
          description: locale === 'en'
            ? 'Bulk upload receipts and extract data automatically. Supports Arabic and English text with high accuracy.'
            : 'ارفع إيصالات متعددة واستخرج البيانات تلقائياً. يدعم النصوص العربية والإنجليزية بدقة عالية.',
        },
        {
          icon: PieChart,
          title: locale === 'en' ? 'Real-Time Financial Reports' : 'تقارير مالية في الوقت الفعلي',
          description: locale === 'en'
            ? 'Access profit & loss, balance sheets, and VAT summaries instantly. Export for FTA filing or audits.'
            : 'احصل على الأرباح والخسائر والميزانية العمومية وملخصات ضريبة القيمة المضافة فوراً. صدّر للتقديم للهيئة أو المراجعة.',
        },
        {
          icon: MessageSquare,
          title: locale === 'en' ? 'AI CFO Advisor' : 'مستشار مالي بالذكاء الاصطناعي',
          description: locale === 'en'
            ? 'Ask questions about your finances in plain English or Arabic. Get instant insights and recommendations.'
            : 'اسأل عن شؤونك المالية بالعربية أو الإنجليزية البسيطة. احصل على رؤى وتوصيات فورية.',
        },
        {
          icon: Lock,
          title: locale === 'en' ? 'Bank-Level Security' : 'أمان على مستوى البنوك',
          description: locale === 'en'
            ? 'Enterprise-grade encryption, automated backups, and SOC 2 compliance keep your financial data safe.'
            : 'تشفير على مستوى المؤسسات ونسخ احتياطية تلقائية والامتثال لـ SOC 2 تحافظ على أمان بياناتك المالية.',
        },
      ],
    },
    // Advantages
    advantages: {
      title: locale === 'en' ? 'Why We\'re Different from Traditional Accounting Software' : 'لماذا نحن مختلفون عن برامج المحاسبة التقليدية',
      subtitle: locale === 'en' ? 'Built for the modern UAE business owner, not legacy desktop systems' : 'مصمم لصاحب الأعمال الإماراتي الحديث، وليس لأنظمة سطح المكتب القديمة',
      items: [
        {
          title: locale === 'en' ? 'AI-First Design' : 'تصميم يعتمد على الذكاء الاصطناعي أولاً',
          us: locale === 'en' ? 'GPT-4o categorizes expenses automatically' : 'GPT-4o يصنف المصروفات تلقائياً',
          them: locale === 'en' ? 'Manual entry and tedious categorization' : 'إدخال يدوي وتصنيف ممل',
        },
        {
          title: locale === 'en' ? 'UAE-Specific Compliance' : 'امتثال خاص بالإمارات',
          us: locale === 'en' ? 'Built-in FTA VAT compliance and templates' : 'امتثال مدمج لضريبة القيمة المضافة الإماراتية وقوالب جاهزة',
          them: locale === 'en' ? 'Generic templates requiring customization' : 'قوالب عامة تحتاج تخصيص',
        },
        {
          title: locale === 'en' ? 'Bilingual Support' : 'دعم ثنائي اللغة',
          us: locale === 'en' ? 'Full Arabic and English with RTL support' : 'دعم كامل للعربية والإنجليزية مع RTL',
          them: locale === 'en' ? 'English only, poor Arabic support' : 'إنجليزي فقط، دعم ضعيف للعربية',
        },
        {
          title: locale === 'en' ? 'Modern Cloud Platform' : 'منصة سحابية حديثة',
          us: locale === 'en' ? 'Access anywhere, automatic updates, no IT needed' : 'الوصول من أي مكان، تحديثات تلقائية، لا حاجة لتقنية المعلومات',
          them: locale === 'en' ? 'Desktop software with manual updates' : 'برامج سطح المكتب مع تحديثات يدوية',
        },
        {
          title: locale === 'en' ? 'Intelligent Automation' : 'أتمتة ذكية',
          us: locale === 'en' ? 'OCR receipt scanning, bulk uploads' : 'مسح الإيصالات بـ OCR، تحميلات متعددة',
          them: locale === 'en' ? 'One-by-one manual processing' : 'معالجة يدوية واحداً تلو الآخر',
        },
        {
          title: locale === 'en' ? 'Price' : 'السعر',
          us: locale === 'en' ? 'Pay as you grow, no setup fees' : 'ادفع مع نموك، بدون رسوم إعداد',
          them: locale === 'en' ? 'High upfront costs and annual licenses' : 'تكاليف أولية عالية وتراخيص سنوية',
        },
      ],
    },
    // Roadmap
    roadmap: {
      title: locale === 'en' ? 'Product Roadmap' : 'خارطة طريق المنتج',
      subtitle: locale === 'en' ? 'Current features and what\'s coming next' : 'الميزات الحالية وما سيأتي',
      current: locale === 'en' ? 'Available Now' : 'متاح الآن',
      q1: locale === 'en' ? 'Q1 2025' : 'الربع الأول 2025',
      q2: locale === 'en' ? 'Q2 2025' : 'الربع الثاني 2025',
      features: {
        current: [
          {
            title: locale === 'en' ? 'AI Expense Categorization' : 'تصنيف المصروفات بالذكاء الاصطناعي',
            description: locale === 'en' ? 'GPT-4o powered intelligent categorization' : 'تصنيف ذكي مدعوم بـ GPT-4o',
          },
          {
            title: locale === 'en' ? 'Invoice Generation' : 'إنشاء الفواتير',
            description: locale === 'en' ? 'FTA-compliant invoices with VAT' : 'فواتير متوافقة مع الهيئة الاتحادية للضرائب مع ضريبة القيمة المضافة',
          },
          {
            title: locale === 'en' ? 'OCR Receipt Scanning' : 'مسح الإيصالات بـ OCR',
            description: locale === 'en' ? 'Bulk upload and automatic data extraction' : 'تحميل متعدد واستخراج تلقائي للبيانات',
          },
          {
            title: locale === 'en' ? 'Financial Reports' : 'التقارير المالية',
            description: locale === 'en' ? 'P&L, Balance Sheet, VAT Summary' : 'الأرباح والخسائر، الميزانية، ملخص ضريبة القيمة المضافة',
          },
        ],
        q1: [
          {
            title: locale === 'en' ? 'Bank Integration' : 'تكامل مصرفي',
            description: locale === 'en' ? 'Connect UAE bank accounts for automatic transaction import' : 'اربط حسابات مصرفية إماراتية لاستيراد المعاملات تلقائياً',
          },
          {
            title: locale === 'en' ? 'Multi-Currency Support' : 'دعم متعدد العملات',
            description: locale === 'en' ? 'Handle USD, EUR, GBP with automatic conversion' : 'تعامل مع الدولار واليورو والجنيه الإسترليني مع تحويل تلقائي',
          },
          {
            title: locale === 'en' ? 'Mobile App (iOS & Android)' : 'تطبيق جوال (iOS و Android)',
            description: locale === 'en' ? 'Scan receipts and manage finances on the go' : 'امسح الإيصالات وأدر شؤونك المالية أثناء التنقل',
          },
        ],
        q2: [
          {
            title: locale === 'en' ? 'Inventory Management' : 'إدارة المخزون',
            description: locale === 'en' ? 'Track stock levels and cost of goods sold' : 'تتبع مستويات المخزون وتكلفة البضائع المباعة',
          },
          {
            title: locale === 'en' ? 'Team Collaboration' : 'تعاون فريقي',
            description: locale === 'en' ? 'Multi-user access with role-based permissions' : 'وصول متعدد المستخدمين مع صلاحيات حسب الدور',
          },
          {
            title: locale === 'en' ? 'Advanced AI Insights' : 'رؤى ذكاء اصطناعي متقدمة',
            description: locale === 'en' ? 'Predictive cash flow analysis and anomaly detection' : 'تحليل تدفق نقدي تنبؤي وكشف شذوذات',
          },
        ],
      },
    },
    // Final CTA
    cta: {
      title: locale === 'en' ? 'Ready to Transform Your Bookkeeping?' : 'هل أنت مستعد لتحويل محاسبتك؟',
      subtitle: locale === 'en' ? 'Join hundreds of UAE businesses saving time and staying compliant' : 'انضم لمئات الشركات الإماراتية التي توفر الوقت وتحافظ على الامتثال',
      primary: locale === 'en' ? 'Start Free Trial' : 'ابدأ الإصدار التجريبي المجاني',
      secondary: locale === 'en' ? 'Schedule Demo' : 'حدد موعد عرض توضيحي',
    },
  };

  return (
    <div className={`min-h-screen bg-background ${isRTL ? 'rtl' : 'ltr'}`} dir={isRTL ? 'rtl' : 'ltr'}>
      
      {/* NAVBAR */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/40">
        <div className="container max-w-7xl mx-auto px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 hover-elevate active-elevate-2 rounded-lg px-2 py-1 -ml-2" data-testid="link-logo">
            <div className="relative">
              <Briefcase className="w-7 h-7 text-primary" />
              <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-primary rounded-full animate-pulse" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-xl leading-none tracking-tight">
                {locale === 'en' ? 'BookKeep AI' : 'بوككيب AI'}
              </span>
            </div>
          </Link>
          
          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm font-medium hover:text-primary transition-colors" data-testid="nav-features">
              {t.nav.features}
            </a>
            <a href="#advantages" className="text-sm font-medium hover:text-primary transition-colors" data-testid="nav-advantages">
              {t.nav.advantages}
            </a>
            <a href="#roadmap" className="text-sm font-medium hover:text-primary transition-colors" data-testid="nav-roadmap">
              {t.nav.roadmap}
            </a>
          </nav>

          {/* Desktop Actions */}
          <div className="hidden md:flex items-center gap-3">
            <Button 
              variant="ghost" 
              size="sm"
              onClick={toggleLanguage}
              data-testid="button-language-toggle"
            >
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
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>

          {/* Mobile Menu Button */}
          <button
            className="md:hidden p-2 hover-elevate active-elevate-2 rounded-lg"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            data-testid="button-mobile-menu"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border/40 bg-background/95 backdrop-blur-xl">
            <nav className="container max-w-7xl mx-auto px-6 py-4 flex flex-col gap-4">
              <a href="#features" className="text-sm font-medium hover:text-primary transition-colors" onClick={() => setMobileMenuOpen(false)} data-testid="mobile-nav-features">
                {t.nav.features}
              </a>
              <a href="#advantages" className="text-sm font-medium hover:text-primary transition-colors" onClick={() => setMobileMenuOpen(false)} data-testid="mobile-nav-advantages">
                {t.nav.advantages}
              </a>
              <a href="#roadmap" className="text-sm font-medium hover:text-primary transition-colors" onClick={() => setMobileMenuOpen(false)} data-testid="mobile-nav-roadmap">
                {t.nav.roadmap}
              </a>
              <div className="flex flex-col gap-2 pt-2">
                <Button variant="ghost" size="sm" onClick={toggleLanguage} data-testid="mobile-button-language-toggle">
                  {t.nav.languageToggle}
                </Button>
                <Link href="/login">
                  <Button variant="ghost" size="sm" className="w-full" data-testid="mobile-button-login">
                    {t.nav.login}
                  </Button>
                </Link>
                <Link href="/register">
                  <Button size="sm" className="w-full" data-testid="mobile-button-get-started">
                    {t.nav.getStarted}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </Link>
              </div>
            </nav>
          </div>
        )}
      </header>

      {/* HERO SECTION */}
      <section className="relative overflow-hidden" data-testid="section-hero">
        {/* Gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-accent/5 pointer-events-none" />
        
        <div className="container max-w-7xl mx-auto px-6 lg:px-8 py-24 lg:py-32 relative">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Text Content */}
            <div className="max-w-3xl">
              <Badge className="mb-6 px-4 py-1.5" variant="secondary" data-testid="badge-ai-powered">
                <Sparkles className="w-4 h-4 mr-2" />
                AI-Powered
              </Badge>
              
              <h1 className="text-5xl lg:text-7xl font-bold tracking-tight mb-6 bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
                {t.hero.headline}
              </h1>
              
              <p className="text-xl lg:text-2xl text-muted-foreground leading-relaxed mb-8 max-w-2xl" data-testid="hero-subheadline">
                {t.hero.subheadline}
              </p>

              <div className="flex flex-col sm:flex-row gap-4 mb-8">
                <Link href="/register">
                  <Button size="lg" className="px-8 py-6 text-lg" data-testid="hero-button-start-trial">
                    {t.hero.ctaPrimary}
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </Link>
                <Button size="lg" variant="outline" className="px-8 py-6 text-lg backdrop-blur-sm" data-testid="hero-button-schedule-demo">
                  {t.hero.ctaSecondary}
                </Button>
              </div>

              <p className="text-sm text-muted-foreground" data-testid="hero-trust-badge">
                {t.hero.trustBadge}
              </p>
            </div>

            {/* Hero Visual - Glassmorphic Dashboard Preview */}
            <div className="relative lg:block" data-testid="hero-visual">
              <div className="relative rounded-2xl border border-border/50 bg-card/50 backdrop-blur-xl p-8 shadow-2xl">
                <div className="space-y-4">
                  {/* Mock dashboard elements */}
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Bot className="w-6 h-6 text-primary" />
                    </div>
                    <div className="flex-1">
                      <div className="h-3 w-32 bg-primary/20 rounded mb-2" />
                      <div className="h-2 w-24 bg-muted rounded" />
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg bg-green-500/10 flex items-center justify-center">
                      <CheckCircle2 className="w-6 h-6 text-green-500" />
                    </div>
                    <div className="flex-1">
                      <div className="h-3 w-40 bg-green-500/20 rounded mb-2" />
                      <div className="h-2 w-28 bg-muted rounded" />
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center">
                      <BarChart3 className="w-6 h-6 text-blue-500" />
                    </div>
                    <div className="flex-1">
                      <div className="h-3 w-36 bg-blue-500/20 rounded mb-2" />
                      <div className="h-2 w-20 bg-muted rounded" />
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Floating accent */}
              <div className="absolute -top-4 -right-4 w-24 h-24 bg-primary/20 rounded-full blur-3xl animate-pulse" />
              <div className="absolute -bottom-4 -left-4 w-32 h-32 bg-accent/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
            </div>
          </div>
        </div>
      </section>

      {/* STATS SECTION */}
      <section className="border-y border-border/40 bg-card/30 backdrop-blur-sm" data-testid="section-stats">
        <div className="container max-w-7xl mx-auto px-6 lg:px-8 py-16">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="text-center" data-testid="stat-invoices">
              <div className="text-4xl lg:text-5xl font-bold font-mono mb-2">15,000+</div>
              <div className="text-sm text-muted-foreground">{t.stats.invoices}</div>
            </div>
            <div className="text-center" data-testid="stat-accuracy">
              <div className="text-4xl lg:text-5xl font-bold font-mono mb-2">99.8%</div>
              <div className="text-sm text-muted-foreground">{t.stats.accuracy}</div>
            </div>
            <div className="text-center" data-testid="stat-time-saved">
              <div className="text-4xl lg:text-5xl font-bold font-mono mb-2">87%</div>
              <div className="text-sm text-muted-foreground">{t.stats.timeSaved}</div>
            </div>
            <div className="text-center" data-testid="stat-businesses">
              <div className="text-4xl lg:text-5xl font-bold font-mono mb-2">300+</div>
              <div className="text-sm text-muted-foreground">{t.stats.businesses}</div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES SECTION */}
      <section id="features" className="py-24 lg:py-32" data-testid="section-features">
        <div className="container max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl lg:text-5xl font-bold mb-4" data-testid="features-title">{t.features.title}</h2>
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto" data-testid="features-subtitle">{t.features.subtitle}</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {t.features.items.map((feature, index) => (
              <Card 
                key={index} 
                className="p-8 border border-border/50 bg-card/50 backdrop-blur-sm hover-elevate transition-all duration-300"
                data-testid={`feature-card-${index}`}
              >
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <feature.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-xl font-semibold mb-4">{feature.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{feature.description}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ADVANTAGES SECTION */}
      <section id="advantages" className="py-24 lg:py-32 bg-gradient-to-b from-accent/5 to-background" data-testid="section-advantages">
        <div className="container max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl lg:text-5xl font-bold mb-4" data-testid="advantages-title">{t.advantages.title}</h2>
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto" data-testid="advantages-subtitle">{t.advantages.subtitle}</p>
          </div>

          <div className="max-w-5xl mx-auto space-y-6">
            {t.advantages.items.map((advantage, index) => (
              <div 
                key={index} 
                className="grid lg:grid-cols-3 gap-4 p-6 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm hover-elevate transition-all duration-300"
                data-testid={`advantage-row-${index}`}
              >
                <div className="font-semibold flex items-center gap-2">
                  <Target className="w-5 h-5 text-primary" />
                  {advantage.title}
                </div>
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                  <span className="text-sm">{advantage.us}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <X className="w-5 h-5 flex-shrink-0" />
                  <span className="text-sm">{advantage.them}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ROADMAP SECTION */}
      <section id="roadmap" className="py-24 lg:py-32" data-testid="section-roadmap">
        <div className="container max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl lg:text-5xl font-bold mb-4" data-testid="roadmap-title">{t.roadmap.title}</h2>
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto" data-testid="roadmap-subtitle">{t.roadmap.subtitle}</p>
          </div>

          <div className="grid lg:grid-cols-3 gap-8">
            {/* Current Features */}
            <div className="space-y-6" data-testid="roadmap-current">
              <div className="flex items-center gap-3 mb-6">
                <Badge className="px-4 py-1.5" variant="default">
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  {t.roadmap.current}
                </Badge>
              </div>
              {t.roadmap.features.current.map((feature, index) => (
                <Card key={index} className="p-6 border-2 border-primary/20 bg-primary/5" data-testid={`roadmap-current-feature-${index}`}>
                  <h4 className="font-semibold mb-2">{feature.title}</h4>
                  <p className="text-sm text-muted-foreground">{feature.description}</p>
                </Card>
              ))}
            </div>

            {/* Q1 2025 */}
            <div className="space-y-6" data-testid="roadmap-q1">
              <div className="flex items-center gap-3 mb-6">
                <Badge className="px-4 py-1.5" variant="secondary">
                  <Rocket className="w-4 h-4 mr-2" />
                  {t.roadmap.q1}
                </Badge>
              </div>
              {t.roadmap.features.q1.map((feature, index) => (
                <Card key={index} className="p-6 border border-border/50 bg-card/50 backdrop-blur-sm" data-testid={`roadmap-q1-feature-${index}`}>
                  <h4 className="font-semibold mb-2">{feature.title}</h4>
                  <p className="text-sm text-muted-foreground">{feature.description}</p>
                </Card>
              ))}
            </div>

            {/* Q2 2025 */}
            <div className="space-y-6" data-testid="roadmap-q2">
              <div className="flex items-center gap-3 mb-6">
                <Badge className="px-4 py-1.5" variant="outline">
                  <Star className="w-4 h-4 mr-2" />
                  {t.roadmap.q2}
                </Badge>
              </div>
              {t.roadmap.features.q2.map((feature, index) => (
                <Card key={index} className="p-6 border border-dashed border-border/50 bg-card/30 backdrop-blur-sm" data-testid={`roadmap-q2-feature-${index}`}>
                  <h4 className="font-semibold mb-2">{feature.title}</h4>
                  <p className="text-sm text-muted-foreground">{feature.description}</p>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FINAL CTA SECTION */}
      <section className="py-24 lg:py-32 relative overflow-hidden" data-testid="section-cta">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-accent/5 to-background pointer-events-none" />
        
        <div className="container max-w-7xl mx-auto px-6 lg:px-8 relative">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-4xl lg:text-5xl font-bold mb-6" data-testid="cta-title">{t.cta.title}</h2>
            <p className="text-xl text-muted-foreground mb-8" data-testid="cta-subtitle">{t.cta.subtitle}</p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/register">
                <Button size="lg" className="px-8 py-6 text-lg" data-testid="cta-button-start-trial">
                  {t.cta.primary}
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </Link>
              <Button size="lg" variant="outline" className="px-8 py-6 text-lg backdrop-blur-sm" data-testid="cta-button-schedule-demo">
                {t.cta.secondary}
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-border/40 py-12" data-testid="section-footer">
        <div className="container max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-3">
              <Briefcase className="w-6 h-6 text-primary" />
              <span className="font-semibold">
                {locale === 'en' ? 'BookKeep AI' : 'بوككيب AI'}
              </span>
            </div>
            <div className="text-sm text-muted-foreground">
              © 2025 BookKeep AI. {locale === 'en' ? 'All rights reserved.' : 'جميع الحقوق محفوظة.'}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
