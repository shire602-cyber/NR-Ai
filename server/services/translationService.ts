/**
 * Translation Service
 * ───────────────────
 * AI-powered translation for news articles using OpenAI.
 * Supports Somali (so), Arabic (ar), and English (en).
 *
 * Features:
 * - Cached translations in `newsTranslations` table
 * - Admin review/approval before distribution
 * - Formal business tone for all languages
 * - Batch translation for multiple languages
 */

import OpenAI from 'openai';
import pLimit from 'p-limit';
import { createLogger } from '../config/logger';
import { getOpenAIKey, getAIModel } from '../config/settings';
import { storage } from '../storage';
import { sanitizeForAI } from '../utils/locale';
import type { RegulatoryNews, NewsTranslation } from '@shared/schema';

/** Concurrency limiter for OpenAI API calls (prevents rate limit errors) */
const openaiLimiter = pLimit(3);

const log = createLogger('translation');

// ── Language config ─────────────────────────────────────────────

export const SUPPORTED_LANGUAGES = ['en', 'ar', 'so'] as const;
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
  ar: 'Arabic',
  so: 'Somali',
};

const LANGUAGE_PROMPTS: Record<SupportedLanguage, string> = {
  en: 'Translate the following text into formal business English. Maintain professional tone suitable for accounting and tax advisory communications.',
  ar: 'ترجم النص التالي إلى اللغة العربية الرسمية. حافظ على نبرة مهنية مناسبة لاتصالات المحاسبة والاستشارات الضريبية. Translate the following text into formal Modern Standard Arabic (فصحى). Use professional business Arabic suitable for accounting and tax advisory communications in the UAE context.',
  so: 'Translate the following text into formal Somali (af-Soomaali). Use professional, clear language suitable for business and tax advisory communications. The audience is Somali-speaking business owners in the UAE.',
};

// ── Core Functions ──────────────────────────────────────────────

/**
 * Get an OpenAI client instance.
 * Uses DB-first settings resolver.
 */
async function getOpenAIClient(): Promise<OpenAI | null> {
  const apiKey = await getOpenAIKey();
  if (!apiKey) {
    log.warn('OpenAI API key not configured — translations will not work');
    return null;
  }
  return new OpenAI({ apiKey });
}

/**
 * Translate text to a target language using OpenAI.
 */
export async function translateText(
  text: string,
  targetLanguage: SupportedLanguage,
  context?: string,
): Promise<string | null> {
  if (!text?.trim()) return null;

  const openai = await getOpenAIClient();
  if (!openai) return null;

  const model = await getAIModel();

  try {
    const systemPrompt = `You are a professional translator specializing in UAE business, tax, and accounting terminology. ${LANGUAGE_PROMPTS[targetLanguage]}

Rules:
- Keep technical terms accurate (VAT, corporate tax, TRN, etc.)
- Maintain any numbers, dates, and percentages as-is
- Do not add explanations or notes — return ONLY the translation
- For Somali: use commonly understood Somali business vocabulary
- For Arabic: use Gulf Arabic business conventions where appropriate
${context ? `\nContext: ${context}` : ''}`;

    // Sanitize input to prevent prompt injection
    const sanitizedText = sanitizeForAI(text);

    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: sanitizedText },
      ],
      temperature: 0.3, // Low temperature for consistent translations
      max_tokens: 2000,
    });

    const translation = response.choices[0]?.message?.content?.trim();
    if (!translation) {
      log.warn({ targetLanguage }, 'OpenAI returned empty translation');
      return null;
    }

    return translation;
  } catch (error: any) {
    log.error(
      { error: error.message, targetLanguage },
      'Translation failed',
    );
    return null;
  }
}

/**
 * Translate a news article to a target language.
 * Checks cache first, then translates and stores.
 */
