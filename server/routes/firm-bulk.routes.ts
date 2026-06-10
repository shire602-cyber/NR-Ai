import { Router } from 'express';
import type { Express, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { requireFirmRole, getAccessibleCompanyIds } from '../middleware/rbac';
import { asyncHandler } from '../middleware/errorHandler';
import { db } from '../db';
import { eq, and, gte, lte, inArray, count, sum, max, not, desc } from 'drizzle-orm';
import {
  companies,
  invoices,
  invoiceLines,
  receipts,
  bankTransactions,
  vatReturns,
} from '../../shared/schema';
import { getEnv } from '../config/env';
import { storage } from '../storage';
import { UAE_VAT_RATE, DEFAULT_CURRENCY } from '../constants';

const router = Router();
router.use(authMiddleware);
router.use(requireFirmRole());

// ─── OCR helpers ──────────────────────────────────────────────────────────────

const BULK_VALID_CATEGORIES = [
  'Office Supplies', 'Utilities', 'Travel', 'Meals',
  'Rent', 'Marketing', 'Equipment', 'Professional Services',
  'Insurance', 'Maintenance', 'Communication', 'Other',
];

const BULK_OCR_PROMPT = `You are an expert receipt/invoice data extraction assistant for UAE businesses.
Extract receipt data and return a JSON object with EXACTLY these fields:
{
  "merchant": "Full business/store name",
  "date": "YYYY-MM-DD format",
  "subtotal": number (amount before VAT),
  "vatPercent": number (default 5 for UAE),
  "vatAmount": number (VAT amount),
  "total": number (final total including VAT),
  "currency": "AED or other 3-letter code",
  "category": "one of: ${BULK_VALID_CATEGORIES.join(', ')}",
  "confidence": number between 0 and 1
}
Return ONLY valid JSON. No markdown.`;

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
  const openai = !anthropic && openaiKey
    ? new OpenAI({ apiKey: openaiKey, baseURL: 'https://api.openai.com/v1' })
    : null;
  return { anthropic, openai };
}

function extractJson(raw: string): any {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse(fenced ? fenced[1].trim() : raw.trim());
}

const ALLOWED_OCR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

async function runOCR(
  imageData: string,
  anthropic: Anthropic | null,
  openai: OpenAI | null,
): Promise<{ merchant: string; date: string; amount: number; vatAmount: number; currency: string; category: string }> {
  // Validate MIME type from the data URL prefix; reject unknown/unsafe types up front.
  // Bare base64 (no data URL prefix) is rejected — clients must declare a MIME type.
  const dataUrlMatch = imageData.match(/^data:([^;]+);base64,/);
  if (!dataUrlMatch) {
    throw Object.assign(new Error('Image must be a data URL with MIME type (e.g. data:image/jpeg;base64,...)'), { status: 400 });
  }
  const declaredMime = dataUrlMatch[1].toLowerCase();
  if (!ALLOWED_OCR_MIME_TYPES.includes(declaredMime)) {
    throw Object.assign(new Error(`Unsupported image MIME type: ${declaredMime}`), { status: 400 });
  }
  const dataUrl = imageData;

  let rawText = '';
  if (anthropic) {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) throw new Error('Invalid image data URL');
    const mediaType = match[1] as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    const base64Data = match[2];
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
          { type: 'text', text: BULK_OCR_PROMPT },
        ],
      }],
    });
    const block = response.content[0];
    if (block.type !== 'text') throw new Error('Unexpected Anthropic response type');
    rawText = block.text;
  } else if (openai) {
    const aiResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
          { type: 'text', text: BULK_OCR_PROMPT },
        ],
      }],
      response_format: { type: 'json_object' },
      max_tokens: 1000,
    });
    const raw = aiResponse.choices[0]?.message?.content;
    if (!raw) throw new Error('Empty OpenAI response');
    rawText = raw;
  } else {
    throw new Error('No OCR API client available');
  }

  const result = extractJson(rawText);
  const subtotal = parseFloat(result.subtotal) || 0;
  const parsedVatPercent = parseFloat(result.vatPercent);
  const vatPercent = Number.isFinite(parsedVatPercent) ? parsedVatPercent : 5;
  const vatAmount = parseFloat(result.vatAmount) || parseFloat((subtotal * vatPercent / 100).toFixed(2));
  const category = BULK_VALID_CATEGORIES.includes(result.category) ? result.category : 'Other';
  let parsedDate = new Date().toISOString().split('T')[0];
  if (result.date && /^\d{4}-\d{2}-\d{2}$/.test(result.date)) parsedDate = result.date;

  return {
    merchant: result.merchant ? String(result.merchant).slice(0, 200) : 'Unknown Merchant',
    date: parsedDate,
    amount: subtotal,
    vatAmount,
    currency: result.currency ? String(result.currency).slice(0, 3).toUpperCase() : DEFAULT_CURRENCY,
    category,
  };
}

