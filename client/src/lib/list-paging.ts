// Client-side paging of a list that is already loaded: the slice to show, the range text and the clamped page.

export const PAGE_SIZES = [25, 50, 100] as const;

export interface PageView {
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
  start: number;
  end: number;
  hasPrev: boolean;
  hasNext: boolean;
}

/** `page` is zero-based; a page past the end (the list shrank) is clamped to the last one. */
export function pageView(total: number, page: number, pageSize: number): PageView {
  const size = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(total / size));
  const clamped = Math.min(Math.max(0, Math.floor(page)), pageCount - 1);
  const start = clamped * size;
  const end = Math.min(total, start + size);
  return { page: clamped, pageCount, from: total === 0 ? 0 : start + 1, to: end, total, start, end, hasPrev: clamped > 0, hasNext: clamped < pageCount - 1 };
}
