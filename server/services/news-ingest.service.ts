/**
 * UAE regulatory news ingestion (W3-E: R13-13, R13-35).
 *
 * There is no bundled or sample news. Items come from (a) admin curation and
 * (b) an RSS/Atom ingester that runs only when NEWS_FEED_URLS is set to one or
 * more comma-separated https feed URLs (FTA, Ministry of Finance, Gulf News...).
 * Without it the feed is honestly empty and the capability reads
 * `requires_external`.
 */
import { XMLParser } from "fast-xml-parser";
import { pool } from "../db";
import { createLogger } from "../config/logger";
import { listJobs, registerJob } from "../platform/job-registry";

const log = createLogger("news-ingest");

export type NewsSource = "fta" | "gulf_news" | "khaleej_times" | "other";

export interface ParsedNewsItem {
  externalId: string;
  title: string;
  summary: string | null;
  content: string | null;
  sourceUrl: string | null;
  imageUrl: string | null;
  publishedAt: Date;
}

export interface NewsFeedStatus {
  id: "news_feed";
  status: "live" | "requires_external";
  feedCount: number;
  externalAction: { en: string; ar: string };
  envVars: string[];
}

export function configuredFeedUrls(
  env: Record<string, string | undefined> = process.env
): string[] {
  const raw = env.NEWS_FEED_URLS?.trim();
  if (!raw) return [];
  const urls: string[] = [];
  for (const part of raw.split(",")) {
    const url = part.trim();
    if (!url) continue;
    try {
      const u = new URL(url);
      if (u.protocol === "https:") urls.push(u.toString());
    } catch {
      // ignore malformed entries; they are reported by the status endpoint's feedCount
    }
  }
  return urls;
}

export function getNewsFeedStatus(
  env: Record<string, string | undefined> = process.env
): NewsFeedStatus {
  const urls = configuredFeedUrls(env);
  return {
    id: "news_feed",
    status: urls.length > 0 ? "live" : "requires_external",
    feedCount: urls.length,
    envVars: ["NEWS_FEED_URLS"],
    externalAction: {
      en: "Set NEWS_FEED_URLS to the https RSS/Atom feed URLs of the FTA, the Ministry of Finance or a news publisher you are licensed to republish.",
      ar: "اضبط NEWS_FEED_URLS على روابط RSS/Atom (https) للهيئة الاتحادية للضرائب أو وزارة المالية أو ناشر أخبار مرخّص لإعادة نشر محتواه.",
    },
  };
}

export function sourceForUrl(url: string): NewsSource {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "other";
  }
  if (host.endsWith("tax.gov.ae") || host.endsWith("mof.gov.ae")) return "fta";
  if (host.endsWith("gulfnews.com")) return "gulf_news";
  if (host.endsWith("khaleejtimes.com")) return "khaleej_times";
  return "other";
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  processEntities: true,
});

const asArray = <T>(v: T | T[] | undefined): T[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

function text(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("#text" in o) return String(o["#text"]);
  }
  return "";
}

const stripTags = (s: string) =>
  s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Parse an RSS 2.0 or Atom document. Items without a title or a valid date are skipped. */
export function parseFeed(xml: string): ParsedNewsItem[] {
  const doc = parser.parse(xml);
  const out: ParsedNewsItem[] = [];
  const rssItems = asArray(doc?.rss?.channel?.item);
  for (const item of rssItems as Array<Record<string, unknown>>) {
    const title = stripTags(text(item.title));
    const link = text(item.link) || null;
    const guid = text(item.guid) || link || title;
    const published = new Date(text(item.pubDate) || text(item["dc:date"]));
    if (!title || Number.isNaN(published.getTime())) continue;
    const description = stripTags(text(item.description));
    const encoded = text(item["content:encoded"]);
    const enclosure = item.enclosure as Record<string, string> | undefined;
    out.push({
      externalId: guid.slice(0, 500),
      title: title.slice(0, 500),
      summary: description ? description.slice(0, 1000) : null,
      content: encoded ? stripTags(encoded).slice(0, 20000) : null,
      sourceUrl: link,
      imageUrl:
        enclosure?.["@_url"] && /^https:/.test(enclosure["@_url"]) ? enclosure["@_url"] : null,
      publishedAt: published,
    });
  }
  const entries = asArray(doc?.feed?.entry);
  for (const entry of entries as Array<Record<string, unknown>>) {
    const title = stripTags(text(entry.title));
    const linkNode = asArray(entry.link as Record<string, string> | Array<Record<string, string>>);
    const link = linkNode[0]?.["@_href"] ?? null;
    const guid = text(entry.id) || link || title;
    const published = new Date(text(entry.published) || text(entry.updated));
    if (!title || Number.isNaN(published.getTime())) continue;
    const summary = stripTags(text(entry.summary));
    const content = stripTags(text(entry.content));
    out.push({
      externalId: guid.slice(0, 500),
      title: title.slice(0, 500),
      summary: summary ? summary.slice(0, 1000) : null,
      content: content ? content.slice(0, 20000) : null,
      sourceUrl: link,
      imageUrl: null,
      publishedAt: published,
    });
  }
  return out;
}

export interface IngestDeps {
  fetchText: (url: string) => Promise<string>;
  urls?: string[];
}

async function defaultFetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Feed ${url} answered ${res.status}`);
  return res.text();
}

/** Pull every configured feed once and upsert new items. Idempotent by (source, externalId). */
export async function ingestNewsFeeds(
  deps: Partial<IngestDeps> = {}
): Promise<{ feeds: number; inserted: number; skipped: number; errors: string[] }> {
  const urls = deps.urls ?? configuredFeedUrls();
  const fetchText = deps.fetchText ?? defaultFetchText;
  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const url of urls) {
    try {
      const items = parseFeed(await fetchText(url));
      const source = sourceForUrl(url);
      for (const item of items) {
        const { rows } = await pool.query(
          `INSERT INTO news_items
             (title, summary, content, source, source_url, category, image_url, published_at, is_active, external_id)
           VALUES ($1,$2,$3,$4,$5,'general',$6,$7,true,$8)
           ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL DO NOTHING
           RETURNING id`,
          [
            item.title,
            item.summary,
            item.content,
            source,
            item.sourceUrl,
            item.imageUrl,
            item.publishedAt,
            item.externalId,
          ]
        );
        if (rows[0]) inserted++;
        else skipped++;
      }
    } catch (err) {
      const message = `${url}: ${(err as Error).message}`;
      errors.push(message);
      log.warn({ url, err: (err as Error).message }, "news feed ingest failed");
    }
  }
  return { feeds: urls.length, inserted, skipped, errors };
}

/** Register the hourly ingest job; it is a no-op until NEWS_FEED_URLS is set. */
export function registerNewsIngestJob(): void {
  if (listJobs().some((j) => j.name === "news.ingest")) return;
  registerJob({
    name: "news.ingest",
    cron: "23 * * * *",
    description: "Ingest configured UAE regulatory news feeds (requires NEWS_FEED_URLS)",
    run: async () => {
      if (configuredFeedUrls().length === 0) return;
      await ingestNewsFeeds();
    },
  });
}
