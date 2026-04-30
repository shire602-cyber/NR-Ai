import { type Express, type Request, type Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { z } from 'zod';
import { storage } from '../storage';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { getEnv } from '../config/env';
import { createLogger } from '../config/logger';
import {
  buildOcrReceiptsWorkbook,
  buildExportFilename,
  type OcrExportRow,
} from '../services/excel-export.service';
import { classifyOcrReceipt } from '../services/receipt-autopilot.service';
import { isStandardCategory } from '../services/receipt-classifier.service';

const log = createLogger('ocr');

// Smart key detection: ANTHROPIC_API_KEY preferred; OPENAI_API_KEY with sk-ant-
// prefix is treated as an Anthropic key (common Railway misconfiguration).
function initOCRClients() {
  const env = getEnv();
  const anthropicKey =
    env.ANTHROPIC_API_KEY ||
    (env.OPENAI_API_KEY?.startsWith('sk-ant-') ? env.OPENAI_API_KEY : undefined);
  const openaiKey =
    env.OPENAI_API_KEY && !env.OPENAI_API_KEY.startsWith('sk-ant-')
      ? env.OPENAI_API_KEY
      : undefined;
  const anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null;
  const openai = !anthropic && openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;
  return { anthropic, openai };
}

function extractJson(raw: string): any {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse(fenced ? fenced[1].trim() : raw.trim());
}

export function registerOCRRoutes(app: Express) {
  const { anthropic, openai } = initOCRClients();

  // ===========================
  // OCR Processing Endpoint
  // ===========================

  app.post("/api/ocr/process", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { messageId, content, imageData, companyId: requestedCompanyId } = req.body;

    // Phase 2 enriches the OCR result with the company's per-tenant classifier
    // (training data + rules). The active company MUST come from the request so
    // a multi-company user (firm_owner, firm_admin, or anyone with multiple
    // companies) gets predictions trained on the correct tenant's data — never
    // company A's model bleeding into a receipt being processed for company B.
    let companyId: string;
    if (requestedCompanyId && typeof requestedCompanyId === 'string') {
      const hasAccess = await storage.hasCompanyAccess(userId, requestedCompanyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }
      companyId = requestedCompanyId;
    } else {
      // Backwards-compat fallback for older clients: only safe when the user
      // has exactly one company. For multi-company users we require an
      // explicit companyId so we never silently pick the wrong tenant.
      const companies = await storage.getCompaniesByUserId(userId);
      if (companies.length === 0) {
        return res.status(404).json({ message: 'No company found' });
      }
      if (companies.length > 1) {
        return res.status(400).json({
          message: 'companyId is required when the user has access to multiple companies',
        });
      }
      companyId = companies[0].id;
    }

    const sanitizedContent = content ? String(content).slice(0, 10000) : '';
    const sanitizedMessageId = messageId ? String(messageId).slice(0, 100) : null;

    const validCategories = [
      'Office Supplies', 'Utilities', 'Travel', 'Meals',
      'Rent', 'Marketing', 'Equipment', 'Professional Services',
      'Insurance', 'Maintenance', 'Communication', 'Other'
    ];

    if (!anthropic && !openai) {
      log.warn('OCR called but no AI key configured (ANTHROPIC_API_KEY or OPENAI_API_KEY)');
      return res.status(503).json({
        message: 'OCR service unavailable — AI provider not configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.',
      });
    }

    if (!imageData && !sanitizedContent) {
      return res.status(400).json({ message: 'Missing imageData or content' });
    }

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

    // Helper: post-process AI extraction → run our internal classifier on the
    // merchant. Overrides AI's category if our classifier is more confident
    // (≥ 0.8) — the same threshold as Phase 2's auto-fallback rule.
    const enrichWithInternalClassifier = async (aiResult: any) => {
      try {
        const merchant = (aiResult?.merchant && String(aiResult.merchant)) || 'Unknown Merchant';
        const lineItems = Array.isArray(aiResult?.lineItems)
          ? aiResult.lineItems.map((li: any) => String(li?.description || ''))
          : [];
        const subtotal = parseFloat(aiResult?.subtotal) || 0;
        const result = await classifyOcrReceipt(companyId, {
          merchant,
          amount: subtotal,
          lineItems,
        });
        // Only override the AI category when our classifier is at-or-above its
        // own confidence threshold. The AI's confidence is on the OCR
        // extraction (numbers/date/total), not the category — so we surface
        // both and let the caller see how the category was determined.
        if (result.confidence >= 0.8 && isStandardCategory(result.category)) {
          aiResult.category = result.category;
        }
        aiResult._classifier = {
          method: result.method,
          confidence: result.confidence,
          reason: result.reason,
        };
      } catch (err: any) {
        log.warn({ err: err?.message || err }, 'Internal classifier enrichment failed');
      }
      return aiResult;
    };

    // Strategy 1: Vision API with image (Anthropic preferred, OpenAI fallback)
    if (imageData) {
      try {
        const aiResult = await runVisionOCR(imageData, extractionPrompt, anthropic, openai);
        await enrichWithInternalClassifier(aiResult);
        return res.json(buildResult(aiResult, sanitizedContent, companyId, sanitizedMessageId, validCategories));
      } catch (visionError: any) {
        const provider = anthropic ? 'Anthropic' : 'OpenAI';
        const detail = visionError?.message || String(visionError);
        log.error({ err: detail, provider }, 'Vision OCR failed');

        // If we have no text fallback, surface the actual provider error so the
        // client can show something useful instead of a generic message.
        if (!sanitizedContent) {
          return res.status(502).json({
            message: `OCR vision request to ${provider} failed: ${detail}`,
          });
        }
        // Otherwise fall through to text-based extraction below
      }
    }

    // Strategy 2: Text-based extraction (no image, or vision failed but text given)
    if (sanitizedContent) {
      try {
        const aiResult = await runTextOCR(sanitizedContent, extractionPrompt, anthropic, openai);
        await enrichWithInternalClassifier(aiResult);
        return res.json(buildResult(aiResult, sanitizedContent, companyId, sanitizedMessageId, validCategories));
      } catch (textError: any) {
        const provider = anthropic ? 'Anthropic' : 'OpenAI';
        const detail = textError?.message || String(textError);
        log.error({ err: detail, provider }, 'Text OCR failed');
        return res.status(502).json({
          message: `OCR text extraction via ${provider} failed: ${detail}`,
        });
      }
    }

    return res.status(400).json({ message: 'Missing imageData or content' });
  }));

  // ===========================
  // Excel Export — in-flight OCR rows
  // ===========================
  // Accepts the rows the client has just extracted (and possibly edited) and
  // streams back an .xlsx file with Date / Vendor / Invoice No. / Amount / VAT
  // columns. The same shape is reused for the saved-receipt bulk export so the
  // client only has to know one schema.
  app.post(
    "/api/ocr/export-excel",
    authMiddleware,
    validate({ body: ocrExportSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { rows, filename } = req.body as z.infer<typeof ocrExportSchema>;
      const buffer = await buildOcrReceiptsWorkbook(rows as OcrExportRow[], {
        sheetName: 'OCR Receipts',
        title: 'Muhasib OCR Export',
      });
      const safeName = filename
        ? `${filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)}.xlsx`
        : buildExportFilename();

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
      res.setHeader('Content-Length', String(buffer.length));
      res.setHeader('Cache-Control', 'no-store');
      res.send(buffer);
    }),
  );
}

