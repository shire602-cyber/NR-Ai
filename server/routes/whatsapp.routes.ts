import { type Express, type Request, type Response } from 'express';
import { storage } from '../storage';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { createLogger } from '../config/logger';

const log = createLogger('whatsapp');

/**
 * WhatsApp Routes (Personal WhatsApp via wa.me links)
 *
 * Messages are sent by opening wa.me links on the client side.
 * The backend only logs messages for history/tracking.
 */
export function registerWhatsAppRoutes(app: Express): void {

  // Log a message that was sent via wa.me link
  app.post("/api/integrations/whatsapp/log-message", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { to, message } = req.body;
    if (!to || !message) {
      return res.status(400).json({ message: 'Phone number and message are required' });
    }

    const companies = await storage.getCompaniesByUserId(userId);
    if (companies.length === 0) {
      return res.status(404).json({ message: 'No company found' });
    }

    const companyId = companies[0].id;

    const waMessageId = `personal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const logged = await storage.createWhatsappMessage({
      companyId,
      waMessageId,
      from: 'personal',
      to: String(to).trim(),
      messageType: 'text',
      content: String(message).slice(0, 5000),
      direction: 'outbound',
      status: 'sent',
    });

    log.info(`WhatsApp message logged for company ${companyId} to ${to}`);
    res.json({ success: true, id: logged.id });
  }));

  // Get WhatsApp message history
  app.get("/api/integrations/whatsapp/messages", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const companies = await storage.getCompaniesByUserId(userId);
    if (companies.length === 0) {
      return res.status(404).json({ message: 'No company found' });
    }

    const companyId = companies[0].id;
    const messages = await storage.getWhatsappMessagesByCompanyId(companyId);
    res.json(messages);
  }));

  // Get WhatsApp config — always return configured:true since personal WhatsApp needs no setup
  app.get("/api/integrations/whatsapp/config", authMiddleware, asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      configured: true,
      isActive: true,
      mode: 'personal',
    });
  }));

  // Get WhatsApp integration status (for dashboard/integrations page)
  app.get("/api/integrations/whatsapp/status", authMiddleware, asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      connected: true,
      configured: true,
      mode: 'personal',
    });
  }));

  // Save WhatsApp reminder rules (stored per company via admin settings)
  app.post("/api/integrations/whatsapp/save-rules", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { rules } = req.body;
    if (!Array.isArray(rules)) {
      return res.status(400).json({ message: 'Rules must be an array' });
    }

    const companies = await storage.getCompaniesByUserId(userId);
    if (companies.length === 0) {
      return res.status(404).json({ message: 'No company found' });
    }

    const companyId = companies[0].id;

    // Store rules as a JSON setting (upsert)
    const key = `whatsapp.rules.${companyId}`;
    const existing = await storage.getAdminSettingByKey(key);
    if (existing) {
      await storage.updateAdminSetting(key, JSON.stringify(rules));
    } else {
      await storage.createAdminSetting({ key, value: JSON.stringify(rules), category: 'whatsapp' });
    }

    log.info(`WhatsApp rules saved for company ${companyId}`);
    res.json({ success: true });
  }));

  // Get WhatsApp reminder rules
  app.get("/api/integrations/whatsapp/rules", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const companies = await storage.getCompaniesByUserId(userId);
    if (companies.length === 0) {
      return res.status(404).json({ message: 'No company found' });
    }

    const companyId = companies[0].id;
    const setting = await storage.getAdminSettingByKey(`whatsapp.rules.${companyId}`);

    if (setting) {
      try {
        const rules = JSON.parse(setting.value);
        return res.json({ rules });
      } catch {
        return res.json({ rules: [] });
      }
    }

    res.json({ rules: [] });
  }));
}
