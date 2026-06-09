import { describe, it, expect } from 'vitest';
import { safeHttpUrl } from '../../client/src/lib/safeUrl';

describe('safeHttpUrl', () => {
  it('accepts http/https URLs', () => {
    expect(safeHttpUrl('https://tax.gov.ae')).toBe('https://tax.gov.ae/');
    expect(safeHttpUrl('http://example.com/news?id=1')).toBe('http://example.com/news?id=1');
  });

  it('rejects javascript: and data: schemes', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('JaVaScRiPt:alert(1)')).toBeNull();
    expect(safeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeHttpUrl('file:///etc/passwd')).toBeNull();
  });

  it('rejects empty/relative/malformed inputs', () => {
    expect(safeHttpUrl('')).toBeNull();
    expect(safeHttpUrl('   ')).toBeNull();
    expect(safeHttpUrl('/relative/path')).toBeNull();
    expect(safeHttpUrl('not a url')).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
    expect(safeHttpUrl(42)).toBeNull();
  });
});
