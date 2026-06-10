import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { z } from "zod";

export function registerOnboardingRoutes(app: Express) {
  // =====================================
  // USER ONBOARDING
  // =====================================

  // Get user onboarding progress
  app.get("/api/onboarding", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
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
  }));

  // Update onboarding progress
  app.patch("/api/onboarding", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;

    // Calculate current step based on completed steps
    const data = req.body;
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

    const onboarding = await storage.updateUserOnboarding(userId, {
      ...data,
      currentStep,
      isOnboardingComplete: isComplete,
      completedAt: isComplete ? new Date() : undefined,
    });

    res.json(onboarding);
  }));

  // Complete onboarding step
  app.post("/api/onboarding/complete-step", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;

    const validationSchema = z.object({
      step: z.enum(['welcome', 'company', 'accounts', 'invoice', 'receipt', 'reports', 'ai', 'reminders']),
    });

    const validated = validationSchema.parse(req.body);
    const { step } = validated;

    const stepMap: Record<string, string> = {
      welcome: 'hasCompletedWelcome',
      company: 'hasCreatedCompany',
      accounts: 'hasSetupChartOfAccounts',
      invoice: 'hasCreatedFirstInvoice',
      receipt: 'hasUploadedFirstReceipt',
      reports: 'hasViewedReports',
      ai: 'hasExploredAI',
      reminders: 'hasConfiguredReminders',
    };

    const field = stepMap[step];
    if (!field) {
      return res.status(400).json({ message: 'Invalid step' });
    }

    const existingOnboarding = await storage.getUserOnboarding(userId);
    if (!existingOnboarding) {
      return res.status(404).json({ message: 'Onboarding not found' });
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
  }));

  // Dismiss tip
  app.post("/api/onboarding/dismiss-tip", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;

    // Validate input
    const validationSchema = z.object({
      tipId: z.string().min(1, 'Tip ID is required'),
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
  }));

  // Get help tips for page
  app.get("/api/help-tips", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { page } = req.query;
    const userId = (req as any).user?.id;

    const onboarding = await storage.getUserOnboarding(userId);
    const dismissedTips = onboarding?.dismissedTips ? JSON.parse(onboarding.dismissedTips) : [];

    let tips;
    if (page) {
      tips = await storage.getHelpTipsByPage(page as string);
    } else {
      tips = await storage.getAllHelpTips();
    }

    // Filter out dismissed tips
    tips = tips.filter(tip => !dismissedTips.includes(tip.tipKey));

    res.json({ tips, showTips: onboarding?.showTips ?? true });
  }));
}
