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
  Smartphone
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useI18n } from '@/lib/i18n';

export default function Landing() {
  const { locale, setLocale } = useI18n();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const toggleLanguage = () => {
    setLocale(locale === 'en' ? 'ar' : 'en');
  };

  const features = [
    {
      icon: Sparkles,
      title: locale === 'en' ? 'AI-Powered Categorization' : 'تصنيف ذكي بالذكاء الاصطناعي',
      description: locale === 'en' 
        ? 'Automatically categorize expenses using advanced AI. Save hours of manual work.'
        : 'تصنيف تلقائي للمصروفات باستخدام الذكاء الاصطناعي المتقدم. وفر ساعات من العمل اليدوي.',
      color: 'bg-purple-600'
    },
    {
      icon: Receipt,
      title: locale === 'en' ? 'OCR Receipt Scanning' : 'مسح الإيصالات بتقنية OCR',
      description: locale === 'en'
        ? 'Scan receipts instantly with our powerful OCR technology. Extract all data automatically.'
        : 'امسح الإيصالات فورًا بتقنية OCR القوية. استخراج جميع البيانات تلقائيًا.',
      color: 'bg-green-600'
    },
    {
      icon: FileText,
      title: locale === 'en' ? 'UAE-Compliant Invoices' : 'فواتير متوافقة مع الإمارات',
      description: locale === 'en'
        ? 'Generate professional invoices with QR codes, TRN, and automatic 5% VAT calculation.'
        : 'إنشاء فواتير احترافية مع رموز QR ورقم التسجيل الضريبي وحساب ضريبة القيمة المضافة 5٪ تلقائيًا.',
      color: 'bg-blue-600'
    },
    {
      icon: BarChart3,
      title: locale === 'en' ? 'Real-Time Reports' : 'تقارير فورية',
      description: locale === 'en'
        ? 'Beautiful financial dashboards with interactive charts and insights. Know your numbers instantly.'
        : 'لوحات مالية جميلة مع رسوم بيانية تفاعلية ورؤى. اعرف أرقامك على الفور.',
      color: 'bg-amber-600'
    },
    {
      icon: Shield,
      title: locale === 'en' ? 'Double-Entry Accounting' : 'محاسبة القيد المزدوج',
      description: locale === 'en'
        ? 'Professional-grade accounting with full audit trails and compliance-ready reports.'
        : 'محاسبة احترافية مع سجلات تدقيق كاملة وتقارير جاهزة للامتثال.',
      color: 'bg-red-600'
    },
    {
      icon: Languages,
      title: locale === 'en' ? 'Bilingual Support' : 'دعم ثنائي اللغة',
      description: locale === 'en'
        ? 'Full English and Arabic support with RTL layout for seamless UAE business operations.'
        : 'دعم كامل للإنجليزية والعربية مع تخطيط من اليمين إلى اليسار لعمليات الأعمال السلسة في الإمارات.',
      color: 'bg-indigo-600'
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
      ],
      highlighted: false,
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="font-bold text-lg">
              {locale === 'en' ? 'AI Bookkeeping' : 'الدفاتر بالذكاء الاصطناعي'}
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleLanguage}
              data-testid="button-language-toggle"
            >
              <Languages className="w-4 h-4 mr-2" />
              {locale === 'en' ? 'العربية' : 'English'}
            </Button>
            <Link href="/login">
              <Button variant="ghost" size="sm" data-testid="button-login">
                {locale === 'en' ? 'Sign In' : 'تسجيل الدخول'}
              </Button>
            </Link>
            <Link href="/register">
              <Button size="sm" data-testid="button-get-started">
                {locale === 'en' ? 'Get Started' : 'ابدأ الآن'}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20 lg:py-32">
        <div className={`text-center max-w-4xl mx-auto space-y-8 ${mounted ? 'animate-in fade-in slide-in-from-bottom-8' : ''}`} style={{ animationDuration: '700ms' }}>
          <Badge variant="secondary" className="text-sm px-4 py-1">
            <Zap className="w-3 h-3 mr-1" />
            {locale === 'en' ? 'Powered by AI' : 'مدعوم بالذكاء الاصطناعي'}
          </Badge>
          
          <h1 className="text-5xl lg:text-7xl font-bold bg-gradient-to-r from-foreground via-foreground to-primary bg-clip-text text-transparent">
            {locale === 'en' 
              ? 'Bookkeeping Made Simple for UAE Businesses'
              : 'الدفاتر المحاسبية أصبحت بسيطة لشركات الإمارات'}
          </h1>
          
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            {locale === 'en'
              ? 'AI-powered accounting platform built specifically for the UAE market. Automate your bookkeeping with OCR scanning, smart categorization, and UAE-compliant reporting.'
              : 'منصة محاسبة بالذكاء الاصطناعي مصممة خصيصًا لسوق الإمارات. أتمتة الدفاتر المحاسبية مع مسح OCR والتصنيف الذكي والتقارير المتوافقة مع الإمارات.'}
          </p>
          
          <div className="flex items-center justify-center gap-4 pt-4">
            <Link href="/register">
              <Button size="lg" className="gap-2" data-testid="button-start-free">
                {locale === 'en' ? 'Start Free Trial' : 'ابدأ تجربة مجانية'}
                <ArrowRight className="w-5 h-5" />
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="outline" data-testid="button-demo">
                {locale === 'en' ? 'View Demo' : 'شاهد العرض التوضيحي'}
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-4 py-20">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">
            {locale === 'en' ? 'Everything You Need' : 'كل ما تحتاجه'}
          </h2>
          <p className="text-xl text-muted-foreground">
            {locale === 'en' 
              ? 'Powerful features designed for UAE businesses'
              : 'ميزات قوية مصممة لشركات الإمارات'}
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <Card 
                key={index}
                className={`hover-elevate transition-all ${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`}
                style={{ animationDelay: `${index * 100}ms`, animationDuration: '500ms' }}
              >
                <CardHeader>
                  <div className={`w-12 h-12 rounded-lg ${feature.color} bg-opacity-10 dark:bg-opacity-20 flex items-center justify-center mb-4`}>
                    <Icon className={`w-6 h-6 ${feature.color.replace('bg-', 'text-')}`} />
                  </div>
                  <CardTitle>{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Pricing Section */}
      <section className="container mx-auto px-4 py-20 bg-gradient-to-br from-primary/5 to-transparent rounded-3xl">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">
            {locale === 'en' ? 'Simple, Transparent Pricing' : 'أسعار بسيطة وشفافة'}
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
              className={`${plan.highlighted ? 'border-primary shadow-lg scale-105' : ''} hover-elevate transition-all`}
            >
              <CardHeader>
                {plan.highlighted && (
                  <Badge className="w-fit mb-2">
                    {locale === 'en' ? 'Most Popular' : 'الأكثر شعبية'}
                  </Badge>
                )}
                <CardTitle className="text-2xl">{plan.name}</CardTitle>
                <CardDescription>{plan.description}</CardDescription>
                <div className="mt-4">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  <span className="text-muted-foreground">{plan.period}</span>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                      <span className="text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/register">
                  <Button 
                    className="w-full mt-6" 
                    variant={plan.highlighted ? 'default' : 'outline'}
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

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-20">
        <Card className="bg-gradient-to-r from-primary to-primary/80 text-primary-foreground border-0">
          <CardContent className="p-12 text-center">
            <h2 className="text-4xl font-bold mb-4">
              {locale === 'en' 
                ? 'Ready to Transform Your Bookkeeping?'
                : 'هل أنت مستعد لتحويل الدفاتر المحاسبية الخاصة بك؟'}
            </h2>
            <p className="text-xl mb-8 opacity-90">
              {locale === 'en'
                ? 'Join hundreds of UAE businesses using AI to automate their accounting'
                : 'انضم إلى مئات شركات الإمارات التي تستخدم الذكاء الاصطناعي لأتمتة محاسبتها'}
            </p>
            <Link href="/register">
              <Button size="lg" variant="secondary" className="gap-2" data-testid="button-cta-signup">
                {locale === 'en' ? 'Start Free 14-Day Trial' : 'ابدأ تجربة مجانية لمدة 14 يومًا'}
                <ArrowRight className="w-5 h-5" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </section>

      {/* Footer */}
      <footer className="border-t mt-20">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="font-semibold">
                {locale === 'en' ? 'AI Bookkeeping' : 'الدفاتر بالذكاء الاصطناعي'}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              © 2024 {locale === 'en' ? 'All rights reserved' : 'جميع الحقوق محفوظة'}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
