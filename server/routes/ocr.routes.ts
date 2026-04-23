import { type Express, type Request, type Response } from 'express';
import { storage } from '../storage';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { getEnv } from '../config/env';

export function registerOCRRoutes(app: Express) {
  const env = getEnv();

  // Resolve which API to use.
  // ANTHROPIC_API_KEY takes explicit precedence.
  // An OPENAI_API_KEY starting with "sk-ant-" is an Anthropic key that was
  // misconfigured in the OpenAI slot — use the Anthropic SDK for it directly
  // rather than letting the OpenAI SDK (which reads OPENAI_BASE_URL) misroute it.
  const anthropicKey =
    env.ANTHROPIC_API_KEY ||
    (env.OPENAI_API_KEY?.startsWith('sk-ant-') ? env.OPENAI_API_KEY : undefined);
  const openaiKey =
    env.OPENAI_API_KEY && !env.OPENAI_API_KEY.startsWith('sk-ant-')
      ? env.OPENAI_API_KEY
      : undefined;

  const anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null;
  // Explicitly pin baseURL so OPENAI_BASE_URL env var cannot silently reroute
  // requests to a different provider (e.g. Anthropic's OpenAI-compatible endpoint).
  const openai =
    !anthropic && openaiKey
      ? new OpenAI({ apiKey: openaiKey, baseURL: 'https://api.openai.com/v1' })
      : null;

  const ANTHROPIC_VISION_MODEL = 'claude-sonnet-4-6';
  const OPENAI_VISION_MODEL = 'gpt-4o';

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

  // Strip potential markdown code fences that some models add around JSON.
  function extractJson(raw: string): any {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    return JSON.parse(fenced ? fenced[1].trim() : raw.trim());
  }

  async function callVision(dataUrl: string): Promise<string> {
    if (anthropic) {
      // Anthropic requires raw base64 with an explicit media_type — NOT a data URI.
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
      if (!match) throw new Error('Invalid image data URL format');

      const mediaType = match[1] as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
      const base64Data = match[2];

      console.log(`[OCR] Sending image to ${ANTHROPIC_VISION_MODEL} via Anthropic SDK`);

      const response = await anthropic.messages.create({
        model: ANTHROPIC_VISION_MODEL,
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: base64Data },
              },
              {
                type: 'text',
                text: EXTRACTION_PROMPT + '\n\nReturn ONLY a valid JSON object. No markdown, no explanation.',
              },
            ],
          },
        ],
      });

      const block = response.content[0];
      if (block.type !== 'text') throw new Error('Unexpected response type from Anthropic');
      return block.text;
    }

    if (openai) {
      console.log(`[OCR] Sending image to ${OPENAI_VISION_MODEL} via OpenAI SDK`);

      const aiResponse = await openai.chat.completions.create({
        model: OPENAI_VISION_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
              { type: 'text', text: EXTRACTION_PROMPT },
            ],
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 2000,
      });

      const raw = aiResponse.choices[0]?.message?.content;
      if (!raw) throw new Error('Empty response from OpenAI vision API');
      return raw;
    }

    throw new Error('No vision API client available');
  }

  async function callTextExtraction(content: string, categories: string[]): Promise<string> {
    const systemPrompt = `Extract receipt data from text. Return JSON with: merchant, date (YYYY-MM-DD), invoiceNumber, subtotal, vatPercent, vatAmount, total, currency, category, lineItems array. UAE context: 5% VAT, AED currency. Categories: ${categories.join(', ')}`;

    if (anthropic) {
      const response = await anthropic.messages.create({
        model: ANTHROPIC_VISION_MODEL,
        max_tokens: 1000,
        system: systemPrompt,
        messages: [
          { role: 'user', content: `Extract receipt data:\n\n${content}\n\nReturn ONLY a valid JSON object.` },
        ],
      });
      const block = response.content[0];
      if (block.type !== 'text') throw new Error('Unexpected response type from Anthropic');
      return block.text;
    }

    if (openai) {
      const aiResponse = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Extract receipt data:\n\n${content}` },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1000,
      });
      const raw = aiResponse.choices[0]?.message?.content;
      if (!raw) throw new Error('Empty response from OpenAI');
      return raw;
    }

    throw new Error('No text extraction API client available');
  }

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

    const { imageData, content, messageId } = req.body;

    const sanitizedMessageId = messageId ? String(messageId).slice(0, 100) : null;

    if (!anthropic && !openai) {
      console.error('[OCR] No AI client available — set OPENAI_API_KEY or ANTHROPIC_API_KEY');
      return res.status(503).json({ message: 'OCR service unavailable: set OPENAI_API_KEY or ANTHROPIC_API_KEY' });
    }

    // Vision path: image provided
    if (imageData) {
      try {
        // Validate file type: only JPEG, PNG, WebP, HEIC allowed
        const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
        const dataUrlForValidation: string = imageData.startsWith('data:') ? imageData : `data:image/jpeg;base64,${imageData}`;
        const mimeMatch = dataUrlForValidation.match(/^data:([^;]+);base64,/);
        if (mimeMatch && !ALLOWED_IMAGE_TYPES.includes(mimeMatch[1].toLowerCase())) {
          return res.status(400).json({ message: 'Invalid file type. Only JPEG, PNG, WebP, and HEIC images are allowed.' });
        }

        // Validate file size: max 10MB (base64 encodes ~33% overhead, so raw limit ~7.5MB base64 chars)
        const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB decoded
        const base64Data = dataUrlForValidation.split(',')[1] || '';
        const decodedSize = Math.floor(base64Data.length * 0.75);
        if (decodedSize > MAX_IMAGE_BYTES) {
          return res.status(400).json({ message: 'Image too large. Maximum size is 10MB.' });
        }

        // imageData may be a full data URL (data:image/...;base64,...) or raw base64
        const dataUrl: string = dataUrlForValidation;

        const raw = await callVision(dataUrl);
        console.log('[OCR] Vision API raw response:', raw.slice(0, 200));

        const result = extractJson(raw);

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
        const raw = await callTextExtraction(sanitizedContent, VALID_CATEGORIES);
        const result = extractJson(raw);

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
