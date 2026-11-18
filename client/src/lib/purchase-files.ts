/**
 * WQ2: files on purchase documents (bill attachments, expense-claim receipts). Files travel as
 * data URLs (the server's upload guard checks the bytes); stored files are read back with the
 * session's auth headers and shown from a blob URL, never from a public link.
 */
import { apiUrl } from "@/lib/api";
import { getAuthHeaders } from "@/lib/auth";

/** Accepted by the upload guard: PDF and the common image types. */
export const PURCHASE_FILE_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/gif";
/** The upload is a 10 MB JSON body of base64 (4/3 of the bytes): refuse larger files up front. */
export const PURCHASE_FILE_MAX_BYTES = 7 * 1024 * 1024;

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * A data URL as a Blob, decoded in the page. Broken-path sweep: the bill preview used
 * `fetch(dataUrl)`, which the production Content-Security-Policy (connect-src 'self') refuses,
 * so the chosen file never previewed in production.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  const header = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const type = /^data:([^;,]+)/.exec(header)?.[1] ?? "application/octet-stream";
  if (!/;base64$/i.test(header)) return new Blob([decodeURIComponent(body)], { type });
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Fetch a stored file with the session's credentials and return a blob URL for it. */
export async function fetchStoredFile(path: string): Promise<{ url: string; type: string }> {
  const res = await fetch(apiUrl(path), { headers: getAuthHeaders(), credentials: "include" });
  if (!res.ok) throw new Error(String(res.status));
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), type: blob.type };
}

/** Open a stored file in a new tab (PDF viewer or image). */
export async function openStoredFile(path: string): Promise<void> {
  const { url } = await fetchStoredFile(path);
  window.open(url, "_blank", "noopener");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
