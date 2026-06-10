import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { z } from "zod";

export function registerFeedbackRoutes(app: Express) {
  // =====================================
  // USER FEEDBACK
  // =====================================

  // Submit feedback
  app.post("/api/feedback", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;

    // Validate input with comprehensive schema
    const validationSchema = z.object({
      feedbackType: z.enum(['bug', 'feature_request', 'improvement', 'praise', 'other']),
      category: z.string().max(50).optional().nullable(),
      pageContext: z.string().max(500).optional().nullable(),
      rating: z.number().int().min(1).max(5).optional().nullable(),
      title: z.string().max(200).optional().nullable(),
      message: z.string().min(10, 'Message must be at least 10 characters').max(5000),
      allowContact: z.boolean().default(true),
      contactEmail: z.string().email('Invalid email format').optional().nullable(),
    });

    const validated = validationSchema.parse(req.body);

    const feedback = await storage.createUserFeedback({
      userId,
      feedbackType: validated.feedbackType,
      category: validated.category,
      pageContext: validated.pageContext,
      rating: validated.rating,
      title: validated.title,
      message: validated.message,
      status: 'new',
      allowContact: validated.allowContact,
      contactEmail: validated.contactEmail,
    });

    res.json(feedback);
  }));

  // Get user's feedback
  app.get("/api/feedback", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const feedback = await storage.getUserFeedback(userId);
    res.json(feedback);
  }));
}
