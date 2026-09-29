import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "TrustSecurity",
  {
    authenticatedAccess: "Authenticated access",
    customerWorkspacesRequireSignedInAccess:
      "Customer workspaces require signed-in access, scoped company membership, and role-aware route checks.",
    secureSessions: "Secure sessions",
    sessionHandlingUsesHttponlyCookiesToken:
      "Session handling uses httpOnly cookies, token revocation, CSRF protection for cookie requests, and startup secret validation.",
    dataProtectionControls: "Data protection controls",
    sensitiveOperationalSettingsAreSeparatedFrom:
      "Sensitive operational settings are separated from the public app surface, with encrypted transport expected in production.",
    auditability: "Auditability",
    accountingActionsAreDesignedAroundTraceable:
      "Accounting actions are designed around traceable records, period locks, retention rules, and exportable supporting schedules.",
    publishFormalUptimeAndIncidentResponse:
      "Publish formal uptime and incident-response history after launch traffic is measurable.",
    completeExternalPenetrationTestingAfterThe:
      "Complete external penetration testing after the launch environment is frozen.",
    prepareSoc2Iso27001Readiness:
      "Prepare SOC 2 / ISO 27001 readiness evidence once operational controls have live history.",
    expandDataProcessingAndResidencyDocumentation:
      "Expand data-processing and residency documentation for enterprise customers.",
    releaseGates: "Release gates",
    typeCheckUnitTestsApiContract:
      "Type-check, unit tests, API contract checks, dependency audit, and production build run before release promotion.",
    productionSmoke: "Production smoke",
    readOnlySmokeChecksCoverLiveness:
      "Read-only smoke checks cover liveness, readiness, deployed version, and OAuth-provider response on the production URL.",
    protectedRouteCrawl: "Protected-route crawl",
    authenticatedFirmRouteSmokeIsSupported:
      "Authenticated firm-route smoke is supported with dedicated smoke credentials and recorded as internal release evidence.",
    backupAndRestoreProof: "Backup and restore proof",
    theApplicationBackupFlowCreatesChecksum:
      "The application backup flow creates checksum-verified snapshots, restore previews, transactional restores, and a pre-restore safety backup. Operational backup cadence is confirmed for each production environment.",
    incidentProcess: "Incident process",
    theResponseChecklistCoversContainmentAudit:
      "The response checklist covers containment, audit-log review, key/API-token rotation, recovery from backup when integrity is in question, and UAE PDPL notification review.",
    privacyAndDpaPosture: "Privacy and DPA posture",
    thePrivacyPolicyIsPublicEnterprise:
      "The Privacy Policy is public. Enterprise DPA and security-questionnaire review is handled during onboarding while a standard downloadable DPA pack is prepared.",
    pricing: "Pricing",
    help: "Help",
    migrate: "Migrate",
    startFree: "Start Free",
    trustAndSecurity: "Trust and Security",
    builtForCautiousUaeFinanceTeams:
      "Built for cautious UAE finance teams, with claims kept honest.",
    muhasibAiProtectsAccountingWorkflowsWith:
      "Muhasib.ai protects accounting workflows with access controls, secure sessions, auditable records, and a clear roadmap toward third-party assurance. We do not claim SOC 2, ISO 27001, or FTA accreditation until those reviews are complete.",
    launchPosture: "Launch posture",
    highCriticalProductionDependencyAuditGate:
      "High/critical production dependency audit gate is part of release.",
    automatedTestBuildTypeCheckAnd:
      "Automated test, build, type-check, and migration-secret gates run locally.",
    externalCertificationsAreRoadmapItemsNot:
      "External certifications are roadmap items, not current claims.",
    launchVerificationEvidence: "Launch verification evidence",
    releaseEvidenceIsKeptPracticalAutomated:
      "Release evidence is kept practical: automated gates, production health checks, and authenticated route crawls for protected firm workflows when smoke credentials are available.",
    internalReleaseGate: "Internal release gate",
    operationalTrustPosture: "Operational trust posture",
    thePublicPostureSeparatesWorkingProduct:
      "The public posture separates working product controls from environment-specific operating procedures and future certifications.",
    supportCommitmentsDuringLaunch: "Support commitments during launch",
    paidLaunchCustomersGetGuidedOnboarding:
      "Paid launch customers get guided onboarding, implementation checklists, and support through the onboarding team. Formal enterprise support commitments are confirmed during setup based on the active hosting and support configuration.",
    whatCustomersCanExpect: "What customers can expect",
    guidedCompanySetupAndChartOf: "Guided company setup and chart-of-accounts review.",
    migrationSupportFromMazeedWafeqZoho:
      "Migration support from mazeed, Wafeq, Zoho Books, or Excel exports.",
    escalationPathForAccountingWorkflowBlockers:
      "Escalation path for accounting workflow blockers during onboarding.",
    securityAndDataProcessingQuestionsAnswered:
      "Security and data-processing questions answered before enterprise activation.",
    assuranceRoadmap: "Assurance roadmap",
    visitHelpCenter: "Visit Help Center",
    migrationGuides: "Migration Guides",
    privacyPolicy: "Privacy Policy",
  },
  {
    authenticatedAccess: "وصول موثَّق",
    customerWorkspacesRequireSignedInAccess:
      "تتطلب مساحات عمل العملاء تسجيل الدخول وعضوية شركة محددة النطاق وفحوصات مسارات مراعية للأدوار.",
    secureSessions: "جلسات آمنة",
    sessionHandlingUsesHttponlyCookiesToken:
      "تستخدم معالجة الجلسات ملفات تعريف ارتباط httpOnly وإبطال الرموز وحماية CSRF لطلبات ملفات الارتباط والتحقق من الأسرار عند بدء التشغيل.",
    dataProtectionControls: "ضوابط حماية البيانات",
    sensitiveOperationalSettingsAreSeparatedFrom:
      "تُفصل الإعدادات التشغيلية الحساسة عن واجهة التطبيق العامة، مع توقع النقل المشفّر في بيئة الإنتاج.",
    auditability: "قابلية التدقيق",
    accountingActionsAreDesignedAroundTraceable:
      "صُمّمت الإجراءات المحاسبية حول سجلات قابلة للتتبع وأقفال الفترات وقواعد الاحتفاظ وجداول داعمة قابلة للتصدير.",
    publishFormalUptimeAndIncidentResponse:
      "نشر سجل رسمي لوقت التشغيل والاستجابة للحوادث بعد أن تصبح حركة الإطلاق قابلة للقياس.",
    completeExternalPenetrationTestingAfterThe: "إجراء اختبار اختراق خارجي بعد تجميد بيئة الإطلاق.",
    prepareSoc2Iso27001Readiness:
      "إعداد أدلة الجاهزية لـ SOC 2 / ISO 27001 بمجرد أن يصبح لدى الضوابط التشغيلية سجل تشغيل فعلي.",
    expandDataProcessingAndResidencyDocumentation:
      "توسيع وثائق معالجة البيانات وموقع الاستضافة لعملاء المؤسسات.",
    releaseGates: "بوابات الإصدار",
    typeCheckUnitTestsApiContract:
      "تُنفَّذ فحوصات الأنواع واختبارات الوحدات وفحوصات عقد الواجهة البرمجية وتدقيق الاعتماديات وبناء الإنتاج قبل ترقية الإصدار.",
    productionSmoke: "فحص الإنتاج السريع",
    readOnlySmokeChecksCoverLiveness:
      "تغطي الفحوصات السريعة للقراءة فقط الجاهزية والاستعداد والإصدار المنشور واستجابة موفّر OAuth على رابط الإنتاج.",
    protectedRouteCrawl: "زحف المسارات المحمية",
    authenticatedFirmRouteSmokeIsSupported:
      "يُدعم الفحص السريع لمسارات المكتب الموثَّقة ببيانات دخول مخصصة للفحص ويُسجَّل كدليل إصدار داخلي.",
    backupAndRestoreProof: "إثبات النسخ الاحتياطي والاستعادة",
    theApplicationBackupFlowCreatesChecksum:
      "ينشئ مسار النسخ الاحتياطي في التطبيق لقطات موثَّقة بمجموع تحقق ومعاينات استعادة واستعادات معاملاتية ونسخة أمان قبل الاستعادة. ويتم تأكيد وتيرة النسخ الاحتياطي التشغيلية لكل بيئة إنتاج.",
    incidentProcess: "عملية الحوادث",
    theResponseChecklistCoversContainmentAudit:
      "تغطي قائمة الاستجابة الاحتواء ومراجعة سجل التدقيق وتدوير المفاتيح ورموز الواجهة البرمجية والاسترداد من النسخة الاحتياطية عند الشك في السلامة ومراجعة الإخطار وفق قانون حماية البيانات الشخصية في الإمارات.",
    privacyAndDpaPosture: "موقف الخصوصية واتفاقية معالجة البيانات",
    thePrivacyPolicyIsPublicEnterprise:
      "سياسة الخصوصية متاحة للعموم. وتُعالج مراجعة اتفاقية معالجة البيانات واستبيانات الأمان لعملاء المؤسسات أثناء التهيئة ريثما تُعدّ حزمة اتفاقية قياسية قابلة للتنزيل.",
    pricing: "الأسعار",
    help: "المساعدة",
    migrate: "الانتقال",
    startFree: "ابدأ مجانًا",
    trustAndSecurity: "الثقة والأمان",
    builtForCautiousUaeFinanceTeams:
      "مصمم للفرق المالية الحذرة في الإمارات، مع الحفاظ على صدق الادعاءات.",
    muhasibAiProtectsAccountingWorkflowsWith:
      "تحمي Muhasib.ai مسارات العمل المحاسبية بضوابط الوصول والجلسات الآمنة والسجلات القابلة للتدقيق وخارطة طريق واضحة نحو التوكيد من طرف ثالث. ولا ندّعي حصولنا على SOC 2 أو ISO 27001 أو اعتماد الهيئة الاتحادية للضرائب حتى تكتمل تلك المراجعات.",
    launchPosture: "موقف الإطلاق",
    highCriticalProductionDependencyAuditGate:
      "بوابة تدقيق اعتماديات الإنتاج عالية الخطورة/الحرجة جزء من الإصدار.",
    automatedTestBuildTypeCheckAnd:
      "تُنفَّذ محليًا بوابات الاختبار الآلي والبناء وفحص الأنواع وأسرار الترحيلات.",
    externalCertificationsAreRoadmapItemsNot:
      "الشهادات الخارجية بنود في خارطة الطريق وليست ادعاءات حالية.",
    launchVerificationEvidence: "أدلة التحقق عند الإطلاق",
    releaseEvidenceIsKeptPracticalAutomated:
      "تُحفظ أدلة الإصدار بصورة عملية: بوابات آلية وفحوصات صحة الإنتاج وزحف مسارات موثَّق للمسارات المحمية الخاصة بالمكاتب عند توفر بيانات الفحص.",
    internalReleaseGate: "بوابة الإصدار الداخلية",
    operationalTrustPosture: "موقف الثقة التشغيلي",
    thePublicPostureSeparatesWorkingProduct:
      "يفصل الموقف المعلن بين ضوابط المنتج العاملة وإجراءات التشغيل الخاصة بكل بيئة والشهادات المستقبلية.",
    supportCommitmentsDuringLaunch: "التزامات الدعم أثناء الإطلاق",
    paidLaunchCustomersGetGuidedOnboarding:
      "يحصل عملاء الإطلاق المدفوعون على تهيئة موجَّهة وقوائم تنفيذ ودعم عبر فريق التهيئة. وتُؤكَّد التزامات الدعم الرسمية للمؤسسات أثناء الإعداد بحسب إعدادات الاستضافة والدعم الفعلية.",
    whatCustomersCanExpect: "ما يمكن للعملاء توقعه",
    guidedCompanySetupAndChartOf: "إعداد موجَّه للشركة ومراجعة دليل الحسابات.",
    migrationSupportFromMazeedWafeqZoho:
      "دعم الانتقال من mazeed أو Wafeq أو Zoho Books أو ملفات Excel المصدَّرة.",
    escalationPathForAccountingWorkflowBlockers:
      "مسار تصعيد لعوائق المسارات المحاسبية أثناء التهيئة.",
    securityAndDataProcessingQuestionsAnswered:
      "الإجابة عن أسئلة الأمان ومعالجة البيانات قبل تفعيل حسابات المؤسسات.",
    assuranceRoadmap: "خارطة طريق التوكيد",
    visitHelpCenter: "زيارة مركز المساعدة",
    migrationGuides: "أدلة الانتقال",
    privacyPolicy: "سياسة الخصوصية",
  }
);