// ─── POST /api/firm/bulk/ocr ──────────────────────────────────────────────────

const bulkOcrSchema = z.object({
  items: z.array(z.object({
    companyId: z.string().uuid(),
    imageData: z.string().min(1),
    filename: z.string().optional(),
  })).min(1).max(20),
});

router.post('/bulk/ocr', asyncHandler(async (req: Request, res: Response) => {
  const { id: userId, firmRole } = (req as any).user;
  const { items } = bulkOcrSchema.parse(req.body);

  const accessibleIds = await getAccessibleCompanyIds(userId, firmRole ?? '');

  for (const item of items) {
    if (accessibleIds !== null && !accessibleIds.includes(item.companyId)) {
      return res.status(403).json({ message: `Access denied to company ${item.companyId}` });
    }
  }

  const { anthropic, openai } = initOCRClients();
  if (!anthropic && !openai) {
    return res.status(503).json({ message: 'OCR service unavailable — set ANTHROPIC_API_KEY or OPENAI_API_KEY' });
  }

  const results: Array<{
    companyId: string;
    filename?: string;
    success: boolean;
    receiptId?: string;
    error?: string;
  }> = [];

  for (const item of items) {
    try {
      const extracted = await runOCR(item.imageData, anthropic, openai);
      const receipt = await storage.createReceipt({
        companyId: item.companyId,
        merchant: extracted.merchant,
        date: extracted.date ? new Date(extracted.date) : null,
        amount: extracted.amount,
        vatAmount: extracted.vatAmount,
        currency: extracted.currency,
        exchangeRate: 1,
        baseCurrencyAmount: extracted.amount,
        category: extracted.category,
        posted: false,
        uploadedBy: userId,
      });
      results.push({ companyId: item.companyId, filename: item.filename, success: true, receiptId: receipt.id });
    } catch (err: any) {
      results.push({ companyId: item.companyId, filename: item.filename, success: false, error: err?.message || 'OCR failed' });
    }
  }

  res.json({ results });
}));

// ─── POST /api/firm/bulk/vat-queue ────────────────────────────────────────────

router.post('/bulk/vat-queue', asyncHandler(async (req: Request, res: Response) => {
  const { id: userId, firmRole } = (req as any).user;
  const accessibleIds = await getAccessibleCompanyIds(userId, firmRole ?? '');

  let clientCompanies: typeof companies.$inferSelect[];

  if (accessibleIds === null) {
    clientCompanies = await db.select().from(companies).where(eq(companies.companyType, 'client'));
  } else if (accessibleIds.length === 0) {
    clientCompanies = [];
  } else {
    clientCompanies = await db.select().from(companies)
      .where(and(eq(companies.companyType, 'client'), inArray(companies.id, accessibleIds)));
  }

  const body = req.body as { companyIds?: string[] };
  if (body.companyIds?.length) {
    clientCompanies = clientCompanies.filter(c => body.companyIds!.includes(c.id));
  }

  const now = new Date();
  const quarter = Math.floor(now.getMonth() / 3);
  const period = `Q${quarter + 1} ${now.getFullYear()}`;

  // Restrict aggregation to the current quarter so the queue reflects only
  // the live VAT period rather than all-time totals across the company.
  const periodStart = new Date(now.getFullYear(), quarter * 3, 1);
  const periodEnd = new Date(now.getFullYear(), quarter * 3 + 3, 0, 23, 59, 59);

  const queue = await Promise.all(clientCompanies.map(async (company) => {
    const [salesRow] = await db
      .select({ total: sum(invoices.subtotal), vat: sum(invoices.vatAmount) })
      .from(invoices)
      .where(and(
        eq(invoices.companyId, company.id),
        gte(invoices.date, periodStart),
        lte(invoices.date, periodEnd),
        not(inArray(invoices.status, ['draft', 'void', 'cancelled'])),
      ));

    const [purchasesRow] = await db
      .select({ total: sum(receipts.amount), vat: sum(receipts.vatAmount) })
      .from(receipts)
      .where(and(
        eq(receipts.companyId, company.id),
        eq(receipts.posted, true),
        gte(receipts.date, periodStart),
        lte(receipts.date, periodEnd),
      ));

    const [latestVat] = await db
      .select({ status: vatReturns.status })
      .from(vatReturns)
      .where(eq(vatReturns.companyId, company.id))
      .orderBy(desc(vatReturns.periodEnd))
      .limit(1);

    const totalSales = Number(salesRow?.total ?? 0);
    const totalPurchases = Number(purchasesRow?.total ?? 0);
    const salesVat = Number(salesRow?.vat ?? 0);
    const purchasesVat = Number(purchasesRow?.vat ?? 0);
    const vatPayable = Math.max(0, salesVat - purchasesVat);

    return {
      companyId: company.id,
      companyName: company.name,
      trn: company.trnVatNumber ?? 'N/A',
      period,
      totalSales,
      totalPurchases,
      vatPayable,
      status: (latestVat?.status ?? 'draft') as string,
    };
  }));

  res.json(queue);
}));

