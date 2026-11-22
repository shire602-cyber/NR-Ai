// Keep the same wording check in the browser smoke test and documentation regression.
const wordStart = String.raw`(?<![\p{L}\p{N}_/])`;
const wordEnd = String.raw`(?![\p{L}\p{N}_/])`;
const englishBank = String.raw`(?:banks?|banking)`;
const arabicBank = String.raw`(?:[وف])?(?:(?:[بك])?(?:ال)?|لل?)(?:بنك(?:ي(?:ة|ه)?)?|بنوك|مصرف(?:ي(?:ة|ه)?)?|مصارف)(?:نا|كم|ك)?`;
const directEnglish = String.raw`(?:open[\s-]+banking|bank(?:ing)?[\s-]+(?:account[\s-]+)?(?:feeds?|connections?|sync(?:s|ed|ing|hronization)?|integrations?))`;
const linkOrSync = String.raw`(?:[وف])?(?:ال)?(?:ربط|ارتباط|اتصال|مزامن[ةه]|تغذي[ةه]|خلاص[ةه]|تكامل)`;
// Allow common intervening words such as "with" and "account" without crossing a sentence.
const directArabic = String.raw`(?:${linkOrSync}(?:\s+\p{L}+){0,3}\s+${arabicBank}|(?:${arabicBank}|الصيرف[ةه])\s+(?:ال)?مفتوح(?:[ةه])?)`;
const directClaim = new RegExp(`${wordStart}(?:${directEnglish}|${directArabic})${wordEnd}`, "iu");
const bankContext = new RegExp(`${wordStart}(?:${englishBank}|${arabicBank})${wordEnd}`, "giu");
const releaseTiming = new RegExp(
  String.raw`${wordStart}(?:(?:coming|available|launching)[\s-]+(?:soon|later)|live[\s-]+feeds?|(?:[وف])?(?:قريبا|لاحقا))${wordEnd}`,
  "giu"
);
const neutralAvailability =
  /^(?:(?:(?:the|this) (?:feature|option|service) )?(?:is|are|be|will(?: be)?)?|(?:س?تتوفر|س?تتاح|متاح[ةه]?|سنوفر|سنضيف)(?: (?:هذه الميزة|هذا الخيار|الميزة|الخدمة|الخيار))?)$/iu;

function timingAppliesToBank(fragment, bank, timing) {
  const bankEnd = bank.index + bank[0].length;
  const timingEnd = timing.index + timing[0].length;
  const bankFirst = bank.index < timing.index;
  const gap = bankFirst
    ? fragment.slice(bankEnd, timing.index)
    : fragment.slice(timingEnd, bank.index);
  if (gap.length > 60) return false;
  const newline = gap.indexOf("\n");
  if (newline === -1) return true;

  // A wrapped label may say only when the feature arrives. A separate line that names another
  // feature, such as "WhatsApp is coming soon", belongs to its own subject.
  const beforeTiming = fragment.lastIndexOf("\n", timing.index - 1) + 1;
  const afterTiming = fragment.indexOf("\n", timingEnd);
  const qualifier = bankFirst
    ? gap.slice(newline + 1) +
      " " +
      fragment.slice(timingEnd, afterTiming === -1 ? undefined : afterTiming)
    : fragment.slice(beforeTiming, timing.index) + " " + gap.slice(0, gap.lastIndexOf("\n"));
  return neutralAvailability.test(qualifier.replace(/[\s\p{P}]+/gu, " ").trim());
}

export function findBankLaunchClaim(text) {
  const normalized = text
    .normalize("NFKC")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\p{M}\u061c\u0640\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, "")
    .replace(/[أإآٱ]/gu, "ا")
    .replace(/[‐‑‒–—−]/gu, "-");
  const direct = normalized.match(directClaim);
  if (direct) return direct[0];

  // Scan across word wraps, with sentence punctuation and blank lines as topic boundaries.
  for (const fragment of normalized.split(/[.!?؟؛;|\f]|\n[^\S\n]*\n/u)) {
    const references = [...fragment.matchAll(bankContext)];
    for (const timing of fragment.matchAll(releaseTiming)) {
      const timingEnd = timing.index + timing[0].length;
      const bank = references.find((reference) => timingAppliesToBank(fragment, reference, timing));
      if (bank) {
        return fragment.slice(
          Math.min(bank.index, timing.index),
          Math.max(bank.index + bank[0].length, timingEnd)
        );
      }
    }
  }
  return undefined;
}
