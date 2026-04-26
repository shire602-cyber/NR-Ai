import {
  Receipt,
  FileText,
  CreditCard,
  CalendarClock,
  Bell,
  Megaphone,
  UserPlus,
  FolderOpen,
  CheckCircle2,
  BookOpen,
  ClipboardCheck,
  BarChart3,
  Star,
  MessageSquare,
  PartyPopper,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────

export interface MessageTemplate {
  id: string;
  name: string;
  nameAr: string;
  icon: typeof Receipt;
  category: 'invoice' | 'payment' | 'onboarding' | 'service' | 'alert' | 'engagement';
  template: string;
  templateAr: string;
}

// ─── Helpers ──────────────────────────────────────────────

// Normalize a UAE-leaning phone number into an E.164 digit string suitable
// for the wa.me URL. Returns "" when the input cannot be reasonably normalized.
export function formatPhoneForWhatsApp(phone: string): string {
  let cleaned = (phone || '').replace(/[^\d]/g, '');
  if (!cleaned) return '';
  // 10 digits starting with 05 -> UAE local mobile, strip leading 0, add 971
  if (cleaned.length === 10 && cleaned.startsWith('05')) {
    cleaned = '971' + cleaned.substring(1);
  } else if (cleaned.length === 9 && cleaned.startsWith('5')) {
    // 9 digits starting with 5 -> UAE mobile without country/leading 0
    cleaned = '971' + cleaned;
  } else if (cleaned.startsWith('00')) {
    // International prefix 00 -> drop it
    cleaned = cleaned.substring(2);
  } else if (cleaned.startsWith('0')) {
    // Generic leading 0 (national prefix) -> drop it
    cleaned = cleaned.substring(1);
  }
  // E.164 allows 8..15 digits after the country code; reject anything outside that.
  if (cleaned.length < 8 || cleaned.length > 15) return '';
  return cleaned;
}

export function openWhatsApp(phone: string, message: string) {
  const formatted = formatPhoneForWhatsApp(phone);
  const encoded = encodeURIComponent(message);
  window.open(`https://wa.me/${formatted}?text=${encoded}`, '_blank');
}

// Prefer a contact's dedicated WhatsApp number, fall back to phone.
export function pickWhatsAppNumber(contact: {
  whatsappNumber?: string | null;
  phone?: string | null;
}): string | null {
  const wa = contact.whatsappNumber?.trim();
  if (wa) return wa;
  const ph = contact.phone?.trim();
  return ph || null;
}

export function fillTemplate(templateStr: string, data: Record<string, string>): string {
  let result = templateStr;
  for (const [key, value] of Object.entries(data)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}

// ─── Message Templates ────────────────────────────────────

export const MESSAGE_TEMPLATES: MessageTemplate[] = [
  {
    id: 'invoice_new',
    name: 'New Invoice',
    nameAr: 'فاتورة جديدة',
    icon: FileText,
    category: 'invoice',
    template: `Hello {{customer_name}},

Your invoice {{invoice_number}} for AED {{amount}} has been issued.

Due Date: {{due_date}}

Thank you for your business!
- {{company_name}}`,
    templateAr: `مرحباً {{customer_name}},

تم إصدار فاتورتك {{invoice_number}} بمبلغ {{amount}} درهم.

تاريخ الاستحقاق: {{due_date}}

شكراً لتعاملك معنا!
- {{company_name}}`,
  },
  {
    id: 'invoice_with_link',
    name: 'Invoice with Link',
    nameAr: 'فاتورة مع رابط',
    icon: FileText,
    category: 'invoice',
    template: `Hello {{customer_name}},

Your invoice {{invoice_number}} for {{amount}} is ready.

View and download: {{link}}

Due Date: {{due_date}}

Thank you!
- {{company_name}}`,
    templateAr: `مرحباً {{customer_name}},

فاتورتك {{invoice_number}} بمبلغ {{amount}} جاهزة.

عرض وتحميل: {{link}}

تاريخ الاستحقاق: {{due_date}}

شكراً لك!
- {{company_name}}`,
  },
  {
    id: 'payment_reminder',
    name: 'Payment Reminder',
    nameAr: 'تذكير بالدفع',
    icon: CreditCard,
    category: 'payment',
    template: `Hello {{customer_name}},

This is a friendly reminder that invoice {{invoice_number}} for AED {{amount}} is due on {{due_date}}.

Please make payment at your earliest convenience.

Thank you!
- {{company_name}}`,
    templateAr: `مرحباً {{customer_name}},

هذا تذكير ودي بأن الفاتورة {{invoice_number}} بمبلغ {{amount}} درهم مستحقة في {{due_date}}.

يرجى السداد في أقرب وقت ممكن.

شكراً لك!
- {{company_name}}`,
  },
  {
    id: 'payment_overdue',
    name: 'Overdue Payment',
    nameAr: 'دفعة متأخرة',
    icon: CalendarClock,
    category: 'payment',
    template: `Hello {{customer_name}},

Invoice {{invoice_number}} for AED {{amount}} was due on {{due_date}} and is now overdue.

Please arrange payment as soon as possible to avoid any disruption.

Thank you for your attention.
- {{company_name}}`,
    templateAr: `مرحباً {{customer_name}},

الفاتورة {{invoice_number}} بمبلغ {{amount}} درهم كانت مستحقة في {{due_date}} وهي الآن متأخرة.

يرجى ترتيب الدفع في أقرب وقت ممكن.

شكراً لاهتمامك.
- {{company_name}}`,
  },
  {
    id: 'payment_received',
    name: 'Payment Received',
    nameAr: 'تم استلام الدفع',
    icon: CheckCircle2,
    category: 'payment',
    template: `Hello {{customer_name}},

Thank you! We have received your payment of AED {{amount}} for invoice {{invoice_number}}.

Your account is now up to date.

Best regards,
- {{company_name}}`,
    templateAr: `مرحباً {{customer_name}},

شكراً لك! لقد استلمنا دفعتك بمبلغ {{amount}} درهم للفاتورة {{invoice_number}}.

حسابك محدّث الآن.

مع أطيب التحيات,
- {{company_name}}`,
  },
  {
    id: 'welcome_client',
    name: 'Welcome New Client',
    nameAr: 'ترحيب بعميل جديد',
    icon: UserPlus,
    category: 'onboarding',
    template: `Hello {{customer_name}},

Welcome to {{company_name}}! We are delighted to have you as our client.

Our team is ready to assist you with all your accounting and compliance needs. Please don't hesitate to reach out if you have any questions.

Best regards,
- {{company_name}}`,
    templateAr: `مرحباً {{customer_name}},

أهلاً بك في {{company_name}}! يسعدنا أن تكون عميلنا.

فريقنا جاهز لمساعدتك في جميع احتياجاتك المحاسبية والامتثال. لا تتردد في التواصل معنا لأي استفسار.

مع أطيب التحيات,
- {{company_name}}`,
  },
  {
    id: 'document_request',
    name: 'Document Request',
    nameAr: 'طلب مستندات',
    icon: FolderOpen,
    category: 'onboarding',
    template: `Hello {{customer_name}},

We kindly request you to provide the following documents at your earliest convenience:

- Trade License (current)
- Emirates ID (authorized signatory)
- Memorandum of Association
- {{message}}

Please share them via WhatsApp or email.

Thank you!
- {{company_name}}`,
    templateAr: `مرحباً {{customer_name}},

نرجو منكم تزويدنا بالمستندات التالية في أقرب وقت:

- الرخصة التجارية (سارية)
- الهوية الإماراتية (المفوض بالتوقيع)
- عقد التأسيس
- {{message}}

يرجى إرسالها عبر واتساب أو البريد الإلكتروني.

شكراً لك!
- {{company_name}}`,
  },
  {
    id: 'onboarding_complete',
    name: 'Onboarding Complete',
    nameAr: 'اكتمال التسجيل',
    icon: CheckCircle2,
    category: 'onboarding',
    template: `Hello {{customer_name}},

Great news! Your onboarding with {{company_name}} is now complete. Your account is fully set up and ready to go.

If you need any assistance, feel free to reach out anytime.

Welcome aboard!
- {{company_name}}`,
    templateAr: `مرحباً {{customer_name}},

أخبار سارة! تم اكتمال تسجيلك لدى {{company_name}}. حسابك جاهز بالكامل.

إذا كنت بحاجة لأي مساعدة، لا تتردد في التواصل معنا.

أهلاً بك معنا!
- {{company_name}}`,
  },
  {
    id: 'bookkeeping_complete',
    name: 'Bookkeeping Complete',
    nameAr: 'اكتمال المحاسبة الشهرية',
    icon: BookOpen,
    category: 'service',
    template: `Hello {{customer_name}},

Your bookkeeping for {{period}} has been completed. All transactions have been recorded and reconciled.

If you would like to review the details, please let us know.

Best regards,
- {{company_name}}`,
    templateAr: `مرحباً {{customer_name}},

تم الانتهاء من المحاسبة الشهرية لفترة {{period}}. تم تسجيل جميع المعاملات ومطابقتها.

إذا كنت ترغب بمراجعة التفاصيل، يرجى إبلاغنا.

مع أطيب التحيات,
- {{company_name}}`,
  },
  {
    id: 'vat_filed',
    name: 'VAT Return Filed',
    nameAr: 'تم تقديم إقرار الضريبة',
    icon: ClipboardCheck,
    category: 'service',
    template: `Hello {{customer_name}},

Your VAT return for the period {{period}} has been successfully filed with the Federal Tax Authority.

VAT Payable: AED {{amount}}
Filing Reference: {{reference}}

Please ensure timely payment to avoid penalties.

Best regards,
- {{company_name}}`,
    templateAr: `مرحباً {{customer_name}},

تم تقديم إقرار ضريبة القيمة المضافة عن الفترة {{period}} بنجاح لدى الهيئة الاتحادية للضرائب.

الضريبة المستحقة: {{amount}} درهم
رقم المرجع: {{reference}}

يرجى التأكد من السداد في الموعد لتجنب أي غرامات.

مع أطيب التحيات,
- {{company_name}}`,
  },
  {
    id: 'vat_deadline_reminder',
    name: 'VAT Deadline Reminder',
    nameAr: 'تذكير موعد الضريبة',
    icon: CalendarClock,
    category: 'alert',
    template: `Hello {{customer_name}},

This is a reminder that your VAT return filing deadline is approaching on {{due_date}}.

Please ensure all invoices and receipts are submitted so we can prepare and file your return on time.

Thank you!
- {{company_name}}`,
    templateAr: `مرحباً {{customer_name}},

هذا تذكير بأن موعد تقديم إقرار ضريبة القيمة المضافة يقترب في {{due_date}}.

يرجى التأكد من تقديم جميع الفواتير والإيصالات لنتمكن من إعداد وتقديم إقراركم في الوقت المحدد.

شكراً لك!
- {{company_name}}`,
  },
  {
    id: 'tax_return_ready',
    name: 'Tax Return Ready',
    nameAr: 'الإقرار الضريبي جاهز',
    icon: FileText,
    category: 'service',
    template: `Hello {{customer_name}},

Your tax return for {{period}} has been prepared and is ready for your review.

Please review it at your earliest convenience so we can submit it before the deadline.

Best regards,
- {{company_name}}`,
    templateAr: `مرحباً {{customer_name}},

تم إعداد إقرارك الضريبي لفترة {{period}} وهو جاهز لمراجعتك.

يرجى مراجعته في أقرب وقت حتى نتمكن من تقديمه قبل الموعد النهائي.

مع أطيب التحيات,
- {{company_name}}`,
  },
  {
    id: 'report_ready',
    name: 'Financial Report Ready',
    nameAr: 'التقرير المالي جاهز',
    icon: BarChart3,
    category: 'service',
    template: `Hello {{customer_name}},

Your financial report for {{period}} is now ready. Key highlights:

{{message}}

Please contact us if you'd like to discuss the details.

Best regards,
- {{company_name}}`,
    templateAr: `مرحباً {{customer_name}},

تقريرك المالي لفترة {{period}} جاهز الآن. أبرز النقاط:

{{message}}

يرجى التواصل معنا إذا كنت ترغب بمناقشة التفاصيل.

مع أطيب التحيات,
- {{company_name}}`,
  },
  {
    id: 'seasonal_greeting',
    name: 'Seasonal Greeting',
    nameAr: 'تهنئة موسمية',
    icon: PartyPopper,
    category: 'engagement',
    template: `Dear {{customer_name}},

{{message}}

Warm wishes from the entire team at {{company_name}}.

Best regards,
- {{company_name}}`,
    templateAr: `عزيزنا {{customer_name}},

{{message}}

أطيب التمنيات من فريق {{company_name}} بأكمله.

مع أطيب التحيات,
- {{company_name}}`,
  },
  {
    id: 'feedback_request',
    name: 'Feedback Request',
    nameAr: 'طلب ملاحظات',
    icon: MessageSquare,
    category: 'engagement',
    template: `Hello {{customer_name}},

We value your opinion! We would love to hear your feedback about our services.

How has your experience been with {{company_name}}? Any suggestions for improvement are greatly appreciated.

Thank you for your time!
- {{company_name}}`,
    templateAr: `مرحباً {{customer_name}},

رأيك يهمنا! نود سماع ملاحظاتك حول خدماتنا.

كيف كانت تجربتك مع {{company_name}}؟ نقدر أي اقتراحات للتحسين.

شكراً لوقتك!
- {{company_name}}`,
  },
  {
    id: 'general_reminder',
    name: 'General Reminder',
    nameAr: 'تذكير عام',
    icon: Bell,
    category: 'alert',
    template: `Hello {{customer_name}},

{{message}}

Best regards,
- {{company_name}}`,
    templateAr: `مرحباً {{customer_name}},

{{message}}

مع أطيب التحيات,
- {{company_name}}`,
  },
  {
    id: 'news_update',
    name: 'News & Announcement',
    nameAr: 'أخبار وإعلان',
    icon: Megaphone,
    category: 'engagement',
    template: `Hello {{customer_name}},

{{message}}

Best regards,
- {{company_name}}`,
    templateAr: `مرحباً {{customer_name}},

{{message}}

مع أطيب التحيات,
- {{company_name}}`,
  },
];
