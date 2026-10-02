// Routes that accept a file as base64 JSON. A 10 MB file is ~13.4 MB once
// base64-encoded, so these get a larger body limit than the 1 MB default; the
// file itself is still capped at 10 MB by document-validation.

export const UPLOAD_ROUTE_PATTERNS: readonly RegExp[] = [
  /^\/api\/companies\/[^/]+\/documents$/,
  /^\/api\/client-portal\/documents$/,
  /^\/api\/companies\/[^/]+\/tax-returns-archive$/,
  /^\/api\/companies\/[^/]+\/expense-claims\/receipt-upload$/,
  // Bank statements: a text statement up to 5 MB, or a PDF with its extracted text.
  /^\/api\/companies\/[^/]+\/bank-statements\/(import|imports\/pdf)$/,
  /^\/api\/companies\/[^/]+\/bank-connections\/[^/]+\/import$/,
  /^\/api\/firm\/vat-workpapers\/[^/]+\/scan$/,
  // Tax filing: FTA acknowledgement uploaded with, or after, recording a filing.
  /^\/api\/vat-returns\/[^/]+\/(file|evidence)$/,
  /^\/api\/corporate-tax\/returns\/[^/]+\/(file|evidence)$/,
];

/** express.json limit for upload routes. */
export const UPLOAD_JSON_LIMIT = "14mb";
/** Hard Content-Length ceiling (bytes) for upload routes; JSON limit above is 14 MiB. */
export const UPLOAD_MAX_CONTENT_LENGTH = 14 * 1024 * 1024 + 512 * 1024;

export function isUploadRoute(path: string): boolean {
  return UPLOAD_ROUTE_PATTERNS.some((rx) => rx.test(path));
}
