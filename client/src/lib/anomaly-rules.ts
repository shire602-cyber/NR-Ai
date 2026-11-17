// Display names of the anomaly checks (the `rule` the API returns).
const RULE_LABELS: Record<string, { en: string; ar: string }> = {
  duplicate_amount: { en: "Duplicate amount", ar: "مبلغ مكرر" },
  unusual_amount: { en: "Unusual amount", ar: "مبلغ غير معتاد" },
  weekend_transaction: { en: "Weekend entry", ar: "قيد في عطلة نهاية الأسبوع" },
  round_number: { en: "Round number", ar: "مبلغ مقرّب" },
  duplicate_vendor: { en: "Possible duplicate charge", ar: "احتمال رسوم مكررة" },
  duplicate_supplier_invoice: { en: "Duplicate supplier invoice", ar: "فاتورة مورد مكررة" },
  vat_rate_mismatch: { en: "VAT rate mismatch", ar: "عدم تطابق نسبة الضريبة" },
  trn_missing: { en: "Supplier TRN missing", ar: "الرقم الضريبي للمورد مفقود" },
  trn_malformed: { en: "Malformed TRN", ar: "رقم ضريبي غير صالح" },
  cross_period_baseline: { en: "Above trailing average", ar: "أعلى من المتوسط السابق" },
};

/** Label of a check, in the reader's language; an unknown rule shows its id with spaces. */
export function anomalyRuleLabel(rule: string, locale: string): string {
  const label = RULE_LABELS[rule];
  if (!label) return rule.replace(/_/g, " ");
  return locale === "ar" ? label.ar : label.en;
}
