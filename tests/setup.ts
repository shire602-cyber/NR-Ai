/**
 * Vitest global test setup.
 * Sets environment variables for test mode.
 */

// Set test environment variables BEFORE any imports
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/muhasib_test";
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters-long";
process.env.JWT_SECRET = "test-jwt-secret-at-least-32-characters-long-unique";
process.env.PORT = "5001";
process.env.LOG_LEVEL = "error"; // Suppress logs during tests

// zod 3-compatible validation messages, as installed by the server entry (R17-27).
import "../shared/zod-config";

/**
 * jsdom does not implement CSS.escape. Tests that look up IDs with
 * `CSS.escape(...)` must keep that call so the selector stays correct for
 * unusual IDs; this polyfill follows the CSSOM algorithm.
 * @see https://drafts.csswg.org/cssom/#the-css.escape()-method
 */
function cssEscape(value: string): string {
  const string = String(value);
  const length = string.length;
  const first = string.charCodeAt(0);
  let result = "";
  for (let index = 0; index < length; index++) {
    const code = string.charCodeAt(index);
    if (code === 0x0000) {
      result += "\uFFFD";
      continue;
    }
    if (
      (code >= 0x0001 && code <= 0x001f) ||
      code === 0x007f ||
      (index === 0 && code >= 0x0030 && code <= 0x0039) ||
      (index === 1 && code >= 0x0030 && code <= 0x0039 && first === 0x002d)
    ) {
      result += `\\${code.toString(16)} `;
      continue;
    }
    if (index === 0 && length === 1 && code === 0x002d) {
      result += `\\${string.charAt(index)}`;
      continue;
    }
    if (
      code >= 0x0080 ||
      code === 0x002d ||
      code === 0x005f ||
      (code >= 0x0030 && code <= 0x0039) ||
      (code >= 0x0041 && code <= 0x005a) ||
      (code >= 0x0061 && code <= 0x007a)
    ) {
      result += string.charAt(index);
      continue;
    }
    result += `\\${string.charAt(index)}`;
  }
  return result;
}

type CssEscapeHost = { escape: (ident: string) => string };
const root = globalThis as typeof globalThis & { CSS?: CssEscapeHost };
if (!root.CSS) {
  root.CSS = { escape: cssEscape };
} else if (typeof root.CSS.escape !== "function") {
  root.CSS.escape = cssEscape;
}
