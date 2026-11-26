/**
 * Retry of an on-demand dialog chunk that failed to load.
 *
 * Engines that predate the WebKit 319492 fix cache a failed module fetch per URL for the life of
 * the document, so importing the same URL again rejects without a request even once the network is
 * back. A retry therefore imports the same chunk under a fresh query string. The URL is never read
 * from the error (older Safari does not name it): each page keeps its literal
 * `import("@/components/team/<Name>")` for the first attempt (the bundler still splits and
 * preloads it) and builds the retry URL from `dialogChunkPath`:
 *
 *   - dev: the dialog's source path relative to the page module (Vite serves it as-is);
 *   - production: a marker the `dialog-chunk-urls` Vite plugin (scripts/vite/) replaces, in the
 *     rendered page chunk, with the path of the hashed chunk that page really imports.
 *
 * The page resolves it with `new URL(path, import.meta.url)` and `freshChunkUrl` adds the query.
 */

export const DIALOG_RETRY_PARAM = "muhasib-retry";

/** The same chunk under a URL the module map has never seen. */
export function freshChunkUrl(chunk: URL | string, token: string): string {
  const url = new URL(chunk);
  url.searchParams.set(DIALOG_RETRY_PARAM, token);
  return url.href;
}

/** A token no earlier attempt in this document used (`attempt` counts from 1). */
export function retryToken(attempt: number, now: number = Date.now()): string {
  return `${attempt}-${now.toString(36)}`;
}
