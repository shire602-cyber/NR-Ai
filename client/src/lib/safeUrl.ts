/**
 * Return the URL only if it is a real http(s) URL the browser can navigate to.
 * Returns null for `javascript:`, `data:`, `file:`, relative, empty, or malformed
 * inputs. Use before `window.open(url, '_blank')` or as the `href` of any link
 * built from data outside our control (FTA news source links, document URLs).
 */
export function safeHttpUrl(input: unknown): string | null {
  if (typeof input !== 'string' || input.trim() === '') return null;
  try {
    const url = new URL(input);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}
