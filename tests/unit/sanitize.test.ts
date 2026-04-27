import { describe, it, expect } from 'vitest';
import {
  sanitizeText,
  sanitizeRichText,
  sanitizeStringsDeep,
  sanitizeFilename,
  isSafeFilename,
  isAllowedMimeType,
  validateUpload,
} from '../../server/sanitize';

describe('sanitizeText', () => {
  it('strips script tags and inline JS', () => {
    expect(sanitizeText('<script>alert(1)</script>hello')).toBe('hello');
    // onerror attributes are dropped along with the surrounding tag
    expect(sanitizeText('<img src=x onerror=alert(1)>'))
      .not.toMatch(/onerror/);
  });

  it('preserves null/undefined', () => {
    expect(sanitizeText(null)).toBe(null);
    expect(sanitizeText(undefined)).toBe(undefined);
  });

  it('leaves plain text alone', () => {
    expect(sanitizeText("Ali O'Brien")).toBe("Ali O'Brien");
  });
});

describe('sanitizeRichText', () => {
  it('keeps allowed tags but strips scripts', () => {
    const out = sanitizeRichText('<p>Hi <strong>there</strong></p><script>x</script>');
    expect(out).toContain('<p>');
    expect(out).toContain('<strong>');
    expect(out).not.toContain('<script>');
  });

  it('blocks javascript: URIs in href', () => {
    const out = sanitizeRichText('<a href="javascript:alert(1)">link</a>');
    expect(out).not.toMatch(/javascript:/i);
  });
});

describe('sanitizeStringsDeep', () => {
  it('walks nested objects and arrays', () => {
    const input = {
      name: '<script>x</script>Joe',
      tags: ['<b>safe</b>tag', 42],
      nested: { note: '<img src=x onerror=1>' },
    };
    const out = sanitizeStringsDeep(input);
    expect(out.name).toBe('Joe');
    // DOMPurify strips the <b> tags but keeps text content from inside.
    expect(out.tags[0]).toBe('safetag');
    expect(out.tags[0]).not.toMatch(/<b>/);
    expect(out.nested.note).not.toMatch(/onerror/);
    expect(out.tags[1]).toBe(42);
  });
});

describe('sanitizeFilename', () => {
  it('strips path traversal', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('/abs/path/foo.png')).toBe('foo.png');
  });

  it('replaces unsafe characters', () => {
    expect(sanitizeFilename('hello world.png')).toBe('hello_world.png');
    expect(sanitizeFilename("rm -rf /;.txt")).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('falls back to "file" for empty / leading-dot names', () => {
    expect(sanitizeFilename('')).toBe('file');
    expect(sanitizeFilename('...')).toBe('file');
  });
});

describe('isSafeFilename', () => {
  it('rejects names with .. or unsafe chars', () => {
    expect(isSafeFilename('foo.png')).toBe(true);
    expect(isSafeFilename('foo/bar.png')).toBe(false);
    expect(isSafeFilename('a..b')).toBe(false);
  });
});

describe('isAllowedMimeType', () => {
  it('allows images, pdfs, csvs', () => {
    expect(isAllowedMimeType('image/png')).toBe(true);
    expect(isAllowedMimeType('application/pdf')).toBe(true);
    expect(isAllowedMimeType('text/csv')).toBe(true);
  });

  it('rejects executables and html', () => {
    expect(isAllowedMimeType('application/x-msdownload')).toBe(false);
    expect(isAllowedMimeType('text/html')).toBe(false);
  });
});

describe('validateUpload', () => {
  it('accepts a small image', () => {
    const r = validateUpload({
      originalname: 'photo.jpg',
      mimetype: 'image/jpeg',
      size: 100_000,
    });
    expect(r.ok).toBe(true);
    expect(r.safeName).toBe('photo.jpg');
  });

  it('rejects oversized files', () => {
    const r = validateUpload({
      originalname: 'big.pdf',
      mimetype: 'application/pdf',
      size: 50 * 1024 * 1024,
    });
    expect(r.ok).toBe(false);
  });

  it('rejects disallowed MIME types', () => {
    const r = validateUpload({
      originalname: 'evil.exe',
      mimetype: 'application/x-msdownload',
      size: 10,
    });
    expect(r.ok).toBe(false);
  });
});
