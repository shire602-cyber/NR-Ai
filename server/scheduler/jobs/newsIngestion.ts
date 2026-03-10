/**
 * News Ingestion Job
 * ──────────────────
 * Fetches tax and compliance news from UAE sources,
 * summarizes via OpenAI, and auto-translates to Somali + Arabic.
 *
 * Schedule: Daily at 10:00 AM UAE time
 *
 * Sources:
 * - UAE Federal Tax Authority (FTA)
 * - Ministry of Finance (MoF)
 * - Gulf News Business
 * - Khaleej Times Business
 *
 * Pipeline:
 * 1. Fetch from RSS/web sources
 * 2. Filter for tax/compliance relevance
 * 3. Summarize with OpenAI
 * 4. Store in regulatoryNews table
 * 5. Auto-translate to Somali + Arabic
 * 6. Queue for admin review (translations not auto-sent)
 */

import OpenAI from 'openai';
import { createLogger } from '../../config/logger';
import { getOpenAIKey, getAIModel } from '../../config/settings';
import { storage } from '../../storage';
import { translateNewsToAllLanguages } from '../../services/translationService';
import { sanitizeForAI } from '../../utils/locale';

const log = createLogger('news-ingestion');

// ── News Sources ────────────────────────────────────────────────

interface NewsSource {
  name: string;
  url: string;
  type: 'rss' | 'web';
  category: string;
}

const NEWS_SOURCES: NewsSource[] = [
  {
    name: 'UAE FTA - Tax Updates',
    url: 'https://tax.gov.ae/en/latest-news.aspx',
    type: 'web',
    category: 'vat',
  },
  {
    name: 'UAE Ministry of Finance',
    url: 'https://www.mof.gov.ae/en/resourcesAndBudget/Pages/news.aspx',
    type: 'web',
    category: 'general',
  },
  {
    name: 'Gulf News - Business',
    url: 'https://gulfnews.com/business/rss',
    type: 'rss',
    category: 'general',
  },
  {
    name: 'Khaleej Times - Business',
    url: 'https://www.khaleejtimes.com/business/rss',
    type: 'rss',
    category: 'general',
  },
];

// ── Types ───────────────────────────────────────────────────────

interface RawNewsItem {
  title: string;
  summary: string;
  content?: string;
  source: string;
  sourceUrl?: string;
  publishedAt?: Date;
}

interface ProcessedNewsItem {
  title: string;
  summary: string;
  content?: string;
  category: string;
  source: string;
  sourceUrl?: string;
  importance: 'low' | 'normal' | 'high' | 'critical';
  effectiveDate?: Date;
  isRelevant: boolean;
}

// ── Main Job Handler ────────────────────────────────────────────

/**
 * Main entry point for the news ingestion job.
 * Called by the scheduler daily at 10:00 AM UAE.
 */
