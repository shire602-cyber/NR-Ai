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
  Users,
  Clock,
  Star,
  Building2,
  Check,
  Briefcase,
  Calculator,
  Coins,
  Play,
  TrendingUp,
  UserPlus,
  Database,
  Download,
  ChevronRight
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
      {/* Email Popup */}
      <EmailPopup open={showEmailPopup} onClose={() => setShowEmailPopup(false)} locale={locale} />

      {/* NAVBAR */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="container max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/">
            <a className="flex items-center gap-3 hover-elevate active-elevate-2 rounded-lg px-2 py-1 -ml-2">
              <Briefcase className="w-6 h-6 text-primary" />
              <div className="flex flex-col">
                <span className="font-bold text-lg leading-none">
                  {locale === 'en' ? 'BookKeep' : 'بوككيب'}
                </span>
                <span className="text-xs text-muted-foreground">
                  {locale === 'en' ? 'AI Bookkeeping' : 'محاسبة ذكية'}
                </span>
              </div>
            </a>
          </Link>
          
          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-6">
            <a href="#features" className="text-sm hover:text-primary transition-colors">
              {locale === 'en' ? 'Features' : 'الميزات'}
            </a>
            <a href="#how-it-works" className="text-sm hover:text-primary transition-colors">
              {locale === 'en' ? 'How it works' : 'كيف تعمل'}
            </a>
            <a href="#pricing" className="text-sm hover:text-primary transition-colors">
              {locale === 'en' ? 'Pricing' : 'الأسعار'}
            </a>
            <a href="#faq" className="text-sm hover:text-primary transition-colors">
              {locale === 'en' ? 'FAQ' : 'الأسئلة'}
            </a>
          </nav>

          <div className="flex items-center gap-3">
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
                {locale === 'en' ? 'Login' : 'دخول'}
              </Button>
            </Link>
            <Link href="/register">
              <Button size="sm" data-testid="link-register-header">
                {locale === 'en' ? 'Start free' : 'ابدأ مجانًا'}
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* HERO SECTION */}
        <section className="relative py-20 lg:py-32 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-accent/5" />
          
          <div className="container max-w-7xl mx-auto px-4 relative">
            <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
              {/* Left: Copy */}
              <div className={`space-y-8 ${mounted ? 'animate-in fade-in slide-in-from-bottom-4 duration-1000' : 'opacity-0'}`}>
                <Badge className="w-fit">
                  🇦🇪 {locale === 'en' ? 'Built for UAE SMEs' : 'مصمم للمؤسسات الإماراتية'}
                </Badge>
                
                <h1 className="text-4xl lg:text-6xl font-bold leading-tight">
                  {locale === 'en' ? (
                    <>AI bookkeeping that actually <span className="text-primary">understands UAE VAT</span>.</>
                  ) : (
                    <>محاسبة ذكية <span className="text-primary">تفهم ضريبة القيمة المضافة الإماراتية</span> فعلاً.</>
                  )}
                </h1>

                <p className="text-xl text-muted-foreground">
                  {locale === 'en' 
                    ? 'Automate invoices, VAT, P&L, and trial balance while staying FTA-compliant. One system for founders, CFOs, and accountants in Dubai and beyond.'
                    : 'أتمتة الفواتير وضريبة القيمة المضافة والأرباح والخسائر والميزان التجريبي مع الامتثال للهيئة الاتحادية للضرائب. نظام واحد للمؤسسين والمديرين الماليين والمحاسبين في دبي وخارجها.'}
                </p>

                {/* CTAs */}
                <div className="flex flex-wrap gap-4">
                  <Link href="/register">
                    <Button size="lg" data-testid="button-start-trial-hero">
                      {locale === 'en' ? 'Start free trial' : 'ابدأ تجربة مجانية'}
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </Link>
                  <Button size="lg" variant="outline" data-testid="button-watch-demo">
                    <Play className="w-4 h-4 mr-2" />
                    {locale === 'en' ? 'Watch how it works' : 'شاهد كيف تعمل'}
                  </Button>
                </div>

                {/* Benefit Pills */}
                <div className="flex flex-wrap gap-4 pt-4">
                  <Badge variant="secondary" className="gap-2">
                    🇦🇪 {locale === 'en' ? 'FTA-aligned VAT logic' : 'منطق ضريبة القيمة المضافة متوافق مع الهيئة الاتحادية'}
                  </Badge>
                  <Badge variant="secondary" className="gap-2">
                    🔐 {locale === 'en' ? 'Bank-grade security' : 'أمان على مستوى البنوك'}
                  </Badge>
                  <Badge variant="secondary" className="gap-2">
                    🤖 {locale === 'en' ? 'Powered by AI' : 'مدعوم بالذكاء الاصطناعي'}
                  </Badge>
                </div>
              </div>

              {/* Right: Animated Dashboard Preview Card */}
              <div className={`${mounted ? 'animate-in fade-in slide-in-from-right-4 duration-1000 delay-200' : 'opacity-0'}`}>
                <Card className="p-8 hover-elevate">
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-2xl font-bold mb-2">
                        {locale === 'en' ? 'Month-end in minutes, not days.' : 'إغلاق الشهر في دقائق، ليس أيامًا.'}
                      </h2>
                      <p className="text-muted-foreground">
                        {locale === 'en' 
                          ? "Here's what your AI assistant is doing behind the scenes:"
                          : 'إليك ما يفعله مساعدك الذكي خلف الكواليس:'}
                      </p>
                    </div>

                    <ul className="space-y-3">
                      {[
                        locale === 'en' ? 'Auto-categorising bank transactions by vendor & narrative' : 'تصنيف المعاملات المصرفية تلقائيًا حسب البائع والوصف',
                        locale === 'en' ? 'Generating bilingual Tax Invoices (English / Arabic)' : 'إنشاء فواتير ضريبية ثنائية اللغة (إنجليزي / عربي)',
                        locale === 'en' ? 'Posting double-entry journals into UAE-ready COA' : 'ترحيل قيود مزدوجة في دليل حسابات جاهز للإمارات',
                        locale === 'en' ? 'Summarising VAT payable & receivable for the period' : 'تلخيص ضريبة القيمة المضافة المستحقة والمستحقة القبض للفترة',
                        locale === 'en' ? 'Preparing P&L and Trial Balance on-click' : 'إعداد قائمة الأرباح والخسائر والميزان التجريبي بنقرة واحدة'
                      ].map((item, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                          <span className="text-sm">{item}</span>
                        </li>
                      ))}
                    </ul>

                    <div className="flex gap-2 pt-4 border-t">
                      <Badge variant="secondary" className="gap-1">
                        <Zap className="w-3 h-3" />
                        {locale === 'en' ? 'Live demo ready' : 'العرض التجريبي جاهز'}
                      </Badge>
                      <Badge variant="outline" className="gap-1">
                        <CheckCircle2 className="w-3 h-3 text-green-500" />
                        {locale === 'en' ? 'API: Connected' : 'API: متصل'}
                      </Badge>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          </div>
        </section>

        {/* TRUST STRIP */}
        <section className="py-12 border-y bg-muted/30">
          <div className="container max-w-7xl mx-auto px-4">
            <p className="text-center text-sm text-muted-foreground mb-6 font-medium uppercase tracking-wide">
              {locale === 'en' ? 'Built for modern UAE businesses' : 'مصمم للشركات الإماراتية الحديثة'}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-8">
              {[
                { icon: '📍', text: locale === 'en' ? 'Dubai SMEs' : 'المؤسسات الصغيرة في دبي' },
                { icon: '🏢', text: locale === 'en' ? 'Co-working hubs' : 'مراكز العمل المشترك' },
                { icon: '🧾', text: locale === 'en' ? 'Tax consultants' : 'مستشارو الضرائب' },
                { icon: '👨‍⚕️', text: locale === 'en' ? 'Clinics & practices' : 'العيادات والممارسات' }
              ].map((item, i) => (
                <div key={i} className="text-center p-4 rounded-lg bg-card border hover-elevate">
                  <div className="text-3xl mb-2">{item.icon}</div>
                  <div className="text-sm font-medium">{item.text}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FEATURES */}
        <section className="py-20 lg:py-32" id="features">
          <div className="container max-w-7xl mx-auto px-4">
            <div className="text-center mb-16">
              <h2 className="text-4xl lg:text-5xl font-bold mb-4">
                {locale === 'en' ? (
                  <>Everything you need to stay <span className="text-primary">on top of your books</span>.</>
                ) : (
                  <>كل ما تحتاجه للبقاء <span className="text-primary">على اطلاع بحساباتك</span>.</>
                )}
              </h2>
              <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
                {locale === 'en'
                  ? 'From AI-driven categorisation to FTA-aligned reports, BookKeep replaces messy spreadsheets and manual bookkeeping with a clean, automated workflow.'
                  : 'من التصنيف المدعوم بالذكاء الاصطناعي إلى التقارير المتوافقة مع الهيئة الاتحادية للضرائب، يستبدل BookKeep جداول البيانات الفوضوية والمحاسبة اليدوية بسير عمل نظيف وتلقائي.'}
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
              {/* Feature 1: AI Categorisation */}
              <Card className="p-8 hover-elevate" data-testid="feature-ai-categorisation">
                <Sparkles className="w-12 h-12 text-primary mb-4" />
                <h3 className="text-2xl font-bold mb-3">
                  {locale === 'en' ? 'AI-first transaction categorisation' : 'تصنيف المعاملات بالذكاء الاصطناعي'}
                </h3>
                <p className="text-muted-foreground mb-4">
                  {locale === 'en'
                    ? 'Feed bank statements or card transactions. Our AI suggests the correct account code, learns your patterns, and keeps your chart of accounts clean.'
                    : 'أدخل كشوف الحسابات المصرفية أو معاملات البطاقات. يقترح الذكاء الاصطناعي رمز الحساب الصحيح، ويتعلم أنماطك، ويحافظ على دليل حساباتك نظيفًا.'}
                </p>
                <ul className="space-y-2">
                  {[
                    locale === 'en' ? 'Smart mapping by vendor & description' : 'ربط ذكي حسب البائع والوصف',
                    locale === 'en' ? 'Override & train rules per company' : 'تجاوز وتدريب القواعد لكل شركة',
                    locale === 'en' ? 'Perfect for high-volume SMEs' : 'مثالي للمؤسسات الصغيرة ذات الحجم الكبير'
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-green-500 mt-1 flex-shrink-0" />
                      <span className="text-sm">{item}</span>
                    </li>
                  ))}
                </ul>
              </Card>

              {/* Feature 2: UAE VAT */}
              <Card className="p-8 hover-elevate" data-testid="feature-uae-vat">
                <FileText className="w-12 h-12 text-primary mb-4" />
                <h3 className="text-2xl font-bold mb-3">
                  {locale === 'en' ? 'UAE VAT & corporate tax ready' : 'جاهز لضريبة القيمة المضافة والضريبة على الشركات'}
                </h3>
                <p className="text-muted-foreground mb-4">
                  {locale === 'en'
                    ? 'Out-of-the-box 5% VAT handling with dedicated VAT Payable/Receivable accounts, bilingual tax invoices, and VAT summaries ready for FTA forms.'
                    : 'معالجة ضريبة القيمة المضافة 5٪ مباشرة مع حسابات ضريبة القيمة المضافة المستحقة/المستحقة القبض، فواتير ضريبية ثنائية اللغة، وملخصات ضريبة القيمة المضافة جاهزة لنماذج الهيئة الاتحادية.'}
                </p>
                <ul className="space-y-2">
                  {[
                    locale === 'en' ? 'TRN stored for company & customers' : 'رقم التسجيل الضريبي مخزن للشركة والعملاء',
                    locale === 'en' ? 'Tax invoice PDFs in English + Arabic' : 'فواتير ضريبية PDF بالإنجليزية والعربية',
                    locale === 'en' ? 'VAT summary report by period' : 'تقرير ملخص ضريبة القيمة المضافة حسب الفترة'
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-green-500 mt-1 flex-shrink-0" />
                      <span className="text-sm">{item}</span>
                    </li>
                  ))}
                </ul>
              </Card>

              {/* Feature 3: Reports */}
              <Card className="p-8 hover-elevate" data-testid="feature-reports">
                <BarChart3 className="w-12 h-12 text-primary mb-4" />
                <h3 className="text-2xl font-bold mb-3">
                  {locale === 'en' ? 'P&L, Trial Balance & more' : 'قائمة الأرباح والخسائر والميزان التجريبي والمزيد'}
                </h3>
                <p className="text-muted-foreground mb-4">
                  {locale === 'en'
                    ? 'Financial statements generated directly from your double-entry journals. No spreadsheet gymnastics, no manual exporting.'
                    : 'بيانات مالية مُنشأة مباشرة من قيودك المزدوجة. لا توجد جداول بيانات معقدة، ولا تصدير يدوي.'}
                </p>
                <ul className="space-y-2">
                  {[
                    locale === 'en' ? 'Profit & Loss by custom date range' : 'الأرباح والخسائر حسب نطاق تاريخ مخصص',
                    locale === 'en' ? 'Trial balance as of any date' : 'الميزان التجريبي اعتبارًا من أي تاريخ',
                    locale === 'en' ? 'JSON APIs ready for your own dashboards' : 'واجهات برمجة التطبيقات JSON جاهزة للوحات المعلومات الخاصة بك'
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-green-500 mt-1 flex-shrink-0" />
                      <span className="text-sm">{item}</span>
                    </li>
                  ))}
                </ul>
              </Card>

              {/* Feature 4: Collaboration */}
              <Card className="p-8 hover-elevate" data-testid="feature-collaboration">
                <Users className="w-12 h-12 text-primary mb-4" />
                <h3 className="text-2xl font-bold mb-3">
                  {locale === 'en' ? 'Collaborate with your accountant' : 'تعاون مع محاسبك'}
                </h3>
                <p className="text-muted-foreground mb-4">
                  {locale === 'en'
                    ? 'Invite your external accountant, give them their own workspace, and let them manage journals, filings, and adjustments without chasing you on WhatsApp.'
                    : 'ادعُ محاسبك الخارجي، امنحه مساحة عمل خاصة به، ودعه يدير القيود والإيداعات والتعديلات دون مطاردتك على واتساب.'}
                </p>
                <ul className="space-y-2">
                  {[
                    locale === 'en' ? 'Multi-company, multi-user structure' : 'هيكل متعدد الشركات والمستخدمين',
                    locale === 'en' ? 'Roles for Owner, Accountant, CFO' : 'أدوار للمالك والمحاسب والمدير المالي',
                    locale === 'en' ? 'Audit-ready history of changes' : 'سجل جاهز للتدقيق للتغييرات'
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

        {/* HOW IT WORKS with ROI Calculator */}
        <section className="py-20 lg:py-32 bg-muted/30" id="how-it-works">
          <div className="container max-w-7xl mx-auto px-4">
            <div className="text-center mb-16">
              <h2 className="text-4xl lg:text-5xl font-bold mb-4">
                {locale === 'en' ? (
                  <>From messy statements to <span className="text-primary">clean books</span> in 4 steps.</>
                ) : (
                  <>من البيانات الفوضوية إلى <span className="text-primary">دفاتر نظيفة</span> في 4 خطوات.</>
                )}
              </h2>
              <p className="text-xl text-muted-foreground">
                {locale === 'en' 
                  ? 'Onboard in under an hour, close your month in under a day.'
                  : 'انضم في أقل من ساعة، أغلق شهرك في أقل من يوم.'}
              </p>
            </div>

            {/* Steps */}
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8 mb-16">
              {[
                {
                  step: '1',
                  icon: <Building2 className="w-8 h-8" />,
                  title: locale === 'en' ? 'Create your company' : 'أنشئ شركتك',
                  desc: locale === 'en' 
                    ? 'Add your company details, TRN, and base currency. We auto-seed a UAE-friendly chart of accounts.'
                    : 'أضف تفاصيل شركتك ورقم التسجيل الضريبي والعملة الأساسية. نقوم بإنشاء دليل حسابات صديق للإمارات تلقائيًا.'
                },
                {
                  step: '2',
                  icon: <Database className="w-8 h-8" />,
                  title: locale === 'en' ? 'Import bank & card data' : 'استورد بيانات البنك والبطاقة',
                  desc: locale === 'en'
                    ? 'Upload CSVs from your bank or card provider. Our AI starts suggesting categories immediately.'
                    : 'قم بتحميل ملفات CSV من البنك أو مزود البطاقة. يبدأ الذكاء الاصطناعي في اقتراح الفئات على الفور.'
                },
                {
                  step: '3',
                  icon: <Sparkles className="w-8 h-8" />,
                  title: locale === 'en' ? 'Let AI do the heavy lifting' : 'دع الذكاء الاصطناعي يقوم بالعمل الثقيل',
                  desc: locale === 'en'
                    ? 'Invoices, VAT, and double-entry postings are generated in the background. You only approve edge cases.'
                    : 'يتم إنشاء الفواتير وضريبة القيمة المضافة والقيود المزدوجة في الخلفية. أنت توافق فقط على الحالات الحدية.'
                },
                {
                  step: '4',
                  icon: <Download className="w-8 h-8" />,
                  title: locale === 'en' ? 'Download VAT & reports' : 'تنزيل ضريبة القيمة المضافة والتقارير',
                  desc: locale === 'en'
                    ? 'Export VAT summaries, P&L, and trial balance for your period. Share them with your auditors, or just sleep better.'
                    : 'صدّر ملخصات ضريبة القيمة المضافة وقائمة الأرباح والخسائر والميزان التجريبي لفترتك. شاركها مع المدققين، أو فقط نم بشكل أفضل.'
                }
              ].map((item, i) => (
                <div key={i} className="text-center" data-testid={`step-${i + 1}`}>
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
                    {item.icon}
                  </div>
                  <h3 className="text-xl font-bold mb-2">
                    {item.step}. {item.title}
                  </h3>
                  <p className="text-muted-foreground">{item.desc}</p>
                </div>
              ))}
            </div>

            {/* ROI Calculator Highlight */}
            <Card className="p-8 max-w-4xl mx-auto">
              <div className="text-center mb-8">
                <Calculator className="w-12 h-12 text-primary mx-auto mb-4" />
                <h3 className="text-2xl font-bold mb-2">
                  {locale === 'en' ? 'Calculate your savings' : 'احسب توفيرك'}
                </h3>
                <p className="text-muted-foreground">
                  {locale === 'en'
                    ? 'See how much time and money you could save each month'
                    : 'اطلع على الوقت والمال الذي يمكنك توفيره كل شهر'}
                </p>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium mb-4">
                    {locale === 'en' 
                      ? `Monthly transactions: ${monthlyTransactions}`
                      : `المعاملات الشهرية: ${monthlyTransactions}`}
                  </label>
                  <input
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

        {/* PRICING */}
        <section className="py-20 lg:py-32" id="pricing">
          <div className="container max-w-7xl mx-auto px-4">
            <div className="text-center mb-16">
              <h2 className="text-4xl lg:text-5xl font-bold mb-4">
                {locale === 'en' ? (
                  <>Simple pricing that <span className="text-primary">grows with you</span>.</>
                ) : (
                  <>تسعير بسيط <span className="text-primary">ينمو معك</span>.</>
                )}
              </h2>
              <p className="text-xl text-muted-foreground">
                {locale === 'en'
                  ? 'All plans include AI categorisation, VAT support, and financial reports.'
                  : 'تشمل جميع الخطط التصنيف بالذكاء الاصطناعي ودعم ضريبة القيمة المضافة والتقارير المالية.'}
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
              {/* Starter */}
              <Card className="p-8">
                <h3 className="text-2xl font-bold mb-2">
                  {locale === 'en' ? 'Starter' : 'المبتدئ'}
                </h3>
                <div className="mb-6">
                  <div className="text-4xl font-bold mb-1">
                    {locale === 'en' ? 'Free' : 'مجانًا'}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {locale === 'en' ? 'no credit card' : 'بدون بطاقة ائتمان'}
                  </div>
                </div>
                <ul className="space-y-3 mb-8">
                  {[
                    locale === 'en' ? '1 company' : 'شركة واحدة',
                    locale === 'en' ? 'Up to 100 transactions / month' : 'حتى 100 معاملة / شهر',
                    locale === 'en' ? 'Invoices & basic reports' : 'فواتير وتقارير أساسية',
                    locale === 'en' ? 'Email support' : 'دعم البريد الإلكتروني'
                  ].map((feature, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                      <span className="text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/register">
                  <Button className="w-full" variant="outline" size="lg" data-testid="button-plan-starter">
                    {locale === 'en' ? 'Start for free' : 'ابدأ مجانًا'}
                  </Button>
                </Link>
              </Card>

              {/* Growth - Most Popular */}
              <Card className="p-8 border-2 border-primary shadow-xl relative scale-105">
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
                  {locale === 'en' ? 'Most popular' : 'الأكثر شعبية'}
                </Badge>
                <h3 className="text-2xl font-bold mb-2">
                  {locale === 'en' ? 'Growth' : 'النمو'}
                </h3>
                <div className="mb-6">
                  <div className="text-4xl font-bold mb-1">
                    AED 299
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {locale === 'en' ? 'per month' : 'في الشهر'}
                  </div>
                </div>
                <ul className="space-y-3 mb-8">
                  {[
                    locale === 'en' ? 'Up to 3 companies' : 'حتى 3 شركات',
                    locale === 'en' ? 'Unlimited transactions' : 'معاملات غير محدودة',
                    locale === 'en' ? 'AI categorisation & anomaly alerts' : 'تصنيف الذكاء الاصطناعي وتنبيهات الشذوذ',
                    locale === 'en' ? 'VAT summaries & invoice PDFs' : 'ملخصات ضريبة القيمة المضافة وفواتير PDF',
                    locale === 'en' ? 'Priority chat & onboarding' : 'دردشة ذات أولوية وإعداد'
                  ].map((feature, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                      <span className="text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/register">
                  <Button className="w-full" size="lg" data-testid="button-plan-growth">
                    {locale === 'en' ? 'Start Growth' : 'ابدأ النمو'}
                  </Button>
                </Link>
              </Card>

              {/* Firm */}
              <Card className="p-8">
                <h3 className="text-2xl font-bold mb-2">
                  {locale === 'en' ? 'Firm' : 'المؤسسة'}
                </h3>
                <div className="mb-6">
                  <div className="text-4xl font-bold mb-1">
                    AED 799
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {locale === 'en' ? 'per month' : 'في الشهر'}
                  </div>
                </div>
                <ul className="space-y-3 mb-8">
                  {[
                    locale === 'en' ? 'Accounting firms & CFOs' : 'شركات المحاسبة والمديرون الماليون',
                    locale === 'en' ? 'Unlimited companies' : 'شركات غير محدودة',
                    locale === 'en' ? 'Dedicated success manager' : 'مدير نجاح مخصص',
                    locale === 'en' ? 'Custom VAT & tax workflows' : 'سير عمل مخصص لضريبة القيمة المضافة والضرائب',
                    locale === 'en' ? 'Early access to new AI features' : 'وصول مبكر إلى ميزات الذكاء الاصطناعي الجديدة'
                  ].map((feature, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                      <span className="text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/register">
                  <Button className="w-full" variant="outline" size="lg" data-testid="button-plan-firm">
                    {locale === 'en' ? 'Talk to us' : 'تحدث إلينا'}
                  </Button>
                </Link>
              </Card>
            </div>

            <p className="text-center text-sm text-muted-foreground mt-8">
              {locale === 'en'
                ? 'All prices in AED. Cancel anytime. No setup fees.'
                : 'جميع الأسعار بالدرهم الإماراتي. إلغاء في أي وقت. بدون رسوم إعداد.'}
            </p>
          </div>
        </section>

        {/* TESTIMONIALS */}
        <section className="py-20 lg:py-32 bg-muted/30">
          <div className="container max-w-7xl mx-auto px-4">
            <div className="text-center mb-16">
              <h2 className="text-4xl lg:text-5xl font-bold mb-4">
                {locale === 'en' ? (
                  <>What <span className="text-primary">founders & finance teams</span> say.</>
                ) : (
                  <>ماذا يقول <span className="text-primary">المؤسسون وفرق المالية</span>.</>
                )}
              </h2>
              <p className="text-xl text-muted-foreground">
                {locale === 'en'
                  ? 'Replace stress and spreadsheets with clarity and control.'
                  : 'استبدل الإجهاد وجداول البيانات بالوضوح والتحكم.'}
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8">
              {[
                {
                  quote: locale === 'en' 
                    ? 'We closed our books 4x faster in Q2. VAT was basically a button instead of a weekly headache.'
                    : 'أغلقنا دفاترنا أسرع 4 مرات في الربع الثاني. كانت ضريبة القيمة المضافة في الأساس زرًا بدلاً من صداع أسبوعي.',
                  author: locale === 'en' ? 'CEO, Marketing Agency – Dubai' : 'الرئيس التنفيذي، وكالة تسويق - دبي'
                },
                {
                  quote: locale === 'en'
                    ? 'Our accountant now just reviews and adjusts. The system does the boring part better than any junior.'
                    : 'محاسبنا الآن يراجع ويعدل فقط. يقوم النظام بالجزء الممل أفضل من أي محاسب مبتدئ.',
                  author: locale === 'en' ? 'Founder, E-commerce – Sharjah' : 'المؤسس، التجارة الإلكترونية - الشارقة'
                },
                {
                  quote: locale === 'en'
                    ? 'The bilingual tax invoices and UAE chart of accounts made onboarding almost instant.'
                    : 'جعلت الفواتير الضريبية ثنائية اللغة ودليل حسابات الإمارات الإعداد فوريًا تقريبًا.',
                  author: locale === 'en' ? 'Tax Consultant – Abu Dhabi' : 'مستشار ضرائب - أبو ظبي'
                }
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
                  <div className="font-semibold" data-testid={`testimonial-author-${i + 1}`}>
                    {testimonial.author}
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-20 lg:py-32" id="faq">
          <div className="container max-w-4xl mx-auto px-4">
            <div className="text-center mb-16">
              <h2 className="text-4xl lg:text-5xl font-bold mb-4">
                {locale === 'en' ? (
                  <>Frequently asked <span className="text-primary">questions</span>.</>
                ) : (
                  <><span className="text-primary">الأسئلة</span> الشائعة.</>
                )}
              </h2>
              <p className="text-xl text-muted-foreground">
                {locale === 'en'
                  ? 'Still unsure? Here are the answers most people want first.'
                  : 'لا تزال غير متأكد؟ إليك الإجابات التي يريدها معظم الناس أولاً.'}
              </p>
            </div>

            <div className="space-y-6">
              {[
                {
                  q: locale === 'en' ? 'Is this only for UAE businesses?' : 'هل هذا فقط للشركات الإماراتية؟',
                  a: locale === 'en'
                    ? 'We start with UAE-friendly VAT and bilingual invoices, but the engine is global-ready. More jurisdictions are coming as we grow.'
                    : 'نبدأ بضريبة القيمة المضافة الصديقة للإمارات والفواتير ثنائية اللغة، لكن المحرك جاهز عالميًا. المزيد من الولايات القضائية قادمة مع نمونا.'
                },
                {
                  q: locale === 'en' ? 'Can my existing accountant use it?' : 'هل يمكن لمحاسبي الحالي استخدامه؟',
                  a: locale === 'en'
                    ? "Yes. Invite them as an accountant user. They'll get access to journals, reports, and exports, while you keep control of access."
                    : 'نعم. ادعهم كمستخدم محاسب. سيحصلون على وصول إلى القيود والتقارير والتصديرات، بينما تحتفظ أنت بالتحكم في الوصول.'
                },
                {
                  q: locale === 'en' ? 'Where is my data stored?' : 'أين يتم تخزين بياناتي؟',
                  a: locale === 'en'
                    ? 'Your data is stored in secure, encrypted databases with regular backups. We never sell your data and can sign NDAs for larger clients.'
                    : 'يتم تخزين بياناتك في قواعد بيانات آمنة ومشفرة مع نسخ احتياطية منتظمة. نحن لا نبيع بياناتك أبدًا ويمكننا التوقيع على اتفاقيات عدم الإفشاء للعملاء الأكبر.'
                },
                {
                  q: locale === 'en' ? 'Do you connect directly to my bank?' : 'هل تتصل مباشرة ببنكي؟',
                  a: locale === 'en'
                    ? 'For the MVP, we support CSV import from your bank. Direct connections to UAE banks and card providers are on the roadmap.'
                    : 'بالنسبة للمنتج الأدنى القابل للتطبيق، ندعم استيراد CSV من بنكك. الاتصالات المباشرة بالبنوك الإماراتية ومزودي البطاقات في خارطة الطريق.'
                }
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
        <section className="py-20 lg:py-32 bg-gradient-to-br from-primary/10 to-accent/10">
          <div className="container max-w-4xl mx-auto px-4 text-center">
            <h2 className="text-4xl lg:text-5xl font-bold mb-6">
              {locale === 'en' ? (
                <>Ready to see your books <span className="text-primary">in real time</span>?</>
              ) : (
                <>مستعد لرؤية دفاترك <span className="text-primary">في الوقت الفعلي</span>؟</>
              )}
            </h2>
            <p className="text-xl text-muted-foreground mb-8">
              {locale === 'en'
                ? "Start with a free account, or book a short onboarding call. We'll help you import your first month of data."
                : 'ابدأ بحساب مجاني، أو احجز مكالمة إعداد قصيرة. سنساعدك على استيراد بيانات شهرك الأول.'}
            </p>
            <div className="flex flex-wrap gap-4 justify-center">
              <Link href="/register">
                <Button size="lg" data-testid="button-start-trial-footer">
                  {locale === 'en' ? 'Start free trial' : 'ابدأ تجربة مجانية'}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
              <Button size="lg" variant="outline" data-testid="button-compare-plans">
                {locale === 'en' ? 'Compare plans' : 'قارن الخطط'}
              </Button>
            </div>
          </div>
        </section>

        {/* FOOTER */}
        <footer className="border-t py-12 bg-muted/30">
          <div className="container max-w-7xl mx-auto px-4">
            <div className="grid md:grid-cols-3 gap-8 mb-8">
              {/* Brand */}
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <Briefcase className="w-6 h-6 text-primary" />
                  <div className="flex flex-col">
                    <span className="font-bold text-lg leading-none">
                      {locale === 'en' ? 'BookKeep' : 'بوككيب'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {locale === 'en' ? 'AI Bookkeeping for UAE SMEs' : 'محاسبة ذكية للمؤسسات الإماراتية'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Links */}
              <div className="flex gap-8">
                <div>
                  <h4 className="font-semibold mb-3">
                    {locale === 'en' ? 'Product' : 'المنتج'}
                  </h4>
                  <div className="space-y-2">
                    <a href="#features" className="block text-sm text-muted-foreground hover:text-primary">
                      {locale === 'en' ? 'Features' : 'الميزات'}
                    </a>
                    <a href="#pricing" className="block text-sm text-muted-foreground hover:text-primary">
                      {locale === 'en' ? 'Pricing' : 'الأسعار'}
                    </a>
                    <a href="#faq" className="block text-sm text-muted-foreground hover:text-primary">
                      {locale === 'en' ? 'FAQ' : 'الأسئلة'}
                    </a>
                  </div>
                </div>
              </div>

              {/* Meta */}
              <div className="text-sm text-muted-foreground">
                <p>© {new Date().getFullYear()} BookKeep. {locale === 'en' ? 'All rights reserved.' : 'كل الحقوق محفوظة.'}</p>
                <p className="mt-2">{locale === 'en' ? 'Made with ☕ in Dubai.' : 'صُنع بـ ☕ في دبي.'}</p>
              </div>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
