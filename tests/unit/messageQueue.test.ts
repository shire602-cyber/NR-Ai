import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

// ── Pure function re-implementations for isolated testing ──

function isWithinBusinessHours(startHour: number, endHour: number): boolean {
  const now = new Date();
  const uaeOffset = 4 * 60;
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const uaeMinutes = utcMinutes + uaeOffset;
  const uaeHour = Math.floor(uaeMinutes / 60) % 24;
  return uaeHour >= startHour && uaeHour < endHour;
}

const ALLOWED_DOCUMENT_DIRS = [
  path.resolve(process.cwd(), 'uploads'),
  path.resolve(process.cwd(), 'documents'),
  path.resolve(process.cwd(), 'invoices'),
  '/tmp',
];

function isPathAllowed(filePath: string): boolean {
  const resolvedPath = path.resolve(filePath);
  return ALLOWED_DOCUMENT_DIRS.some(
    (dir) => resolvedPath.startsWith(dir + path.sep) || resolvedPath === dir
  );
}

// ── Tests ──

describe('Message Queue Service - Pure Logic', () => {
  // ────────────────────────────────────────────────────────
  // Business Hours
  // ────────────────────────────────────────────────────────
  describe('isWithinBusinessHours', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /**
     * Helper: sets system time to a specific UTC hour and minute.
     * Uses a fixed date (2026-03-10) so only the time matters.
     */
    function setUTCTime(utcHour: number, utcMinute = 0): void {
      const date = new Date(Date.UTC(2026, 2, 10, utcHour, utcMinute, 0, 0));
      vi.setSystemTime(date);
    }

    it('should return true when UAE time is within business hours (9-18)', () => {
      // UTC 08:00 => UAE 12:00 (noon) — well inside 9-18
      setUTCTime(8, 0);
      expect(isWithinBusinessHours(9, 18)).toBe(true);
    });

    it('should return false when UAE time is before business hours', () => {
      // UTC 03:00 => UAE 07:00 — before 9 AM
      setUTCTime(3, 0);
      expect(isWithinBusinessHours(9, 18)).toBe(false);
    });

    it('should return false when UAE time is after business hours', () => {
      // UTC 15:00 => UAE 19:00 — after 6 PM
      setUTCTime(15, 0);
      expect(isWithinBusinessHours(9, 18)).toBe(false);
    });

    it('should return true at exactly the start boundary (9 AM UAE)', () => {
      // UTC 05:00 => UAE 09:00
      setUTCTime(5, 0);
      expect(isWithinBusinessHours(9, 18)).toBe(true);
    });

    it('should return false at exactly the end boundary (6 PM UAE)', () => {
      // UTC 14:00 => UAE 18:00 — endHour is exclusive
      setUTCTime(14, 0);
      expect(isWithinBusinessHours(9, 18)).toBe(false);
    });

    it('should return true one minute before end boundary', () => {
      // UTC 13:59 => UAE 17:59
      setUTCTime(13, 59);
      expect(isWithinBusinessHours(9, 18)).toBe(true);
    });

    it('should return false one minute before start boundary', () => {
      // UTC 04:59 => UAE 08:59
      setUTCTime(4, 59);
      expect(isWithinBusinessHours(9, 18)).toBe(false);
    });

    it('should handle midnight crossing correctly (UTC 20:00 = UAE 00:00)', () => {
      // UTC 20:00 => UAE 00:00 (next day)
      setUTCTime(20, 0);
      // UAE hour wraps to 0 — outside 9-18
      expect(isWithinBusinessHours(9, 18)).toBe(false);
    });

    it('should handle midnight crossing — UAE 01:00 (UTC 21:00)', () => {
      // UTC 21:00 => UAE 01:00
      setUTCTime(21, 0);
      expect(isWithinBusinessHours(9, 18)).toBe(false);
    });

    it('should handle late evening in UAE (UTC 19:30 = UAE 23:30)', () => {
      // UTC 19:30 => UAE 23:30
      setUTCTime(19, 30);
      expect(isWithinBusinessHours(9, 18)).toBe(false);
    });

    it('should work with custom business hours (0-24 meaning always open)', () => {
      setUTCTime(12, 0); // UAE 16:00
      expect(isWithinBusinessHours(0, 24)).toBe(true);
    });

    it('should work with custom business hours (10-14 narrow window)', () => {
      // UTC 08:00 => UAE 12:00 — inside 10-14
      setUTCTime(8, 0);
      expect(isWithinBusinessHours(10, 14)).toBe(true);

      // UTC 11:00 => UAE 15:00 — outside 10-14
      setUTCTime(11, 0);
      expect(isWithinBusinessHours(10, 14)).toBe(false);
    });

    it('should return false when start equals end (zero-width window)', () => {
      setUTCTime(8, 0); // UAE 12:00
      expect(isWithinBusinessHours(12, 12)).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────
  // Path Validation
  // ────────────────────────────────────────────────────────
  describe('isPathAllowed', () => {
    const cwd = process.cwd();

    describe('allowed paths', () => {
      it('should allow a file inside the uploads directory', () => {
        expect(isPathAllowed(path.join(cwd, 'uploads', 'file.pdf'))).toBe(true);
      });

      it('should allow a file inside the documents directory', () => {
        expect(isPathAllowed(path.join(cwd, 'documents', 'report.docx'))).toBe(true);
      });

      it('should allow a file inside the invoices directory', () => {
        expect(isPathAllowed(path.join(cwd, 'invoices', 'inv-001.pdf'))).toBe(true);
      });

      it('should allow a file inside /tmp', () => {
        expect(isPathAllowed('/tmp/file.pdf')).toBe(true);
      });

      it('should allow nested files inside allowed directories', () => {
        expect(isPathAllowed(path.join(cwd, 'uploads', 'sub', 'deep', 'file.pdf'))).toBe(true);
      });

      it('should allow the allowed directory itself', () => {
        expect(isPathAllowed(path.join(cwd, 'uploads'))).toBe(true);
      });

      it('should allow /tmp directory itself', () => {
        expect(isPathAllowed('/tmp')).toBe(true);
      });
    });

    describe('disallowed paths', () => {
      it('should reject path traversal to /etc/passwd', () => {
        expect(isPathAllowed('../../etc/passwd')).toBe(false);
      });

      it('should reject absolute paths outside allowed directories', () => {
        expect(isPathAllowed('/root/file.pdf')).toBe(false);
      });

      it('should reject relative traversal that escapes to a sibling of uploads', () => {
        // ../uploads/file resolves relative to cwd, which is just cwd/../uploads/file
        // This goes up one level from cwd then into uploads — NOT the same as cwd/uploads
        expect(isPathAllowed('../uploads/file')).toBe(false);
      });

      it('should reject path traversal through an allowed directory', () => {
        // uploads/../../../etc/passwd resolves to something outside allowed dirs
        expect(isPathAllowed('uploads/../../../etc/passwd')).toBe(false);
      });

      it('should reject paths to system directories', () => {
        expect(isPathAllowed('/etc/shadow')).toBe(false);
        expect(isPathAllowed('/usr/bin/node')).toBe(false);
        expect(isPathAllowed('/var/log/syslog')).toBe(false);
      });

      it('should reject the cwd itself (not an allowed directory)', () => {
        expect(isPathAllowed(cwd)).toBe(false);
      });

      it('should reject a path that is a prefix of an allowed dir but not a child', () => {
        // "uploadsExtra" is not the same as "uploads/"
        expect(isPathAllowed(path.join(cwd, 'uploadsExtra', 'file.pdf'))).toBe(false);
      });

      it('should reject /tmpevil (prefix attack on /tmp)', () => {
        expect(isPathAllowed('/tmpevil/file.pdf')).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('should handle empty string by resolving to cwd (disallowed)', () => {
        // path.resolve('') === cwd, which is not an allowed directory
        expect(isPathAllowed('')).toBe(false);
      });

      it('should handle dot path by resolving to cwd (disallowed)', () => {
        expect(isPathAllowed('.')).toBe(false);
      });

      it('should handle double-dot traversal', () => {
        expect(isPathAllowed('..')).toBe(false);
      });

      it('should handle a deeply nested traversal that lands in /tmp', () => {
        // This resolves to /tmp/secret.txt regardless of cwd nesting
        expect(isPathAllowed('/tmp/a/b/../../secret.txt')).toBe(true);
      });

      it('should handle path with trailing separator inside allowed dir', () => {
        expect(isPathAllowed(path.join(cwd, 'uploads', 'subdir') + path.sep)).toBe(true);
      });
    });
  });
});
