// The public banking copy contract, checked by the render and browser tests.
export const publicBankingCopy = {
  en: {
    question: "How do I reconcile my bank account?",
    answer:
      "Upload a CSV exported from your bank, review suggested matches, and reconcile against your books",
  },
  ar: {
    question: "كيف أطابق حسابي البنكي؟",
    answer: "ارفع كشف حسابك البنكي بصيغة CSV، وراجع المطابقات المقترحة، ثم طابقها مع دفاترك",
  },
};

// Match prose in labels, descriptions and denials. Keep technical URLs and IDs out of the match.
export const publicBankFeedMentions = [
  /(?<![\w/])(?:(?:bank(?:ing)?|live)(?:\s+|[\u2010-\u2015-])feeds?|open(?:\s+|[\u2010-\u2015-])banking)(?![\w/])/iu,
  /(?<![\w/])bank(?:ing)?(?:\s+|[\u2010-\u2015-])sync(?:ing|hroni[sz](?:ation|e|es|ed|ing))?(?![\w/])/iu,
  /(?<![\w/])(?:auto[-\s]+sync\s+feeds?|feed\s+connections?|bank\s+connections?\s+(?:created|deleted))(?![\w/])/iu,
  /\b(?:live\s+bank[-\s]+data|banking\s+provider\s+accounts\s+linked)\b/i,
  /\bcoming\s+later\b/i,
  /\bfeeds?\s*:\s*(?:wio|alaan|lean|tarabut)\b/i,
  /(?<![\p{L}\p{N}_])(?:[وفب])?(?:ال|لل)?(?:(?:ربط|تغذي(?:ة|ات)|خلاص(?:ة|ات)|موجز|مزامنة\s+(?:ال)?(?:حساب(?:ات)?|معاملات))\s+(?:ال)?(?:بنكي|مصرفي)ة?|خدمات\s+(?:ال)?مصرفية\s+(?:ال)?مفتوحة)(?![\p{L}\p{N}_])/u,
  /\bCSV\b[^.!?؟\n]{0,80}(?:ال)?ربط\s+(?:ال)?مباشر/iu,
  /\bdirect\s+bank(?:ing|\s+account)?\s+connections?\b/i,
  /\bbank\s+connect\s*\/\s*sync\b/i,
  /\b(?:automatic(?:ally)?|automated)\s+(?:import(?:s|ing)?\s+bank\s+transactions?|bank\s+(?:transactions?\s+imports?|statements?\s+fetching))\b/i,
  /\breal[-\s]+time\s+(?:bank\s+)?transaction\s+imports?\b/i,
  /\b(?:connect|link)\s+invoices?\s+and\s+bank\s+refresh(?:es)?\b/i,
  /\bconnect(?:s|ed|ing)?\s+(?:directly\s+to\s+(?:(?:a|the|your|my)\s+)?bank(?:ing|\s+accounts?)?|to\s+(?:(?:a|the|your|my)\s+)?bank(?:ing|\s+accounts?)?\s+directly)\b/i,
  /\b(?:connect\s+for\s+easy\s+reconciliation|bank\s+account\s+is\s+already\s+connected\s+for\s+reconciliation)\b/i,
  /(?:يتصل|تتصل|اتصل|اتصال|ارتباط|اربط|ربط)\s+(?:ال)?مباشر(?:ة)?\s+ب(?:ال)?(?:بنك|مصرف|حساب[يك]?\s+(?:ال)?(?:بنكي|مصرفي))/u,
  /(?:اربط|ربط|اتصل)\s+(?:ب)?(?:ال)?(?:بنك|مصرف|حساب[يك]?\s+(?:ال)?(?:بنكي|مصرفي))\s+(?:ال)?مباشر(?:ة)?/u,
  /(?:اربط|ربط)\s+تحديثات\s+الفواتير\s+والبنك/u,
  /(?<![\p{L}\p{N}_])مزامنة\s+(?:ال)?ب(?:نك|نوك)(?![\p{L}\p{N}_])/u,
  /(?:حساب[يك]?\s+(?:ال)?(?:بنكي|مصرفي)\s+مرتبط\s+بالفعل\s+(?:للمطابقة|للتسوية)|اربط\s+حساب[يك]\s+لتسهيل\s+المطابقة\s+البنكية)/u,
];

export function findPublicBankingMention(copy) {
  const text = copy
    .normalize("NFKC")
    .replace(/\u0640|[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu, "")
    .replace(/(?<=\p{Script_Extensions=Arabic})\p{M}+/gu, "");
  return publicBankFeedMentions.map((pattern) => text.match(pattern)?.[0]).find(Boolean);
}

export const bankingDescriptionSelectors = [
  'meta[name="description"]',
  'meta[property="og:description"]',
  'meta[name="twitter:description"]',
];
