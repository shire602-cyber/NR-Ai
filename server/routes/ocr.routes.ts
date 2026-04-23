import { type Express, type Request, type Response } from 'express';
import { storage } from '../storage';
import OpenAI from 'openai';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { getEnv } from '../config/env';

export function registerOCRRoutes(app: Express) {
  const apiKey = getEnv().OPENAI_API_KEY;
  const openai = apiKey ? new OpenAI({ apiKey }) : null;

  const VISION_MODEL = 'gpt-4o';

  const VALID_CATEGORIES = [
    'Office Supplies', 'Utilities', 'Travel', 'Meals',
    'Rent', 'Marketing', 'Equipment', 'Professional Services',
    'Insurance', 'Maintenance', 'Communication', 'Other',
  ];

  const EXTRACTION_PROMPT = `You are an expert receipt/invoice data extraction assistant for UAE businesses.
Analyze this receipt image carefully and extract EVERY detail visible.

Return a JSON object with EXACTLY these fields:
{
  "merchant": "Full business/store name as printed on receipt",
  "date": "YYYY-MM-DD format",
  "invoiceNumber": "receipt/invoice/ref number if visible, else null",
  "subtotal": number (amount before VAT, in original currency),
  "vatPercent": number (VAT percentage, default 5 for UAE if not shown),
  "vatAmount": number (VAT amount, calculate from subtotal if not shown),
  "total": number (final total including VAT),
  "currency": "AED or other 3-letter code found on receipt",
  "category": "one of the categories below",
  "lineItems": [{"description": "item name", "quantity": number_or_null, "unitPrice": number_or_null, "amount": number}],
  "confidence": number between 0 and 1
}

Valid categories: ${VALID_CATEGORIES.join(', ')}

Rules:
- UAE VAT is 5% — if receipt shows 5% or "VAT" without percentage, use 5
- If subtotal not shown, derive it: subtotal = total - vatAmount
- If vatAmount not shown, derive it: vatAmount = subtotal * (vatPercent/100)
- Include ALL line items visible on the receipt
- For Arabic text: transliterate or translate merchant names to English
- currency defaults to AED for UAE receipts
- Be precise — extract exactly what is printed, do not guess values not on the receipt`;

  app.post('/api/ocr/process', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const companies = await storage.getCompaniesByUserId(userId);
    if (companies.length === 0) {
      return res.status(404).json({ message: 'No company found' });
    }
    const companyId = companies[0].id;

    const { imageData, content, messageId, mediaId } = req.body;

    const sanitizedMessageId = messageId ? String(messageId).slice(0, 100) : null;

    if (!openai) {
      console.error('[OCR] OpenAI client not initialized — OPENAI_API_KEY missing');
      return res.status(503).json({ message: 'OCR service unavailable: missing API key' });
    }

    // Vision path: image provided
    if (imageData) {
      try {
        // imageData may be a full data URL (data:image/...;base64,...) or raw base64
        const dataUrl: string = imageData.startsWith('data:') ? imageData : `data:image/jpeg;base64,${imageData}`;

        console.log(`[OCR] Sending image to ${VISION_MODEL} vision API`);

        const aiResponse = await openai.chat.completions.create({
          model: VISION_MODEL,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: {
                    url: dataUrl,
                    detail: 'high',
                  },
                },
                {
                  type: 'text',
                  text: EXTRACTION_PROMPT,
                },
              ],
            },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 2000,
        });

        const raw = aiResponse.choices[0]?.message?.content;
        if (!raw) {
          throw new Error('Empty response from vision API');
        }

        console.log('[OCR] Vision API response:', raw);

        const result = JSON.parse(raw);

        const subtotal = parseFloat(result.subtotal) || 0;
        const vatPercent = parseFloat(result.vatPercent) || 5;
        const vatAmount = parseFloat(result.vatAmount) || parseFloat((subtotal * vatPercent / 100).toFixed(2));
        const total = parseFloat(result.total) || parseFloat((subtotal + vatAmount).toFixed(2));
        const category = VALID_CATEGORIES.includes(result.category) ? result.category : 'Other';

        let parsedDate = new Date().toISOString().split('T')[0];
        if (result.date && /^\d{4}-\d{2}-\d{2}$/.test(result.date)) {
          parsedDate = result.date;
        }

        const lineItems = Array.isArray(result.lineItems) ? result.lineItems.map((item: any) => ({
          description: String(item.description || '').slice(0, 500),
          quantity: item.quantity != null ? parseFloat(item.quantity) || null : null,
          unitPrice: item.unitPrice != null ? parseFloat(item.unitPrice) || null : null,
          amount: parseFloat(item.amount) || 0,
        })) : [];

        return res.json({
          merchant: result.merchant ? String(result.merchant).slice(0, 200) : 'Unknown Merchant',
          date: parsedDate,
          invoiceNumber: result.invoiceNumber ? String(result.invoiceNumber).slice(0, 100) : null,
          subtotal,
          vatPercent,
          vatAmount,
          total,
          amount: subtotal,
          currency: result.currency ? String(result.currency).slice(0, 3).toUpperCase() : 'AED',
          category,
          lineItems,
          confidence: parseFloat(result.confidence) || 0.95,
          rawText: '',
          companyId,
          messageId: sanitizedMessageId,
        });
      } catch (err: any) {
        console.error('[OCR] Vision extraction failed:', err?.message || err);
        return res.status(500).json({ message: `OCR extraction failed: ${err?.message || 'Unknown error'}` });
      }
    }

    // Text-only path: fallback when only text content provided
    if (content) {
      const sanitizedContent = String(content).slice(0, 10000);
      try {
        const aiResponse = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: `Extract receipt data from text. Return JSON with: merchant, date (YYYY-MM-DD), invoiceNumber, subtotal, vatPercent, vatAmount, total, currency, category, lineItems array. UAE context: 5% VAT, AED currency. Categories: ${VALID_CATEGORIES.join(', ')}`,
            },
            {
              role: 'user',
              content: `Extract receipt data:\n\n${sanitizedContent}`,
            },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 1000,
        });

        const result = JSON.parse(aiResponse.choices[0]?.message?.content || '{}');
        const subtotal = parseFloat(result.subtotal) || 0;
        const vatPercent = parseFloat(result.vatPercent) || 5;
        const vatAmount = parseFloat(result.vatAmount) || parseFloat((subtotal * vatPercent / 100).toFixed(2));
        const total = parseFloat(result.total) || parseFloat((subtotal + vatAmount).toFixed(2));
        const category = VALID_CATEGORIES.includes(result.category) ? result.category : 'Other';

        let parsedDate = new Date().toISOString().split('T')[0];
        if (result.date && /^\d{4}-\d{2}-\d{2}$/.test(result.date)) {
          parsedDate = result.date;
        }

        return res.json({
          merchant: result.merchant ? String(result.merchant).slice(0, 200) : 'Unknown Merchant',
          date: parsedDate,
          invoiceNumber: result.invoiceNumber ? String(result.invoiceNumber).slice(0, 100) : null,
          subtotal,
          vatPercent,
          vatAmount,
          total,
          amount: subtotal,
          currency: result.currency ? String(result.currency).slice(0, 3).toUpperCase() : 'AED',
          category,
          lineItems: [],
          confidence: 0.85,
          rawText: sanitizedContent,
          companyId,
          messageId: sanitizedMessageId,
        });
      } catch (err: any) {
        console.error('[OCR] Text extraction failed:', err?.message || err);
        return res.status(500).json({ message: `OCR extraction failed: ${err?.message || 'Unknown error'}` });
      }
    }

    return res.status(400).json({ message: 'No image or text content provided' });
  }));
}
