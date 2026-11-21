const CLAIMS = [
  /\b(?:(?:connect|link) your bank|securely link your[^.!?]*bank account|via encrypted feeds|UAE bank feeds|photo, email forward, or bank feed|sync a bank line)\b/gi,
  /\b(?:connect to|sync from)\s+(?:(?:a|your)\s+)?(?:live\s+)?bank feeds?\b/gi,
  /\b(?:live\s+)?bank feeds?\s+(?:(?:are|is|will be)\s+)?(?:now\s+)?(?:connected|available|supported|live|coming\s+(?:soon|later)|launch(?:ing)?\s+soon)\b/gi,
  /\b(?:we|Muhasib)\s+(?:will|now)\s+(?:support|offer|provide|enable)\s+(?:live\s+)?bank feeds?\b/gi,
  /(?:اربط|وصل|يمكنك ربط)\s+(?:حسابك\s+البنكي|بنكك)|(?:زامن|استورد)\s+(?:معاملاتك|حركاتك)\s+البنكية\s+تلقائيا/gu,
  /(?:سيتوفر|سندعم)\s+الربط البنكي المباشر|الربط البنكي المباشر\s+(?:متاح|مدعوم|قادم|لاحقا|قريبا)/gu,
];

// Recognize direct negation of the matched phrase without suppressing a later
// positive claim elsewhere in the text.
const NEGATED_BEFORE =
  /(?:\b(?:no|not|never|don['’]t|cannot|can['’]t|without)\s+(?:(?:support|offer|provide|enable|use|need)\s+)?|(?:لا|لن|ليس|بدون|دون)\s+)$/iu;
const NEGATED_AFTER =
  /^\s+(?:(?:is|are)\s+)?(?:unavailable|unsupported|not\s+(?:available|supported|offered)\b|غير\s+(?:متاح|مدعوم))/iu;

function normalizeCopy(text) {
  return text.replace(/\u0640|[\u064b-\u065f]|\u0670/gu, "").replace(/\s+/gu, " ");
}

/** Return the first unsupported bank feed claim, if any. */
export function findUnsupportedBankFeedClaim(text) {
  const source = normalizeCopy(text);
  for (const pattern of CLAIMS) {
    for (const match of source.matchAll(pattern)) {
      const before = source.slice(0, match.index);
      const after = source.slice(match.index + match[0].length);
      if (!NEGATED_BEFORE.test(before) && !NEGATED_AFTER.test(after)) return match[0];
    }
  }
  return null;
}

/** Statement-import surfaces omit the feature entirely, including negative mentions. */
export function findBankFeedMention(text) {
  const source = normalizeCopy(text);
  return (
    source.match(
      /\b(?:bank[\s-]+feeds?|live\s+(?:feeds?|sync(?:ing|hronization)?)|open[\s-]+banking)\b/iu
    )?.[0] ??
    source.match(
      /(?:ال)?(?:ربط|خلاصة)\s+(?:ال)?(?:بنكي(?:ة)?|مصرفي(?:ة)?)|(?:ال)?مزامنة\s+(?:ال)?مباشرة|الخدمات المصرفية المفتوحة/u
    )?.[0] ??
    findUnsupportedBankFeedClaim(text)
  );
}
