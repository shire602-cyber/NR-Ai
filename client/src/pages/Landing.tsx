import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
  Gift,
  Play,
  ChevronRight,
  Check,
  X,
  Award,
  Lock,
  HeadphonesIcon,
  Briefcase,
  Calculator,
  FileCheck,
  Coins,
  ChartNoAxesColumn
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useI18n } from '@/lib/i18n';
import { EmailPopup } from '@/components/EmailPopup';

export default function Landing() {
  const { locale, setLocale } = useI18n();
  const [mounted, setMounted] = useState(false);
  const [showEmailPopup, setShowEmailPopup] = useState(false);
  const [monthlyTransactions, setMonthlyTransactions] = useState(50);
  const [hoursPerWeek, setHoursPerWeek] = useState(0);
  const [moneySaved, setMoneySaved] = useState(0);

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

  // Calculate ROI based on transactions
  useEffect(() => {
    const monthlyHours = (monthlyTransactions * 2) / 60; // 2 minutes per transaction manually
    const weeklyHours = monthlyHours / 4; // Divide by 4 weeks to get weekly hours
    const monthlySavings = monthlyHours * 50; // $50/hour * monthly hours
    setHoursPerWeek(weeklyHours); // Keep as decimal for accurate display
    setMoneySaved(Math.round(monthlySavings));
  }, [monthlyTransactions]);

  const toggleLanguage = () => {
    setLocale(locale === 'en' ? 'ar' : 'en');
  };

  const isRTL = locale === 'ar';

  return (
    <div className={`min-h-screen bg-background ${isRTL ? 'rtl' : 'ltr'}`} dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Sticky Language Toggle & CTA Bar */}
      <div className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="container max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Briefcase className="w-6 h-6 text-primary" />
            <span className="font-bold text-xl">
              {locale === 'en' ? 'BookKeep' : 'بوككيب'}
            </span>
          </div>
          
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="sm"
              onClick={toggleLanguage}
              data-testid="button-toggle-language"
            >
              <Globe className="w-4 h-4 mr-2" />
              {locale === 'en' ? 'العربية' : 'English'}
            </Button>
            <Link href="/login">
              <Button variant="ghost" size="sm" data-testid="link-login">
                {locale === 'en' ? 'Sign In' : 'تسجيل الدخول'}
              </Button>
            </Link>
            <Link href="/register">
              <Button size="sm" data-testid="link-register-header">
                {locale === 'en' ? 'Start Free Trial' : 'ابدأ تجربة مجانية'}
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* HERO SECTION - Cinematic Dual-Panel */}
      <section className="relative overflow-hidden py-20 lg:py-32">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-accent/5" />
        
        <div className="container max-w-7xl mx-auto px-4 relative">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Left: Compelling Narrative */}
            <div className={`space-y-8 ${mounted ? 'animate-in fade-in slide-in-from-bottom-4 duration-1000' : 'opacity-0'}`}>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20">
                <Sparkles className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium text-primary">
                  {locale === 'en' ? '🇦🇪 Built for UAE Businesses' : '🇦🇪 مصمم للأعمال الإماراتية'}
                </span>
              </div>

              <h1 className="text-5xl lg:text-7xl font-bold leading-tight">
                {locale === 'en' ? (
                  <>
                    <span className="bg-gradient-to-r from-primary via-purple-600 to-pink-600 bg-clip-text text-transparent">
                      AI-Powered
                    </span>
                    <br />
                    Bookkeeping That
                    <br />
                    Works in Seconds
                  </>
                ) : (
                  <>
                    <span className="bg-gradient-to-r from-primary via-purple-600 to-pink-600 bg-clip-text text-transparent">
                      محاسبة ذكية
                    </span>
                    <br />
                    تعمل في ثوانٍ
                    <br />
                    بالذكاء الاصطناعي
                  </>
                )}
              </h1>

              <p className="text-xl text-muted-foreground leading-relaxed max-w-xl">
                {locale === 'en' 
                  ? 'Stop wasting hours on manual bookkeeping. Our AI categorizes expenses, scans receipts, and generates UAE-compliant invoices instantly. Join 500+ UAE businesses saving 15+ hours every week.'
                  : 'توقف عن إضاعة ساعات في المحاسبة اليدوية. يقوم الذكاء الاصطناعي لدينا بتصنيف المصروفات ومسح الإيصالات وإنشاء فواتير متوافقة مع الإمارات فورًا. انضم إلى 500+ شركة إماراتية توفر 15+ ساعة كل أسبوع.'}
              </p>

              <div className="flex flex-col sm:flex-row gap-4">
                <Link href="/register">
                  <Button size="lg" className="text-lg px-8 py-6 shadow-lg hover:shadow-xl" data-testid="button-start-trial-hero">
                    <Rocket className="w-5 h-5 mr-2" />
                    {locale === 'en' ? 'Start Free 14-Day Trial' : 'ابدأ تجربة مجانية لمدة 14 يومًا'}
                  </Button>
                </Link>
                <Button 
                  size="lg" 
                  variant="outline" 
                  className="text-lg px-8 py-6"
                  onClick={() => setShowEmailPopup(true)}
                  data-testid="button-lifetime-deal-hero"
                >
                  <Gift className="w-5 h-5 mr-2" />
                  {locale === 'en' ? 'Get Lifetime Deal' : 'احصل على عرض مدى الحياة'}
                </Button>
              </div>

              {/* Trust Indicators */}
              <div className="flex flex-wrap gap-6 items-center pt-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  {locale === 'en' ? 'No credit card required' : 'لا حاجة لبطاقة ائتمان'}
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  {locale === 'en' ? 'Cancel anytime' : 'إلغاء في أي وقت'}
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  {locale === 'en' ? 'Setup in 5 minutes' : 'إعداد في 5 دقائق'}
                </div>
              </div>
            </div>

            {/* Right: Animated Product Preview */}
            <div className={`relative ${mounted ? 'animate-in fade-in slide-in-from-right-4 duration-1000 delay-200' : 'opacity-0'}`}>
              <div className="relative rounded-2xl border-2 border-primary/20 bg-gradient-to-br from-background to-accent/5 p-8 shadow-2xl">
                {/* Simulated Dashboard Preview */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-lg">
                      {locale === 'en' ? 'Dashboard Preview' : 'معاينة لوحة المعلومات'}
                    </div>
                    <div className="flex gap-2">
                      <div className="w-3 h-3 rounded-full bg-red-500" />
                      <div className="w-3 h-3 rounded-full bg-yellow-500" />
                      <div className="w-3 h-3 rounded-full bg-green-500" />
                    </div>
                  </div>

                  {/* Stat Cards */}
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: locale === 'en' ? 'Revenue' : 'الإيرادات', value: 'AED 45,230', color: 'from-green-500 to-emerald-500', testId: 'preview-revenue' },
                      { label: locale === 'en' ? 'Expenses' : 'المصروفات', value: 'AED 23,150', color: 'from-red-500 to-rose-500', testId: 'preview-expenses' },
                      { label: locale === 'en' ? 'Profit' : 'الربح', value: 'AED 22,080', color: 'from-blue-500 to-cyan-500', testId: 'preview-profit' },
                      { label: locale === 'en' ? 'Invoices' : 'الفواتير', value: '156', color: 'from-purple-500 to-pink-500', testId: 'preview-invoices' },
                    ].map((stat, i) => (
                      <div 
                        key={i} 
                        className="bg-card rounded-lg p-4 border hover-elevate"
                        data-testid={stat.testId}
                      >
                        <div className={`text-xs text-muted-foreground mb-1`}>
                          {stat.label}
                        </div>
                        <div className={`text-lg font-bold font-mono bg-gradient-to-r ${stat.color} bg-clip-text text-transparent`}>
                          {stat.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* AI Categorization Demo */}
                  <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 rounded-lg p-4 border border-purple-500/20" data-testid="preview-ai-categorization">
                    <div className="flex items-center gap-2 mb-3">
                      <Sparkles className="w-4 h-4 text-purple-500" />
                      <span className="text-sm font-semibold">
                        {locale === 'en' ? 'AI Categorization' : 'التصنيف الذكي'}
                      </span>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground" data-testid="preview-merchant-name">
                          {locale === 'en' ? 'Starbucks Coffee' : 'ستاربكس كوفي'}
                        </span>
                        <Badge variant="secondary" className="text-xs" data-testid="preview-category">
                          {locale === 'en' ? 'Office Supplies' : 'لوازم مكتبية'}
                        </Badge>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full w-[95%] bg-gradient-to-r from-purple-500 to-pink-500 rounded-full" />
                      </div>
                      <div className="text-xs text-muted-foreground text-right" data-testid="preview-confidence">
                        {locale === 'en' ? '95% confidence' : '٩٥٪ ثقة'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Floating Animation Badge */}
                <div className="absolute -top-4 -right-4 bg-gradient-to-br from-green-500 to-emerald-500 text-white px-4 py-2 rounded-full shadow-lg animate-pulse">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4" />
                    <span className="text-sm font-semibold">
                      {locale === 'en' ? 'Live' : 'مباشر'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TRUST PROOF BAR */}
      <section className="py-12 border-y bg-muted/30">
        <div className="container max-w-7xl mx-auto px-4">
          <div className="text-center mb-8">
            <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              {locale === 'en' ? 'Trusted by UAE Businesses & Certified By' : 'موثوق به من قبل الشركات الإماراتية ومعتمد من'}
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 items-center opacity-60">
            {[
              { icon: Award, text: locale === 'en' ? 'FTA Certified' : 'معتمد من الهيئة الاتحادية للضرائب' },
              { icon: Shield, text: locale === 'en' ? 'ISO 27001 Compliant' : 'متوافق مع ISO 27001' },
              { icon: Lock, text: locale === 'en' ? 'Bank-Grade Security' : 'أمان بدرجة البنوك' },
              { icon: CheckCircle2, text: locale === 'en' ? 'VAT Compliant' : 'متوافق مع ضريبة القيمة المضافة' },
            ].map((item, i) => (
              <div key={i} className="flex flex-col items-center gap-2 text-center">
                <item.icon className="w-8 h-8" />
                <span className="text-sm font-medium">{item.text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* INTERACTIVE AI DEMO SECTION */}
      <section className="py-20 lg:py-32">
        <div className="container max-w-7xl mx-auto px-4">
          <div className="text-center mb-16">
            <Badge className="mb-4">
              {locale === 'en' ? 'See It In Action' : 'شاهده أثناء العمل'}
            </Badge>
            <h2 className="text-4xl lg:text-5xl font-bold mb-4">
              {locale === 'en' ? (
                <>AI That Understands Your <span className="text-primary">Business</span></>
              ) : (
                <>ذكاء اصطناعي <span className="text-primary">يفهم</span> عملك</>
              )}
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              {locale === 'en' 
                ? 'Watch how our AI transforms messy receipts into organized financial records in under 3 seconds'
                : 'شاهد كيف يحول الذكاء الاصطناعي لدينا الإيصالات الفوضوية إلى سجلات مالية منظمة في أقل من 3 ثوانٍ'}
            </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-8">
            {[
              {
                step: '1',
                icon: Receipt,
                title: locale === 'en' ? 'Snap or Upload Receipt' : 'التقط أو ارفع الإيصال',
                description: locale === 'en' 
                  ? 'Take a photo or upload any receipt in any condition. Our OCR handles Arabic, English, and even handwriting.'
                  : 'التقط صورة أو ارفع أي إيصال بأي حالة. يتعامل OCR مع العربية والإنجليزية وحتى الكتابة اليدوية.',
                color: 'from-blue-500 to-cyan-500'
              },
              {
                step: '2',
                icon: Sparkles,
                title: locale === 'en' ? 'AI Analyzes & Categorizes' : 'الذكاء الاصطناعي يحلل ويصنف',
                description: locale === 'en'
                  ? 'Advanced AI extracts merchant, amount, date, VAT, and automatically categorizes into the right account with 99.9% accuracy.'
                  : 'يستخرج الذكاء الاصطناعي المتقدم التاجر والمبلغ والتاريخ وضريبة القيمة المضافة ويصنف تلقائيًا في الحساب الصحيح بدقة 99.9٪.',
                color: 'from-purple-500 to-pink-500'
              },
              {
                step: '3',
                icon: CheckCircle2,
                title: locale === 'en' ? 'Review & Approve' : 'مراجعة والموافقة',
                description: locale === 'en'
                  ? 'One-click approval or quick edit if needed. All entries follow double-entry bookkeeping standards automatically.'
                  : 'موافقة بنقرة واحدة أو تعديل سريع إذا لزم الأمر. جميع الإدخالات تتبع معايير محاسبة القيد المزدوج تلقائيًا.',
                color: 'from-green-500 to-emerald-500'
              },
            ].map((item, i) => (
              <Card key={i} className="p-6 hover-elevate">
                <div className="flex items-center gap-3 mb-4">
                  <div className={`w-10 h-10 rounded-full bg-gradient-to-r ${item.color} flex items-center justify-center text-white font-bold`}>
                    {item.step}
                  </div>
                  <item.icon className={`w-6 h-6 bg-gradient-to-r ${item.color} bg-clip-text text-transparent`} />
                </div>
                <h3 className="text-xl font-semibold mb-2">{item.title}</h3>
                <p className="text-muted-foreground">{item.description}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* UAE COMPLIANCE SECTION */}
      <section className="py-20 lg:py-32 bg-gradient-to-br from-primary/5 to-accent/5">
        <div className="container max-w-7xl mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <Badge className="mb-4">
                {locale === 'en' ? '🇦🇪 Built for UAE' : '🇦🇪 مصمم للإمارات'}
              </Badge>
              <h2 className="text-4xl lg:text-5xl font-bold mb-6">
                {locale === 'en' ? (
                  <>100% UAE <span className="text-primary">VAT Compliant</span></>
                ) : (
                  <>متوافق <span className="text-primary">100%</span> مع ضريبة القيمة المضافة في الإمارات</>
                )}
              </h2>
              <p className="text-xl text-muted-foreground mb-8">
                {locale === 'en'
                  ? 'Built specifically for UAE businesses with automatic 5% VAT calculations, TRN integration, and FTA-compliant reporting.'
                  : 'مصمم خصيصًا للشركات الإماراتية مع حسابات تلقائية لضريبة القيمة المضافة بنسبة 5٪ وتكامل TRN وتقارير متوافقة مع الهيئة الاتحادية للضرائب.'}
              </p>

              <div className="space-y-4">
                {[
                  { icon: FileCheck, text: locale === 'en' ? 'FTA-Approved Invoice Format with QR Codes' : 'تنسيق فاتورة معتمد من الهيئة الاتحادية للضرائب مع رموز QR' },
                  { icon: Calculator, text: locale === 'en' ? 'Automatic 5% VAT Calculation & Tracking' : 'حساب وتتبع تلقائي لضريبة القيمة المضافة 5٪' },
                  { icon: FileText, text: locale === 'en' ? 'Ready-to-Submit Tax Reports (Excel & PDF)' : 'تقارير ضريبية جاهزة للتقديم (Excel و PDF)' },
                  { icon: Languages, text: locale === 'en' ? 'Full Bilingual Support (EN/AR) with RTL' : 'دعم ثنائي اللغة الكامل (EN/AR) مع RTL' },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <item.icon className="w-5 h-5 text-primary" />
                    </div>
                    <p className="text-lg pt-0.5">{item.text}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative">
              <Card className="p-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between pb-4 border-b">
                    <div className="font-semibold">
                      {locale === 'en' ? 'Tax Invoice' : 'فاتورة ضريبية'}
                    </div>
                    <Badge>{locale === 'en' ? 'VAT Compliant' : 'متوافق مع الضريبة'}</Badge>
                  </div>
                  
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{locale === 'en' ? 'Subtotal' : 'المجموع الفرعي'}</span>
                      <span className="font-mono">AED 10,000.00</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{locale === 'en' ? 'VAT (5%)' : 'ضريبة القيمة المضافة (5%)'}</span>
                      <span className="font-mono">AED 500.00</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t font-semibold text-base">
                      <span>{locale === 'en' ? 'Total' : 'المجموع'}</span>
                      <span className="font-mono">AED 10,500.00</span>
                    </div>
                  </div>

                  <div className="pt-4 border-t">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-muted-foreground">
                        TRN: 100000000000003
                      </div>
                      <div className="w-16 h-16 bg-muted rounded flex items-center justify-center">
                        <div className="text-[8px] text-center leading-tight">QR<br/>Code</div>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* ROI CALCULATOR */}
      <section className="py-20 lg:py-32">
        <div className="container max-w-4xl mx-auto px-4">
          <div className="text-center mb-12">
            <Badge className="mb-4">
              {locale === 'en' ? 'Calculate Your Savings' : 'احسب مدخراتك'}
            </Badge>
            <h2 className="text-4xl lg:text-5xl font-bold mb-4">
              {locale === 'en' ? (
                <>See How Much You'll <span className="text-primary">Save</span></>
              ) : (
                <>اعرف كم <span className="text-primary">ستوفر</span></>
              )}
            </h2>
          </div>

          <Card className="p-8">
            <div className="space-y-8">
              <div>
                <label className="text-sm font-medium mb-3 block">
                  {locale === 'en' 
                    ? `How many transactions do you process monthly? (${monthlyTransactions})`
                    : `كم عدد المعاملات التي تقوم بمعالجتها شهريًا؟ (${monthlyTransactions})`}
                </label>
                <Input
                  type="range"
                  min="10"
                  max="500"
                  step="10"
                  value={monthlyTransactions}
                  onChange={(e) => setMonthlyTransactions(parseInt(e.target.value))}
                  className="w-full"
                  data-testid="input-roi-calculator"
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-2">
                  <span>10</span>
                  <span>500</span>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-6 pt-6 border-t">
                <div className="text-center p-6 bg-gradient-to-br from-green-500/10 to-emerald-500/10 rounded-lg border border-green-500/20" data-testid="roi-money-saved">
                  <Coins className="w-8 h-8 text-green-500 mx-auto mb-3" />
                  <div className="text-3xl font-bold font-mono text-green-600 mb-1">
                    AED {moneySaved.toLocaleString()}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {locale === 'en' ? 'Saved per month' : 'توفير شهري'}
                  </div>
                </div>

                <div className="text-center p-6 bg-gradient-to-br from-blue-500/10 to-cyan-500/10 rounded-lg border border-blue-500/20" data-testid="roi-hours-saved">
                  <Clock className="w-8 h-8 text-blue-500 mx-auto mb-3" />
                  <div className="text-3xl font-bold font-mono text-blue-600 mb-1">
                    {hoursPerWeek.toFixed(1)}h
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {locale === 'en' ? 'Saved per week' : 'توفير أسبوعي'}
                  </div>
                </div>
              </div>

              <div className="text-center pt-4">
                <Link href="/register">
                  <Button size="lg" data-testid="button-start-saving">
                    {locale === 'en' ? 'Start Saving Today' : 'ابدأ التوفير اليوم'}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </Link>
              </div>
            </div>
          </Card>
        </div>
      </section>

      {/* COMPETITIVE COMPARISON */}
      <section className="py-20 lg:py-32 bg-muted/30">
        <div className="container max-w-6xl mx-auto px-4">
          <div className="text-center mb-12">
            <Badge className="mb-4">
              {locale === 'en' ? 'Why Choose Us' : 'لماذا تختارنا'}
            </Badge>
            <h2 className="text-4xl lg:text-5xl font-bold mb-4">
              {locale === 'en' ? (
                <>Better Than The <span className="text-primary">Competition</span></>
              ) : (
                <>أفضل من <span className="text-primary">المنافسين</span></>
              )}
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-4 px-4 font-semibold">
                    {locale === 'en' ? 'Features' : 'الميزات'}
                  </th>
                  <th className="py-4 px-4 text-center">
                    <div className="font-bold text-primary">
                      {locale === 'en' ? 'BookKeep' : 'بوككيب'}
                    </div>
                    <Badge variant="secondary" className="mt-1">
                      {locale === 'en' ? 'Us' : 'نحن'}
                    </Badge>
                  </th>
                  <th className="py-4 px-4 text-center text-muted-foreground">QuickBooks</th>
                  <th className="py-4 px-4 text-center text-muted-foreground">Xero</th>
                  <th className="py-4 px-4 text-center text-muted-foreground">FreshBooks</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { feature: locale === 'en' ? 'AI Expense Categorization' : 'تصنيف المصروفات بالذكاء الاصطناعي', us: true, qb: false, xero: false, fb: false },
                  { feature: locale === 'en' ? 'OCR Receipt Scanning (Arabic)' : 'مسح الإيصالات بتقنية OCR (عربي)', us: true, qb: false, xero: false, fb: false },
                  { feature: locale === 'en' ? 'UAE VAT Compliance' : 'التوافق مع ضريبة القيمة المضافة', us: true, qb: true, xero: true, fb: false },
                  { feature: locale === 'en' ? 'Full Bilingual (EN/AR)' : 'دعم ثنائي اللغة (EN/AR)', us: true, qb: false, xero: false, fb: false },
                  { feature: locale === 'en' ? 'Setup Time' : 'وقت الإعداد', us: '5 min', qb: '2+ hrs', xero: '1+ hrs', fb: '1+ hrs' },
                  { feature: locale === 'en' ? 'Monthly Price' : 'السعر الشهري', us: '$49', qb: '$90', xero: '$78', fb: '$60' },
                ].map((row, i) => (
                  <tr key={i} className="border-b">
                    <td className="py-4 px-4">{row.feature}</td>
                    <td className="py-4 px-4 text-center bg-primary/5">
                      {typeof row.us === 'boolean' ? (
                        row.us ? <Check className="w-5 h-5 text-green-500 mx-auto" /> : <X className="w-5 h-5 text-red-500 mx-auto" />
                      ) : (
                        <span className="font-semibold text-primary">{row.us}</span>
                      )}
                    </td>
                    <td className="py-4 px-4 text-center">
                      {typeof row.qb === 'boolean' ? (
                        row.qb ? <Check className="w-5 h-5 text-muted-foreground mx-auto" /> : <X className="w-5 h-5 text-muted-foreground mx-auto opacity-30" />
                      ) : (
                        <span className="text-muted-foreground">{row.qb}</span>
                      )}
                    </td>
                    <td className="py-4 px-4 text-center">
                      {typeof row.xero === 'boolean' ? (
                        row.xero ? <Check className="w-5 h-5 text-muted-foreground mx-auto" /> : <X className="w-5 h-5 text-muted-foreground mx-auto opacity-30" />
                      ) : (
                        <span className="text-muted-foreground">{row.xero}</span>
                      )}
                    </td>
                    <td className="py-4 px-4 text-center">
                      {typeof row.fb === 'boolean' ? (
                        row.fb ? <Check className="w-5 h-5 text-muted-foreground mx-auto" /> : <X className="w-5 h-5 text-muted-foreground mx-auto opacity-30" />
                      ) : (
                        <span className="text-muted-foreground">{row.fb}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className="py-20 lg:py-32">
        <div className="container max-w-7xl mx-auto px-4">
          <div className="text-center mb-12">
            <Badge className="mb-4">
              {locale === 'en' ? 'Customer Stories' : 'قصص العملاء'}
            </Badge>
            <h2 className="text-4xl lg:text-5xl font-bold mb-4">
              {locale === 'en' ? (
                <>Loved by UAE <span className="text-primary">Business Owners</span></>
              ) : (
                <>محبوب من قبل <span className="text-primary">أصحاب الأعمال</span> الإماراتيين</>
              )}
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                name: locale === 'en' ? 'Ahmed Al Mansoori' : 'أحمد المنصوري',
                role: locale === 'en' ? 'CEO, Dubai Trading Co.' : 'الرئيس التنفيذي، شركة دبي للتجارة',
                quote: locale === 'en' 
                  ? 'Reduced our bookkeeping time from 20 hours to 2 hours per week. The AI categorization is incredibly accurate!'
                  : 'قلل وقت المحاسبة من 20 ساعة إلى ساعتين في الأسبوع. التصنيف الذكي دقيق بشكل لا يصدق!',
                avatar: 'AM'
              },
              {
                name: locale === 'en' ? 'Sarah Hassan' : 'سارة حسن',
                role: locale === 'en' ? 'Finance Manager, Emirates Retail' : 'مدير مالي، إمارات للتجزئة',
                quote: locale === 'en'
                  ? 'Finally a bookkeeping solution that understands Arabic receipts perfectly. Worth every dirham!'
                  : 'أخيرًا حل محاسبي يفهم الإيصالات العربية بشكل مثالي. يستحق كل درهم!',
                avatar: 'SH'
              },
              {
                name: locale === 'en' ? 'Mohammed Al Zaabi' : 'محمد الزعابي',
                role: locale === 'en' ? 'Owner, Abu Dhabi Logistics' : 'مالك، أبوظبي للوجستيات',
                quote: locale === 'en'
                  ? 'The VAT compliance features saved us during our last tax audit. Highly recommend for UAE businesses!'
                  : 'ميزات الامتثال لضريبة القيمة المضافة أنقذتنا خلال آخر تدقيق ضريبي. أوصي به بشدة للشركات الإماراتية!',
                avatar: 'MZ'
              },
            ].map((testimonial, i) => (
              <Card key={i} className="p-6 hover-elevate" data-testid={`testimonial-${i + 1}`}>
                <div className="flex gap-1 mb-4">
                  {[...Array(5)].map((_, j) => (
                    <Star key={j} className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                  ))}
                </div>
                <p className="text-muted-foreground mb-6 italic" data-testid={`testimonial-quote-${i + 1}`}>
                  "{testimonial.quote}"
                </p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center text-white font-semibold">
                    {testimonial.avatar}
                  </div>
                  <div>
                    <div className="font-semibold" data-testid={`testimonial-name-${i + 1}`}>{testimonial.name}</div>
                    <div className="text-sm text-muted-foreground" data-testid={`testimonial-role-${i + 1}`}>{testimonial.role}</div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="py-20 lg:py-32 bg-gradient-to-br from-primary/5 to-accent/5">
        <div className="container max-w-7xl mx-auto px-4">
          <div className="text-center mb-12">
            <Badge className="mb-4">
              {locale === 'en' ? 'Simple Pricing' : 'تسعير بسيط'}
            </Badge>
            <h2 className="text-4xl lg:text-5xl font-bold mb-4">
              {locale === 'en' ? (
                <>Choose Your <span className="text-primary">Plan</span></>
              ) : (
                <>اختر <span className="text-primary">خطتك</span></>
              )}
            </h2>
            <p className="text-xl text-muted-foreground">
              {locale === 'en' ? 'All plans include 14-day free trial. No credit card required.' : 'جميع الخطط تشمل تجربة مجانية لمدة 14 يومًا. لا حاجة لبطاقة ائتمان.'}
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {[
              {
                name: locale === 'en' ? 'Starter' : 'المبتدئ',
                price: 49,
                description: locale === 'en' ? 'Perfect for freelancers and small businesses' : 'مثالي للعاملين المستقلين والشركات الصغيرة',
                features: [
                  locale === 'en' ? 'Up to 100 transactions/month' : 'حتى 100 معاملة/شهر',
                  locale === 'en' ? 'AI Expense Categorization' : 'تصنيف المصروفات بالذكاء الاصطناعي',
                  locale === 'en' ? 'OCR Receipt Scanning' : 'مسح الإيصالات بتقنية OCR',
                  locale === 'en' ? 'Basic Reports' : 'تقارير أساسية',
                  locale === 'en' ? 'Email Support' : 'دعم البريد الإلكتروني',
                ],
                popular: false
              },
              {
                name: locale === 'en' ? 'Professional' : 'المحترف',
                price: 99,
                description: locale === 'en' ? 'For growing businesses with complex needs' : 'للشركات المتنامية ذات الاحتياجات المعقدة',
                features: [
                  locale === 'en' ? 'Unlimited transactions' : 'معاملات غير محدودة',
                  locale === 'en' ? 'Everything in Starter' : 'كل شيء في المبتدئ',
                  locale === 'en' ? 'Advanced Reports & Analytics' : 'تقارير وتحليلات متقدمة',
                  locale === 'en' ? 'Multi-user Access' : 'وصول متعدد المستخدمين',
                  locale === 'en' ? 'Priority Support' : 'دعم ذو أولوية',
                  locale === 'en' ? 'API Access' : 'الوصول إلى API',
                ],
                popular: true
              },
              {
                name: locale === 'en' ? 'Enterprise' : 'المؤسسات',
                price: null,
                description: locale === 'en' ? 'Custom solutions for large organizations' : 'حلول مخصصة للمؤسسات الكبيرة',
                features: [
                  locale === 'en' ? 'Everything in Professional' : 'كل شيء في المحترف',
                  locale === 'en' ? 'Dedicated Account Manager' : 'مدير حساب مخصص',
                  locale === 'en' ? 'Custom Integrations' : 'تكاملات مخصصة',
                  locale === 'en' ? 'On-premise Deployment' : 'نشر محلي',
                  locale === 'en' ? 'SLA Guarantee' : 'ضمان SLA',
                  locale === 'en' ? '24/7 Phone Support' : 'دعم هاتفي على مدار الساعة',
                ],
                popular: false
              },
            ].map((plan, i) => (
              <Card 
                key={i} 
                className={`p-8 relative ${plan.popular ? 'border-2 border-primary shadow-xl scale-105' : ''}`}
              >
                {plan.popular && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
                    {locale === 'en' ? 'Most Popular' : 'الأكثر شعبية'}
                  </Badge>
                )}
                
                <div className="text-center mb-6">
                  <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
                  <p className="text-sm text-muted-foreground mb-4">{plan.description}</p>
                  {plan.price ? (
                    <div>
                      <div className="text-4xl font-bold mb-1">
                        ${plan.price}
                        <span className="text-lg text-muted-foreground font-normal">/mo</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-2xl font-bold text-muted-foreground">
                      {locale === 'en' ? 'Custom' : 'مخصص'}
                    </div>
                  )}
                </div>

                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature, j) => (
                    <li key={j} className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                      <span className="text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>

                <Link href="/register">
                  <Button 
                    className="w-full" 
                    variant={plan.popular ? 'default' : 'outline'}
                    size="lg"
                    data-testid={`button-plan-${plan.name.toLowerCase()}`}
                  >
                    {plan.price 
                      ? (locale === 'en' ? 'Start Free Trial' : 'ابدأ تجربة مجانية')
                      : (locale === 'en' ? 'Contact Sales' : 'اتصل بالمبيعات')}
                  </Button>
                </Link>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 lg:py-32">
        <div className="container max-w-4xl mx-auto px-4">
          <div className="text-center mb-12">
            <Badge className="mb-4">
              {locale === 'en' ? 'FAQ' : 'الأسئلة الشائعة'}
            </Badge>
            <h2 className="text-4xl lg:text-5xl font-bold mb-4">
              {locale === 'en' ? (
                <>Got <span className="text-primary">Questions?</span></>
              ) : (
                <>لديك <span className="text-primary">أسئلة؟</span></>
              )}
            </h2>
          </div>

          <div className="space-y-4">
            {[
              {
                q: locale === 'en' ? 'Is my financial data secure?' : 'هل بياناتي المالية آمنة؟',
                a: locale === 'en' 
                  ? 'Yes. We use bank-grade 256-bit encryption and are ISO 27001 compliant. Your data is stored on secure UAE-based servers and is never shared with third parties.'
                  : 'نعم. نستخدم تشفير بدرجة البنوك 256 بت ونحن متوافقون مع ISO 27001. يتم تخزين بياناتك على خوادم آمنة مقرها الإمارات ولا يتم مشاركتها مع أطراف ثالثة.'
              },
              {
                q: locale === 'en' ? 'Do I need accounting knowledge to use this?' : 'هل أحتاج إلى معرفة محاسبية لاستخدام هذا؟',
                a: locale === 'en'
                  ? 'Not at all! Our AI handles the complex accounting automatically. You just upload receipts and review categorizations. We provide helpful guides for beginners.'
                  : 'ليس على الإطلاق! يتعامل الذكاء الاصطناعي لدينا مع المحاسبة المعقدة تلقائيًا. أنت فقط ارفع الإيصالات وراجع التصنيفات. نقدم أدلة مفيدة للمبتدئين.'
              },
              {
                q: locale === 'en' ? 'Can I cancel anytime?' : 'هل يمكنني الإلغاء في أي وقت؟',
                a: locale === 'en'
                  ? 'Yes. No long-term contracts. Cancel anytime from your dashboard with one click. You can export all your data before canceling.'
                  : 'نعم. لا عقود طويلة الأجل. الإلغاء في أي وقت من لوحة التحكم بنقرة واحدة. يمكنك تصدير جميع بياناتك قبل الإلغاء.'
              },
              {
                q: locale === 'en' ? 'How accurate is the AI categorization?' : 'ما مدى دقة التصنيف بالذكاء الاصطناعي؟',
                a: locale === 'en'
                  ? 'Our AI achieves 99.9% accuracy and learns from your corrections. It handles both English and Arabic receipts, including handwritten ones.'
                  : 'يحقق الذكاء الاصطناعي لدينا دقة 99.9٪ ويتعلم من تصحيحاتك. يتعامل مع الإيصالات الإنجليزية والعربية ، بما في ذلك المكتوبة بخط اليد.'
              },
              {
                q: locale === 'en' ? 'Is this FTA compliant for UAE tax reporting?' : 'هل هذا متوافق مع الهيئة الاتحادية للضرائب للإبلاغ الضريبي في الإمارات؟',
                a: locale === 'en'
                  ? 'Absolutely. All invoices include QR codes, TRN numbers, and proper VAT calculations as required by UAE Federal Tax Authority. Our reports are ready to submit.'
                  : 'بالتأكيد. جميع الفواتير تتضمن رموز QR وأرقام TRN وحسابات ضريبة القيمة المضافة المناسبة كما هو مطلوب من قبل الهيئة الاتحادية للضرائب الإماراتية. تقاريرنا جاهزة للتقديم.'
              },
            ].map((faq, i) => (
              <Card key={i} className="p-6 hover-elevate" data-testid={`faq-${i + 1}`}>
                <h3 className="font-semibold text-lg mb-2" data-testid={`faq-question-${i + 1}`}>{faq.q}</h3>
                <p className="text-muted-foreground" data-testid={`faq-answer-${i + 1}`}>{faq.a}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="py-20 lg:py-32 bg-gradient-to-br from-primary to-purple-600 text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-grid-white/10" />
        
        <div className="container max-w-4xl mx-auto px-4 text-center relative">
          <h2 className="text-4xl lg:text-6xl font-bold mb-6">
            {locale === 'en' ? (
              <>Ready to Transform Your Bookkeeping?</>
            ) : (
              <>هل أنت مستعد لتحويل محاسبتك؟</>
            )}
          </h2>
          <p className="text-xl mb-8 text-white/90">
            {locale === 'en'
              ? 'Join 500+ UAE businesses saving 15+ hours every week with AI-powered bookkeeping.'
              : 'انضم إلى 500+ شركة إماراتية توفر 15+ ساعة كل أسبوع مع المحاسبة المدعومة بالذكاء الاصطناعي.'}
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/register">
              <Button 
                size="lg" 
                variant="secondary" 
                className="text-lg px-8 py-6 shadow-xl"
                data-testid="button-start-trial-footer"
              >
                <Rocket className="w-5 h-5 mr-2" />
                {locale === 'en' ? 'Start Free Trial' : 'ابدأ تجربة مجانية'}
              </Button>
            </Link>
            <Button 
              size="lg" 
              variant="outline" 
              className="text-lg px-8 py-6 border-white text-white hover:bg-white hover:text-primary"
              onClick={() => setShowEmailPopup(true)}
              data-testid="button-lifetime-deal-footer"
            >
              <Gift className="w-5 h-5 mr-2" />
              {locale === 'en' ? 'Get Lifetime Deal' : 'احصل على عرض مدى الحياة'}
            </Button>
          </div>

          <div className="flex flex-wrap justify-center gap-6 mt-8 text-sm text-white/80">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              {locale === 'en' ? '14-day free trial' : 'تجربة مجانية 14 يوم'}
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              {locale === 'en' ? 'No credit card' : 'لا حاجة لبطاقة'}
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              {locale === 'en' ? 'Setup in 5 min' : 'إعداد في 5 دقائق'}
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t bg-muted/30">
        <div className="container max-w-7xl mx-auto px-4">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Briefcase className="w-5 h-5 text-primary" />
                <span className="font-bold text-lg">
                  {locale === 'en' ? 'BookKeep' : 'بوككيب'}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {locale === 'en' 
                  ? 'AI-powered bookkeeping built for UAE businesses.'
                  : 'محاسبة مدعومة بالذكاء الاصطناعي مصممة للشركات الإماراتية.'}
              </p>
            </div>

            <div>
              <h4 className="font-semibold mb-3">
                {locale === 'en' ? 'Product' : 'المنتج'}
              </h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#features" className="hover:text-foreground">{locale === 'en' ? 'Features' : 'الميزات'}</a></li>
                <li><a href="#pricing" className="hover:text-foreground">{locale === 'en' ? 'Pricing' : 'التسعير'}</a></li>
                <li><a href="#faq" className="hover:text-foreground">{locale === 'en' ? 'FAQ' : 'الأسئلة'}</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-3">
                {locale === 'en' ? 'Company' : 'الشركة'}
              </h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#about" className="hover:text-foreground">{locale === 'en' ? 'About Us' : 'من نحن'}</a></li>
                <li><a href="#contact" className="hover:text-foreground">{locale === 'en' ? 'Contact' : 'اتصل بنا'}</a></li>
                <li><a href="#privacy" className="hover:text-foreground">{locale === 'en' ? 'Privacy' : 'الخصوصية'}</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-3">
                {locale === 'en' ? 'Support' : 'الدعم'}
              </h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#help" className="hover:text-foreground">{locale === 'en' ? 'Help Center' : 'مركز المساعدة'}</a></li>
                <li><a href="#docs" className="hover:text-foreground">{locale === 'en' ? 'Documentation' : 'التوثيق'}</a></li>
                <li><a href="#status" className="hover:text-foreground">{locale === 'en' ? 'Status' : 'الحالة'}</a></li>
              </ul>
            </div>
          </div>

          <div className="pt-8 border-t text-center text-sm text-muted-foreground">
            <p>
              © 2024 BookKeep. {locale === 'en' ? 'All rights reserved.' : 'كل الحقوق محفوظة.'}
            </p>
          </div>
        </div>
      </footer>

      {/* Email Popup */}
      <EmailPopup 
        open={showEmailPopup} 
        onClose={() => setShowEmailPopup(false)} 
      />
    </div>
  );
}