// ─── POST /api/firm/bulk/invoices ─────────────────────────────────────────────

const bulkInvoicesSchema = z.object({
  companyIds: z.array(z.string().uuid()).min(1),
  serviceDescription: z.string().min(1).max(500),
  amount: z.number().positive(),
  vatRate: z.number().min(0).max(1).default(UAE_VAT_RATE),
});

router.post('/bulk/invoices', asyncHandler(async (req: Request, res: Response) => {
  const { id: userId, firmRole } = (req as any).user;
  const { companyIds, serviceDescription, amount, vatRate } = bulkInvoicesSchema.parse(req.body);

  const accessibleIds = await getAccessibleCompanyIds(userId, firmRole ?? '');

  for (const companyId of companyIds) {
    if (accessibleIds !== null && !accessibleIds.includes(companyId)) {
      return res.status(403).json({ message: `Access denied to company ${companyId}` });
    }
  }

  const targetCompanies = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(inArray(companies.id, companyIds));

  const vatAmount = parseFloat((amount * vatRate).toFixed(2));
  const total = parseFloat((amount + vatAmount).toFixed(2));
  const dateStr = new Date().toISOString().split('T')[0];

  const results: Array<{
    companyId: string;
    companyName: string;
    success: boolean;
    invoiceId?: string;
    invoiceNumber?: string;
    error?: string;
  }> = [];

  for (let i = 0; i < targetCompanies.length; i++) {
    const company = targetCompanies[i];
    try {
      const invoiceNumber = `NRA-${dateStr.replace(/-/g, '')}-${String(i + 1).padStart(3, '0')}`;
      const invoice = await storage.createInvoice({
        companyId: company.id,
        number: invoiceNumber,
        customerName: company.name,
        date: new Date(),
        currency: DEFAULT_CURRENCY,
        exchangeRate: 1,
        baseCurrencyAmount: total,
        subtotal: amount,
        vatAmount,
        total,
        status: 'draft',
        invoiceType: 'invoice',
        isRecurring: false,
      });

      await storage.createInvoiceLine({
        invoiceId: invoice.id,
        description: serviceDescription,
        quantity: 1,
        unitPrice: amount,
        vatRate,
        vatSupplyType: 'standard_rated',
      });

      results.push({ companyId: company.id, companyName: company.name, success: true, invoiceId: invoice.id, invoiceNumber });
    } catch (err: any) {
      results.push({ companyId: company.id, companyName: company.name, success: false, error: err?.message || 'Invoice creation failed' });
    }
  }

  res.json({ results });
}));

// ─── POST /api/firm/bulk/period-close ────────────────────────────────────────

const periodCloseSchema = z.object({
  companyIds: z.array(z.string().uuid()).min(1),
  period: z.string().min(1),
});

