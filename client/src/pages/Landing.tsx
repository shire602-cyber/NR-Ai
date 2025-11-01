import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  Languages,
  TrendingUp,
  Users,
  Clock,
  Star,
  Building2,
  Globe,
  Rocket,
  Gift
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useI18n } from '@/lib/i18n';
import { EmailPopup } from '@/components/EmailPopup';

export default function Landing() {
  const { locale, setLocale } = useI18n();
  const [mounted, setMounted] = useState(false);
  const [showEmailPopup, setShowEmailPopup] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // Show email popup after 15 seconds
  useEffect(() => {
    const popupTimer = setTimeout(() => {
      setShowEmailPopup(true);
    }, 15000);

    return () => clearTimeout(popupTimer);
  }, []);

  const toggleLanguage = () => {
    setLocale(locale === 'en' ? 'ar' : 'en');
  };

  const stats = [
    {
      icon: Users,
      value: locale === 'en' ? '500+' : '٥٠٠+',
      label: locale === 'en' ? 'Active Businesses' : 'شركات نشطة',
      color: 'from-blue-600 to-cyan-600'
    },
    {
      icon: Receipt,
      value: locale === 'en' ? '10K+' : '١٠ ألف+',
      label: locale === 'en' ? 'Invoices Generated' : 'فاتورة تم إنشاؤها',
      color: 'from-green-600 to-emerald-600'
    },
    {
      icon: Clock,
      value: locale === 'en' ? '100+' : '١٠٠+',
      label: locale === 'en' ? 'Hours Saved Daily' : 'ساعة يتم توفيرها يوميًا',
      color: 'from-purple-600 to-pink-600'
    },
    {
      icon: TrendingUp,
      value: locale === 'en' ? '99.9%' : '٩٩.٩٪',
      label: locale === 'en' ? 'Accuracy Rate' : 'معدل الدقة',
      color: 'from-amber-600 to-orange-600'
    },
  ];

  const features = [
    {
      icon: Sparkles,
      title: locale === 'en' ? 'AI-Powered Categorization' : 'تصنيف ذكي بالذكاء الاصطناعي',
      description: locale === 'en' 
        ? 'Automatically categorize expenses using advanced AI. Save hours of manual work every week.'
        : 'تصنيف تلقائي للمصروفات باستخدام الذكاء الاصطناعي المتقدم. وفر ساعات من العمل اليدوي كل أسبوع.',
      gradient: 'from-purple-500 to-pink-500'
    },
    {
      icon: Receipt,
      title: locale === 'en' ? 'OCR Receipt Scanning' : 'مسح الإيصالات بتقنية OCR',
      description: locale === 'en'
        ? 'Scan receipts instantly with our powerful OCR technology. Extract all data in seconds.'
        : 'امسح الإيصالات فورًا بتقنية OCR القوية. استخراج جميع البيانات في ثوانٍ.',
      gradient: 'from-green-500 to-emerald-500'
    },
    {
      icon: FileText,
      title: locale === 'en' ? 'UAE-Compliant Invoices' : 'فواتير متوافقة مع الإمارات',
      description: locale === 'en'
        ? 'Generate professional invoices with QR codes, TRN, and automatic 5% VAT calculation.'
        : 'إنشاء فواتير احترافية مع رموز QR ورقم التسجيل الضريبي وحساب ضريبة القيمة المضافة 5٪ تلقائيًا.',
      gradient: 'from-blue-500 to-cyan-500'
    },
    {
      icon: BarChart3,
      title: locale === 'en' ? 'Real-Time Financial Reports' : 'تقارير مالية فورية',
      description: locale === 'en'
        ? 'Beautiful financial dashboards with interactive charts. Know your numbers instantly, anytime.'
        : 'لوحات مالية جميلة مع رسوم بيانية تفاعلية. اعرف أرقامك على الفور في أي وقت.',
      gradient: 'from-amber-500 to-orange-500'
    },
    {
      icon: Shield,
      title: locale === 'en' ? 'Double-Entry Accounting' : 'محاسبة القيد المزدوج',
      description: locale === 'en'
        ? 'Professional-grade accounting with full audit trails and compliance-ready reports.'
        : 'محاسبة احترافية مع سجلات تدقيق كاملة وتقارير جاهزة للامتثال.',
      gradient: 'from-red-500 to-rose-500'
    },
    {
      icon: Languages,
      title: locale === 'en' ? 'Bilingual Support' : 'دعم ثنائي اللغة',
      description: locale === 'en'
        ? 'Full English and Arabic support with RTL layout for seamless UAE business operations.'
        : 'دعم كامل للإنجليزية والعربية مع تخطيط من اليمين إلى اليسار لعمليات الأعمال السلسة.',
      gradient: 'from-indigo-500 to-violet-500'
    },
  ];

  const testimonials = [
    {
      name: locale === 'en' ? 'Ahmed Al Mansoori' : 'أحمد المنصوري',
      role: locale === 'en' ? 'CEO, Dubai Trading Co.' : 'الرئيس التنفيذي، شركة دبي للتجارة',
      content: locale === 'en' 
        ? "This platform has transformed how we handle our bookkeeping. The AI categorization is incredibly accurate, and we're saving 10+ hours every week!"
        : 'لقد غيرت هذه المنصة طريقة تعاملنا مع الدفاتر المحاسبية. التصنيف بالذكاء الاصطناعي دقيق بشكل لا يصدق، ونوفر أكثر من 10 ساعات كل أسبوع!',
      rating: 5
    },
    {
      name: locale === 'en' ? 'Fatima Hassan' : 'فاطمة حسن',
      role: locale === 'en' ? 'Founder, Abu Dhabi Consulting' : 'المؤسسة، استشارات أبوظبي',
      content: locale === 'en'
        ? 'The bilingual support is perfect for our UAE business. Our team can work in Arabic or English seamlessly. Highly recommended!'
        : 'الدعم ثنائي اللغة مثالي لأعمالنا في الإمارات. يمكن لفريقنا العمل باللغة العربية أو الإنجليزية بسلاسة. أوصي به بشدة!',
      rating: 5
    },
    {
      name: locale === 'en' ? 'Mohammed Al Fahim' : 'محمد الفهيم',
      role: locale === 'en' ? 'CFO, Sharjah Enterprises' : 'المدير المالي، مؤسسات الشارقة',
      content: locale === 'en'
        ? "Finally, a bookkeeping solution that understands UAE tax requirements. The VAT compliance features are exceptional!"
        : 'أخيرًا، حل دفاتر محاسبية يفهم المتطلبات الضريبية في الإمارات. ميزات الامتثال لضريبة القيمة المضافة استثنائية!',
      rating: 5
    },
  ];

  const pricingPlans = [
    {
      name: locale === 'en' ? 'Starter' : 'المبتدئ',
      price: locale === 'en' ? 'AED 99' : '٩٩ درهم',
      period: locale === 'en' ? '/month' : '/شهر',
      description: locale === 'en' ? 'Perfect for freelancers and small businesses' : 'مثالي للعاملين المستقلين والشركات الصغيرة',
      features: [
        locale === 'en' ? 'Single company' : 'شركة واحدة',
        locale === 'en' ? 'Unlimited invoices' : 'فواتير غير محدودة',
        locale === 'en' ? 'OCR receipt scanning' : 'مسح الإيصالات بتقنية OCR',
        locale === 'en' ? 'AI categorization' : 'التصنيف بالذكاء الاصطناعي',
        locale === 'en' ? 'Basic reports' : 'تقارير أساسية',
        locale === 'en' ? 'Email support' : 'دعم عبر البريد الإلكتروني',
      ],
      highlighted: false,
    },
    {
      name: locale === 'en' ? 'Professional' : 'المحترف',
      price: locale === 'en' ? 'AED 299' : '٢٩٩ درهم',
      period: locale === 'en' ? '/month' : '/شهر',
      description: locale === 'en' ? 'For growing businesses that need more' : 'للشركات المتنامية التي تحتاج إلى المزيد',
      features: [
        locale === 'en' ? 'Everything in Starter' : 'كل ميزات المبتدئ',
        locale === 'en' ? 'Priority support' : 'دعم ذو أولوية',
        locale === 'en' ? 'Advanced reports' : 'تقارير متقدمة',
        locale === 'en' ? 'API access' : 'الوصول إلى API',
        locale === 'en' ? 'Custom workflows' : 'سير عمل مخصص',
        locale === 'en' ? 'Multi-user access' : 'وصول متعدد المستخدمين',
      ],
      highlighted: true,
    },
    {
      name: locale === 'en' ? 'Enterprise' : 'المؤسسات',
      price: locale === 'en' ? 'Custom' : 'مخصص',
      period: '',
      description: locale === 'en' ? 'For large organizations with complex needs' : 'للمؤسسات الكبيرة ذات الاحتياجات المعقدة',
      features: [
        locale === 'en' ? 'Everything in Professional' : 'كل ميزات المحترف',
        locale === 'en' ? 'Multiple companies' : 'شركات متعددة',
        locale === 'en' ? 'Dedicated account manager' : 'مدير حساب مخصص',
        locale === 'en' ? 'Custom integrations' : 'تكاملات مخصصة',
        locale === 'en' ? 'SLA guarantee' : 'ضمان اتفاقية مستوى الخدمة',
        locale === 'en' ? 'White-label options' : 'خيارات العلامة البيضاء',
      ],
      highlighted: false,
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/10">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-lg border-b shadow-sm">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg">
              <Sparkles className="w-6 h-6 text-primary-foreground" />
            </div>
            <div className="font-bold text-xl bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
              {locale === 'en' ? 'AI Bookkeeping' : 'الدفاتر الذكية'}
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleLanguage}
              data-testid="button-language-toggle"
              className="hover-elevate"
            >
              <Globe className="w-4 h-4 mr-2" />
              {locale === 'en' ? 'العربية' : 'English'}
            </Button>
            <Link href="/login">
              <Button variant="ghost" size="sm" data-testid="button-login" className="hover-elevate">
                {locale === 'en' ? 'Sign In' : 'تسجيل الدخول'}
              </Button>
            </Link>
            <Link href="/register">
              <Button size="sm" data-testid="button-get-started" className="gap-2 shadow-lg hover-elevate">
                {locale === 'en' ? 'Get Started' : 'ابدأ الآن'}
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-24 lg:py-36">
        <div className={`text-center max-w-5xl mx-auto space-y-8 ${mounted ? 'animate-in fade-in slide-in-from-bottom-8' : ''}`} style={{ animationDuration: '700ms' }}>
          <Badge variant="secondary" className="text-sm px-5 py-2 shadow-lg">
            <Rocket className="w-4 h-4 mr-2" />
            {locale === 'en' ? 'AI-Powered Accounting Platform' : 'منصة محاسبة بالذكاء الاصطناعي'}
          </Badge>
          
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold leading-tight">
            <span className="bg-gradient-to-r from-foreground via-primary to-foreground bg-clip-text text-transparent">
              {locale === 'en' 
                ? 'Bookkeeping Made'
                : 'الدفاتر المحاسبية'}
            </span>
            <br />
            <span className="bg-gradient-to-r from-primary via-primary/80 to-primary bg-clip-text text-transparent">
              {locale === 'en' ? 'Simple for UAE' : 'أصبحت بسيطة'}
            </span>
          </h1>
          
          <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
            {locale === 'en'
              ? 'The most advanced AI-powered accounting platform built specifically for UAE businesses. Automate your bookkeeping with OCR scanning, smart categorization, and UAE-compliant reporting.'
              : 'منصة المحاسبة بالذكاء الاصطناعي الأكثر تقدمًا المصممة خصيصًا لشركات الإمارات. أتمتة الدفاتر المحاسبية مع مسح OCR والتصنيف الذكي والتقارير المتوافقة مع الإمارات.'}
          </p>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-6">
            <Link href="/register">
              <Button size="lg" className="gap-2 text-lg px-8 py-6 shadow-2xl hover-elevate" data-testid="button-start-free">
                <Zap className="w-5 h-5" />
                {locale === 'en' ? 'Start Free Trial' : 'ابدأ تجربة مجانية'}
              </Button>
            </Link>
            <Button 
              size="lg" 
              variant="outline" 
              className="gap-2 text-lg px-8 py-6 hover-elevate shadow-lg" 
              data-testid="button-lifetime-deal"
              onClick={() => setShowEmailPopup(true)}
            >
              <Gift className="w-5 h-5" />
              {locale === 'en' ? 'Lifetime Deal' : 'عرض مدى الحياة'}
            </Button>
          </div>

          <div className="flex items-center justify-center gap-8 pt-8 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              {locale === 'en' ? 'No credit card required' : 'لا حاجة لبطاقة ائتمان'}
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              {locale === 'en' ? '14-day free trial' : 'تجربة مجانية لمدة 14 يومًا'}
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              {locale === 'en' ? 'Cancel anytime' : 'إلغاء في أي وقت'}
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="container mx-auto px-4 py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {stats.map((stat, index) => {
            const Icon = stat.icon;
            return (
              <Card 
                key={index}
                className={`text-center hover-elevate transition-all ${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`}
                style={{ animationDelay: `${index * 100}ms`, animationDuration: '500ms' }}
              >
                <CardContent className="p-6 space-y-3">
                  <div className={`mx-auto w-14 h-14 rounded-full bg-gradient-to-br ${stat.color} flex items-center justify-center shadow-lg`}>
                    <Icon className="w-7 h-7 text-white" />
                  </div>
                  <div className="text-3xl font-bold bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-transparent">
                    {stat.value}
                  </div>
                  <div className="text-sm font-medium text-muted-foreground">
                    {stat.label}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-4 py-24">
        <div className="text-center mb-16 space-y-4">
          <Badge variant="secondary" className="text-sm px-4 py-1">
            {locale === 'en' ? 'Features' : 'الميزات'}
          </Badge>
          <h2 className="text-4xl md:text-5xl font-bold">
            <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
              {locale === 'en' ? 'Everything You Need' : 'كل ما تحتاجه'}
            </span>
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            {locale === 'en' 
              ? 'Powerful features designed specifically for UAE businesses'
              : 'ميزات قوية مصممة خصيصًا لشركات الإمارات'}
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <Card 
                key={index}
                className={`group hover-elevate transition-all border-2 ${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`}
                style={{ animationDelay: `${index * 100}ms`, animationDuration: '500ms' }}
              >
                <CardHeader>
                  <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform`}>
                    <Icon className="w-7 h-7 text-white" />
                  </div>
                  <CardTitle className="text-xl">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground leading-relaxed">{feature.description}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="container mx-auto px-4 py-24 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 rounded-3xl">
        <div className="text-center mb-16 space-y-4">
          <Badge variant="secondary" className="text-sm px-4 py-1">
            {locale === 'en' ? 'Testimonials' : 'آراء العملاء'}
          </Badge>
          <h2 className="text-4xl md:text-5xl font-bold">
            <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
              {locale === 'en' ? 'Loved by UAE Businesses' : 'محبوب من قبل شركات الإمارات'}
            </span>
          </h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {testimonials.map((testimonial, index) => (
            <Card key={index} className="hover-elevate transition-all">
              <CardContent className="p-6 space-y-4">
                <div className="flex gap-1">
                  {Array.from({ length: testimonial.rating }).map((_, i) => (
                    <Star key={i} className="w-5 h-5 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-muted-foreground leading-relaxed italic">
                  "{testimonial.content}"
                </p>
                <div className="flex items-center gap-3 pt-2">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-primary-foreground font-semibold">
                    {testimonial.name.charAt(0)}
                  </div>
                  <div>
                    <div className="font-semibold">{testimonial.name}</div>
                    <div className="text-sm text-muted-foreground">{testimonial.role}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Pricing Section */}
      <section className="container mx-auto px-4 py-24">
        <div className="text-center mb-16 space-y-4">
          <Badge variant="secondary" className="text-sm px-4 py-1">
            {locale === 'en' ? 'Pricing' : 'الأسعار'}
          </Badge>
          <h2 className="text-4xl md:text-5xl font-bold">
            <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
              {locale === 'en' ? 'Simple, Transparent Pricing' : 'أسعار بسيطة وشفافة'}
            </span>
          </h2>
          <p className="text-xl text-muted-foreground">
            {locale === 'en' 
              ? 'Choose the perfect plan for your business'
              : 'اختر الخطة المثالية لعملك'}
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {pricingPlans.map((plan, index) => (
            <Card 
              key={index}
              className={`${plan.highlighted ? 'border-primary border-2 shadow-2xl scale-105 relative overflow-hidden' : 'border-2'} hover-elevate transition-all`}
            >
              {plan.highlighted && (
                <div className="absolute top-0 right-0 bg-gradient-to-r from-primary to-primary/80 text-primary-foreground px-4 py-1 text-sm font-semibold rounded-bl-lg">
                  {locale === 'en' ? 'Most Popular' : 'الأكثر شعبية'}
                </div>
              )}
              <CardHeader className="pb-4">
                <CardTitle className="text-2xl">{plan.name}</CardTitle>
                <CardDescription className="text-base">{plan.description}</CardDescription>
                <div className="mt-6">
                  <span className="text-5xl font-bold bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-transparent">
                    {plan.price}
                  </span>
                  <span className="text-muted-foreground text-lg">{plan.period}</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <ul className="space-y-3">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                      <span className="text-sm leading-relaxed">{feature}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/register">
                  <Button 
                    className="w-full" 
                    variant={plan.highlighted ? 'default' : 'outline'}
                    size="lg"
                    data-testid={`button-pricing-${plan.name.toLowerCase()}`}
                  >
                    {locale === 'en' ? 'Get Started' : 'ابدأ الآن'}
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Trust Badges */}
      <section className="container mx-auto px-4 py-16">
        <div className="text-center space-y-6">
          <p className="text-sm text-muted-foreground uppercase tracking-wide font-semibold">
            {locale === 'en' ? 'Trusted by Leading UAE Businesses' : 'موثوق به من قبل الشركات الرائدة في الإمارات'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-8 opacity-60">
            <Building2 className="w-12 h-12" />
            <Building2 className="w-12 h-12" />
            <Building2 className="w-12 h-12" />
            <Building2 className="w-12 h-12" />
            <Building2 className="w-12 h-12" />
          </div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="container mx-auto px-4 py-20">
        <Card className="bg-gradient-to-br from-primary via-primary/90 to-primary/80 text-primary-foreground border-0 shadow-2xl overflow-hidden relative">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAxMCAwIEwgMCAwIDAgMTAiIGZpbGw9Im5vbmUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS1vcGFjaXR5PSIwLjEiIHN0cm9rZS13aWR0aD0iMSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNncmlkKSIvPjwvc3ZnPg==')] opacity-30"></div>
          <CardContent className="p-12 md:p-16 text-center relative z-10">
            <Sparkles className="w-16 h-16 mx-auto mb-6 opacity-90" />
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              {locale === 'en' 
                ? 'Ready to Transform Your Bookkeeping?'
                : 'هل أنت مستعد لتحويل الدفاتر المحاسبية الخاصة بك؟'}
            </h2>
            <p className="text-xl mb-10 opacity-95 max-w-2xl mx-auto">
              {locale === 'en'
                ? 'Join hundreds of UAE businesses using AI to automate their accounting. Start your 14-day free trial today!'
                : 'انضم إلى مئات شركات الإمارات التي تستخدم الذكاء الاصطناعي لأتمتة محاسبتها. ابدأ تجربتك المجانية لمدة 14 يومًا اليوم!'}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/register">
                <Button size="lg" variant="secondary" className="gap-2 text-lg px-8 py-6 shadow-xl hover-elevate" data-testid="button-cta-signup">
                  <Rocket className="w-5 h-5" />
                  {locale === 'en' ? 'Start Free 14-Day Trial' : 'ابدأ تجربة مجانية لمدة 14 يومًا'}
                </Button>
              </Link>
              <Button 
                size="lg" 
                variant="outline" 
                className="gap-2 text-lg px-8 py-6 bg-white/10 border-white/20 hover:bg-white/20 text-white hover:text-white shadow-xl" 
                onClick={() => setShowEmailPopup(true)}
              >
                {locale === 'en' ? 'Get Lifetime Deal' : 'احصل على عرض مدى الحياة'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Footer */}
      <footer className="border-t mt-20">
        <div className="container mx-auto px-4 py-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-primary-foreground" />
                </div>
                <span className="font-bold text-lg">
                  {locale === 'en' ? 'AI Bookkeeping' : 'الدفاتر الذكية'}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {locale === 'en' 
                  ? 'AI-powered accounting platform built for UAE businesses.'
                  : 'منصة محاسبة بالذكاء الاصطناعي مصممة لشركات الإمارات.'}
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-4">{locale === 'en' ? 'Product' : 'المنتج'}</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>{locale === 'en' ? 'Features' : 'الميزات'}</li>
                <li>{locale === 'en' ? 'Pricing' : 'الأسعار'}</li>
                <li>{locale === 'en' ? 'FAQ' : 'الأسئلة الشائعة'}</li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-4">{locale === 'en' ? 'Company' : 'الشركة'}</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>{locale === 'en' ? 'About' : 'عن'}</li>
                <li>{locale === 'en' ? 'Contact' : 'اتصل'}</li>
                <li>{locale === 'en' ? 'Privacy' : 'الخصوصية'}</li>
              </ul>
            </div>
          </div>
          <div className="border-t pt-8 flex items-center justify-between flex-wrap gap-4">
            <p className="text-sm text-muted-foreground">
              © 2024 {locale === 'en' ? 'All rights reserved' : 'جميع الحقوق محفوظة'}
            </p>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Shield className="w-4 h-4" />
              {locale === 'en' ? 'UAE VAT Compliant' : 'متوافق مع ضريبة القيمة المضافة في الإمارات'}
            </div>
          </div>
        </div>
      </footer>

      {/* Email Popup */}
      <EmailPopup 
        open={showEmailPopup} 
        onClose={() => setShowEmailPopup(false)}
        locale={locale}
      />
    </div>
  );
}
