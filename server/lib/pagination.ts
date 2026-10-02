/**
 * Opt-in page/perPage pagination for list endpoints.
 *
 * Without `page` or `perPage` in the query a response is exactly what it was
 * before; with them the list is sliced and X-Total-Count, X-Page and X-Per-Page
 * are set (all three are in the CORS exposed headers). Endpoints that already
 * return a bare array keep returning one.
 */
import type { Request, Response } from "express";

export const DEFAULT_PER_PAGE = 50;
export const MAX_PER_PAGE = 200;

export interface PageRequest {
  page: number;
  perPage: number;
  offset: number;
}

export type PageParse = { requested: false } | ({ requested: true; ok: true } & PageRequest) | { requested: true; ok: false; message: string };

function positiveInt(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^\d{1,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 ? n : null;
}

/** Reads ?page and ?perPage. perPage is capped at 200; junk is an error, not a silent default. */
export function parsePagination(query: Record<string, unknown>): PageParse {
  const hasPage = query.page !== undefined;
  const hasPer = query.perPage !== undefined;
  if (!hasPage && !hasPer) return { requested: false };
  const page = hasPage ? positiveInt(query.page) : 1;
  const perRaw = hasPer ? positiveInt(query.perPage) : DEFAULT_PER_PAGE;
  if (page === null) return { requested: true, ok: false, message: "page must be a positive integer" };
  if (perRaw === null) return { requested: true, ok: false, message: "perPage must be a positive integer" };
  const perPage = Math.min(perRaw, MAX_PER_PAGE);
  return { requested: true, ok: true, page, perPage, offset: (page - 1) * perPage };
}

export function setPageHeaders(res: Response, total: number, page: PageRequest): void {
  res.setHeader("X-Total-Count", String(total));
  res.setHeader("X-Page", String(page.page));
  res.setHeader("X-Per-Page", String(page.perPage));
}

/**
 * Slice an in-memory list when the caller asked for a page; otherwise hand it back untouched.
 * Returns null after answering 400 for a malformed page request.
 */
export function paginateList<T>(req: Request, res: Response, items: T[]): T[] | null {
  const parsed = parsePagination(req.query as Record<string, unknown>);
  if (!parsed.requested) return items;
  if (!parsed.ok) {
    res.status(400).json({ message: parsed.message, code: "INVALID_PAGINATION" });
    return null;
  }
  setPageHeaders(res, items.length, parsed);
  return items.slice(parsed.offset, parsed.offset + parsed.perPage);
}
