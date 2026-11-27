/** Open or download a Document Vault file reference. */
import { apiUrl } from "./api";
import { getAuthHeaders } from "./auth";
import { withCsrfHeader } from "./csrf";

/** W4-D (R16-09): headers for a raw fetch (Bearer, or the CSRF token for cookie sessions). */
export async function vaultHeaders(method: string): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...getAuthHeaders() };
  return headers.Authorization ? headers : withCsrfHeader(method, headers);
}

/** The stored reference is neither an https:// link nor the authenticated download route. */
export class VaultUnsupportedReferenceError extends Error {}
/** The browser refused to open the preview tab. */
export class VaultPopupBlockedError extends Error {}

const DOWNLOAD_ROUTE =
  /^\/api\/documents\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/download$/i;

/** The parsed https:// link, or null when the reference is not a well-formed one. */
function externalHttpsUrl(reference: string): string | null {
  if (!/^https:\/\//i.test(reference)) return null;
  try {
    return new URL(reference).href;
  } catch {
    return null;
  }
}

/**
 * Opens an external link without passing this page on as opener or referrer. The tab is reserved
 * first because window.open with "noopener" returns null whether or not it was blocked.
 */
function openExternal(href: string) {
  const tab = window.open("", "_blank");
  if (!tab) throw new VaultPopupBlockedError();
  try {
    tab.opener = null;
    const link = tab.document.createElement("a");
    link.href = href;
    link.rel = "noreferrer";
    tab.document.body.appendChild(link);
    link.click();
  } catch (error) {
    tab.close();
    throw error;
  }
}

/**
 * Types shown inside a tab. A blob: URL runs with this site's origin, so nothing that can carry
 * script (HTML, SVG, XML) belongs here; everything else is saved to disk instead.
 */
const PREVIEW_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "text/plain",
]);

function saveUrl(url: string, fileName: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** A preview keeps its object URL (reload, the PDF viewer's save) until the tab is closed. */
function revokeWhenClosed(tab: Window, url: string) {
  const timer = setInterval(() => {
    if (!tab.closed) return;
    clearInterval(timer);
    URL.revokeObjectURL(url);
  }, 1_000);
}

/** Must be called straight from the click handler: a preview reserves its tab before any await. */
export async function openVaultFile(
  doc: { fileUrl: string; fileName: string },
  download: boolean
): Promise<void> {
  const external = externalHttpsUrl(doc.fileUrl);
  if (external) {
    openExternal(external);
    return;
  }
  // Stored files are served by the authenticated download route (fileUrl is set by the server).
  if (!DOWNLOAD_ROUTE.test(doc.fileUrl)) throw new VaultUnsupportedReferenceError();

  // No "noopener" feature here: it would make window.open return null and lose the handle.
  const tab = download ? null : window.open("", "_blank");
  if (!download) {
    if (!tab) throw new VaultPopupBlockedError();
    tab.opener = null;
  }
  try {
    const res = await fetch(apiUrl(doc.fileUrl), {
      headers: await vaultHeaders("GET"),
      credentials: "include",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    // The user closed the reserved tab while the file was loading.
    if (tab?.closed) return;
    const url = URL.createObjectURL(blob);
    const type = blob.type.split(";")[0].trim().toLowerCase();
    try {
      if (tab && PREVIEW_TYPES.has(type)) {
        tab.location.replace(url);
        revokeWhenClosed(tab, url);
      } else {
        tab?.close();
        saveUrl(url, doc.fileName);
      }
    } catch (error) {
      // Nothing took the URL over, so nothing else will release it.
      URL.revokeObjectURL(url);
      throw error;
    }
  } catch (error) {
    tab?.close();
    throw error;
  }
}