export async function translateNewsArticle(
  newsId: string,
  targetLanguage: SupportedLanguage,
): Promise<NewsTranslation | null> {
  // Check if translation already exists
  const existing = await storage.getNewsTranslation(newsId, targetLanguage);
  if (existing) {
    log.debug({ newsId, language: targetLanguage }, 'Using cached translation');
    return existing;
  }

  // Get the original news article
  const news = await storage.getRegulatoryNewsById(newsId);
  if (!news) {
    log.error({ newsId }, 'News article not found for translation');
    return null;
  }

  // If the source is already in the target language, just copy it
  // English is the default source language
  if (targetLanguage === 'en') {
    return storage.createNewsTranslation({
      newsId,
      language: 'en',
      title: news.title,
      summary: news.summary,
      content: news.content || undefined,
      isApproved: true, // English originals are auto-approved
    });
  }

  // Check if Arabic is already available in the regulatoryNews table
  if (targetLanguage === 'ar' && news.titleAr && news.summaryAr) {
    return storage.createNewsTranslation({
      newsId,
      language: 'ar',
      title: news.titleAr,
      summary: news.summaryAr,
      content: news.contentAr || undefined,
      isApproved: false, // Still needs admin review
    });
  }

  const context = `Category: ${news.category}. Source: ${news.source || 'UAE regulatory'}`;

  // Translate title and summary (and content if available)
  // Rate-limited to avoid OpenAI API throttling
  const [translatedTitle, translatedSummary, translatedContent] = await Promise.all([
    openaiLimiter(() => translateText(news.title, targetLanguage, context)),
    openaiLimiter(() => translateText(news.summary, targetLanguage, context)),
    news.content
      ? openaiLimiter(() => translateText(news.content!, targetLanguage, context))
      : Promise.resolve(null),
  ]);

  if (!translatedTitle || !translatedSummary) {
    log.error(
      { newsId, language: targetLanguage },
      'Failed to translate title or summary',
    );
    return null;
  }

  // Store the translation
  const translation = await storage.createNewsTranslation({
    newsId,
    language: targetLanguage,
    title: translatedTitle,
    summary: translatedSummary,
    content: translatedContent || undefined,
    isApproved: false, // Needs admin review before distribution
  });

  log.info(
    { newsId, language: targetLanguage, translationId: translation.id },
    'News article translated and cached',
  );

  return translation;
}

/**
 * Translate a news article into all supported languages.
 * Skips languages that already have cached translations.
 */
export async function translateNewsToAllLanguages(
  newsId: string,
): Promise<Map<SupportedLanguage, NewsTranslation | null>> {
  const results = new Map<SupportedLanguage, NewsTranslation | null>();

  for (const lang of SUPPORTED_LANGUAGES) {
    try {
      const translation = await translateNewsArticle(newsId, lang);
      results.set(lang, translation);
    } catch (error: any) {
      log.error(
        { newsId, language: lang, error: error.message },
        'Failed to translate news article',
      );
      results.set(lang, null);
    }
  }

  return results;
}

/**
 * Get all translations for a news article.
 */
export async function getNewsTranslations(
  newsId: string,
): Promise<NewsTranslation[]> {
  return storage.getNewsTranslationsByNewsId(newsId);
}

/**
 * Approve a translation (admin action).
 */
export async function approveTranslation(
  translationId: string,
  reviewedBy: string,
): Promise<NewsTranslation | null> {
  return storage.approveNewsTranslation(translationId, reviewedBy);
}

/**
 * Get the best available translation for a news article in a given language.
 * Only returns approved translations by default. Falls back to English.
 *
 * @param requireApproved - If true (default), only return approved translations.
 *   Set to false for admin preview where unapproved content is acceptable.
 */
export async function getBestTranslation(
  newsId: string,
  preferredLanguage: SupportedLanguage,
  requireApproved: boolean = true,
): Promise<NewsTranslation | null> {
  // Try preferred language first
  const preferred = await storage.getNewsTranslation(newsId, preferredLanguage);
  if (preferred && preferred.isApproved) return preferred;

  // Fall back to English (auto-approved)
  if (preferredLanguage !== 'en') {
    const english = await storage.getNewsTranslation(newsId, 'en');
    if (english && english.isApproved) return english;
  }

  // Only return unapproved content if explicitly allowed (e.g., admin preview)
  if (!requireApproved && preferred) return preferred;

  return null;
}
