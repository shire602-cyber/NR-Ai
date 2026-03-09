import { Router, type Express, type Request, type Response } from 'express';
import { storage } from '../storage';
import OpenAI from 'openai';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { getEnv } from '../config/env';

// OpenAI client for AI-powered receipt extraction
const openai = new OpenAI({
  apiKey: getEnv().OPENAI_API_KEY,
});

const AI_MODEL = 'gpt-3.5-turbo';

export function registerOCRRoutes(app: Express) {
  // ===========================
  // OCR Processing Endpoint
  // ===========================

  // Process receipt image with OCR and AI categorization
  app.post("/api/ocr/process", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    // Validate and get company for scoping
    const companies = await storage.getCompaniesByUserId(userId);
    if (companies.length === 0) {
      return res.status(404).json({ message: 'No company found' });
    }
    const companyId = companies[0].id;

    const { messageId, mediaId, content, imageData } = req.body;

    // Validate input
    const sanitizedContent = content ? String(content).slice(0, 10000) : '';
    const sanitizedMessageId = messageId ? String(messageId).slice(0, 100) : null;
    const sanitizedMediaId = mediaId ? String(mediaId).slice(0, 100) : null;

    // Default extraction results
    let rawText = sanitizedContent;
    let extractedData = {
      merchant: 'Unknown Merchant',
      date: new Date().toISOString().split('T')[0],
      amount: 0,
      vatAmount: 0,
      category: 'Office Supplies',
      confidence: 0.5,
      rawText: rawText,
      companyId: companyId,
      messageId: sanitizedMessageId,
    };

    // Valid expense categories for UAE businesses
    const validCategories = [
      'Office Supplies', 'Utilities', 'Travel', 'Meals',
      'Rent', 'Marketing', 'Equipment', 'Professional Services',
      'Insurance', 'Maintenance', 'Communication', 'Other'
    ];

    // Try to use AI to extract structured data from text
    if (sanitizedContent) {
      try {
        const aiResponse = await openai.chat.completions.create({
          model: AI_MODEL,
          messages: [
            {
              role: "system",
              content: `You are a receipt data extraction assistant for UAE businesses. Extract the following information from receipt text:
                - merchant: The store/business name
                - date: The transaction date (YYYY-MM-DD format, use today if not found)
                - amount: The subtotal amount before VAT in AED (number only, exclude VAT)
                - vatAmount: The VAT amount in AED (number only, assume 5% of amount if not specified)
                - category: Categorize as one of: ${validCategories.join(', ')}

                Important: All amounts should be in AED. If the receipt shows a different currency, convert to AED.
                Respond in JSON format only with these exact field names.`
            },
            {
              role: "user",
              content: `Extract receipt data from this text:\n\n${sanitizedContent}`
            }
          ],
          response_format: { type: "json_object" },
          max_tokens: 500,
        });

        const aiResult = JSON.parse(aiResponse.choices[0]?.message?.content || '{}');

        // Validate and sanitize AI response
        const parsedAmount = parseFloat(aiResult.amount);
        const parsedVat = parseFloat(aiResult.vatAmount);
        const category = validCategories.includes(aiResult.category) ? aiResult.category : 'Other';

        // Validate date format
        let parsedDate = extractedData.date;
        if (aiResult.date && /^\d{4}-\d{2}-\d{2}$/.test(aiResult.date)) {
          parsedDate = aiResult.date;
        }

        extractedData = {
          merchant: aiResult.merchant ? String(aiResult.merchant).slice(0, 200) : extractedData.merchant,
          date: parsedDate,
          amount: !isNaN(parsedAmount) && parsedAmount >= 0 ? parsedAmount : 0,
          vatAmount: !isNaN(parsedVat) && parsedVat >= 0 ? parsedVat : 0,
          category: category,
          confidence: 0.9,
          rawText: sanitizedContent,
          companyId: companyId,
          messageId: sanitizedMessageId,
        };
      } catch (aiError: any) {
        console.log('AI extraction error:', aiError.message || 'Unknown error');
        // Return default data with lower confidence
        extractedData.confidence = 0.3;
      }
    }

    res.json(extractedData);
  }));
}
