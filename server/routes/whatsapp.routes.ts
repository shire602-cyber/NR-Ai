import { Router, type Express, type Request, type Response } from 'express';
import { storage } from '../storage';
import { z } from 'zod';
import OpenAI from 'openai';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { getEnv } from '../config/env';
import { createLogger } from '../config/logger';

const log = createLogger('whatsapp');

// =============================================
// Private helper functions
// =============================================

function formatPhoneNumber(phone: string): { valid: boolean; formatted: string; error?: string } {
  // Remove all non-digit characters except leading +
  let cleaned = phone.trim().replace(/[^\d+]/g, '');

  // Remove leading + if present
  cleaned = cleaned.replace(/^\+/, '');

  // Remove any remaining non-digit characters
  cleaned = cleaned.replace(/\D/g, '');

  // Validate length (international numbers are typically 7-15 digits)
  if (cleaned.length < 7 || cleaned.length > 15) {
    return {
      valid: false,
      formatted: cleaned,
      error: `Phone number must be 7-15 digits (got ${cleaned.length}). Please use international format without + (e.g., 971501234567)`
    };
  }

  // Check if it starts with 0 (local format - not valid for WhatsApp)
  if (cleaned.startsWith('0')) {
    return {
      valid: false,
      formatted: cleaned,
      error: 'Phone number cannot start with 0. Please use international format (e.g., 971501234567)'
    };
  }

  return { valid: true, formatted: cleaned };
}

async function sendWhatsAppMessage(phoneNumberId: string, accessToken: string, to: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string; errorCode?: string; errorType?: string }> {
  try {
    // Validate and format phone number
    const phoneValidation = formatPhoneNumber(to);
    if (!phoneValidation.valid) {
      return {
        success: false,
        error: phoneValidation.error || 'Invalid phone number format'
      };
    }

    const formattedTo = phoneValidation.formatted;

    console.log(`[WhatsApp] Attempting to send message to ${formattedTo} via phone number ID ${phoneNumberId}`);

    const requestBody = {
      messaging_product: 'whatsapp',
      to: formattedTo,
      type: 'text',
      text: {
        body: message,
      },
    };

    // Use latest stable API version (v21.0 as of 2024)
    // v18.0 may be deprecated, updating to v21.0 for better compatibility
    const response = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    console.log(`[WhatsApp] API Response status: ${response.status} ${response.statusText}`);

    // Check content type before parsing JSON
    const contentType = response.headers.get('content-type');
    let data: any;

    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
      console.log('[WhatsApp] API Response data:', JSON.stringify(data).substring(0, 500));
    } else {
      // If not JSON, read as text to get error message
      const text = await response.text();
      console.error('[WhatsApp] API returned non-JSON response:', text.substring(0, 500));
      return {
        success: false,
        error: `WhatsApp API error (${response.status}): ${response.statusText}. Response: ${text.substring(0, 200)}`
      };
    }

    if (response.ok && data.messages && data.messages[0]) {
      console.log(`[WhatsApp] Message sent successfully. Message ID: ${data.messages[0].id}`);
      return { success: true, messageId: data.messages[0].id };
    } else {
      const errorDetails = data.error || {};
      const errorMessage = errorDetails.message ||
                           errorDetails.error_user_msg ||
                           errorDetails.error_subcode ||
                           JSON.stringify(errorDetails) ||
                           'Failed to send WhatsApp message';
      console.error('[WhatsApp] API Error:', JSON.stringify(errorDetails));
      console.error('[WhatsApp] Error Code:', errorDetails.code, 'Type:', errorDetails.type);
      return {
        success: false,
        error: errorMessage,
      };
    }
  } catch (error: any) {
    console.error('[WhatsApp] Send error:', error);
    console.error('[WhatsApp] Error stack:', error.stack);
    // Ensure error message doesn't contain HTML
    let errorMessage = error.message || 'Failed to send WhatsApp message';
    if (errorMessage.includes('<!DOCTYPE') || errorMessage.includes('<html')) {
      errorMessage = 'Failed to send WhatsApp message. Please check your configuration and try again.';
    }
    return { success: false, error: errorMessage };
  }
}

// =============================================
// Route registration
// =============================================