export async function runNewsIngestion(): Promise<void> {
  log.info('Starting news ingestion job');

  const openai = await getOpenAIClientForNews();
  if (!openai) {
    log.warn('OpenAI not configured — skipping news ingestion (AI-dependent)');
    return;
  }

  let totalFetched = 0;
  let totalStored = 0;
  let totalTranslated = 0;

  // ── Load existing news ONCE for duplicate detection ──────────
  // This prevents N queries per news item (was fetching full table each time)
  const existingTitleSet = await buildExistingTitleSet();
  log.info({ existingCount: existingTitleSet.size }, 'Loaded existing news titles for dedup');

  // Process each source
  for (const source of NEWS_SOURCES) {
    try {
      log.info({ source: source.name }, 'Fetching news from source');

      // Fetch raw news
      const rawItems = await fetchNewsFromSource(source);
      totalFetched += rawItems.length;

      if (rawItems.length === 0) {
        log.info({ source: source.name }, 'No new items found');
        continue;
      }

      // Process and filter with AI
      for (const item of rawItems) {
        try {
          const processed = await processNewsItem(openai, item, source.category);

          if (!processed.isRelevant) {
            log.debug({ title: item.title }, 'News item filtered as irrelevant');
            continue;
          }

          // Check for duplicates using the pre-loaded set
          if (isDuplicateTitle(processed.title, existingTitleSet)) {
            log.debug({ title: processed.title }, 'Duplicate news item, skipping');
            continue;
          }

          // Store in database
          const stored = await storage.createRegulatoryNews({
            title: processed.title,
            summary: processed.summary,
            content: processed.content,
            category: processed.category,
            source: processed.source,
            sourceUrl: processed.sourceUrl,
            importance: processed.importance,
            effectiveDate: processed.effectiveDate,
            isActive: true,
            publishedAt: new Date(),
          });
          totalStored++;

          // Add to dedup set so subsequent items in this run are also checked
          existingTitleSet.add(normalizeTitle(processed.title));

          // Auto-translate to all languages
          try {
            const translations = await translateNewsToAllLanguages(stored.id);
            const translatedCount = Array.from(translations.values()).filter(t => t !== null).length;
            totalTranslated += translatedCount;
            log.info(
              { newsId: stored.id, languages: translatedCount },
              'News translated',
            );
          } catch (translationError: any) {
            log.error(
              { newsId: stored.id, error: translationError.message },
              'Failed to translate news (non-fatal)',
            );
          }
        } catch (itemError: any) {
          log.error(
            { title: item.title, error: itemError.message },
            'Failed to process news item',
          );
        }
      }
    } catch (sourceError: any) {
      log.error(
        { source: source.name, error: sourceError.message },
        'Failed to fetch from news source',
      );
    }
  }

  log.info(
    { fetched: totalFetched, stored: totalStored, translated: totalTranslated },
    'News ingestion job completed',
  );
}

// ── News Fetching ───────────────────────────────────────────────

/**
 * Fetch news items from a source.
 * Uses simple HTTP + text parsing (no heavy RSS library needed).
 */
async function fetchNewsFromSource(source: NewsSource): Promise<RawNewsItem[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

    const response = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Muhasib.ai News Bot/1.0 (NR Accounting Services)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      log.warn(
        { source: source.name, status: response.status },
        'Failed to fetch news source',
      );
      return [];
    }

    const text = await response.text();

    if (source.type === 'rss') {
      return parseRSSFeed(text, source.name);
    } else {
      return parseWebPage(text, source);
    }
  } catch (error: any) {
    if (error.name === 'AbortError') {
      log.warn({ source: source.name }, 'News fetch timed out');
    } else {
      log.warn(
        { source: source.name, error: error.message },
        'Error fetching news source',
      );
    }
    return [];
  }
}

/**
 * Parse RSS XML feed into news items.
 * Simple regex-based parser (no XML library needed).
 */
function parseRSSFeed(xml: string, sourceName: string): RawNewsItem[] {
  const items: RawNewsItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null && items.length < 10) {
    const itemXml = match[1];

    const title = extractXmlTag(itemXml, 'title');
    const description = extractXmlTag(itemXml, 'description');
    const link = extractXmlTag(itemXml, 'link');
    const pubDate = extractXmlTag(itemXml, 'pubDate');

    if (title && description) {
      items.push({
        title: cleanHtml(title),
        summary: cleanHtml(description).substring(0, 500),
        source: sourceName,
        sourceUrl: link || undefined,
        publishedAt: pubDate ? new Date(pubDate) : undefined,
      });
    }
  }

  return items;
}

/**
 * Parse a web page for news content.
 * Uses simple text extraction (AI will do the heavy lifting).
 */
function parseWebPage(html: string, source: NewsSource): RawNewsItem[] {
  // Extract text content from the page
  const textContent = cleanHtml(html)
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 5000); // Limit for AI processing

  if (textContent.length < 100) {
    return [];
  }

  // Return as a single item for AI to break down
  return [{
    title: `Latest from ${source.name}`,
    summary: textContent,
    source: source.name,
    sourceUrl: source.url,
    publishedAt: new Date(),
  }];
}

// ── AI Processing ───────────────────────────────────────────────

/**
 * Process a raw news item with OpenAI.
 * Categorizes, rates importance, and cleans up content.
 */
