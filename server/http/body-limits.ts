/**
 * JSON body-size routing shared by the app (server/index.ts) and the DB test harness, so the two
 * can never disagree. Most endpoints accept 1 MB of JSON; image/file uploads that arrive as
 * base64 data URLs get 10 MB. S1 (R14-13): the company logo upload is the only company route
 * with the larger cap (a 1 MB image is ~1.37 MB of base64); the logo bytes are still capped at
 * LOGO_MAX_BYTES by the route.
 */
export const LARGE_JSON_ROUTES: readonly RegExp[] = [
  /^\/api\/ocr\//,
  /^\/api\/export\//,
  /^\/api\/firm\/bulk\/ocr/,
  /^\/api\/companies\/[^/]+\/receipts$/,
  /^\/api\/companies\/[^/]+\/bank-statements\/(import|preview)$/,
  /^\/api\/journal\/[^/]+\/attachments$/,
  /^\/api\/companies\/[^/]+\/logo$/,
  // WQ2: purchase documents (bill attachment, bill capture, expense-claim receipt).
  /^\/api\/bills\/[^/]+\/attachment$/,
  /^\/api\/companies\/[^/]+\/bills\/capture$/,
  /^\/api\/companies\/[^/]+\/expense-claims\/receipts$/,
];

export const LARGE_JSON_LIMIT = "10mb";
export const SMALL_JSON_LIMIT = "1mb";

export function usesLargeJson(path: string): boolean {
  return LARGE_JSON_ROUTES.some((rx) => rx.test(path));
}