export function registerWhatsAppRoutes(app: Express) {
  // ===========================
  // WhatsApp Integration Routes
  // ===========================

  // WhatsApp Webhook Verification (GET) - For Meta webhook setup
  app.get("/api/webhooks/whatsapp", asyncHandler(async (req: Request, res: Response) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    console.log('[WhatsApp Webhook] Verification request:', { mode, token: token ? '***' : 'missing', challenge: challenge ? 'present' : 'missing' });

    if (mode === 'subscribe') {
      // Try to validate token against stored configs
      // For now, accept any token for initial setup, but log it
      console.log('[WhatsApp Webhook] Webhook verified successfully');
      return res.status(200).send(challenge);
    }

    console.log('[WhatsApp Webhook] Verification failed: invalid mode');
    res.status(403).json({ message: 'Forbidden' });
  }));

  // WhatsApp Webhook (POST) - Receive messages
  app.post("/api/webhooks/whatsapp", asyncHandler(async (req: Request, res: Response) => {
    const body = req.body;

    console.log('[WhatsApp Webhook] Received webhook:', {
      object: body.object,
      entryCount: body.entry?.length || 0,
      timestamp: new Date().toISOString(),
    });

    // Log full webhook payload for debugging (first 1000 chars)
    console.log('[WhatsApp Webhook] Full payload:', JSON.stringify(body).substring(0, 1000));

    // Acknowledge receipt immediately (WhatsApp requires quick response)
    res.status(200).send('EVENT_RECEIVED');

    // Process messages asynchronously
    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field === 'messages') {
            const value = change.value;
            const messages = value.messages || [];

            console.log(`[WhatsApp Webhook] Processing ${messages.length} message(s)`);

            for (const message of messages) {
              await processWhatsAppMessage(message, value.metadata);
            }
          } else {
            console.log(`[WhatsApp Webhook] Ignoring change field: ${change.field}`);
          }
        }
      }
    } else {
      console.log(`[WhatsApp Webhook] Unknown object type: ${body.object}`);
    }
  }));

  // Process incoming WhatsApp message
  async function processWhatsAppMessage(message: any, metadata: any) {
    try {
      console.log('[WhatsApp Webhook] Processing message:', {
        messageId: message.id,
        from: message.from,
        type: message.type,
        hasText: !!message.text?.body,
        metadata: metadata ? {
          phone_number_id: metadata.phone_number_id,
          display_phone_number: metadata.display_phone_number,
        } : 'missing',
      });

      const phoneNumberId = metadata?.phone_number_id;

      if (!phoneNumberId) {
        console.error('[WhatsApp Webhook] Missing phone_number_id in metadata. Full metadata:', JSON.stringify(metadata));
        console.error('[WhatsApp Webhook] Available metadata keys:', metadata ? Object.keys(metadata) : 'metadata is null/undefined');
        return;
      }

      // Find company by phone number ID
      const config = await storage.getWhatsappConfigByPhoneNumberId(phoneNumberId);
      if (!config) {
        console.error(`[WhatsApp Webhook] No configuration found for phone number ID: ${phoneNumberId}`);
        console.error('[WhatsApp Webhook] Available phone number IDs in database:', 'Check database for configured phone numbers');
        return;
      }

      console.log('[WhatsApp Webhook] Found config for company:', config.companyId);

      const messageData = {
        companyId: config.companyId,
        waMessageId: message.id,
        from: message.from,
        to: phoneNumberId,
        messageType: message.type || 'text',
        content: message.text?.body || message.caption || null,
        mediaId: message.image?.id || message.document?.id || message.video?.id || message.audio?.id || null,
        direction: 'inbound' as const,
        status: 'received' as const,
      };

      console.log('Received WhatsApp message:', {
        from: messageData.from,
        type: messageData.messageType,
        hasContent: !!messageData.content,
        companyId: messageData.companyId,
      });

      // Save the message to database
      await storage.createWhatsappMessage(messageData);

      // TODO: In full implementation:
      // 1. Download media if present
      // 2. Run OCR on images
      // 3. Use AI to categorize expenses
      // 4. Create receipt/expense entry

    } catch (error: any) {
      console.error('Error processing WhatsApp message:', error);
      console.error('Error details:', error.message, error.stack);
    }
  }

  // Get WhatsApp configuration
  app.get("/api/integrations/whatsapp/config", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const companies = await storage.getCompaniesByUserId(userId);
    if (companies.length === 0) {
      return res.status(404).json({ message: 'No company found' });
    }

    const companyId = companies[0].id;
    const config = await storage.getWhatsappConfig(companyId);

    if (!config) {
      return res.json({
        configured: false,
        isActive: false,
        companyId,
      });
    }

    // Don't expose sensitive tokens
    res.json({
      configured: true,
      isActive: config.isActive,
      phoneNumberId: config.phoneNumberId,
      businessAccountId: config.businessAccountId,
      hasAccessToken: !!config.accessToken,
      companyId,
      configId: config.id,
    });
  }));

  // Save WhatsApp configuration
  app.post("/api/integrations/whatsapp/config", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { phoneNumberId, accessToken, webhookVerifyToken, businessAccountId } = req.body;

    const companies = await storage.getCompaniesByUserId(userId);
    if (companies.length === 0) {
      return res.status(404).json({ message: 'No company found' });
    }

    const companyId = companies[0].id;
    const existingConfig = await storage.getWhatsappConfig(companyId);

    if (existingConfig) {
      // Update existing config
      const updated = await storage.updateWhatsappConfig(existingConfig.id, {
        phoneNumberId,
        accessToken,
        webhookVerifyToken,
        businessAccountId,
        isActive: true,
      });
      res.json({ message: 'WhatsApp configuration updated', configId: updated.id });
    } else {
      // Create new config
      const config = await storage.createWhatsappConfig({
        companyId,
        phoneNumberId,
        accessToken,
        webhookVerifyToken,
        businessAccountId,
        isActive: true,
      });
      res.json({ message: 'WhatsApp configuration created', configId: config.id });
    }
  }));

  // Toggle WhatsApp integration on/off
  app.patch("/api/integrations/whatsapp/toggle", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const companies = await storage.getCompaniesByUserId(userId);
    if (companies.length === 0) {
      return res.status(404).json({ message: 'No company found' });
    }

    const companyId = companies[0].id;
    const config = await storage.getWhatsappConfig(companyId);

    if (!config) {
      return res.status(404).json({ message: 'WhatsApp not configured' });
    }

    const updated = await storage.updateWhatsappConfig(config.id, {
      isActive: !config.isActive,
    });

    res.json({
      message: updated.isActive ? 'WhatsApp integration enabled' : 'WhatsApp integration disabled',
      isActive: updated.isActive
    });
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

  // Send custom WhatsApp message
  app.post("/api/integrations/whatsapp/send-message", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { to, message } = req.body;
    if (!to || !message) {
      return res.status(400).json({
        success: false,
        error: 'Phone number and message are required',
        hint: 'Phone number should be in international format without + sign (e.g., 971501234567)'
      });
    }

    // Validate phone number format
    const phoneValidation = formatPhoneNumber(to);
    if (!phoneValidation.valid) {
      return res.status(400).json({
        success: false,
        error: phoneValidation.error || 'Invalid phone number format'
      });
    }

    const companies = await storage.getCompaniesByUserId(userId);
    if (companies.length === 0) {
      return res.status(404).json({ message: 'No company found' });
    }

    const companyId = companies[0].id;
    const whatsappConfig = await storage.getWhatsappConfig(companyId);
    if (!whatsappConfig || !whatsappConfig.isActive || !whatsappConfig.phoneNumberId || !whatsappConfig.accessToken) {
      return res.status(400).json({
        success: false,
        error: 'WhatsApp configuration is missing or inactive. Please configure WhatsApp in Admin Settings.'
      });
    }

    const result = await sendWhatsAppMessage(
      whatsappConfig.phoneNumberId,
      whatsappConfig.accessToken,
      phoneValidation.formatted,
      message
    );

    if (result.success) {
      // Log the message
      try {
        await storage.createWhatsappMessage({
          companyId,
          waMessageId: result.messageId || 'unknown',
          from: whatsappConfig.phoneNumberId,
          to: phoneValidation.formatted,
          messageType: 'text',
          content: message,
          direction: 'outbound',
          status: 'sent',
        });
      } catch (logError: any) {
        console.error('Failed to log WhatsApp message:', logError);
        // Don't fail the request if logging fails
      }

      return res.json({ success: true, messageId: result.messageId });
    } else {
      return res.status(400).json({ success: false, error: result.error || 'Failed to send WhatsApp message' });
    }
  }));

  // Reply to WhatsApp message
  app.post("/api/integrations/whatsapp/reply", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { messageId, reply } = req.body;
    if (!messageId || !reply) {
      return res.status(400).json({ message: 'Message ID and reply are required' });
    }

    const companies = await storage.getCompaniesByUserId(userId);
    if (companies.length === 0) {
      return res.status(404).json({ message: 'No company found' });
    }

    const companyId = companies[0].id;
    const originalMessage = await storage.getWhatsappMessage(messageId);
    if (!originalMessage || originalMessage.companyId !== companyId) {
      return res.status(404).json({ message: 'Message not found' });
    }

    const whatsappConfig = await storage.getWhatsappConfig(companyId);
    if (!whatsappConfig || !whatsappConfig.isActive || !whatsappConfig.phoneNumberId || !whatsappConfig.accessToken) {
      return res.status(400).json({ message: 'WhatsApp configuration is missing or inactive' });
    }

    // Validate phone number format from original message
    const phoneValidation = formatPhoneNumber(originalMessage.from);
    if (!phoneValidation.valid) {
      return res.status(400).json({
        success: false,
        error: phoneValidation.error || 'Invalid phone number format in original message'
      });
    }

    const result = await sendWhatsAppMessage(
      whatsappConfig.phoneNumberId,
      whatsappConfig.accessToken,
      phoneValidation.formatted,
      reply
    );

    if (result.success) {
      // Log the reply
      try {
        await storage.createWhatsappMessage({
          companyId,
          waMessageId: result.messageId || 'unknown',
          from: whatsappConfig.phoneNumberId,
          to: originalMessage.from,
          messageType: 'text',
          content: reply,
          direction: 'outbound',
          status: 'sent',
        });
      } catch (logError: any) {
        console.error('Failed to log WhatsApp reply:', logError);
        // Don't fail the request if logging fails
      }

      return res.json({ success: true, messageId: result.messageId });
    } else {
      return res.status(400).json({ success: false, error: result.error || 'Failed to send WhatsApp reply' });
    }
  }));

  // Test WhatsApp configuration
  app.post("/api/integrations/whatsapp/test", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const companies = await storage.getCompaniesByUserId(userId);
    if (companies.length === 0) {
      return res.status(404).json({ message: 'No company found' });
    }

    const companyId = companies[0].id;
    const whatsappConfig = await storage.getWhatsappConfig(companyId);
    if (!whatsappConfig || !whatsappConfig.isActive || !whatsappConfig.phoneNumberId || !whatsappConfig.accessToken) {
      return res.status(400).json({
        success: false,
        error: 'WhatsApp configuration is missing or inactive. Please configure WhatsApp in Admin Settings.'
      });
    }

    // Get test phone number from request body, or return error
    const { testPhoneNumber } = req.body;
    if (!testPhoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Test phone number is required. Please provide a phone number in international format (e.g., 971501234567)',
        hint: 'You can test by sending to your own WhatsApp number. Use international format without + sign.'
      });
    }

    // Validate phone number format
    const phoneValidation = formatPhoneNumber(testPhoneNumber);
    if (!phoneValidation.valid) {
      return res.status(400).json({
        success: false,
        error: phoneValidation.error || 'Invalid phone number format',
        hint: 'Use international format without + sign (e.g., 971501234567)'
      });
    }

    const testMessage = 'Test message from Muhasib.ai - If you receive this, your WhatsApp integration is working!';

    console.log(`[WhatsApp Test] Sending test message to ${phoneValidation.formatted}`);

    const result = await sendWhatsAppMessage(
      whatsappConfig.phoneNumberId,
      whatsappConfig.accessToken,
      phoneValidation.formatted,
      testMessage
    );

    if (result.success) {
      return res.json({
        success: true,
        message: 'WhatsApp configuration is valid and working. Test message sent successfully!',
        messageId: result.messageId,
        sentTo: phoneValidation.formatted
      });
    } else {
      return res.status(400).json({
        success: false,
        error: result.error || 'Failed to send test message',
        errorCode: result.errorCode,
        errorType: result.errorType,
        details: 'Common issues: 1) Phone number not registered with Meta, 2) Invalid Access Token, 3) Phone Number ID mismatch, 4) Account not approved for sending messages'
      });
    }
  }));

  // Get WhatsApp integration status (for dashboard)
  app.get("/api/integrations/whatsapp/status", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const companies = await storage.getCompaniesByUserId(userId);
    if (companies.length === 0) {
      return res.json({ connected: false, configured: false });
    }

    const companyId = companies[0].id;
    const config = await storage.getWhatsappConfig(companyId);

    if (!config) {
      return res.json({ connected: false, configured: false });
    }

    res.json({
      connected: config.isActive,
      configured: true,
      phoneNumberId: config.phoneNumberId,
    });
  }));

  // WhatsApp Diagnostic Endpoint - Comprehensive troubleshooting
  app.get("/api/integrations/whatsapp/diagnose", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const companies = await storage.getCompaniesByUserId(userId);
    if (companies.length === 0) {
      return res.json({
        configured: false,
        issues: ['No company found'],
        recommendations: ['Please create a company first']
      });
    }

    const companyId = companies[0].id;
    const config = await storage.getWhatsappConfig(companyId);

    const diagnostics: any = {
      configured: !!config,
      isActive: config?.isActive || false,
      hasPhoneNumberId: !!config?.phoneNumberId,
      hasAccessToken: !!config?.accessToken,
      phoneNumberId: config?.phoneNumberId || 'Not set',
      hasBusinessAccountId: !!config?.businessAccountId,
      issues: [] as string[],
      recommendations: [] as string[],
      webhookUrl: `${req.protocol}://${req.get('host')}/api/webhooks/whatsapp`,
    };

    // Check configuration completeness
    if (!config) {
      diagnostics.issues.push('WhatsApp configuration not found');
      diagnostics.recommendations.push('Go to Admin Settings and configure WhatsApp');
      return res.json(diagnostics);
    }

    if (!config.phoneNumberId) {
      diagnostics.issues.push('Phone Number ID is missing');
      diagnostics.recommendations.push('Add your Phone Number ID from Meta Business Manager');
    }

    if (!config.accessToken) {
      diagnostics.issues.push('Access Token is missing');
      diagnostics.recommendations.push('Add your Access Token from Meta Business Manager');
    }

    if (!config.isActive) {
      diagnostics.issues.push('WhatsApp integration is inactive');
      diagnostics.recommendations.push('Enable the WhatsApp integration in Admin Settings');
    }

    // Test API connectivity if we have credentials
    if (config.phoneNumberId && config.accessToken && config.isActive) {
      try {
        // Try to get phone number info from Meta API
        const testResponse = await fetch(`https://graph.facebook.com/v21.0/${config.phoneNumberId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${config.accessToken}`,
          },
        });

        if (testResponse.ok) {
          const phoneInfo = await testResponse.json();
          diagnostics.phoneNumberInfo = {
            verifiedName: phoneInfo.verified_name,
            displayPhoneNumber: phoneInfo.display_phone_number,
            qualityRating: phoneInfo.quality_rating,
          };
          diagnostics.apiConnection = 'Connected';
        } else {
          const errorData = await testResponse.json().catch(() => ({}));
          diagnostics.apiConnection = 'Failed';
          diagnostics.apiError = errorData.error?.message || `HTTP ${testResponse.status}`;
          diagnostics.issues.push(`API connection failed: ${diagnostics.apiError}`);

          if (testResponse.status === 401) {
            diagnostics.recommendations.push('Access Token may be expired or invalid. Generate a new token in Meta Business Manager');
          } else if (testResponse.status === 404) {
            diagnostics.recommendations.push('Phone Number ID not found. Verify it matches your Meta Business Manager');
          }
        }
      } catch (apiError: any) {
        diagnostics.apiConnection = 'Error';
        diagnostics.apiError = apiError.message;
        diagnostics.issues.push(`API test failed: ${apiError.message}`);
      }
    }

    // Webhook configuration recommendations
    diagnostics.webhookSetup = {
      url: diagnostics.webhookUrl,
      verifyToken: config.webhookVerifyToken ? 'Set' : 'Not set',
      instructions: [
        '1. Go to Meta Business Manager > WhatsApp > Configuration',
        '2. Add Webhook URL: ' + diagnostics.webhookUrl,
        `3. Set Verify Token: ${config.webhookVerifyToken || 'any-value-you-want'}`,
        '4. Subscribe to "messages" field',
        '5. Save and verify the webhook'
      ]
    };

    if (!config.webhookVerifyToken) {
      diagnostics.recommendations.push('Set a webhook verify token for better security');
    }

    return res.json(diagnostics);
  }));

  // Test message for WhatsApp webhook (for development)
  app.post("/api/integrations/whatsapp/test-message", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const companies = await storage.getCompaniesByUserId(userId);
    if (companies.length === 0) {
      return res.status(404).json({ message: 'No company found' });
    }

    const companyId = companies[0].id;
    const { from, messageType, content, mediaId } = req.body;

    // Validate input
    const sanitizedFrom = from ? String(from).slice(0, 20).replace(/[^+\d]/g, '') : '+971501234567';
    const sanitizedMessageType = ['text', 'image', 'document'].includes(messageType) ? messageType : 'text';
    const sanitizedContent = content ? String(content).slice(0, 5000) : 'Test receipt message';
    const sanitizedMediaId = mediaId ? String(mediaId).slice(0, 100) : null;

    // Generate unique waMessageId with random suffix to prevent duplicates
    const waMessageId = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create a test message with validated and sanitized data
    const message = await storage.createWhatsappMessage({
      companyId,
      waMessageId,
      from: sanitizedFrom,
      to: 'business_number',
      messageType: sanitizedMessageType,
      content: sanitizedContent,
      mediaId: sanitizedMediaId,
      direction: 'inbound',
      status: 'received',
    });

    res.json({
      message: 'Test message created',
      data: message
    });
  }));

  // ===========================
  // Send Invoice Reminder via WhatsApp
  // ===========================

  // Send manual reminder
  app.post("/api/invoices/:invoiceId/send-reminder", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { invoiceId } = req.params;
    const userId = (req as any).user?.id;
    const { channels = ['in_app'] } = req.body; // Default to in-app only

    const invoice = await storage.getInvoice(invoiceId);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, invoice.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Get reminder settings for this company
    const reminderSettings = await storage.getReminderSettingsByCompanyId(invoice.companyId);
    const invoiceReminderSetting = reminderSettings.find(s => s.reminderType === 'invoice_overdue' || s.reminderType === 'invoice_due_soon');

    const logs: any[] = [];

    // Send WhatsApp if enabled
    if (channels.includes('whatsapp') || invoiceReminderSetting?.sendWhatsapp) {
      const whatsappConfig = await storage.getWhatsappConfig(invoice.companyId);
      const reminderType = invoiceReminderSetting?.reminderType || 'invoice_overdue';

      // Track if WhatsApp was explicitly requested
      const whatsappExplicitlyRequested = channels.includes('whatsapp');
      let whatsappFailed = false;
      let whatsappError = '';

      if (!whatsappConfig || !whatsappConfig.isActive || !whatsappConfig.phoneNumberId || !whatsappConfig.accessToken) {
        whatsappFailed = true;
        whatsappError = 'WhatsApp configuration is missing or inactive';
      } else {
        // Get customer phone number from customer contacts
        const customerContacts = await storage.getCustomerContactsByCompanyId(invoice.companyId);
        const customerContact = customerContacts.find(c => c.name === invoice.customerName);
        const customerPhone = customerContact?.phone;

        if (!customerPhone) {
          whatsappFailed = true;
          whatsappError = 'Customer phone number not found';
        } else {
          // Format message with template
          // Calculate due date (invoice date + payment terms, default 30 days)
          const invoiceDate = new Date(invoice.date);
          const paymentTerms = customerContact?.paymentTerms || 30;
          const dueDate = new Date(invoiceDate);
          dueDate.setDate(dueDate.getDate() + paymentTerms);

          let message = invoiceReminderSetting?.whatsappTemplate ||
            `Hello ${invoice.customerName || 'Customer'}, this is a reminder that invoice ${invoice.number} for AED ${invoice.total.toFixed(2)} is due on ${dueDate.toLocaleDateString()}. Please make payment at your earliest convenience.`;

          // Replace placeholders
          message = message
            .replace(/\{\{customer_name\}\}/g, invoice.customerName || 'Customer')
            .replace(/\{\{invoice_number\}\}/g, invoice.number)
            .replace(/\{\{amount\}\}/g, `AED ${invoice.total.toFixed(2)}`)
            .replace(/\{\{due_date\}\}/g, dueDate.toLocaleDateString());

          // Validate phone number before sending
          const phoneValidation = formatPhoneNumber(customerPhone);
          if (!phoneValidation.valid) {
            whatsappFailed = true;
            whatsappError = phoneValidation.error || 'Invalid customer phone number format';
          } else {
            const whatsappResult = await sendWhatsAppMessage(
              whatsappConfig.phoneNumberId,
              whatsappConfig.accessToken,
              phoneValidation.formatted,
              message
            );

            if (whatsappResult.success) {
              // Log WhatsApp message
              await storage.createWhatsappMessage({
                companyId: invoice.companyId,
                waMessageId: whatsappResult.messageId || 'unknown',
                from: whatsappConfig.phoneNumberId,
                to: phoneValidation.formatted,
                messageType: 'text',
                content: message,
                direction: 'outbound',
                status: 'sent',
              });

              logs.push(await storage.createReminderLog({
                companyId: invoice.companyId,
                reminderType: reminderType,
                relatedEntityType: 'invoice',
                relatedEntityId: invoiceId,
                channel: 'whatsapp',
                status: 'sent',
                attemptNumber: 1,
                sentAt: new Date(),
              }));
            } else {
              whatsappFailed = true;
              whatsappError = whatsappResult.error || 'Failed to send WhatsApp message';
            // Only log failure here if WhatsApp was explicitly requested
            // Otherwise, the log will be created later for non-explicit failures
            if (whatsappExplicitlyRequested) {
              logs.push(await storage.createReminderLog({
                companyId: invoice.companyId,
                reminderType: reminderType,
                relatedEntityType: 'invoice',
                relatedEntityId: invoiceId,
                channel: 'whatsapp',
                status: 'failed',
                attemptNumber: 1,
                sentAt: new Date(),
                errorMessage: whatsappError,
              }));
            }
            }
          }
        }
      }

      // If WhatsApp was explicitly requested but failed, return error
      if (whatsappExplicitlyRequested && whatsappFailed) {
        return res.status(400).json({
          message: `WhatsApp reminder failed: ${whatsappError}`,
          logs
        });
      }

      // Log failure even if not explicitly requested (for tracking)
      if (!whatsappExplicitlyRequested && whatsappFailed) {
        logs.push(await storage.createReminderLog({
          companyId: invoice.companyId,
          reminderType: reminderType,
          relatedEntityType: 'invoice',
          relatedEntityId: invoiceId,
          channel: 'whatsapp',
          status: 'failed',
          attemptNumber: 1,
          sentAt: new Date(),
          errorMessage: whatsappError,
        }));
      }
    }

    // Create in-app notification for the reminder
    if (channels.includes('in_app') || invoiceReminderSetting?.sendInApp) {
      await storage.createNotification({
        userId,
        companyId: invoice.companyId,
        type: 'payment_due',
        title: 'Payment Reminder Sent',
        message: `Reminder sent for invoice ${invoice.number} to ${invoice.customerName}`,
        priority: 'normal',
        relatedEntityType: 'invoice',
        relatedEntityId: invoiceId,
        actionUrl: `/invoices/${invoiceId}`,
      });

      const reminderType = invoiceReminderSetting?.reminderType || 'invoice_overdue';
      logs.push(await storage.createReminderLog({
        companyId: invoice.companyId,
        reminderType: reminderType,
        relatedEntityType: 'invoice',
        relatedEntityId: invoiceId,
        channel: 'in_app',
        status: 'sent',
        attemptNumber: 1,
        sentAt: new Date(),
      }));
    }

    res.json({ message: 'Reminder sent successfully', logs });
  }));
}
