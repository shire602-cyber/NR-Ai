import type { Express, Request, Response } from "express";
import { onboardingPatchBody } from "../../shared/validators/route-bodies";
import { parsedBody } from "../http/parsed-body";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { z } from "zod";
import { requirePermission } from "../middleware/companyRolePolicy";
import { strictBody } from "../http/strict-body";
import { pq } from "../services/connectors/pq";
import { COA_TEMPLATES, validateTrnFormat } from "../services/migration-import/coa-templates";
import { onboardingProgressBody, type OnboardingProgressBody } from "../../shared/validators/plans";
import { zUuid } from "../../shared/validators/primitives";

async function readOnboardingProgress(companyId: string) {
  const { rows } = await pq<{
    step: string | null;
    first_task: string | null;
    starting_point: string | null;
    industry: string | null;
    cutover_date: string | Date | null;
    dismissed_getting_started: boolean;
    updated_at: Date | string | null;
  }>(
    `SELECT step, first_task, starting_point, industry, to_char(cutover_date, 'YYYY-MM-DD') AS cutover_date,
            dismissed_getting_started, updated_at
       FROM company_onboarding_progress WHERE company_id = $1`,
    [companyId]
  );
  const row = rows[0];
  return {
    companyId,
    step: row?.step ?? null,
    firstTask: row?.first_task ?? null,
    startingPoint: row?.starting_point ?? null,
    industry: row?.industry ?? null,
    cutoverDate: row?.cutover_date ? String(row.cutover_date) : null,
    dismissedGettingStarted: row?.dismissed_getting_started === true,
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

type OnboardingPatch = z.output<typeof onboardingPatchBody> & {
  showTour?: boolean;
  tourDismissedAt?: Date;
};

export function registerOnboardingRoutes(app: Express) {
  // =====================================
  // USER ONBOARDING
  // =====================================

  // Get user onboarding progress
  app.get(
    "/api/onboarding",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      let onboarding = await storage.getUserOnboarding(userId);

      // Create default onboarding if not exists
      if (!onboarding) {
        onboarding = await storage.createUserOnboarding({
          userId,
          hasCompletedWelcome: false,
          hasCreatedCompany: false,
          hasSetupChartOfAccounts: false,
          hasCreatedFirstInvoice: false,
          hasUploadedFirstReceipt: false,
          hasViewedReports: false,
          hasExploredAI: false,
          hasConfiguredReminders: false,
          currentStep: 0,
          totalSteps: 8,
          isOnboardingComplete: false,
          showTips: true,
          showTour: true,
        });
      }

      res.json(onboarding);
    })
  );

  // Update onboarding progress
  app.patch(
    "/api/onboarding",
    authMiddleware,
    strictBody(onboardingPatchBody),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;

      // Calculate current step based on completed steps
      const { tourDismissed, ...data } = parsedBody<OnboardingPatch>(req);
      // R18-03: the welcome tour records a one-time, server-side dismissal.
      if (tourDismissed === true) {
        data.showTour = false;
        data.tourDismissedAt = new Date();
      }
      let currentStep = 0;
      if (data.hasCompletedWelcome) currentStep = 1;
      if (data.hasCreatedCompany) currentStep = 2;
      if (data.hasSetupChartOfAccounts) currentStep = 3;
      if (data.hasCreatedFirstInvoice) currentStep = 4;
      if (data.hasUploadedFirstReceipt) currentStep = 5;
      if (data.hasViewedReports) currentStep = 6;
      if (data.hasExploredAI) currentStep = 7;
      if (data.hasConfiguredReminders) currentStep = 8;

      const isComplete = currentStep >= 8;

      // A preference-only patch (e.g. tour dismissal) must not recompute, and
      // therefore reset, the step progress from a body that carries no steps.
      const touchesSteps = Object.keys(data).some((key) => key.startsWith("has"));
      const onboarding = await storage.updateUserOnboarding(userId, {
        ...data,
        ...(touchesSteps
          ? {
              currentStep,
              isOnboardingComplete: isComplete,
              completedAt: isComplete ? new Date() : undefined,
            }
          : {}),
      });

      res.json(onboarding);
    })
  );

  // Complete onboarding step
  app.post(
    "/api/onboarding/complete-step",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;

      const validationSchema = z.object({
        step: z.enum([
          "welcome",
          "company",
          "accounts",
          "invoice",
          "receipt",
          "reports",
          "ai",
          "reminders",
        ]),
      });

      const validated = validationSchema.parse(req.body);
      const { step } = validated;

      const stepMap: Record<string, string> = {
        welcome: "hasCompletedWelcome",
        company: "hasCreatedCompany",
        accounts: "hasSetupChartOfAccounts",
        invoice: "hasCreatedFirstInvoice",
        receipt: "hasUploadedFirstReceipt",
        reports: "hasViewedReports",
        ai: "hasExploredAI",
        reminders: "hasConfiguredReminders",
      };

      const field = stepMap[step];
      if (!field) {
        return res.status(400).json({ message: "Invalid step" });
      }

      const existingOnboarding = await storage.getUserOnboarding(userId);
      if (!existingOnboarding) {
        return res.status(404).json({ message: "Onboarding not found" });
      }

      const updatedData = {
        ...existingOnboarding,
        [field]: true,
      };

      let currentStep = 0;
      if (updatedData.hasCompletedWelcome) currentStep++;
      if (updatedData.hasCreatedCompany) currentStep++;
      if (updatedData.hasSetupChartOfAccounts) currentStep++;
      if (updatedData.hasCreatedFirstInvoice) currentStep++;
      if (updatedData.hasUploadedFirstReceipt) currentStep++;
      if (updatedData.hasViewedReports) currentStep++;
      if (updatedData.hasExploredAI) currentStep++;
      if (updatedData.hasConfiguredReminders) currentStep++;

      const isComplete = currentStep >= 8;

      const onboarding = await storage.updateUserOnboarding(userId, {
        [field]: true,
        currentStep,
        isOnboardingComplete: isComplete,
        completedAt: isComplete ? new Date() : undefined,
      });

      res.json(onboarding);
    })
  );

  // Dismiss tip
  app.post(
    "/api/onboarding/dismiss-tip",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;

      // Validate input
      const validationSchema = z.object({
        tipId: z.string().min(1, "Tip ID is required"),
      });

      const validated = validationSchema.parse(req.body);
      const { tipId } = validated;

      const onboarding = await storage.getUserOnboarding(userId);
      const dismissedTips = onboarding?.dismissedTips ? JSON.parse(onboarding.dismissedTips) : [];

      if (!dismissedTips.includes(tipId)) {
        dismissedTips.push(tipId);
      }

      const updated = await storage.updateUserOnboarding(userId, {
        dismissedTips: JSON.stringify(dismissedTips),
      });

      res.json(updated);
    })
  );

  // ─── W5-B (R19-18): guided setup — COA template by industry, TRN check, import ──

  app.get("/api/onboarding/coa-templates", authMiddleware, (_req: Request, res: Response) => {
    res.json(COA_TEMPLATES.map((t) => ({ id: t.id, label: t.label, accounts: t.accounts.length })));
  });

  const coaTemplateBody = z.object({ templateId: z.string().min(1).max(50) }).strict();
  app.post(
    "/api/companies/:companyId/onboarding/coa-template",
    authMiddleware,
    requirePermission("settings.company"),
    strictBody(coaTemplateBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { templateId } = parsedBody<z.output<typeof coaTemplateBody>>(req);
      const template = COA_TEMPLATES.find((t) => t.id === templateId);
      if (!template) {
        return res.status(400).json({ message: "Unknown template", code: "UNKNOWN_TEMPLATE" });
      }
      let added = 0;
      for (const acct of template.accounts) {
        const { rowCount } = await pq(
          `INSERT INTO accounts (company_id, code, name_en, name_ar, type, sub_type, is_active, is_system_account)
           SELECT $1, $2, $3, $4, $5, $6, true, false
            WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE company_id = $1 AND code = $2)`,
          [req.params.companyId, acct.code, acct.nameEn, acct.nameAr, acct.type, acct.subType]
        );
        added += rowCount;
      }
      res.json({ templateId, added, skipped: template.accounts.length - added });
    })
  );

  // WQ7 (1.10): the company setup wizard's progress lives on the server, so the step, the first
  // task, the starting point, the industry chart and the go-live date survive a device change.
  app.get(
    "/api/companies/:companyId/onboarding/progress",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      if (!zUuid.safeParse(companyId).success) {
        return res.status(404).json({ message: "Company not found", code: "NOT_FOUND" });
      }
      if (!(await storage.hasCompanyAccess(req.user!.id, companyId))) {
        return res.status(404).json({ message: "Company not found", code: "NOT_FOUND" });
      }
      res.json(await readOnboardingProgress(companyId));
    })
  );

  app.put(
    "/api/companies/:companyId/onboarding/progress",
    authMiddleware,
    requirePermission("settings.company"),
    strictBody(onboardingProgressBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const body = parsedBody<OnboardingProgressBody>(req);
      const has = (k: keyof OnboardingProgressBody) => body[k] !== undefined;
      await pq(
        `INSERT INTO company_onboarding_progress
                (company_id, step, first_task, starting_point, industry, cutover_date,
                 dismissed_getting_started, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::date, COALESCE($7, false), $8, now())
         ON CONFLICT (company_id) DO UPDATE SET
           step = CASE WHEN $9 THEN EXCLUDED.step ELSE company_onboarding_progress.step END,
           first_task = CASE WHEN $10 THEN EXCLUDED.first_task ELSE company_onboarding_progress.first_task END,
           starting_point = CASE WHEN $11 THEN EXCLUDED.starting_point ELSE company_onboarding_progress.starting_point END,
           industry = CASE WHEN $12 THEN EXCLUDED.industry ELSE company_onboarding_progress.industry END,
           cutover_date = CASE WHEN $13 THEN EXCLUDED.cutover_date ELSE company_onboarding_progress.cutover_date END,
           dismissed_getting_started = CASE WHEN $14 THEN EXCLUDED.dismissed_getting_started
                                            ELSE company_onboarding_progress.dismissed_getting_started END,
           updated_by = $8, updated_at = now()`,
        [
          companyId,
          body.step ?? null,
          body.firstTask ?? null,
          body.startingPoint ?? null,
          body.industry ?? null,
          body.cutoverDate ?? null,
          body.dismissedGettingStarted ?? null,
          req.user!.id,
          has("step"),
          has("firstTask"),
          has("startingPoint"),
          has("industry"),
          has("cutoverDate"),
          has("dismissedGettingStarted"),
        ]
      );
      res.json(await readOnboardingProgress(companyId));
    })
  );

  // Format check only: verifying a TRN against the FTA register needs FTA access (external).
  const trnBody = z.object({ trn: z.string().max(40) }).strict();
  app.post(
    "/api/onboarding/validate-trn",
    authMiddleware,
    strictBody(trnBody),
    asyncHandler(async (req: Request, res: Response) => {
      const result = validateTrnFormat(parsedBody<z.output<typeof trnBody>>(req).trn);
      res.json({
        ...result,
        registryCheck: "requires_external",
        registryNote: "Confirm the TRN on the FTA EmaraTax TRN verification page.",
      });
    })
  );

  // Optional steps are derived from real data, not flags.
  app.get(
    "/api/onboarding/optional-steps",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      const { rows } = await pq<{
        company_id: string;
        trn: string | null;
        imports: string;
      }>(
        `SELECT c.id AS company_id, c.trn_vat_number AS trn,
                (SELECT count(*) FROM import_jobs j WHERE j.company_id = c.id AND j.status = 'committed') AS imports
           FROM company_users cu JOIN companies c ON c.id = cu.company_id
          WHERE cu.user_id = $1 ORDER BY cu.created_at ASC LIMIT 1`,
        [userId]
      );
      const row = rows[0];
      const trn = row?.trn ? validateTrnFormat(row.trn) : null;
      res.json({
        companyId: row?.company_id ?? null,
        importData: { done: Number(row?.imports ?? 0) > 0, href: "/import" },
        trn: { done: !!trn?.valid, value: row?.trn ?? null, reason: trn?.reason ?? null },
      });
    })
  );

  // Get help tips for page
  app.get(
    "/api/help-tips",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { page } = req.query;
      const userId = req.user!.id;

      const onboarding = await storage.getUserOnboarding(userId);
      const dismissedTips = onboarding?.dismissedTips ? JSON.parse(onboarding.dismissedTips) : [];

      let tips;
      if (page) {
        tips = await storage.getHelpTipsByPage(page as string);
      } else {
        tips = await storage.getAllHelpTips();
      }

      // Filter out dismissed tips
      tips = tips.filter((tip) => !dismissedTips.includes(tip.tipKey));

      res.json({ tips, showTips: onboarding?.showTips ?? true });
    })
  );
}