// Schema for the in-flight OCR export. Strict enough to reject obvious junk
// but tolerant of partial data — empty cells render as blanks, not "null".
const ocrExportRowSchema = z.object({
  date: z.union([z.string().max(40), z.null()]).optional(),
  vendor: z.union([z.string().max(200), z.null()]).optional(),
  invoiceNumber: z.union([z.string().max(100), z.null()]).optional(),
  amount: z.union([z.number(), z.string().max(40), z.null()]).optional(),
  vat: z.union([z.number(), z.string().max(40), z.null()]).optional(),
  currency: z.union([z.string().max(10), z.null()]).optional(),
});

const ocrExportSchema = z.object({
  rows: z.array(ocrExportRowSchema).min(1, 'At least one row is required').max(5000),
  filename: z.string().max(80).optional(),
});

async function runVisionOCR(
  imageData: string,
  prompt: string,
  anthropic: Anthropic | null,
  openai: OpenAI | null,
): Promise<any> {
  // Parse the data URL once for both providers.
  let base64Data = imageData;
  let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg';

  const dataUrlMatch = imageData.match(/^data:([^;]+);base64,(.+)$/s);
  if (dataUrlMatch) {
    const mimeType = dataUrlMatch[1];
    base64Data = dataUrlMatch[2];
    if (mimeType.includes('png')) mediaType = 'image/png';
    else if (mimeType.includes('webp')) mediaType = 'image/webp';
    else if (mimeType.includes('gif')) mediaType = 'image/gif';
    else mediaType = 'image/jpeg';
  }

  if (anthropic) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });
    const block = response.content[0];
    if (!block || block.type !== 'text') {
      throw new Error('Unexpected Anthropic response (no text block)');
    }
    return extractJson(block.text);
  }

  if (openai) {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64Data}`, detail: 'high' } },
            { type: 'text', text: prompt },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1500,
    });
    const raw = response.choices[0]?.message?.content;
    if (!raw) throw new Error('Empty OpenAI response');
    return JSON.parse(raw);
  }

  throw new Error('No vision client available');
}

async function runTextOCR(
  textContent: string,
  prompt: string,
  anthropic: Anthropic | null,
  openai: OpenAI | null,
): Promise<any> {
  const userMessage = `Extract receipt data from this OCR text:\n\n${textContent}`;

  if (anthropic) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: prompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    const block = response.content[0];
    if (!block || block.type !== 'text') {
      throw new Error('Unexpected Anthropic response (no text block)');
    }
    return extractJson(block.text);
  }

  if (openai) {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: userMessage },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1500,
    });
    const raw = response.choices[0]?.message?.content;
    if (!raw) throw new Error('Empty OpenAI response');
    return JSON.parse(raw);
  }

  throw new Error('No text client available');
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
  // Treat null/undefined as missing (default to 5% for UAE); explicit 0 means zero-rated
  const vatPercentage = aiResult.vatPercentage === null || aiResult.vatPercentage === undefined
    ? 5
    : parseNonNegative(aiResult.vatPercentage);
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
    classifier: aiResult._classifier || null,
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
