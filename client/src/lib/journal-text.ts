/**
 * Journal memos and line descriptions are written by the server in English. In the Arabic interface the sentences the
 * system generates itself (invoice, payment, credit note, refund, stock) are shown in Arabic; names, numbers and any text
 * a person typed are kept as they are. A sentence that is not recognised is shown unchanged, so nothing is hidden.
 */

const METHODS: Record<string, string> = { bank: "بنك", gateway: "بوابة الدفع", cash: "نقد", card: "بطاقة" };
const INVOICE_STATES: Record<string, string> = { draft: "مسودة", sent: "مرسلة", paid: "مدفوعة", partial: "مدفوعة جزئياً", void: "ملغاة", credited: "مُشعَرة دائناً", cancelled: "ملغاة", overdue: "متأخرة" };
const STOCK_TYPES: Record<string, string> = { purchase: "شراء", sale: "بيع", adjustment: "تسوية", return: "مرتجع" };

type Rule = [RegExp, (m: RegExpMatchArray, again: (s: string) => string) => string];

const RULES: Rule[] = [
  // Notifications the system writes about invoices and online payments.
  [/^Invoice created$/, () => "تم إنشاء فاتورة"],
  [/^Online payment received$/, () => "تم استلام دفعة إلكترونية"],
  [/^Invoice (draft|sent|paid|partial|void|credited|cancelled|overdue)$/, (m) => `الفاتورة ${INVOICE_STATES[m[1]]}`],
  [/^Invoice (\S+) for (.+) — ([\d.,]+) (\w+)$/s, (m) => `فاتورة ${m[1]} للعميل ${m[2]} — ${m[3]} ${m[4]}`],
  [/^Invoice (\S+) for (.+) marked as (\w+)$/s, (m) => `الفاتورة ${m[1]} للعميل ${m[2]} أصبحت ${INVOICE_STATES[m[3]] ?? m[3]}`],
  [/^([\d.,]+) (\w+) paid online for invoice (\S+)\.$/, (m) => `تم دفع ${m[1]} ${m[2]} إلكترونياً للفاتورة ${m[3]}.`],
  [/^Reversal(?::| -) (.+)$/s, (m, again) => `عكس: ${again(m[1])}`],
  [/^Manual$/, () => "يدوي"],
  [/^Invoice (\S+) — cash received$/, (m) => `فاتورة ${m[1]} — نقد مستلم`],
  [/^Invoice (\S+) — clear A\/R$/, (m) => `فاتورة ${m[1]} — تسوية الذمم المدينة`],
  [/^Invoice (\S+) — customer credit \(overpayment\)$/, (m) => `فاتورة ${m[1]} — رصيد دائن للعميل (دفعة زائدة)`],
  [/^Sales Invoice (\S+) - (.+)$/s, (m) => `فاتورة مبيعات ${m[1]} - ${m[2]}`],
  [/^VAT output - Invoice (\S+)$/, (m) => `ضريبة المخرجات - فاتورة ${m[1]}`],
  [/^Invoice (\S+) - (.+)$/s, (m) => `فاتورة ${m[1]} - ${m[2]}`],
  [/^Invoice (\S+)$/, (m) => `فاتورة ${m[1]}`],
  [/^Credit Note (\S+) - partial credit of Invoice (\S+)$/, (m) => `إشعار دائن ${m[1]} - إشعار جزئي على الفاتورة ${m[2]}`],
  [/^Credit Note (\S+) - credit of Invoice (\S+)$/, (m) => `إشعار دائن ${m[1]} - إشعار على الفاتورة ${m[2]}`],
  [/^\[Credit\] (.+)$/s, (m) => `[إشعار دائن] ${m[1]}`],
  [/^Reduce A\/R - (\S+)$/, (m) => `تخفيض الذمم المدينة - ${m[1]}`],
  [/^Reverse VAT - (\S+)$/, (m) => `عكس الضريبة - ${m[1]}`],
  [/^Payment received for Invoice (\S+) - (\w+)$/, (m) => `دفعة مستلمة للفاتورة ${m[1]} - ${METHODS[m[2]] ?? m[2]}`],
  [/^(?:Payment g|G)ateway fee - (.+)$/, (m) => `رسوم بوابة الدفع - ${m[1]}`],
  [/^Refund - Invoice (\S+)$/, (m) => `رد - فاتورة ${m[1]}`],
  [/^Refund of credit note (\S+) - cash refunded$/, (m) => `رد الإشعار الدائن ${m[1]} - نقد مردود`],
  [/^Refund of credit note (\S+) - clear customer credit$/, (m) => `رد الإشعار الدائن ${m[1]} - تسوية رصيد العميل`],
  [/^Refund of credit note (\S+) to (.+)$/s, (m) => `رد الإشعار الدائن ${m[1]} إلى ${m[2]}`],
  [/^Refund of customer credit - (.+)$/s, (m) => `رد رصيد العميل - ${m[1]}`],
  [/^Void refund of customer credit - reversal of (.+)$/s, (m) => `إلغاء رد رصيد العميل - عكس ${m[1]}`],
  [/^Void refund of credit note (\S+) - reversal of (.+)$/s, (m) => `إلغاء رد الإشعار الدائن ${m[1]} - عكس ${m[2]}`],
  [/^Void Invoice (\S+) - reversal of original posting$/, (m) => `إلغاء الفاتورة ${m[1]} - عكس القيد الأصلي`],
  [/^Void Invoice (\S+)$/, (m) => `إلغاء الفاتورة ${m[1]}`],
  [/^Void Credit Note (\S+)$/, (m) => `إلغاء الإشعار الدائن ${m[1]}`],
  [/^Cost of goods sold - void of Credit Note (\S+) restock$/, (m) => `تكلفة البضاعة المباعة - إلغاء إعادة تخزين الإشعار الدائن ${m[1]}`],
  [/^Cost of goods sold reversal - (.+)$/s, (m, again) => `عكس تكلفة البضاعة المباعة - ${again(m[1])}`],
  [/^Cost of goods sold - (.+)$/s, (m, again) => `تكلفة البضاعة المباعة - ${again(m[1])}`],
  [/^Inventory (purchase|sale|adjustment|return) - (.+)$/s, (m) => `مخزون (${STOCK_TYPES[m[1]]}) - ${m[2]}`],
  [/^Inventory - (.+)$/s, (m, again) => `المخزون - ${again(m[1])}`],
  [/^Opening inventory \(stock on hand at average cost\)$/, () => "مخزون افتتاحي (المخزون الفعلي بمتوسط التكلفة)"],
  [/^Opening inventory$/, () => "مخزون افتتاحي"],
  [/^Inventory write-down$/, () => "تخفيض قيمة المخزون"],
  [/^(.+) \((purchase|sale|adjustment|return)\)$/s, (m) => `${m[1]} (${STOCK_TYPES[m[2]]})`],
  [/^Opening balances as of (.+)$/, (m) => `الأرصدة الافتتاحية كما في ${m[1]}`],
  [/^Advance payment$/, () => "دفعة مقدمة"],
  [/^Refundable security deposit$/, () => "تأمين مسترد"],
];

/** The text in the interface language; unrecognised text comes back unchanged. */
export function localizeJournalText(text: string | null | undefined, locale: string): string {
  if (!text) return text ?? "";
  if (locale !== "ar") return text;
  return translate(text, 0);
}

function translate(text: string, depth: number): string {
  if (depth > 3) return text;
  for (const [pattern, build] of RULES) {
    const m = text.match(pattern);
    if (m) return build(m, (s) => translate(s, depth + 1));
  }
  return text;
}
