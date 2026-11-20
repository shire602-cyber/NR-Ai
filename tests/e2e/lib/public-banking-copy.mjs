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

export const publicBankFeedPromises = [
  /\bbank feeds?\b[^.!?\n]{0,60}\b(?:coming|soon|later|future|roadmap)\b/i,
  /(?:(?:سيتوفر|سيتاح|سيُتاح)\s+الربط البنكي|الربط البنكي[^.؟\n]{0,60}(?:لاحق|قريب|مستقبل))/u,
];

export const bankingDescriptionSelectors = [
  'meta[name="description"]',
  'meta[property="og:description"]',
  'meta[name="twitter:description"]',
];
