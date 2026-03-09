import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { z } from "zod";
import crypto from "crypto";

export function registerReferralRoutes(app: Express) {
  // =====================================
  // REFERRAL SYSTEM
  // =====================================

  // Get user's referral code
  app.get("/api/referral/my-code", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    let referralCode = await storage.getReferralCodeByUserId(userId);

    // Auto-generate referral code if not exists
    if (!referralCode) {
      const code = `REF-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      referralCode = await storage.createReferralCode({
        userId,
        code,
        isActive: true,
        referrerRewardType: 'credit',
        referrerRewardValue: 50, // AED 50 credit
        refereeRewardType: 'discount',
        refereeRewardValue: 20, // 20% discount
        totalReferrals: 0,
        successfulReferrals: 0,
        totalRewardsEarned: 0,
      });
    }

    res.json(referralCode);
  }));

  // Get referral stats
  app.get("/api/referral/stats", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const referralCode = await storage.getReferralCodeByUserId(userId);
    const referrals = await storage.getReferralsByReferrerId(userId);

    const stats = {
      code: referralCode?.code || null,
      totalReferrals: referralCode?.totalReferrals || 0,
      successfulReferrals: referralCode?.successfulReferrals || 0,
      pendingReferrals: referrals.filter(r => r.status === 'pending' || r.status === 'signed_up').length,
      totalRewardsEarned: referralCode?.totalRewardsEarned || 0,
      recentReferrals: referrals.slice(0, 10),
    };

    res.json(stats);
  }));

  // Validate referral code (for signup)
  app.get("/api/referral/validate/:code", asyncHandler(async (req: Request, res: Response) => {
    const { code } = req.params;
    const referralCode = await storage.getReferralCodeByCode(code);

    if (!referralCode || !referralCode.isActive) {
      return res.status(404).json({ valid: false, message: 'Invalid or expired referral code' });
    }

    if (referralCode.expiresAt && new Date(referralCode.expiresAt) < new Date()) {
      return res.status(400).json({ valid: false, message: 'Referral code has expired' });
    }

    res.json({
      valid: true,
      discount: referralCode.refereeRewardValue,
      discountType: referralCode.refereeRewardType,
    });
  }));

  // Track referral signup
  app.post("/api/referral/track-signup", asyncHandler(async (req: Request, res: Response) => {
    // Validate input
    const validationSchema = z.object({
      code: z.string().min(1, 'Referral code is required'),
      refereeEmail: z.string().email('Invalid email address'),
      source: z.string().optional(),
    });

    const validated = validationSchema.parse(req.body);
    const { code, refereeEmail, source } = validated;

    const referralCode = await storage.getReferralCodeByCode(code);
    if (!referralCode || !referralCode.isActive) {
      return res.status(400).json({ message: 'Invalid referral code' });
    }

    // Create referral record
    const referral = await storage.createReferral({
      referralCodeId: referralCode.id,
      referrerId: referralCode.userId,
      refereeEmail,
      status: 'pending',
      signupSource: source || 'link',
      referrerRewardStatus: 'pending',
      refereeRewardStatus: 'pending',
      referrerRewardAmount: referralCode.referrerRewardValue,
      refereeRewardAmount: referralCode.refereeRewardValue,
    });

    // Update referral code stats
    await storage.updateReferralCode(referralCode.id, {
      totalReferrals: (referralCode.totalReferrals || 0) + 1,
    });

    // Notify referrer
    await storage.createNotification({
      userId: referralCode.userId,
      type: 'referral',
      title: 'New Referral Signup!',
      message: `Someone signed up using your referral code. They'll need to complete a qualifying action for you to earn your reward.`,
      priority: 'normal',
      actionUrl: '/referrals',
    });

    res.json(referral);
  }));
}
