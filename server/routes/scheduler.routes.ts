/**
 * Scheduler Admin Routes
 * ──────────────────────
 * Admin-only API endpoints for managing background jobs,
 * WhatsApp Web, message templates, and news translations.
 *
 * GET  /api/admin/scheduler/jobs      — List all scheduled jobs with status
 * POST /api/admin/scheduler/jobs/:name/trigger — Manually trigger a job
 * GET  /api/admin/scheduler/queue/stats — Get message queue statistics
 * GET  /api/admin/news/translations    — List unapproved translations
 * POST /api/admin/news/:id/translate   — Trigger translation for a news article
 * POST /api/admin/news/translations/:id/approve — Approve a translation
 * POST /api/admin/news/:id/distribute  — Send approved news to clients
 * GET  /api/admin/cross-sell/catalog    — Service catalog
 * GET  /api/admin/cross-sell/opportunities — Identify opportunities
 * GET  /api/admin/cross-sell/campaigns  — List campaigns
 * POST /api/admin/cross-sell/campaigns  — Create campaign
 * POST /api/admin/cross-sell/campaigns/:id/generate-messages — AI message generation
 * POST /api/admin/cross-sell/campaigns/:id/execute — Approve & send
 */

import type { Express, Request, Response } from 'express';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { getJobStatuses, triggerJob, getRegisteredJobNames } from '../scheduler/index';
import { getQueueStats } from '../services/messageQueue';
import { getWhatsAppWebState } from '../services/whatsappWeb';
import { storage } from '../storage';
import { createLogger } from '../config/logger';
import { mapLocaleToLanguage, cleanPhone } from '../utils/locale';

const log = createLogger('scheduler-routes');

