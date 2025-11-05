import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Sheet as SheetComponent,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
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
  Download,
  ChevronRight,
  MapPin,
  Lock,
  Bot,
  Award,
  Menu,
  Rocket,
  Cpu,
  Activity,
  Eye,
  Layers,
  GitBranch,
  Target,
  Microscope
} from 'lucide-react';
import { SiStripe, SiPaypal } from 'react-icons/si';
import { useState, useEffect } from 'react';
import { useI18n } from '@/lib/i18n';
import { EmailPopup } from '@/components/EmailPopup';
import { useHealthCheck } from '@/hooks/useHealthCheck';

export default function Landing() {
  const { locale, setLocale } = useI18n();
  const [mounted, setMounted] = useState(false);
  const [showEmailPopup, setShowEmailPopup] = useState(false);
  const [monthlyTransactions, setMonthlyTransactions] = useState(50);
  const [hoursPerWeek, setHoursPerWeek] = useState(0);
  const [moneySaved, setMoneySaved] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [animatedInvoices, setAnimatedInvoices] = useState(0);
  const [animatedAccuracy, setAnimatedAccuracy] = useState(0);
  const [animatedTime, setAnimatedTime] = useState(0);
  const healthStatus = useHealthCheck(30000);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // Animated stats
  useEffect(() => {
    if (!mounted) return;
    
    const duration = 2000;
    const steps = 60;
    const invoiceTarget = 15000;
    const accuracyTarget = 99.8;
    const timeTarget = 87;
    
    let current = 0;
    const interval = setInterval(() => {
      current++;
      const progress = current / steps;
      
      setAnimatedInvoices(Math.floor(invoiceTarget * progress));
      setAnimatedAccuracy(Number((accuracyTarget * progress).toFixed(1)));
      setAnimatedTime(Math.floor(timeTarget * progress));
      
      if (current >= steps) clearInterval(interval);
    }, duration / steps);
    
    return () => clearInterval(interval);
  }, [mounted]);

  // Show email popup after 15 seconds OR 50% scroll
  useEffect(() => {
    let hasShownPopup = false;
    
    const showPopup = () => {
      if (!hasShownPopup) {
        hasShownPopup = true;
        setShowEmailPopup(true);
      }
    };

    const popupTimer = setTimeout(showPopup, 15000);
    const handleScroll = () => {
      const scrollPercent = (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100;
      if (scrollPercent >= 50) showPopup();
    };

    window.addEventListener('scroll', handleScroll);
    return () => {
      clearTimeout(popupTimer);
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // Calculate ROI based on transactions
  useEffect(() => {
    const monthlyHours = (monthlyTransactions * 2) / 60;
    const weeklyHours = monthlyHours / 4;
    const monthlySavings = monthlyHours * 50;
    setHoursPerWeek(weeklyHours);
    setMoneySaved(Math.round(monthlySavings));
  }, [monthlyTransactions]);

  const toggleLanguage = () => {
    setLocale(locale === 'en' ? 'ar' : 'en');
  };

  const isRTL = locale === 'ar';

  return (
    <div className={`min-h-screen bg-background ${isRTL ? 'rtl' : 'ltr'}`} dir={isRTL ? 'rtl' : 'ltr'}>
      <EmailPopup open={showEmailPopup} onClose={() => setShowEmailPopup(false)} locale={locale} />

      {/* NAVBAR */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg supports-[backdrop-filter]:bg-background/60 border-b border-border/40">
        <div className="container max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 hover-elevate active-elevate-2 rounded-lg px-2 py-1 -ml-2" data-testid="link-logo">
            <div className="relative">
              <Briefcase className="w-6 h-6 text-primary" />
              <div className="absolute -top-1 -right-1 w-2 h-2 bg-primary rounded-full animate-pulse" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-lg leading-none">
                {locale === 'en' ? 'BookKeep AI' : 'بوككيب AI'}
              </span>
              <span className="text-xs text-muted-foreground">
                {locale === 'en' ? 'Futuristic Accounting' : 'محاسبة مستقبلية'}
              </span>
            </div>
          </Link>
          
          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-6">
            <a href="#features" className="text-sm hover:text-primary transition-colors" data-testid="nav-features">
              {locale === 'en' ? 'Features' : 'الميزات'}
            </a>
            <a href="#platform" className="text-sm hover:text-primary transition-colors" data-testid="nav-platform">
              {locale === 'en' ? 'Platform' : 'المنصة'}
            </a>
            <a href="#pricing" className="text-sm hover:text-primary transition-colors" data-testid="nav-pricing">
              {locale === 'en' ? 'Pricing' : 'الأسعار'}
            </a>
          </nav>

          {/* Desktop Actions */}
          <div className="hidden md:flex items-center gap-3">
            <Button 
              variant="ghost" 
              size="sm"
              onClick={toggleLanguage}
              aria-label={locale === 'en' ? 'Switch to Arabic' : 'التبديل إلى الإنجليزية'}
              data-testid="button-toggle-language"
            >
              <Globe className="w-4 h-4 mr-2" />
              {locale === 'en' ? 'العربية' : 'English'}
            </Button>
            <Link href="/login">
              <Button variant="ghost" size="sm" data-testid="link-login">
                {locale === 'en' ? 'Login' : 'دخول'}
              </Button>
            </Link>
            <Link href="/register">
              <Button size="sm" className="bg-gradient-to-r from-primary to-primary/80" data-testid="link-register-header">
                {locale === 'en' ? 'Start Free' : 'ابدأ مجانًا'}
                <Rocket className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>

          {/* Mobile Menu */}
          <div className="flex md:hidden items-center gap-2">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={toggleLanguage}
              aria-label={locale === 'en' ? 'Switch to Arabic' : 'التبديل إلى الإنجليزية'}
              data-testid="button-toggle-language-mobile"
            >
              <Globe className="w-5 h-5" />
            </Button>
            <SheetComponent open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  aria-label={locale === 'en' ? 'Open main menu' : 'فتح القائمة الرئيسية'}
                  data-testid="button-mobile-menu"
                >
                  <Menu className="w-5 h-5" />
                  <span className="sr-only">{locale === 'en' ? 'Open menu' : 'فتح القائمة'}</span>
                </Button>
              </SheetTrigger>
              <SheetContent side={isRTL ? 'left' : 'right'}>
                <SheetHeader>
                  <SheetTitle>{locale === 'en' ? 'Menu' : 'القائمة'}</SheetTitle>
                </SheetHeader>
                <nav className="flex flex-col gap-4 mt-8">
                  <a href="#features" className="text-lg hover:text-primary transition-colors py-2" onClick={() => setMobileMenuOpen(false)} data-testid="nav-features-mobile">
                    {locale === 'en' ? 'Features' : 'الميزات'}
                  </a>
                  <a href="#platform" className="text-lg hover:text-primary transition-colors py-2" onClick={() => setMobileMenuOpen(false)} data-testid="nav-platform-mobile">
                    {locale === 'en' ? 'Platform' : 'المنصة'}
                  </a>
                  <a href="#pricing" className="text-lg hover:text-primary transition-colors py-2" onClick={() => setMobileMenuOpen(false)} data-testid="nav-pricing-mobile">
                    {locale === 'en' ? 'Pricing' : 'الأسعار'}
                  </a>
                  <div className="border-t pt-4 mt-4 flex flex-col gap-3">
                    <Link href="/login">
                      <Button variant="ghost" className="w-full" data-testid="link-login-mobile">
                        {locale === 'en' ? 'Login' : 'دخول'}
                      </Button>
                    </Link>
                    <Link href="/register">
                      <Button className="w-full" data-testid="link-register-mobile">
                        {locale === 'en' ? 'Start Free Trial' : 'ابدأ تجربة مجانية'}
                      </Button>
                    </Link>
                  </div>
                </nav>
              </SheetContent>
            </SheetComponent>
          </div>
        </div>
      </header>

      <main role="main">
        {/* HERO SECTION - FUTURISTIC */}
        <section className="relative py-32 lg:py-40 overflow-hidden" aria-label={locale === 'en' ? 'Hero section' : 'القسم الرئيسي'}>
          {/* Animated Background */}
          <div className="absolute inset-0">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-background to-accent/20 opacity-50" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/20 via-transparent to-transparent opacity-30" />
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-pulse" />
            <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent/10 rounded-full blur-3xl animate-pulse delay-700" />
          </div>
          
          <div className="container max-w-7xl mx-auto px-4 relative">
            <div className="text-center max-w-5xl mx-auto space-y-8">
              {/* Status Badge */}
              <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border ${mounted ? 'animate-in fade-in slide-in-from-top-4 duration-1000' : 'opacity-0'}`}>
                <Activity className="w-4 h-4 text-primary animate-pulse" />
                <span className="text-sm font-medium">
                  {locale === 'en' ? 'Next-Generation AI Accounting' : 'محاسبة الذكاء الاصطناعي من الجيل التالي'}
                </span>
                <Badge 
                  variant="outline" 
                  className={`gap-1 ${
                    healthStatus.isOnline 
                      ? 'bg-green-500/10 border-green-500/50 text-green-700 dark:text-green-400' 
                      : 'bg-red-500/10 border-red-500/50 text-red-700 dark:text-red-400'
                  }`}
                  data-testid="badge-api-status"
                >
                  <CheckCircle2 className={`w-3 h-3 ${healthStatus.isOnline ? 'text-green-500' : 'text-red-500'}`} />
                  {healthStatus.isOnline ? (locale === 'en' ? 'Live' : 'مباشر') : (locale === 'en' ? 'Offline' : 'غير متصل')}
                </Badge>
              </div>
              
              {/* Hero Headline */}
              <h1 className={`text-5xl lg:text-7xl font-bold leading-tight ${mounted ? 'animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-100' : 'opacity-0'}`}>
                {locale === 'en' ? (
                  <>
                    <span className="bg-gradient-to-r from-primary via-primary/80 to-accent bg-clip-text text-transparent">
                      AI Bookkeeping
                    </span>
                    {' '}Built for UAE Businesses
                  </>
                ) : (
                  <>
                    <span className="bg-gradient-to-r from-primary via-primary/80 to-accent bg-clip-text text-transparent">
                      محاسبة AI
                    </span>
                    {' '}مصممة للشركات الإماراتية
                  </>
                )}
              </h1>

              {/* Subheading */}
              <p className={`text-xl lg:text-2xl text-muted-foreground max-w-3xl mx-auto ${mounted ? 'animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-200' : 'opacity-0'}`}>
                {locale === 'en' 
                  ? 'Experience futuristic accounting automation. Save time, stay FTA-compliant, and unlock real-time financial clarity with cutting-edge AI.'
                  : 'اختبر أتمتة المحاسبة المستقبلية. وفّر الوقت، والتزم بمعايير الهيئة الاتحادية للضرائب، واحصل على وضوح مالي في الوقت الفعلي باستخدام الذكاء الاصطناعي المتقدم.'}
              </p>

              {/* CTAs */}
              <div className={`flex flex-wrap justify-center gap-4 ${mounted ? 'animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-300' : 'opacity-0'}`}>
                <Link href="/register">
                  <Button 
                    size="lg" 
                    className="min-h-[44px] text-lg px-8 bg-gradient-to-r from-primary to-primary/80 hover:shadow-lg hover:shadow-primary/50 transition-shadow"
                    aria-label={locale === 'en' ? 'Start free trial and create your account' : 'ابدأ تجربة مجانية وأنشئ حسابك'}
                    data-testid="button-start-trial-hero"
                  >
                    <Rocket className="w-5 h-5 mr-2" />
                    {locale === 'en' ? 'Start Free Trial' : 'ابدأ تجربة مجانية'}
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </Link>
                <Button 
                  size="lg" 
                  variant="outline" 
                  className="min-h-[44px] text-lg px-8 backdrop-blur-sm"
                  aria-label={locale === 'en' ? 'Watch demo video to see the platform in action' : 'شاهد فيديو توضيحي لرؤية المنصة أثناء العمل'}
                  data-testid="button-watch-demo"
                >
                  <Eye className="w-5 h-5 mr-2" />
                  {locale === 'en' ? 'See it in Action' : 'شاهده أثناء العمل'}
                </Button>
              </div>

              {/* Trust Badges */}
              <div className={`flex flex-wrap justify-center gap-4 pt-6 ${mounted ? 'animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-400' : 'opacity-0'}`}>
                <Badge variant="secondary" className="gap-2 px-4 py-2 text-sm">
                  <Shield className="w-4 h-4" />
                  {locale === 'en' ? 'FTA-Compliant' : 'متوافق مع الهيئة'}
                </Badge>
                <Badge variant="secondary" className="gap-2 px-4 py-2 text-sm">
                  <Lock className="w-4 h-4" />
                  {locale === 'en' ? 'Bank-Grade Security' : 'أمان بنكي'}
                </Badge>
                <Badge variant="secondary" className="gap-2 px-4 py-2 text-sm">
                  <Brain className="w-4 h-4" />
                  {locale === 'en' ? 'Powered by AI' : 'مدعوم بـ AI'}
                </Badge>
              </div>
            </div>

            {/* Animated Stats */}
            <div className={`grid grid-cols-1 md:grid-cols-3 gap-6 mt-20 max-w-5xl mx-auto ${mounted ? 'animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-500' : 'opacity-0'}`}>
              <Card className="p-6 text-center border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent hover-elevate">
                <div className="text-4xl lg:text-5xl font-bold text-primary mb-2">
                  {animatedInvoices.toLocaleString()}+
                </div>
                <div className="text-sm text-muted-foreground font-medium">
                  {locale === 'en' ? 'Invoices Processed' : 'فواتير معالجة'}
                </div>
              </Card>
              <Card className="p-6 text-center border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent hover-elevate">
                <div className="text-4xl lg:text-5xl font-bold text-primary mb-2">
                  {animatedAccuracy}%
                </div>
                <div className="text-sm text-muted-foreground font-medium">
                  {locale === 'en' ? 'AI Accuracy Rate' : 'دقة الذكاء الاصطناعي'}
                </div>
              </Card>
              <Card className="p-6 text-center border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent hover-elevate">
                <div className="text-4xl lg:text-5xl font-bold text-primary mb-2">
                  {animatedTime}%
                </div>
                <div className="text-sm text-muted-foreground font-medium">
                  {locale === 'en' ? 'Time Saved' : 'الوقت الموفر'}
                </div>
              </Card>
            </div>
          </div>
        </section>

        {/* FEATURES - INTERACTIVE SHOWCASE */}
        <section className="py-20 lg:py-32 bg-muted/20" id="features">
          <div className="container max-w-7xl mx-auto px-4">
            <div className="text-center mb-16">
              <Badge className="mb-4">
                <Sparkles className="w-4 h-4 mr-2" />
                {locale === 'en' ? 'Cutting-Edge Features' : 'ميزات متطورة'}
              </Badge>
              <h2 className="text-4xl lg:text-5xl font-bold mb-4">
                {locale === 'en' ? (
                  <>The Future of <span className="text-primary">Accounting is Here</span></>
                ) : (
                  <>مستقبل <span className="text-primary">المحاسبة هنا</span></>
                )}
              </h2>
              <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
                {locale === 'en'
                  ? 'Experience next-generation AI that understands UAE tax law, learns from your data, and automates complex workflows in real-time.'
                  : 'اختبر الذكاء الاصطناعي من الجيل التالي الذي يفهم القانون الضريبي الإماراتي، ويتعلم من بياناتك، ويؤتمت سير العمل المعقد في الوقت الفعلي.'}
              </p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {/* Feature 1 */}
              <Card className="p-8 hover-elevate group cursor-pointer transition-all border-2 hover:border-primary/50" data-testid="feature-ai-brain">
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-primary/10 rounded-full blur-2xl group-hover:blur-3xl transition-all" />
                  <Brain className="w-16 h-16 text-primary relative z-10 group-hover:scale-110 transition-transform" />
                </div>
                <h3 className="text-2xl font-bold mb-3">
                  {locale === 'en' ? 'Intelligent Auto-Categorization' : 'تصنيف تلقائي ذكي'}
                </h3>
                <p className="text-muted-foreground mb-4">
                  {locale === 'en'
                    ? 'Our AI learns your business patterns and auto-categorizes transactions with 99.8% accuracy. No manual data entry ever again.'
                    : 'يتعلم الذكاء الاصطناعي أنماط عملك ويصنف المعاملات تلقائيًا بدقة 99.8٪. لا حاجة لإدخال البيانات يدويًا مرة أخرى.'}
                </p>
                <ul className="space-y-2">
                  {[
                    locale === 'en' ? 'Real-time transaction processing' : 'معالجة المعاملات في الوقت الفعلي',
                    locale === 'en' ? 'Custom rule learning' : 'تعلم القواعد المخصصة',
                    locale === 'en' ? 'Vendor pattern recognition' : 'التعرف على أنماط البائعين'
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-green-500 mt-1 flex-shrink-0" />
                      <span className="text-sm">{item}</span>
                    </li>
                  ))}
                </ul>
              </Card>

              {/* Feature 2 */}
              <Card className="p-8 hover-elevate group cursor-pointer transition-all border-2 hover:border-primary/50" data-testid="feature-realtime">
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-primary/10 rounded-full blur-2xl group-hover:blur-3xl transition-all" />
                  <Activity className="w-16 h-16 text-primary relative z-10 group-hover:scale-110 transition-transform" />
                </div>
                <h3 className="text-2xl font-bold mb-3">
                  {locale === 'en' ? 'Real-Time P&L Dashboard' : 'لوحة P&L في الوقت الفعلي'}
                </h3>
                <p className="text-muted-foreground mb-4">
                  {locale === 'en'
                    ? 'Watch your financial health update live. Every transaction instantly reflects in beautifully designed reports.'
                    : 'شاهد صحتك المالية تتحدث مباشرة. كل معاملة تنعكس على الفور في تقارير مصممة بشكل جميل.'}
                </p>
                <ul className="space-y-2">
                  {[
                    locale === 'en' ? 'Live profit & loss tracking' : 'تتبع الأرباح والخسائر المباشر',
                    locale === 'en' ? 'Interactive financial charts' : 'رسوم بيانية مالية تفاعلية',
                    locale === 'en' ? 'One-click report generation' : 'إنشاء التقرير بنقرة واحدة'
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-green-500 mt-1 flex-shrink-0" />
                      <span className="text-sm">{item}</span>
                    </li>
                  ))}
                </ul>
              </Card>

              {/* Feature 3 */}
              <Card className="p-8 hover-elevate group cursor-pointer transition-all border-2 hover:border-primary/50" data-testid="feature-uae-tax">
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-primary/10 rounded-full blur-2xl group-hover:blur-3xl transition-all" />
                  <FileText className="w-16 h-16 text-primary relative z-10 group-hover:scale-110 transition-transform" />
                </div>
                <h3 className="text-2xl font-bold mb-3">
                  {locale === 'en' ? 'UAE Tax Automation' : 'أتمتة الضرائب الإماراتية'}
                </h3>
                <p className="text-muted-foreground mb-4">
                  {locale === 'en'
                    ? 'Built-in UAE VAT (5%) and corporate tax compliance. Generate FTA-ready reports with one click.'
                    : 'امتثال مدمج لضريبة القيمة المضافة (5٪) والضريبة على الشركات في الإمارات. إنشاء تقارير جاهزة للهيئة الاتحادية بنقرة واحدة.'}
                </p>
                <ul className="space-y-2">
                  {[
                    locale === 'en' ? 'Bilingual tax invoices (EN/AR)' : 'فواتير ضريبية ثنائية اللغة',
                    locale === 'en' ? 'Automatic VAT calculations' : 'حسابات ضريبة القيمة المضافة التلقائية',
                    locale === 'en' ? 'FTA filing assistance' : 'مساعدة تقديم الهيئة الاتحادية'
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-green-500 mt-1 flex-shrink-0" />
                      <span className="text-sm">{item}</span>
                    </li>
                  ))}
                </ul>
              </Card>

              {/* Feature 4 */}
              <Card className="p-8 hover-elevate group cursor-pointer transition-all border-2 hover:border-primary/50" data-testid="feature-collaboration">
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-primary/10 rounded-full blur-2xl group-hover:blur-3xl transition-all" />
                  <GitBranch className="w-16 h-16 text-primary relative z-10 group-hover:scale-110 transition-transform" />
                </div>
                <h3 className="text-2xl font-bold mb-3">
                  {locale === 'en' ? 'Accountant Collaboration' : 'تعاون المحاسبين'}
                </h3>
                <p className="text-muted-foreground mb-4">
                  {locale === 'en'
                    ? 'Invite your accountant with one click. Share read-only or edit access. Perfect for year-end close.'
                    : 'ادع محاسبك بنقرة واحدة. شارك الوصول للقراءة فقط أو التحرير. مثالي لإغلاق نهاية العام.'}
                </p>
                <ul className="space-y-2">
                  {[
                    locale === 'en' ? 'Role-based permissions' : 'أذونات قائمة على الأدوار',
                    locale === 'en' ? 'Audit trail & history' : 'مسار التدقيق والتاريخ',
                    locale === 'en' ? 'Shared workspaces' : 'مساحات عمل مشتركة'
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-green-500 mt-1 flex-shrink-0" />
                      <span className="text-sm">{item}</span>
                    </li>
                  ))}
                </ul>
              </Card>

              {/* Feature 5 */}
              <Card className="p-8 hover-elevate group cursor-pointer transition-all border-2 hover:border-primary/50" data-testid="feature-ocr">
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-primary/10 rounded-full blur-2xl group-hover:blur-3xl transition-all" />
                  <Microscope className="w-16 h-16 text-primary relative z-10 group-hover:scale-110 transition-transform" />
                </div>
                <h3 className="text-2xl font-bold mb-3">
                  {locale === 'en' ? 'OCR Receipt Scanning' : 'مسح الإيصالات بـ OCR'}
                </h3>
                <p className="text-muted-foreground mb-4">
                  {locale === 'en'
                    ? 'Snap a photo of any receipt. Our AI extracts amount, date, vendor, and categorizes automatically.'
                    : 'التقط صورة لأي إيصال. يستخرج الذكاء الاصطناعي المبلغ والتاريخ والبائع ويصنف تلقائيًا.'}
                </p>
                <ul className="space-y-2">
                  {[
                    locale === 'en' ? 'Mobile app integration' : 'تكامل تطبيق الجوال',
                    locale === 'en' ? 'Multi-language support' : 'دعم متعدد اللغات',
                    locale === 'en' ? 'Cloud receipt storage' : 'تخزين الإيصالات السحابي'
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-green-500 mt-1 flex-shrink-0" />
                      <span className="text-sm">{item}</span>
                    </li>
                  ))}
                </ul>
              </Card>

              {/* Feature 6 */}
              <Card className="p-8 hover-elevate group cursor-pointer transition-all border-2 hover:border-primary/50" data-testid="feature-security">
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-primary/10 rounded-full blur-2xl group-hover:blur-3xl transition-all" />
                  <Shield className="w-16 h-16 text-primary relative z-10 group-hover:scale-110 transition-transform" />
                </div>
                <h3 className="text-2xl font-bold mb-3">
                  {locale === 'en' ? 'Bank-Grade Security' : 'أمان على مستوى البنوك'}
                </h3>
                <p className="text-muted-foreground mb-4">
                  {locale === 'en'
                    ? 'Your data is encrypted end-to-end. Hosted on UAE cloud infrastructure with automatic backups.'
                    : 'بياناتك مشفرة من طرف إلى طرف. مستضافة على البنية التحتية السحابية الإماراتية مع نسخ احتياطية تلقائية.'}
                </p>
                <ul className="space-y-2">
                  {[
                    locale === 'en' ? '256-bit encryption' : 'تشفير 256 بت',
                    locale === 'en' ? 'UAE data sovereignty' : 'سيادة البيانات الإماراتية',
                    locale === 'en' ? 'Daily automated backups' : 'نسخ احتياطية يومية تلقائية'
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-green-500 mt-1 flex-shrink-0" />
                      <span className="text-sm">{item}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>
        </section>

        {/* PLATFORM SHOWCASE */}
        <section className="py-20 lg:py-32" id="platform">
          <div className="container max-w-7xl mx-auto px-4">
            <div className="text-center mb-16">
              <Badge className="mb-4">
                <Cpu className="w-4 h-4 mr-2" />
                {locale === 'en' ? 'The Platform' : 'المنصة'}
              </Badge>
              <h2 className="text-4xl lg:text-5xl font-bold mb-4">
                {locale === 'en' ? (
                  <>Built for <span className="text-primary">Scale & Speed</span></>
                ) : (
                  <>مصمم من أجل <span className="text-primary">النطاق والسرعة</span></>
                )}
              </h2>
            </div>

            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div className="space-y-8">
                <div className="flex gap-4 hover-elevate p-6 rounded-lg">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                      <Zap className="w-6 h-6 text-primary" />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-xl font-bold mb-2">
                      {locale === 'en' ? 'Lightning Fast' : 'سريع البرق'}
                    </h3>
                    <p className="text-muted-foreground">
                      {locale === 'en'
                        ? 'Process thousands of transactions in seconds. Our AI engine is optimized for UAE business volumes.'
                        : 'معالجة آلاف المعاملات في ثوانٍ. محرك الذكاء الاصطناعي محسّن لأحجام الأعمال الإماراتية.'}
                    </p>
                  </div>
                </div>

                <div className="flex gap-4 hover-elevate p-6 rounded-lg">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                      <Layers className="w-6 h-6 text-primary" />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-xl font-bold mb-2">
                      {locale === 'en' ? 'Multi-Company Support' : 'دعم متعدد الشركات'}
                    </h3>
                    <p className="text-muted-foreground">
                      {locale === 'en'
                        ? 'Manage unlimited companies from one dashboard. Perfect for accountants and business owners with multiple entities.'
                        : 'إدارة شركات غير محدودة من لوحة معلومات واحدة. مثالي للمحاسبين وأصحاب الأعمال مع كيانات متعددة.'}
                    </p>
                  </div>
                </div>

                <div className="flex gap-4 hover-elevate p-6 rounded-lg">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                      <Database className="w-6 h-6 text-primary" />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-xl font-bold mb-2">
                      {locale === 'en' ? 'Smart Integrations' : 'تكاملات ذكية'}
                    </h3>
                    <p className="text-muted-foreground">
                      {locale === 'en'
                        ? 'Connect with Stripe, PayPal, Excel, and more. Import transactions automatically and stay synced.'
                        : 'اتصل بـ Stripe و PayPal و Excel والمزيد. استيراد المعاملات تلقائيًا والبقاء متزامنًا.'}
                    </p>
                  </div>
                </div>
              </div>

              <Card className="p-8 border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-2xl font-bold">
                      {locale === 'en' ? 'ROI Calculator' : 'حاسبة العائد على الاستثمار'}
                    </h3>
                    <Target className="w-8 h-8 text-primary" />
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium mb-2 block">
                      {locale === 'en' ? 'Monthly Transactions' : 'المعاملات الشهرية'}
                    </label>
                    <input
                      type="range"
                      min="10"
                      max="500"
                      value={monthlyTransactions}
                      onChange={(e) => setMonthlyTransactions(Number(e.target.value))}
                      className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                    <div className="text-3xl font-bold text-primary mt-4">
                      {monthlyTransactions}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                    <div>
                      <div className="text-sm text-muted-foreground mb-1">
                        {locale === 'en' ? 'Hours Saved/Week' : 'ساعات موفرة/أسبوع'}
                      </div>
                      <div className="text-2xl font-bold text-primary">
                        {hoursPerWeek.toFixed(1)}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground mb-1">
                        {locale === 'en' ? 'Money Saved/Month' : 'أموال موفرة/شهر'}
                      </div>
                      <div className="text-2xl font-bold text-primary">
                        AED {moneySaved}
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {locale === 'en'
                      ? 'Based on 2 minutes per transaction @ AED 50/hour'
                      : 'بناءً على دقيقتين لكل معاملة @ 50 درهم/ساعة'}
                  </p>
                </div>
              </Card>
            </div>
          </div>
        </section>

        {/* INTEGRATIONS */}
        <section className="py-12 bg-muted/10">
          <div className="container max-w-5xl mx-auto px-4">
            <p className="text-center text-sm text-muted-foreground mb-8 font-medium uppercase tracking-wide">
              {locale === 'en' ? 'Seamless Integrations' : 'تكاملات سلسة'}
            </p>
            <div className="flex flex-wrap justify-center items-center gap-8 md:gap-12">
              <div className="flex items-center gap-3 opacity-70 hover:opacity-100 transition-opacity hover-elevate p-4 rounded-lg" data-testid="integration-stripe" role="img" aria-label="Stripe payment integration">
                <SiStripe className="w-12 h-12" aria-hidden="true" />
                <span className="font-semibold text-lg">Stripe</span>
              </div>
              <div className="flex items-center gap-3 opacity-70 hover:opacity-100 transition-opacity hover-elevate p-4 rounded-lg" data-testid="integration-paypal" role="img" aria-label="PayPal payment integration">
                <SiPaypal className="w-12 h-12" aria-hidden="true" />
                <span className="font-semibold text-lg">PayPal</span>
              </div>
              <div className="flex items-center gap-3 opacity-70 hover:opacity-100 transition-opacity hover-elevate p-4 rounded-lg" data-testid="integration-excel" role="img" aria-label="Excel spreadsheet integration">
                <Database className="w-12 h-12 text-green-600" aria-hidden="true" />
                <span className="font-semibold text-lg">Excel</span>
              </div>
            </div>
          </div>
        </section>

        {/* PRICING */}
        <section className="py-20 lg:py-32 bg-muted/20" id="pricing">
          <div className="container max-w-7xl mx-auto px-4">
            <div className="text-center mb-4">
              <h2 className="text-4xl lg:text-5xl font-bold mb-4">
                {locale === 'en' ? (
                  <>Simple, <span className="text-primary">Transparent Pricing</span></>
                ) : (
                  <>تسعير <span className="text-primary">بسيط وشفاف</span></>
                )}
              </h2>
              <p className="text-muted-foreground text-sm">
                {locale === 'en' 
                  ? 'All prices in AED · No setup fees · Cancel anytime'
                  : 'جميع الأسعار بالدرهم الإماراتي · بدون رسوم إعداد · إلغاء في أي وقت'}
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8 mt-12">
              {/* Starter */}
              <Card className="p-8 hover-elevate">
                <h3 className="text-2xl font-bold mb-2">
                  {locale === 'en' ? 'Starter' : 'بداية'}
                </h3>
                <div className="text-4xl font-bold mb-4">
                  {locale === 'en' ? 'Free' : 'مجاني'}
                </div>
                <p className="text-muted-foreground mb-6">
                  {locale === 'en' ? 'Perfect for freelancers' : 'مثالي للعاملين الأحرار'}
                </p>
                <ul className="space-y-3 mb-8">
                  {[
                    locale === 'en' ? '1 company' : 'شركة واحدة',
                    locale === 'en' ? '50 transactions/month' : '50 معاملة/شهر',
                    locale === 'en' ? 'Basic reports' : 'تقارير أساسية',
                    locale === 'en' ? 'Email support' : 'دعم البريد الإلكتروني'
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                      <span className="text-sm">{item}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/register">
                  <Button className="w-full" variant="outline">
                    {locale === 'en' ? 'Get Started' : 'ابدأ'}
                  </Button>
                </Link>
              </Card>

              {/* Growth - Most Popular */}
              <Card className="p-8 border-2 border-primary relative hover-elevate">
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
                  {locale === 'en' ? 'Most Popular' : 'الأكثر شعبية'}
                </Badge>
                <h3 className="text-2xl font-bold mb-2">
                  {locale === 'en' ? 'Growth' : 'نمو'}
                </h3>
                <div className="text-4xl font-bold mb-4">
                  AED 299<span className="text-lg text-muted-foreground">/mo</span>
                </div>
                <p className="text-muted-foreground mb-6">
                  {locale === 'en' ? 'For growing businesses' : 'للأعمال المتنامية'}
                </p>
                <ul className="space-y-3 mb-8">
                  {[
                    locale === 'en' ? '3 companies' : '3 شركات',
                    locale === 'en' ? 'Unlimited transactions' : 'معاملات غير محدودة',
                    locale === 'en' ? 'AI categorization' : 'تصنيف AI',
                    locale === 'en' ? 'All reports' : 'جميع التقارير',
                    locale === 'en' ? 'Priority support' : 'دعم الأولوية'
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                      <span className="text-sm">{item}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/register">
                  <Button className="w-full bg-gradient-to-r from-primary to-primary/80">
                    {locale === 'en' ? 'Start Free Trial' : 'ابدأ تجربة مجانية'}
                  </Button>
                </Link>
              </Card>

              {/* Firm */}
              <Card className="p-8 hover-elevate">
                <h3 className="text-2xl font-bold mb-2">
                  {locale === 'en' ? 'Firm' : 'مكتب'}
                </h3>
                <div className="text-4xl font-bold mb-4">
                  AED 799<span className="text-lg text-muted-foreground">/mo</span>
                </div>
                <p className="text-muted-foreground mb-6">
                  {locale === 'en' ? 'For accounting firms' : 'لمكاتب المحاسبة'}
                </p>
                <ul className="space-y-3 mb-8">
                  {[
                    locale === 'en' ? 'Unlimited companies' : 'شركات غير محدودة',
                    locale === 'en' ? 'White-label reports' : 'تقارير بعلامة بيضاء',
                    locale === 'en' ? 'API access' : 'وصول API',
                    locale === 'en' ? 'Custom integrations' : 'تكاملات مخصصة',
                    locale === 'en' ? 'Dedicated support' : 'دعم مخصص'
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                      <span className="text-sm">{item}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/register">
                  <Button className="w-full" variant="outline">
                    {locale === 'en' ? 'Contact Sales' : 'اتصل بالمبيعات'}
                  </Button>
                </Link>
              </Card>
            </div>
          </div>
        </section>

        {/* CTA SECTION */}
        <section className="py-20 lg:py-32">
          <div className="container max-w-5xl mx-auto px-4">
            <Card className="p-12 lg:p-16 text-center border-2 border-primary/20 bg-gradient-to-br from-primary/10 via-background to-accent/10 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-50" />
              <div className="absolute top-10 right-10 w-64 h-64 bg-primary/10 rounded-full blur-3xl" />
              <div className="absolute bottom-10 left-10 w-64 h-64 bg-accent/10 rounded-full blur-3xl" />
              
              <div className="relative z-10">
                <Badge className="mb-6">
                  <Rocket className="w-4 h-4 mr-2" />
                  {locale === 'en' ? 'Start Your Journey' : 'ابدأ رحلتك'}
                </Badge>
                <h2 className="text-4xl lg:text-5xl font-bold mb-6">
                  {locale === 'en' ? (
                    <>Ready to Experience the <span className="text-primary">Future?</span></>
                  ) : (
                    <>جاهز لتجربة <span className="text-primary">المستقبل؟</span></>
                  )}
                </h2>
                <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
                  {locale === 'en'
                    ? 'Join forward-thinking UAE businesses using AI to automate bookkeeping. Start your free trial today—no credit card required.'
                    : 'انضم إلى الشركات الإماراتية ذات التفكير المستقبلي التي تستخدم الذكاء الاصطناعي لأتمتة المحاسبة. ابدأ تجربتك المجانية اليوم - لا حاجة لبطاقة ائتمان.'}
                </p>
                <div className="flex flex-wrap justify-center gap-4">
                  <Link href="/register">
                    <Button size="lg" className="text-lg px-8 bg-gradient-to-r from-primary to-primary/80 hover:shadow-lg hover:shadow-primary/50 transition-shadow">
                      <Rocket className="w-5 h-5 mr-2" />
                      {locale === 'en' ? 'Start Free Trial' : 'ابدأ تجربة مجانية'}
                      <ArrowRight className="w-5 h-5 ml-2" />
                    </Button>
                  </Link>
                  <Button size="lg" variant="outline" className="text-lg px-8 backdrop-blur-sm">
                    {locale === 'en' ? 'Book a Demo' : 'احجز عرضًا توضيحيًا'}
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        </section>

        {/* FOOTER */}
        <footer className="py-12 border-t bg-muted/20">
          <div className="container max-w-7xl mx-auto px-4">
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Building2 className="w-4 h-4" />
                <span>
                  {locale === 'en' ? 'Made with' : 'صنع بـ'}
                </span>
                <Award className="w-4 h-4 text-red-500" />
                <span>
                  {locale === 'en' ? 'in Dubai' : 'في دبي'}
                </span>
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <a href="#" className="hover:text-primary transition-colors">
                  {locale === 'en' ? 'Privacy' : 'الخصوصية'}
                </a>
                <a href="#" className="hover:text-primary transition-colors">
                  {locale === 'en' ? 'Terms' : 'الشروط'}
                </a>
                <a href="#" className="hover:text-primary transition-colors">
                  {locale === 'en' ? 'Contact' : 'اتصل'}
                </a>
              </div>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
