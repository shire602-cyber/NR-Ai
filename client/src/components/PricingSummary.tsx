import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Link } from 'wouter';
import {
  Check,
  Zap,
  Crown,
  Rocket,
  Building2,
  ArrowRight,
  Star,
} from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { motion, AnimatePresence } from 'framer-motion';
import { StaggerContainer, StaggerItem, hoverLift } from '@/lib/animations';

/**
 * PricingSummary -- Condensed 4-card pricing component
 * designed for embedding inside the Landing page or any other page.
 *
 * Usage:
 *   import { PricingSummary } from '@/components/PricingSummary';
 *   <PricingSummary />
 */
export function PricingSummary() {
  const { locale } = useI18n();
  const [isYearly, setIsYearly] = useState(false);
  const isRTL = locale === 'ar';

  const t = {
    monthly: locale === 'en' ? 'Monthly' : 'شهري',
    yearly: locale === 'en' ? 'Yearly' : 'سنوي',
    save20: locale === 'en' ? 'Save 20%' : 'وفّر 20%',
    perMonth: locale === 'en' ? '/mo' : '/شهر',
    free: locale === 'en' ? 'Free' : 'مجاني',
    viewAll: locale === 'en' ? 'View Full Pricing' : 'عرض جميع الأسعار',
    recommended: locale === 'en' ? 'Recommended' : 'موصى به',
    mostPopular: locale === 'en' ? 'Most Popular' : 'الأكثر شعبية',
  };

  const plans = [
    {
      id: 'free',
      name: locale === 'en' ? 'Free' : 'مجاني',
      icon: Zap,
      monthlyPrice: 0,
      yearlyPrice: 0,
      highlights: locale === 'en'
        ? ['1 company, 1 user', '50 invoices/mo', 'Basic AI categorization', 'VAT filing']
        : ['شركة واحدة، مستخدم واحد', '50 فاتورة/شهر', 'تصنيف ذكي أساسي', 'ضريبة القيمة المضافة'],
      cta: locale === 'en' ? 'Get Started Free' : 'ابدأ مجاناً',
      variant: 'outline' as const,
      highlight: false,
      badge: null,
      gradient: 'from-slate-400 to-slate-500',
      iconColor: 'text-slate-600',
      iconBg: 'from-slate-500/10 to-slate-600/5',
    },
    {
      id: 'starter',
      name: locale === 'en' ? 'Starter' : 'المبتدئ',
      icon: Rocket,
      monthlyPrice: 49,
      yearlyPrice: 39,
      highlights: locale === 'en'
        ? ['1 company, 3 users', '200 invoices/mo', 'AI OCR scanning', 'Inventory & bill pay']
        : ['شركة واحدة، 3 مستخدمين', '200 فاتورة/شهر', 'مسح OCR ذكي', 'مخزون ودفع فواتير'],
      cta: locale === 'en' ? 'Start 14-Day Trial' : 'ابدأ تجربة 14 يوم',
      variant: 'default' as const,
      highlight: false,
      badge: 'recommended',
      gradient: 'from-blue-400 to-blue-600',
      iconColor: 'text-blue-600',
      iconBg: 'from-blue-500/10 to-blue-600/5',
    },
    {
      id: 'professional',
      name: locale === 'en' ? 'Professional' : 'الاحترافي',
      icon: Crown,
      monthlyPrice: 149,
      yearlyPrice: 119,
      highlights: locale === 'en'
        ? ['3 companies, 10 users', 'Unlimited invoices', 'AI CFO & Anomaly Detection', 'Payroll, Tax & E-Invoicing']
        : ['3 شركات، 10 مستخدمين', 'فواتير غير محدودة', 'مستشار مالي وكشف شاذ', 'رواتب، ضرائب وفوترة إلكترونية'],
      cta: locale === 'en' ? 'Start 14-Day Trial' : 'ابدأ تجربة 14 يوم',
      variant: 'default' as const,
      highlight: true,
      badge: 'mostPopular',
      gradient: 'from-emerald-400 to-teal-600',
      iconColor: 'text-emerald-600',
      iconBg: 'from-emerald-500/10 to-emerald-600/5',
    },
    {
      id: 'enterprise',
      name: locale === 'en' ? 'Enterprise' : 'المؤسسات',
      icon: Building2,
      monthlyPrice: 299,
      yearlyPrice: 239,
      highlights: locale === 'en'
        ? ['Unlimited everything', 'Priority AI processing', 'Dedicated account manager', 'Custom integrations & API']
        : ['كل شيء غير محدود', 'أولوية معالجة ذكية', 'مدير حساب مخصص', 'تكاملات مخصصة و API'],
      cta: locale === 'en' ? 'Contact Sales' : 'تواصل مع المبيعات',
      variant: 'outline' as const,
      highlight: false,
      badge: null,
      gradient: 'from-purple-400 to-purple-600',
      iconColor: 'text-purple-600',
      iconBg: 'from-purple-500/10 to-purple-600/5',
    },
  ];

  const formatPrice = (price: number) => (price === 0 ? t.free : `AED ${price}`);

  return (
    <div className={isRTL ? 'rtl' : 'ltr'} dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Monthly/Yearly toggle */}
      <div className="flex items-center justify-center gap-3 mb-10">
        <span className={`text-sm font-medium transition-colors ${!isYearly ? 'text-foreground' : 'text-muted-foreground'}`}>
          {t.monthly}
        </span>
        <Switch
          checked={isYearly}
          onCheckedChange={setIsYearly}
          className="data-[state=checked]:bg-emerald-600"
        />
        <span className={`text-sm font-medium transition-colors ${isYearly ? 'text-foreground' : 'text-muted-foreground'}`}>
          {t.yearly}
        </span>
        <AnimatePresence>
          {isYearly && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8, x: -10 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.8, x: -10 }}
              transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            >
              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800">
                {t.save20}
              </Badge>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Cards */}
      <StaggerContainer className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto">
        {plans.map((plan) => {
          const price = isYearly ? plan.yearlyPrice : plan.monthlyPrice;
          const PlanIcon = plan.icon;

          return (
            <StaggerItem key={plan.id}>
              <motion.div whileHover={hoverLift} className="h-full">
                <Card
                  className={`relative h-full flex flex-col overflow-hidden transition-all duration-300 ${
                    plan.highlight
                      ? 'border-emerald-500 dark:border-emerald-400 shadow-lg shadow-emerald-500/10 ring-1 ring-emerald-500/20 scale-[1.02] lg:scale-105'
                      : 'hover:border-foreground/20'
                  }`}
                >
                  {/* Top accent bar */}
                  <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${plan.gradient}`} />

                  <CardHeader className="pb-3">
                    {/* Badge */}
                    {plan.badge && (
                      <div className="mb-2">
                        <Badge
                          variant={plan.badge === 'mostPopular' ? 'default' : 'secondary'}
                          className={
                            plan.badge === 'mostPopular'
                              ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-600'
                              : ''
                          }
                        >
                          {plan.badge === 'mostPopular' && <Star className="h-3 w-3 me-1" />}
                          {plan.badge === 'mostPopular' ? t.mostPopular : t.recommended}
                        </Badge>
                      </div>
                    )}

                    {/* Icon + Name */}
                    <div className="flex items-center gap-2.5 mb-1">
                      <div className={`h-9 w-9 rounded-xl bg-gradient-to-br ${plan.iconBg} flex items-center justify-center`}>
                        <PlanIcon className={`h-4.5 w-4.5 ${plan.iconColor}`} />
                      </div>
                      <CardTitle className="text-lg">{plan.name}</CardTitle>
                    </div>

                    {/* Price */}
                    <div className="mt-3 flex items-baseline gap-1">
                      <AnimatePresence mode="wait">
                        <motion.span
                          key={`${plan.id}-${isYearly}`}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ duration: 0.2 }}
                          className="text-3xl font-bold tracking-tight"
                        >
                          {formatPrice(price)}
                        </motion.span>
                      </AnimatePresence>
                      {price > 0 && (
                        <span className="text-muted-foreground text-sm">{t.perMonth}</span>
                      )}
                    </div>
                  </CardHeader>

                  <CardContent className="flex-1 pb-3">
                    <ul className="space-y-2">
                      {plan.highlights.map((item, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm">
                          <Check className={`h-4 w-4 mt-0.5 shrink-0 ${
                            plan.highlight ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'
                          }`} />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>

                  <CardFooter className="pt-1 pb-5">
                    <Link href={plan.id === 'enterprise' ? '#contact' : '/register'} className="w-full">
                      <Button
                        variant={plan.variant}
                        className={`w-full ${
                          plan.highlight
                            ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-700 hover:to-teal-700 shadow-lg shadow-emerald-500/25'
                            : plan.id === 'starter'
                            ? 'bg-blue-600 text-white hover:bg-blue-700'
                            : ''
                        }`}
                      >
                        {plan.cta}
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

      {/* View all link */}
      <div className="text-center mt-8">
        <Link href="/pricing">
          <Button variant="ghost" className="text-emerald-600 hover:text-emerald-700 dark:text-emerald-400">
            {t.viewAll}
            <ArrowRight className="h-4 w-4 ms-1" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