export function registerSchedulerRoutes(app: Express) {
  // ── List all scheduled jobs ────────────────────────────────
  app.get('/api/admin/scheduler/jobs', authMiddleware, adminMiddleware, asyncHandler(async (_req: Request, res: Response) => {
    const jobs = await getJobStatuses();
    res.json(jobs);
  }));

  // ── Manually trigger a job ─────────────────────────────────
  app.post('/api/admin/scheduler/jobs/:name/trigger', authMiddleware, adminMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { name } = req.params;
    const result = await triggerJob(name);

    if (result.success) {
      log.info({ job: name, admin: (req as any).user?.email }, 'Job manually triggered by admin');
      res.json({ message: `Job '${name}' triggered successfully` });
    } else {
      res.status(404).json({ message: result.error });
    }
  }));

  // ── Get registered job names ───────────────────────────────
  app.get('/api/admin/scheduler/job-names', authMiddleware, adminMiddleware, asyncHandler(async (_req: Request, res: Response) => {
    const names = getRegisteredJobNames();
    res.json(names);
  }));

  // ── Message queue stats ────────────────────────────────────
  app.get('/api/admin/scheduler/queue/stats', authMiddleware, adminMiddleware, asyncHandler(async (_req: Request, res: Response) => {
    const stats = await getQueueStats();
    res.json(stats);
  }));

  // ── WhatsApp Web connection status ─────────────────────────
  app.get('/api/admin/whatsapp-web/status', authMiddleware, adminMiddleware, asyncHandler(async (_req: Request, res: Response) => {
    const state = getWhatsAppWebState();

    // Get DB session for daily counter
    const session = await storage.getWhatsappWebSession();
    if (session) {
      state.messagesSentToday = session.messagesSentToday;
      state.dailyLimit = session.dailyMessageLimit;
    }

    res.json(state);
  }));

  // ── WhatsApp Web QR code ───────────────────────────────────
  app.get('/api/admin/whatsapp-web/qr', authMiddleware, adminMiddleware, asyncHandler(async (_req: Request, res: Response) => {
    const state = getWhatsAppWebState();

    if (state.status === 'qr_ready' && state.qrCode) {
      // Generate QR code as data URL using the qrcode package
      const QRCode = await import('qrcode');
      const qrDataUrl = await QRCode.toDataURL(state.qrCode, {
        width: 300,
        margin: 2,
      });

      res.json({
        status: 'qr_ready',
        qrDataUrl,
        message: 'Scan this QR code with WhatsApp on your phone',
      });
    } else if (state.status === 'connected') {
      res.json({
        status: 'connected',
        phoneNumber: state.phoneNumber,
        pushName: state.pushName,
        message: 'WhatsApp Web is already connected',
      });
    } else {
      res.json({
        status: state.status,
        message: state.status === 'connecting' ? 'Connecting to WhatsApp...' : 'WhatsApp Web is not initialized',
      });
    }
  }));

  // ── Initialize/reconnect WhatsApp Web ──────────────────────
  app.post('/api/admin/whatsapp-web/connect', authMiddleware, adminMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { initWhatsAppWeb } = await import('../services/whatsappWeb');
    const state = getWhatsAppWebState();

    if (state.status === 'connected') {
      return res.json({ message: 'Already connected', status: 'connected' });
    }

    // Start connection in background (don't await — it takes time)
    initWhatsAppWeb().catch(err => {
      log.error({ error: err.message }, 'WhatsApp Web init failed');
    });

    log.info({ admin: (req as any).user?.email }, 'WhatsApp Web connection initiated by admin');
    res.json({ message: 'Connection initiated. Check /api/admin/whatsapp-web/qr for QR code.', status: 'connecting' });
  }));

  // ── Disconnect WhatsApp Web ────────────────────────────────
  app.post('/api/admin/whatsapp-web/disconnect', authMiddleware, adminMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { disconnectWhatsAppWeb } = await import('../services/whatsappWeb');
    await disconnectWhatsAppWeb();

    log.info({ admin: (req as any).user?.email }, 'WhatsApp Web disconnected by admin');
    res.json({ message: 'WhatsApp Web disconnected', status: 'disconnected' });
  }));

  // ── Send test WhatsApp message ─────────────────────────────
  app.post('/api/admin/whatsapp-web/test', authMiddleware, adminMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { sendWhatsAppWebMessage } = await import('../services/whatsappWeb');
    const { phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).json({ message: 'Phone number and message are required' });
    }

    const result = await sendWhatsAppWebMessage(phone, message);

    if (result.success) {
      log.info({ admin: (req as any).user?.email, phone }, 'Test WhatsApp message sent');
      res.json({ success: true, messageId: result.messageId });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  }));

  // ── Get message templates ──────────────────────────────────
  app.get('/api/admin/message-templates', authMiddleware, adminMiddleware, asyncHandler(async (_req: Request, res: Response) => {
    const templates = await storage.getAllMessageTemplates();
    res.json(templates);
  }));

  // ── Update a message template ──────────────────────────────
  app.put('/api/admin/message-templates/:id', authMiddleware, adminMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { body, subject, isActive } = req.body;

    const updated = await storage.updateMessageTemplate(id, {
      ...(body !== undefined && { body }),
      ...(subject !== undefined && { subject }),
      ...(isActive !== undefined && { isActive }),
    });

    log.info({ templateId: id, admin: (req as any).user?.email }, 'Message template updated');
    res.json(updated);
  }));

  // ── Create a message template ──────────────────────────────
  app.post('/api/admin/message-templates', authMiddleware, adminMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { name, category, language, body, subject, channel } = req.body;

    if (!name || !body) {
      return res.status(400).json({ message: 'Template name and body are required' });
    }

    const template = await storage.createMessageTemplate({
      name,
      category: category || 'general',
      language: language || 'en',
      body,
      subject,
      channel: channel || 'whatsapp',
    });

    log.info({ templateId: template.id, admin: (req as any).user?.email }, 'Message template created');
    res.json(template);
  }));

  // ── WhatsApp Web session settings ──────────────────────────
  app.get('/api/admin/whatsapp-web/settings', authMiddleware, adminMiddleware, asyncHandler(async (_req: Request, res: Response) => {
    const session = await storage.getWhatsappWebSession();
    if (!session) {
      return res.json({
        dailyMessageLimit: 100,
        messageDelayMs: 3000,
        businessHoursStart: 9,
        businessHoursEnd: 18,
        timezone: 'Asia/Dubai',
      });
    }
    res.json({
      dailyMessageLimit: session.dailyMessageLimit,
      messageDelayMs: session.messageDelayMs,
      businessHoursStart: session.businessHoursStart,
      businessHoursEnd: session.businessHoursEnd,
      timezone: session.timezone,
      messagesSentToday: session.messagesSentToday,
    });
  }));

  // ── Update WhatsApp Web session settings ───────────────────
  app.put('/api/admin/whatsapp-web/settings', authMiddleware, adminMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { dailyMessageLimit, messageDelayMs, businessHoursStart, businessHoursEnd } = req.body;

    // ── Input validation ──────────────────────────────────────
    const errors: string[] = [];
    if (dailyMessageLimit !== undefined) {
      if (typeof dailyMessageLimit !== 'number' || dailyMessageLimit < 1 || dailyMessageLimit > 1000) {
        errors.push('dailyMessageLimit must be a number between 1 and 1000');
      }
    }
    if (messageDelayMs !== undefined) {
      if (typeof messageDelayMs !== 'number' || messageDelayMs < 1000 || messageDelayMs > 30000) {
        errors.push('messageDelayMs must be between 1000 and 30000 (1-30 seconds)');
      }
    }
    if (businessHoursStart !== undefined) {
      if (typeof businessHoursStart !== 'number' || businessHoursStart < 0 || businessHoursStart > 23) {
        errors.push('businessHoursStart must be between 0 and 23');
      }
    }
    if (businessHoursEnd !== undefined) {
      if (typeof businessHoursEnd !== 'number' || businessHoursEnd < 1 || businessHoursEnd > 24) {
        errors.push('businessHoursEnd must be between 1 and 24');
      }
    }
    if (businessHoursStart !== undefined && businessHoursEnd !== undefined) {
      if (businessHoursStart >= businessHoursEnd) {
        errors.push('businessHoursStart must be less than businessHoursEnd');
      }
    }
    if (errors.length > 0) {
      return res.status(400).json({ message: 'Validation failed', errors });
    }

    await storage.updateWhatsappWebSession({
      ...(dailyMessageLimit !== undefined && { dailyMessageLimit }),
      ...(messageDelayMs !== undefined && { messageDelayMs }),
      ...(businessHoursStart !== undefined && { businessHoursStart }),
      ...(businessHoursEnd !== undefined && { businessHoursEnd }),
    });

    log.info({ admin: (req as any).user?.email }, 'WhatsApp Web settings updated');
    res.json({ message: 'Settings updated' });
  }));

  // ══════════════════════════════════════════════════════════
  // News Translation & Distribution
  // ──────────────────────────────────────────────────────────
  // IMPORTANT: Specific routes (/translations/pending, /translations/:id)
  // MUST be registered BEFORE parameterized routes (/news/:id)
  // to prevent Express from matching "translations" as an :id param.
  // ══════════════════════════════════════════════════════════

  // ── Get all news articles with translations ─────────────
  app.get('/api/admin/news', authMiddleware, adminMiddleware, asyncHandler(async (_req: Request, res: Response) => {
    const news = await storage.getRegulatoryNews();

    // Batch-load all translations in one query (avoid N+1)
    const allTranslations = await storage.getAllNewsTranslations();
    const translationsByNewsId = new Map<string, typeof allTranslations>();
    for (const t of allTranslations) {
      const arr = translationsByNewsId.get(t.newsId) || [];
      arr.push(t);
      translationsByNewsId.set(t.newsId, arr);
    }

    // Enrich with translation status
    const enriched = news.map((item) => {
      const translations = translationsByNewsId.get(item.id) || [];
      return {
        ...item,
        translations: translations.map(t => ({
          id: t.id,
          language: t.language,
          title: t.title,
          isApproved: t.isApproved,
        })),
        translationCount: translations.length,
        approvedCount: translations.filter(t => t.isApproved).length,
      };
    });
    res.json(enriched);
  }));

  // ── List unapproved translations (MUST be before /news/:id) ──
  app.get('/api/admin/news/translations/pending', authMiddleware, adminMiddleware, asyncHandler(async (_req: Request, res: Response) => {
    const translations = await storage.getUnapprovedTranslations();

    // Batch-load news articles for enrichment (avoid N+1)
    const allNews = await storage.getRegulatoryNews();
    const newsMap = new Map(allNews.map(n => [n.id, n]));

    const enriched = translations.map((t) => {
      const news = newsMap.get(t.newsId);
      return {
        ...t,
        originalTitle: news?.title,
        originalSummary: news?.summary,
        category: news?.category,
        importance: news?.importance,
      };
    });

    res.json(enriched);
  }));

  // ── Approve a translation (MUST be before /news/:id) ──
  app.post('/api/admin/news/translations/:id/approve', authMiddleware, adminMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const adminUserId = (req as any).user?.id;

    const translation = await storage.approveNewsTranslation(id, adminUserId);
    if (!translation) {
      return res.status(404).json({ message: 'Translation not found' });
    }
    log.info({ translationId: id, admin: (req as any).user?.email }, 'Translation approved');
    res.json(translation);
  }));

  // ── Update a translation (MUST be before /news/:id) ──
  app.put('/api/admin/news/translations/:id', authMiddleware, adminMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { title, summary, content } = req.body;

    const updated = await storage.updateNewsTranslation(id, {
      ...(title !== undefined && { title }),
      ...(summary !== undefined && { summary }),
      ...(content !== undefined && { content }),
    });

    if (!updated) {
      return res.status(404).json({ message: 'Translation not found' });
    }

    log.info({ translationId: id, admin: (req as any).user?.email }, 'Translation updated');
    res.json(updated);
  }));

  // ── Get a single news article with full translations ────
  // NOTE: This parameterized route must come AFTER all /news/translations/* routes
  app.get('/api/admin/news/:id', authMiddleware, adminMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const news = await storage.getRegulatoryNewsById(id);
    if (!news) {
      return res.status(404).json({ message: 'News article not found' });
    }

    const translations = await storage.getNewsTranslationsByNewsId(id);
    res.json({ ...news, translations });
  }));

  // ── Trigger translation for a news article ──────────────
  app.post('/api/admin/news/:id/translate', authMiddleware, adminMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const news = await storage.getRegulatoryNewsById(id);
    if (!news) {
      return res.status(404).json({ message: 'News article not found' });
    }

    const { translateNewsToAllLanguages } = await import('../services/translationService');
    const translations = await translateNewsToAllLanguages(id);

    const results: Record<string, string> = {};
    for (const [lang, translation] of translations) {
      results[lang] = translation ? 'translated' : 'failed';
    }

    log.info({ newsId: id, admin: (req as any).user?.email, results }, 'News translations triggered');
    res.json({ message: 'Translations generated', results });
  }));

  // ── Distribute news to clients via WhatsApp ─────────────
  app.post('/api/admin/news/:id/distribute', authMiddleware, adminMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { targetCompanyIds } = req.body; // Optional: specific companies. Empty = all clients

    // Validate targetCompanyIds is an array if provided
    if (targetCompanyIds !== undefined && !Array.isArray(targetCompanyIds)) {
      return res.status(400).json({ message: 'targetCompanyIds must be an array of company IDs' });
    }

    const news = await storage.getRegulatoryNewsById(id);
    if (!news) {
      return res.status(404).json({ message: 'News article not found' });
    }

    const { enqueueTemplatedMessage } = await import('../services/messageQueue');
    const { getBestTranslation } = await import('../services/translationService');

    // Get target companies
    const allCompanies = await storage.getAllCompaniesWithContacts();
    const targets = targetCompanyIds?.length
      ? allCompanies.filter((c: any) => targetCompanyIds.includes(c.id))
      : allCompanies;

    let queued = 0;
    let skipped = 0;

    for (const company of targets) {
      // Get the company's preferred language (using shared utility)
      const language = mapLocaleToLanguage(company.locale);

      // Get best available translation
      const translation = await getBestTranslation(id, language);
      if (!translation) {
        skipped++;
        continue;
      }

      // Use contactPhone with shared cleanPhone utility
      const primaryPhone = cleanPhone(company.contactPhone);
      if (!primaryPhone) {
        skipped++;
        continue;
      }

      try {
        await enqueueTemplatedMessage({
          templateName: 'news_update',
          language,
          recipientPhone: primaryPhone,
          recipientName: company.name,
          placeholders: {
            newsTitle: translation.title,
            newsSummary: translation.summary,
          },
          companyId: company.id,
          relatedEntityType: 'regulatory_news',
          relatedEntityId: id,
          priority: news.importance === 'critical' ? 1 : news.importance === 'high' ? 3 : 5,
        });
        queued++;
      } catch (err: any) {
        log.warn({ companyId: company.id, error: err.message }, 'Failed to queue news for company');
        skipped++;
      }
    }

    log.info(
      { newsId: id, queued, skipped, admin: (req as any).user?.email },
      'News distribution queued',
    );

    res.json({
      message: `News queued for distribution to ${queued} clients (${skipped} skipped)`,
      queued,
      skipped,
    });
  }));

  // ══════════════════════════════════════════════════════════
  // Cross-Selling Campaigns (P6)
  // ══════════════════════════════════════════════════════════

  // ── Get service catalog ─────────────────────────────────
  app.get('/api/admin/cross-sell/catalog', authMiddleware, adminMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { getServiceCatalog } = await import('../services/crossSelling');
    const rawLang = (req.query.language as string) || 'en';
    const language = ['en', 'ar', 'so'].includes(rawLang) ? rawLang : 'en';
    const catalog = getServiceCatalog(language);
    res.json(catalog);
  }));

  // ── Identify cross-sell opportunities ───────────────────
  app.get('/api/admin/cross-sell/opportunities', authMiddleware, adminMiddleware, asyncHandler(async (_req: Request, res: Response) => {
    const { identifyOpportunities } = await import('../services/crossSelling');
    const opportunities = await identifyOpportunities();

    // Group by service
    const grouped: Record<string, { service: string; clients: Array<{ companyId: string; companyName: string; reason: string }> }> = {};
    for (const opp of opportunities) {
      if (!grouped[opp.service.id]) {
        grouped[opp.service.id] = {
          service: opp.service.name,
          clients: [],
        };
      }
      grouped[opp.service.id].clients.push({
        companyId: opp.companyId,
        companyName: opp.companyName,
        reason: opp.reason,
      });
    }

    res.json({
      totalOpportunities: opportunities.length,
      byService: grouped,
    });
  }));

  // ── List all campaigns ──────────────────────────────────
  app.get('/api/admin/cross-sell/campaigns', authMiddleware, adminMiddleware, asyncHandler(async (_req: Request, res: Response) => {
    const campaigns = await storage.getAllCrossSellCampaigns();
    res.json(campaigns);
  }));

  // ── Get campaign details with targets ───────────────────
  app.get('/api/admin/cross-sell/campaigns/:id', authMiddleware, adminMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const campaign = await storage.getCrossSellCampaign(id);
    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    const targets = await storage.getCrossSellTargetsByCampaign(id);

    // Batch-load companies for O(1) lookup (avoid N+1)
    const allCompanies = await storage.getAllCompaniesWithContacts();
    const companyMap = new Map(allCompanies.map(c => [c.id, c]));

    const enrichedTargets = targets.map((t) => {
      const company = companyMap.get(t.companyId);
      return {
        ...t,
        companyName: company?.name,
        companyLocale: company?.locale,
      };
    });

    res.json({ ...campaign, targets: enrichedTargets });
  }));

  // ── Create a new campaign ───────────────────────────────
  app.post('/api/admin/cross-sell/campaigns', authMiddleware, adminMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { serviceId, name, description, targetCompanyIds } = req.body;

    if (!serviceId || !name) {
      return res.status(400).json({ message: 'serviceId and name are required' });
    }

    const { createCampaignFromRecommendations } = await import('../services/crossSelling');
    const campaign = await createCampaignFromRecommendations({
      serviceId,
      name,
      description,
      targetCompanyIds,
      createdBy: (req as any).user?.id,
    });

    log.info({ campaignId: campaign.id, admin: (req as any).user?.email }, 'Cross-sell campaign created');
    res.json(campaign);
  }));

  // ── Generate personalized AI messages ───────────────────
  app.post('/api/admin/cross-sell/campaigns/:id/generate-messages', authMiddleware, adminMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { generateCampaignMessages } = await import('../services/crossSelling');
    const generated = await generateCampaignMessages(id);

    log.info({ campaignId: id, generated, admin: (req as any).user?.email }, 'Campaign messages generated');
    res.json({ message: `Generated ${generated} personalized messages`, generated });
  }));

  // ── Approve and execute campaign ────────────────────────
  app.post('/api/admin/cross-sell/campaigns/:id/execute', authMiddleware, adminMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { executeCampaign } = await import('../services/crossSelling');
    const result = await executeCampaign(id, (req as any).user?.id);

    log.info(
      { campaignId: id, admin: (req as any).user?.email, ...result },
      'Cross-sell campaign executed',
    );

    res.json({
      message: `Campaign executed: ${result.queued} messages queued, ${result.failed} failed`,
      ...result,
    });
  }));

  // ── Delete a draft campaign ─────────────────────────────
  app.delete('/api/admin/cross-sell/campaigns/:id', authMiddleware, adminMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const campaign = await storage.getCrossSellCampaign(id);

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    if (campaign.status !== 'draft') {
      return res.status(400).json({ message: 'Only draft campaigns can be deleted' });
    }

    await storage.deleteCrossSellCampaign(id);
    log.info({ campaignId: id, admin: (req as any).user?.email }, 'Draft campaign deleted');
    res.json({ message: 'Campaign deleted' });
  }));
}