async function processNewsItem(
  openai: OpenAI,
  item: RawNewsItem,
  defaultCategory: string,
): Promise<ProcessedNewsItem> {
  const model = await getAIModel();

  try {
    const response = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `You are a UAE tax and compliance news analyst for NR Accounting Services, a Dubai-based accounting firm.

Analyze the following news item and return a JSON object with these fields:
- "isRelevant": boolean — true if this is relevant to UAE businesses (VAT, corporate tax, customs, labor law, business compliance, FTA updates, etc.)
- "title": string — Clean, professional title (max 100 chars)
- "summary": string — 2-3 sentence professional summary
- "category": string — one of: "vat", "corporate_tax", "customs", "labor", "general"
- "importance": string — one of: "low", "normal", "high", "critical"
  - critical: New tax law, major FTA deadline, penalty changes
  - high: Significant regulatory update, new filing requirements
  - normal: Routine update, industry news
  - low: General business news, minor updates

IMPORTANT:
- Filter OUT: sports, entertainment, politics (unless tax-related), weather
- Filter IN: anything about UAE taxes, VAT, corporate tax, free zones, business licensing, labor, customs
- Return ONLY valid JSON, no markdown or explanation`,
        },
        {
          role: 'user',
          content: `Title: ${sanitizeForAI(item.title, 500)}\n\nContent: ${sanitizeForAI(item.summary, 5000)}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    });

    const result = response.choices[0]?.message?.content;
    if (!result) {
      return {
        ...item,
        category: defaultCategory,
        importance: 'normal',
        isRelevant: false,
      };
    }

    const parsed = JSON.parse(result);

    return {
      title: parsed.title || item.title,
      summary: parsed.summary || item.summary,
      content: item.content,
      category: parsed.category || defaultCategory,
      source: item.source,
      sourceUrl: item.sourceUrl,
      importance: parsed.importance || 'normal',
      isRelevant: parsed.isRelevant ?? false,
    };
  } catch (error: any) {
    log.warn(
      { title: item.title, error: error.message },
      'AI processing failed, using defaults',
    );
    return {
      ...item,
      category: defaultCategory,
      importance: 'normal',
      isRelevant: false, // Safe default: irrelevant unless AI confirms
    };
  }
}

// ── Duplicate Detection ─────────────────────────────────────────

/**
 * Normalize a title for dedup comparison.
 * Lowercases, trims, and removes common noise words.
 */
function normalizeTitle(title: string): string {
  return title.toLowerCase().trim().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ');
}

/**
 * Build a set of normalized existing news titles.
 * Called ONCE per ingestion run, not per item.
 */
async function buildExistingTitleSet(): Promise<Set<string>> {
  const titleSet = new Set<string>();
  try {
    const existingNews = await storage.getRegulatoryNews();
    for (const news of existingNews) {
      titleSet.add(normalizeTitle(news.title));
    }
  } catch (err: any) {
    log.warn({ error: err.message }, 'Could not load existing news for dedup');
  }
  return titleSet;
}

/**
 * Check if a title is a duplicate using the pre-loaded set.
 * Uses exact match on normalized title + Jaccard similarity > 0.85.
 */
function isDuplicateTitle(title: string, existingSet: Set<string>): boolean {
  const normalized = normalizeTitle(title);

  // Exact match
  if (existingSet.has(normalized)) return true;

  // Jaccard similarity check against all existing titles
  for (const existing of existingSet) {
    if (jaccardSimilarity(existing, normalized) > 0.85) return true;
  }

  return false;
}

/**
 * Simple string similarity using Jaccard index on words.
 */
function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/));
  const wordsB = new Set(b.split(/\s+/));
  const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

// ── Helpers ─────────────────────────────────────────────────────

async function getOpenAIClientForNews(): Promise<OpenAI | null> {
  const apiKey = await getOpenAIKey();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

function extractXmlTag(xml: string, tag: string): string | null {
  // Handle CDATA sections
  const cdataRegex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i');
  const cdataMatch = cdataRegex.exec(xml);
  if (cdataMatch) return cdataMatch[1].trim();

  // Regular tag
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = regex.exec(xml);
  return match ? match[1].trim() : null;
}

function cleanHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
