import { Router, type Express, type Request, type Response } from 'express';
import { storage } from '../storage';
import OpenAI from 'openai';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { getEnv } from '../config/env';

export function registerOCRRoutes(app: Express) {
  const apiKey = getEnv().OPENAI_API_KEY;
  const openai = apiKey ? new OpenAI({ apiKey }) : null;

  // ===========================
  // OCR Processing Endpoint
  // ===========================

  app.post("/api/ocr/process", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const companies = await storage.getCompaniesByUserId(userId);
    if (companies.length === 0) {
      return res.status(404).json({ message: 'No company found' });
    }
    const companyId = companies[0].id;

    const { messageId, mediaId, content, imageData } = req.body;

    const sanitizedContent = content ? String(content).slice(0, 10000) : '';
    const sanitizedMessageId = messageId ? String(messageId).slice(0, 100) : null;

    const defaultResult = {
      merchant: 'Unknown Merchant',
      date: new Date().toISOString().split('T')[0],
      invoiceNumber: null,
      subtotal: 0,
      vatPercentage: 5,
      vatAmount: 0,
      total: 0,
      currency: 'AED',
      category: 'Other',
      lineItems: [],
      confidence: 0.3,
      rawText: sanitizedContent,
      companyId,
      messageId: sanitizedMessageId,
    };

    if (!openai) {
      return res.json(defaultResult);
    }

    const validCategories = [
      'Office Supplies', 'Utilities', 'Travel', 'Meals',
      'Rent', 'Marketing', 'Equipment', 'Professional Services',
      'Insurance', 'Maintenance', 'Communication', 'Other'
    ];

    const extractionPrompt = `You are an expert accountant specializing in UAE business receipt and invoice processing. Analyze this receipt/invoice image carefully and extract ALL financial data with high precision.

Extract the following fields. Be extremely precise with numbers — read every digit carefully:

1. merchant: The exact business/supplier name as printed (include LLC, Co., etc.)
2. date: Transaction date in YYYY-MM-DD format. Check for formats like DD/MM/YYYY, MM-DD-YYYY, written dates (15 Jan 2025), Arabic dates. If not found use today.
3. invoiceNumber: Invoice/receipt/transaction number or reference (look for "Invoice No", "Receipt No", "Ref", "TRN", "#", bill number, etc.)
4. subtotal: The amount BEFORE VAT/tax (look for "Subtotal", "Net Amount", "Before Tax", "Excl. VAT"). Number only.
5. vatPercentage: The VAT/tax rate percentage (default 5 for UAE). Number only.
6. vatAmount: The exact VAT/tax amount charged (look for "VAT", "Tax Amount", "VAT 5%"). Number only.
7. total: The FINAL total amount paid including VAT (look for "Total", "Grand Total", "Amount Due", "Total Due", "Net Payable"). This is typically the largest amount. Number only.
8. currency: Currency code (AED, USD, EUR, etc.). Default AED for UAE receipts.
9. category: Classify into one of: ${validCategories.join(', ')}
10. lineItems: Array of items. Each item: { "description": string, "quantity": number, "unitPrice": number, "total": number }

IMPORTANT RULES:
- The "total" field must be the grand total INCLUDING VAT — the final amount the customer pays
- If you see only one amount, treat it as the total. Calculate subtotal = total / 1.05 for UAE receipts
- If subtotal and vatAmount are both found but no total, compute total = subtotal + vatAmount
- If total and vatAmount are both found but no subtotal, compute subtotal = total - vatAmount
- For Arabic text: read right-to-left, extract numbers regardless of language
- Numbers may use commas as thousands separators (1,234.56) — parse correctly
- Amounts may show as "AED 1,234.56" or "1,234.56 AED" or just "1,234.56"
- Look for TRN (Tax Registration Number) which indicates a VAT-registered business

Respond ONLY with valid JSON matching this exact structure:
{
  "merchant": "string",
  "date": "YYYY-MM-DD",
  "invoiceNumber": "string or null",
  "subtotal": number,
  "vatPercentage": number,
  "vatAmount": number,
  "total": number,
  "currency": "string",
  "category": "string",
  "lineItems": [{"description": "string", "quantity": number, "unitPrice": number, "total": number}],
  "confidence": number between 0 and 1
}`;

    // Strategy 1: Vision API with image
    if (imageData) {
      try {
        // imageData is a data URL (data:image/jpeg;base64,...) — extract the base64 part
        let base64Data = imageData;
        let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg';

        const dataUrlMatch = imageData.match(/^data:([^;]+);base64,(.+)$/);
        if (dataUrlMatch) {
          const mimeType = dataUrlMatch[1];
          base64Data = dataUrlMatch[2];
          if (mimeType.includes('png')) mediaType = 'image/png';
          else if (mimeType.includes('webp')) mediaType = 'image/webp';
          else if (mimeType.includes('gif')) mediaType = 'image/gif';
          else mediaType = 'image/jpeg';
        }

        const visionResponse = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${mediaType};base64,${base64Data}`,
                    detail: 'high',
                  },
                },
                {
                  type: 'text',
                  text: extractionPrompt,
                },
              ],
            },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 1500,
        });

        const raw = visionResponse.choices[0]?.message?.content || '{}';
        const aiResult = JSON.parse(raw);

        return res.json(buildResult(aiResult, sanitizedContent, companyId, sanitizedMessageId, validCategories));
      } catch (visionError: any) {
        console.error('[OCR] Vision API error:', visionError?.message || visionError);
        // Fall through to text-based extraction
      }
    }

    // Strategy 2: Text-based extraction (when image not provided or vision failed)
    if (sanitizedContent) {
      try {
        const textResponse = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: extractionPrompt,
            },
            {
              role: 'user',
              content: `Extract receipt data from this OCR text:\n\n${sanitizedContent}`,
            },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 1500,
        });

        const raw = textResponse.choices[0]?.message?.content || '{}';
        const aiResult = JSON.parse(raw);

        return res.json(buildResult(aiResult, sanitizedContent, companyId, sanitizedMessageId, validCategories));
      } catch (textError: any) {
        console.error('[OCR] Text extraction error:', textError?.message || textError);
      }
    }

    return res.json(defaultResult);
  }));
}

function buildResult(
  aiResult: any,
  rawText: string,
  companyId: string,
  messageId: string | null,
  validCategories: string[],
) {
  const subtotal = parseNonNegative(aiResult.subtotal);
  const vatAmount = parseNonNegative(aiResult.vatAmount);
  const vatPercentage = parseNonNegative(aiResult.vatPercentage) || 5;
  let total = parseNonNegative(aiResult.total);

  // Reconcile amounts if any are missing
  if (total === 0 && subtotal > 0) {
    total = parseFloat((subtotal + vatAmount).toFixed(2));
  }
  const derivedSubtotal = subtotal > 0 ? subtotal : (total > 0 ? parseFloat((total / (1 + vatPercentage / 100)).toFixed(2)) : 0);
  const derivedVat = vatAmount > 0 ? vatAmount : parseFloat((derivedSubtotal * vatPercentage / 100).toFixed(2));
  const derivedTotal = total > 0 ? total : parseFloat((derivedSubtotal + derivedVat).toFixed(2));

  const category = validCategories.includes(aiResult.category) ? aiResult.category : 'Other';

  let parsedDate = new Date().toISOString().split('T')[0];
  if (aiResult.date && /^\d{4}-\d{2}-\d{2}$/.test(aiResult.date)) {
    parsedDate = aiResult.date;
  }

  const lineItems = Array.isArray(aiResult.lineItems)
    ? aiResult.lineItems.map((item: any) => ({
        description: String(item.description || '').slice(0, 500),
        quantity: parseNonNegative(item.quantity) || 1,
        unitPrice: parseNonNegative(item.unitPrice),
        total: parseNonNegative(item.total),
      }))
    : [];

  return {
    merchant: aiResult.merchant ? String(aiResult.merchant).slice(0, 200) : 'Unknown Merchant',
    date: parsedDate,
    invoiceNumber: aiResult.invoiceNumber ? String(aiResult.invoiceNumber).slice(0, 100) : null,
    subtotal: derivedSubtotal,
    vatPercentage,
    vatAmount: derivedVat,
    total: derivedTotal,
    // Legacy field names for backward compatibility with client
    amount: derivedSubtotal,
    currency: aiResult.currency ? String(aiResult.currency).slice(0, 10) : 'AED',
    category,
    lineItems,
    confidence: typeof aiResult.confidence === 'number' ? Math.min(1, Math.max(0, aiResult.confidence)) : 0.85,
    rawText,
    companyId,
    messageId,
  };
}

function parseNonNegative(val: any): number {
  if (val === null || val === undefined) return 0;
  const n = parseFloat(String(val).replace(/,/g, ''));
  return !isNaN(n) && n >= 0 ? n : 0;
}
