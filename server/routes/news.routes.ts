import type { Express, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db";
import { adminMiddleware, authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { DomainError } from "../errors";
import {
  getNewsFeedStatus,
  ingestNewsFeeds,
  registerNewsIngestJob,
} from "../services/news-ingest.service";
import { zDate, zHttpsUrl, zText, zUuid } from "../../shared/validators/primitives";

const CATEGORIES = ["vat", "corporate_tax", "regulation", "economy", "general"] as const;
const SOURCES = ["fta", "gulf_news", "khaleej_times", "other"] as const;

const createNewsBody = z
  .object({
    title: zText(500, { min: 1 }),
    titleAr: zText(500).optional().nullable(),
    summary: zText(1000).optional().nullable(),
    summaryAr: zText(1000).optional().nullable(),
    content: zText(20000).optional().nullable(),
    contentAr: zText(20000).optional().nullable(),
    source: z.enum(SOURCES),
    sourceUrl: zHttpsUrl.optional().nullable(),
    category: z.enum(CATEGORIES),
    publishedAt: zDate,
  })
  .strict();

const updateNewsBody = createNewsBody
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .strict();

export function registerNewsRoutes(app: Express) {
  registerNewsIngestJob();

  /** Capability status of the news feed (requires_external until NEWS_FEED_URLS is set). */
  app.get(
    "/api/news/status",
    authMiddleware,
    asyncHandler(async (_req: Request, res: Response) => {
      res.json(getNewsFeedStatus());
    })
  );

  // ── Admin curation ──────────────────────────────────────────────────────
  app.get(
    "/api/admin/news",
    authMiddleware,
    adminMiddleware,
    asyncHandler(async (_req: Request, res: Response) => {
      const { rows } = await pool.query(
        `SELECT id, title, title_ar AS "titleAr", summary, summary_ar AS "summaryAr", source,
                source_url AS "sourceUrl", category, published_at AS "publishedAt",
                is_active AS "isActive", external_id AS "externalId"
           FROM news_items ORDER BY published_at DESC LIMIT 500`
      );
      res.json(rows);
    })
  );

  app.post(
    "/api/admin/news",
    authMiddleware,
    adminMiddleware,
    strictBody(createNewsBody),
    asyncHandler(async (req: Request, res: Response) => {
      const b = parsedBody<z.infer<typeof createNewsBody>>(req);
      const { rows } = await pool.query(
        `INSERT INTO news_items
           (title, title_ar, summary, summary_ar, content, content_ar, source, source_url, category,
            published_at, is_active, curated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11)
         RETURNING id, title, source, category, published_at AS "publishedAt", is_active AS "isActive"`,
        [
          b.title,
          b.titleAr ?? null,
          b.summary ?? null,
          b.summaryAr ?? null,
          b.content ?? null,
          b.contentAr ?? null,
          b.source,
          b.sourceUrl ?? null,
          b.category,
          b.publishedAt,
          req.user!.id,
        ]
      );
      res.status(201).json(rows[0]);
    })
  );

  app.patch(
    "/api/admin/news/:id",
    authMiddleware,
    adminMiddleware,
    strictBody(updateNewsBody),
    asyncHandler(async (req: Request, res: Response) => {
      if (!zUuid.safeParse(req.params.id).success) throw new DomainError("NEWS_NOT_FOUND", 404);
      const b = parsedBody<z.infer<typeof updateNewsBody>>(req);
      const { rows } = await pool.query(
        `UPDATE news_items SET
           title = COALESCE($2, title), title_ar = COALESCE($3, title_ar),
           summary = COALESCE($4, summary), summary_ar = COALESCE($5, summary_ar),
           content = COALESCE($6, content), content_ar = COALESCE($7, content_ar),
           source = COALESCE($8, source), source_url = COALESCE($9, source_url),
           category = COALESCE($10, category), published_at = COALESCE($11, published_at),
           is_active = COALESCE($12, is_active), curated_by = $13
         WHERE id = $1
         RETURNING id, title, source, category, published_at AS "publishedAt", is_active AS "isActive"`,
        [
          req.params.id,
          b.title ?? null,
          b.titleAr ?? null,
          b.summary ?? null,
          b.summaryAr ?? null,
          b.content ?? null,
          b.contentAr ?? null,
          b.source ?? null,
          b.sourceUrl ?? null,
          b.category ?? null,
          b.publishedAt ?? null,
          b.isActive ?? null,
          req.user!.id,
        ]
      );
      if (!rows[0]) throw new DomainError("NEWS_NOT_FOUND", 404, undefined, "News item not found");
      res.json(rows[0]);
    })
  );

  // Removing an item hides it from every feed (kept for audit as inactive).
  app.delete(
    "/api/admin/news/:id",
    authMiddleware,
    adminMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      if (!zUuid.safeParse(req.params.id).success) throw new DomainError("NEWS_NOT_FOUND", 404);
      const { rowCount } = await pool.query(
        `UPDATE news_items SET is_active = false, curated_by = $2 WHERE id = $1`,
        [req.params.id, req.user!.id]
      );
      if (!rowCount) throw new DomainError("NEWS_NOT_FOUND", 404, undefined, "News item not found");
      res.json({ id: req.params.id, isActive: false });
    })
  );

  app.post(
    "/api/admin/news/ingest",
    authMiddleware,
    adminMiddleware,
    asyncHandler(async (_req: Request, res: Response) => {
      const status = getNewsFeedStatus();
      if (status.status !== "live") {
        throw new DomainError(
          "NEWS_FEED_NOT_CONFIGURED",
          409,
          { status },
          "No news feeds configured: set NEWS_FEED_URLS"
        );
      }
      res.json(await ingestNewsFeeds());
    })
  );
}
