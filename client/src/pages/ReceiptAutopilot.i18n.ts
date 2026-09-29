import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "ReceiptAutopilot",
  {
    companyRules: "Company Rules",
    uaeKeywords: "UAE Keywords",
    statisticalNaiveBayes: "Statistical (Naive Bayes)",
    openaiFallback: "OpenAI Fallback",
    exactFuzzyMerchantPatternsFromYour:
      "Exact + fuzzy merchant patterns from your accepted history.",
    builtInPatternsCoveringDewaEtisalat:
      "Built-in patterns covering DEWA, Etisalat, Careem, Emirates, …",
    naiveBayesTrainedOnYourAccepted: "Naive Bayes trained on your accepted classifications.",
    usedWhenInternalConfidenceFallsBelow: "Used when internal confidence falls below threshold.",
    settingsSaved: "Settings saved",
    autopilotConfigurationUpdated: "Autopilot configuration updated.",
    couldNotSave: "Could not save",
    pleaseTryAgain: "Please try again.",
    receiptAutopilot: "Receipt Autopilot",
    failsafeActive: "Failsafe Active",
    internalClassifierWithOpenaiFallbackThe:
      "Internal classifier with OpenAI fallback. The system learns your accepted classifications and automatically posts high-confidence receipts to the GL.",
    aiAccuracy: "AI Accuracy",
    overallAcceptanceRateAcrossAllClassifier:
      "Overall acceptance rate across all classifier methods. Threshold: {thresholdPct}%.",
    acceptedRejected: "{totalAccepted} accepted / {totalRejected} rejected",
    couldNotLoadClassifierStats: "Could not load classifier stats:",
    internalClassifierAccuracyIsBelowThe:
      "Internal classifier accuracy ({accuracyPct}%) is below the {thresholdPct}% threshold — this company has been automatically switched to OpenAI-only mode. Restore hybrid mode below once you have more training data.",
    noReceiptsClassifiedYetUploadReceipts:
      "No receipts classified yet. Upload receipts to start training the model.",
    fallback: "Fallback",
    judged: "{value} judged",
    total: "Total {totalPredictions}",
    autopilotSettings: "Autopilot Settings",
    hybridModeRunsTheInternalClassifier:
      "Hybrid mode runs the internal classifier first; OpenAI is used only as a fallback.",
    autoPostHighConfidenceReceipts: "Auto-post high-confidence receipts",
    whenEnabledReceiptsMatchingARule:
      "When enabled, receipts matching a rule with ≥5 acceptances and confidence at or above your auto-post threshold are posted to the GL without user review.",
    autoPostConfidenceThreshold: "Auto-post confidence threshold",
    minimumClassificationConfidenceBeforeAReceipt:
      "Minimum classification confidence before a receipt may post without review (80–99%). Below it, receipts wait in the review queue.",
    hybridModeRecommended: "Hybrid mode (recommended)",
    offBypassTheInternalClassifierAnd:
      "Off → bypass the internal classifier and use OpenAI for every receipt.",
  },
  {
    companyRules: "قواعد الشركة",
    uaeKeywords: "كلمات مفتاحية إماراتية",
    statisticalNaiveBayes: "إحصائي (Naive Bayes)",
    openaiFallback: "البديل (OpenAI)",
    exactFuzzyMerchantPatternsFromYour: "أنماط تجار مطابقة تمامًا وتقريبيًا من سجل ما قبلته.",
    builtInPatternsCoveringDewaEtisalat:
      "أنماط مدمجة تغطي هيئة كهرباء ومياه دبي واتصالات وكريم والإمارات وغيرها…",
    naiveBayesTrainedOnYourAccepted: "نموذج Naive Bayes مدرَّب على التصنيفات التي قبلتها.",
    usedWhenInternalConfidenceFallsBelow: "يُستخدم عندما تنخفض الثقة الداخلية عن الحد.",
    settingsSaved: "تم حفظ الإعدادات",
    autopilotConfigurationUpdated: "تم تحديث إعدادات الطيار الآلي.",
    couldNotSave: "تعذّر الحفظ",
    pleaseTryAgain: "يرجى المحاولة مرة أخرى.",
    receiptAutopilot: "الطيار الآلي للإيصالات",
    failsafeActive: "الوضع الآمن مفعّل",
    internalClassifierWithOpenaiFallbackThe:
      "مصنّف داخلي مع بديل من OpenAI. يتعلم النظام من التصنيفات التي قبلتها ويرحّل تلقائيًا الإيصالات عالية الثقة إلى دفتر الأستاذ العام.",
    aiAccuracy: "دقة الذكاء الاصطناعي",
    overallAcceptanceRateAcrossAllClassifier:
      "معدل القبول الإجمالي عبر جميع طرق التصنيف. الحد: {thresholdPct}%.",
    acceptedRejected: "{totalAccepted} مقبول / {totalRejected} مرفوض",
    couldNotLoadClassifierStats: "تعذّر تحميل إحصاءات المصنّف:",
    internalClassifierAccuracyIsBelowThe:
      "دقة المصنّف الداخلي ({accuracyPct}%) أقل من الحد {thresholdPct}% — وقد تم تحويل هذه الشركة تلقائيًا إلى وضع OpenAI فقط. أعد الوضع الهجين أدناه متى توفرت لديك بيانات تدريب أكثر.",
    noReceiptsClassifiedYetUploadReceipts:
      "لم تُصنَّف إيصالات بعد. ارفع إيصالات لبدء تدريب النموذج.",
    fallback: "البديل",
    judged: "{value} محكوم عليه",
    total: "الإجمالي {totalPredictions}",
    autopilotSettings: "إعدادات الطيار الآلي",
    hybridModeRunsTheInternalClassifier:
      "يشغّل الوضع الهجين المصنّف الداخلي أولًا؛ ولا يُستخدم OpenAI إلا كبديل.",
    autoPostHighConfidenceReceipts: "الترحيل التلقائي للإيصالات عالية الثقة",
    whenEnabledReceiptsMatchingARule:
      "عند التفعيل، تُرحَّل إلى دفتر الأستاذ العام دون مراجعة المستخدم الإيصالات المطابقة لقاعدة لها 5 قبولات أو أكثر وثقة تساوي حد الترحيل التلقائي أو تزيد عليه.",
    autoPostConfidenceThreshold: "حد الثقة للترحيل التلقائي",
    minimumClassificationConfidenceBeforeAReceipt:
      "الحد الأدنى لثقة التصنيف قبل أن يُرحَّل الإيصال دون مراجعة (80–99%). وأدنى منه تنتظر الإيصالات في قائمة المراجعة.",
    hybridModeRecommended: "الوضع الهجين (موصى به)",
    offBypassTheInternalClassifierAnd: "إيقاف ← تجاوز المصنّف الداخلي واستخدام OpenAI لكل إيصال.",
  }
);
