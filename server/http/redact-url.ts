/**
 * Secret-free URLs for logs and monitoring (S5-SEC-1).
 *
 * Bearer-style secrets ride in URLs in a few places (portal share links, OAuth callbacks, password
 * reset). Nothing that writes a URL to a log, an error report or an audit row may emit them, so
 * the redaction is generic rather than a list of routes:
 *   - a path segment that looks like a token (32+ url-safe characters with both a letter and a
 *     digit, and not a UUID) becomes `:token`;
 *   - a query value is replaced when its key names a secret, or when the value itself looks like
 *     a token.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_CHARS_RE = /^[A-Za-z0-9_-]{32,}$/;
const SECRET_KEY_RE = /token|secret|password|passwd|code|state|signature|sig|auth|key|credential/i;

export const REDACTED_SEGMENT = ":token";
export const REDACTED_VALUE = "[REDACTED]";

/** True for a string that is plausibly a bearer token (long, url-safe, mixed letters/digits). */
export function looksLikeToken(value: string): boolean {
  if (!TOKEN_CHARS_RE.test(value) || UUID_RE.test(value)) return false;
  return /[A-Za-z]/.test(value) && /\d/.test(value);
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function redactPath(path: string): string {
  return path
    .split("/")
    .map((segment) => (looksLikeToken(decode(segment)) ? REDACTED_SEGMENT : segment))
    .join("/");
}

export function redactQuery(query: string): string {
  if (!query) return query;
  return query
    .split("&")
    .map((pair) => {
      if (!pair) return pair;
      const eq = pair.indexOf("=");
      if (eq < 0) return looksLikeToken(decode(pair)) ? REDACTED_VALUE : pair;
      const key = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (value && (SECRET_KEY_RE.test(decode(key)) || looksLikeToken(decode(value)))) {
        return `${key}=${REDACTED_VALUE}`;
      }
      return pair;
    })
    .join("&");
}

/** A request URL (path + optional query + optional fragment) with every secret removed. */
export function redactUrl(url: string | undefined | null): string {
  if (!url) return "";
  const hash = url.indexOf("#");
  const noHash = hash >= 0 ? url.slice(0, hash) : url;
  const q = noHash.indexOf("?");
  const path = q >= 0 ? noHash.slice(0, q) : noHash;
  const query = q >= 0 ? noHash.slice(q + 1) : "";
  const out = redactPath(path) + (q >= 0 ? `?${redactQuery(query)}` : "");
  return hash >= 0 ? `${out}#${REDACTED_VALUE}` : out;
}
