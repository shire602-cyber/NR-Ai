import DOMPurify from 'isomorphic-dompurify';
import path from 'path';

/**
 * Strip ALL HTML/SVG markup. Use for user-supplied text fields that should
 * never contain markup (names, addresses, comments, descriptions). Safe to
 * call on null/undefined; the input is returned unchanged.
 */
export function sanitizeText<T extends string | null | undefined>(value: T): T {
  if (value == null) return value;
  return DOMPurify.sanitize(value as string, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }) as T;
}

/**
 * Sanitise a rich-text (HTML) field. Allows a small allowlist of presentation
 * tags appropriate for invoice notes / email templates. Strips scripts,
 * iframes, on* handlers, javascript: URLs.
 */
export function sanitizeRichText(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'b', 'i', 'u',
      'ul', 'ol', 'li',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'blockquote', 'code', 'pre',
      'a', 'span', 'div',
    ],
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'class'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):)/i,
  });
}

/**
 * Recursively walk a plain object and apply sanitizeText to every string.
 * Skips Buffers, Dates, and arrays-of-non-strings unchanged. Useful as a
 * defense-in-depth pass for endpoints that accept loose JSON.
 */
export function sanitizeStringsDeep<T>(value: T): T {
  if (value == null) return value;
  if (typeof value === 'string') return sanitizeText(value) as unknown as T;
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeStringsDeep(v)) as unknown as T;
  }
  if (typeof value === 'object' && value.constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeStringsDeep(v);
    }
    return out as T;
  }
  return value;
}

// ── File upload validation ──────────────────────────────────────

const SAFE_FILENAME = /^[A-Za-z0-9._-]+$/;
const ALLOWED_MIME_PREFIXES = [
  'image/',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'text/plain',
];

export function isAllowedMimeType(mime: string): boolean {
  if (!mime) return false;
  const lower = mime.toLowerCase();
  return ALLOWED_MIME_PREFIXES.some((p) =>
    p.endsWith('/') ? lower.startsWith(p) : lower === p,
  );
}

/**
 * Sanitise an uploaded filename. Strips directory components, unicode
 * tricks, and anything outside [A-Za-z0-9._-]. Always returns a safe basename.
 */
export function sanitizeFilename(name: string): string {
  if (!name) return 'file';
  // Strip path components
  const base = path.basename(name);
  // Drop anything not in our allowlist; collapse repeats; trim leading dots
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '');
  return cleaned.length > 0 ? cleaned.slice(0, 200) : 'file';
}

export function isSafeFilename(name: string): boolean {
  return SAFE_FILENAME.test(name) && !name.includes('..');
}

export interface UploadCheck {
  ok: boolean;
  error?: string;
  safeName?: string;
}

export function validateUpload(file: {
  originalname: string;
  mimetype: string;
  size: number;
}, opts: { maxBytes?: number; allowedMimePrefixes?: string[] } = {}): UploadCheck {
  const maxBytes = opts.maxBytes ?? 10 * 1024 * 1024; // 10 MB default
  if (file.size > maxBytes) {
    return { ok: false, error: `File exceeds ${Math.round(maxBytes / 1024 / 1024)}MB limit` };
  }
  const allowed = opts.allowedMimePrefixes
    ? opts.allowedMimePrefixes.some((p) =>
        p.endsWith('/') ? file.mimetype.toLowerCase().startsWith(p) : file.mimetype.toLowerCase() === p,
      )
    : isAllowedMimeType(file.mimetype);
  if (!allowed) {
    return { ok: false, error: `MIME type ${file.mimetype} is not allowed` };
  }
  return { ok: true, safeName: sanitizeFilename(file.originalname) };
}