router.post('/bulk/period-close', asyncHandler(async (req: Request, res: Response) => {
  const { id: userId, firmRole } = (req as any).user;
  const { companyIds, period } = periodCloseSchema.parse(req.body);

  const accessibleIds = await getAccessibleCompanyIds(userId, firmRole ?? '');

  for (const companyId of companyIds) {
    if (accessibleIds !== null && !accessibleIds.includes(companyId)) {
      return res.status(403).json({ message: `Access denied to company ${companyId}` });
    }
  }

  const targetCompanies = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(inArray(companies.id, companyIds));

  const statuses = await Promise.all(targetCompanies.map(async (company: { id: string; name: string }) => {
    const issues: string[] = [];

    // Check unposted receipts
    const [unpostedReceipts] = await db
      .select({ cnt: count() })
      .from(receipts)
      .where(and(eq(receipts.companyId, company.id), eq(receipts.posted, false)));
    const allReceiptsPosted = Number(unpostedReceipts?.cnt ?? 0) === 0;
    if (!allReceiptsPosted) issues.push(`${unpostedReceipts?.cnt} unposted receipt(s)`);

    // Check unreconciled bank transactions
    const [unreconciledTx] = await db
      .select({ cnt: count() })
      .from(bankTransactions)
      .where(and(eq(bankTransactions.companyId, company.id), eq(bankTransactions.isReconciled, false)));
    const bankRecDone = Number(unreconciledTx?.cnt ?? 0) === 0;
    if (!bankRecDone) issues.push(`${unreconciledTx?.cnt} unreconciled transaction(s)`);

    // Check VAT return prepared
    const [latestVat] = await db
      .select({ status: vatReturns.status })
      .from(vatReturns)
      .where(eq(vatReturns.companyId, company.id))
      .orderBy(desc(vatReturns.periodEnd))
      .limit(1);
    const vatStatus = latestVat?.status ?? 'none';
    const vatPrepared = vatStatus !== 'none' && vatStatus !== 'draft';
    if (!vatPrepared) issues.push('VAT return not prepared');

    // Trial balance: check invoices and receipts are balanced (simplified check)
    const [invoiceSum] = await db
      .select({ total: sum(invoices.total) })
      .from(invoices)
      .where(eq(invoices.companyId, company.id));
    const [receiptSum] = await db
      .select({ total: sum(receipts.amount) })
      .from(receipts)
      .where(eq(receipts.companyId, company.id));
    const hasActivity = Number(invoiceSum?.total ?? 0) > 0 || Number(receiptSum?.total ?? 0) > 0;
    const trialBalanceOk = hasActivity;
    if (!hasActivity) issues.push('No financial activity found');

    return {
      companyId: company.id,
      companyName: company.name,
      period,
      checks: {
        trialBalanceOk,
        bankRecDone,
        allReceiptsPosted,
        vatPrepared,
      },
      issues,
      readyToClose: issues.length === 0,
    };
  }));

  res.json(statuses);
}));

// ─── GET /api/firm/bulk/bank-import-status ────────────────────────────────────

router.get('/bulk/bank-import-status', asyncHandler(async (req: Request, res: Response) => {
  const { id: userId, firmRole } = (req as any).user;
  const accessibleIds = await getAccessibleCompanyIds(userId, firmRole ?? '');

  let clientCompanies: typeof companies.$inferSelect[];

  if (accessibleIds === null) {
    clientCompanies = await db.select().from(companies).where(eq(companies.companyType, 'client'));
  } else if (accessibleIds.length === 0) {
    clientCompanies = [];
  } else {
    clientCompanies = await db.select().from(companies)
      .where(and(eq(companies.companyType, 'client'), inArray(companies.id, accessibleIds)));
  }

  const statuses = await Promise.all(clientCompanies.map(async (company) => {
    const [lastImport] = await db
      .select({ lastDate: max(bankTransactions.createdAt) })
      .from(bankTransactions)
      .where(eq(bankTransactions.companyId, company.id));

    const [totalTx] = await db
      .select({ cnt: count() })
      .from(bankTransactions)
      .where(eq(bankTransactions.companyId, company.id));

    const [reconciledTx] = await db
      .select({ cnt: count() })
      .from(bankTransactions)
      .where(and(eq(bankTransactions.companyId, company.id), eq(bankTransactions.isReconciled, true)));

    const [unreconciledTx] = await db
      .select({ cnt: count() })
      .from(bankTransactions)
      .where(and(eq(bankTransactions.companyId, company.id), eq(bankTransactions.isReconciled, false)));

    const total = Number(totalTx?.cnt ?? 0);
    const reconciled = Number(reconciledTx?.cnt ?? 0);
    const unreconciled = Number(unreconciledTx?.cnt ?? 0);
    const matchRate = total > 0 ? Math.round((reconciled / total) * 100) : 0;

    return {
      companyId: company.id,
      companyName: company.name,
      lastImportDate: lastImport?.lastDate ?? null,
      unreconciledCount: unreconciled,
      totalTransactions: total,
      matchRate,
    };
  }));

  res.json(statuses);
}));

// ─── Registration ──────────────────────────────────────────────────────────────

export function registerFirmBulkRoutes(app: Express): void {
  app.use('/api/firm', router);
}
