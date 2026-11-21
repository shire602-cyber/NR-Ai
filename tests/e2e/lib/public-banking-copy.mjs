// The public banking copy contract, checked by the render and browser tests.
export const publicBankingCopy = {
  en: {
    question: "How do I reconcile my bank account?",
    answer:
      "Upload a CSV exported from your bank, review suggested matches, and reconcile against your books.",
  },
  ar: {
    question: "كيف أطابق حسابي البنكي؟",
    answer: "ارفع كشف حسابك البنكي بصيغة CSV، وراجع المطابقات المقترحة، ثم طابقها مع دفاترك.",
  },
};

// Match prose in labels, descriptions and denials. Keep technical URLs and IDs out of the match.
export const publicBankFeedMentions = [
  /(?<![\w/])(?:(?:bank(?:ing)?|live)(?:\s+|[\u2010-\u2015-])feeds?|open(?:\s+|[\u2010-\u2015-])banking)(?![\w/])/iu,
  /(?<![\p{L}\p{N}_])(?:[وفب])?(?:ال|لل)?(?:(?:ربط|تغذي(?:ة|ات)|خلاص(?:ة|ات)|موجز|مزامنة\s+(?:ال)?(?:حساب(?:ات)?|معاملات))\s+(?:ال)?(?:بنكي|مصرفي)ة?|خدمات\s+(?:ال)?مصرفية\s+(?:ال)?مفتوحة)(?![\p{L}\p{N}_])/u,
  /\bCSV\b[^.!?؟\n]{0,80}(?:ال)?ربط\s+(?:ال)?مباشر/iu,
];

export const bankingDescriptionSelectors = [
  'meta[name="description"]',
  'meta[property="og:description"]',
  'meta[name="twitter:description"]',
];
