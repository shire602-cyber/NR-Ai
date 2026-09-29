// Client side of private file storage: read a chosen file as base64 for the JSON
// upload routes, and download stored files through the authenticated routes
// (files are never public URLs).

import { getAuthHeaders, refreshSession } from "./auth";
import { apiUrl } from "./api";

/** Mirrors the server cap (server/services/document-validation.ts). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Value for <input accept>; the server re-checks the real bytes. */
export const ACCEPTED_UPLOAD_TYPES =
  "application/pdf,image/png,image/jpeg,image/webp,image/heic,.pdf,.png,.jpg,.jpeg,.webp,.heic,.xlsx,.docx,.csv";

export type FileProblem = "empty" | "too_large";

/** Returns a problem code, or null when the file is acceptable to try uploading. */
export function checkFileBeforeUpload(file: File): FileProblem | null {
  if (file.size === 0) return "empty";
  if (file.size > MAX_UPLOAD_BYTES) return "too_large";
  return null;
}

export function fileProblemMessage(problem: FileProblem, locale: string): string {
  const mb = MAX_UPLOAD_BYTES / 1024 / 1024;
  if (problem === "empty") {
    return locale === "ar" ? "الملف فارغ" : "The file is empty";
  }
  return locale === "ar"
    ? `حجم الملف يتجاوز الحد الأقصى (${mb} ميجابايت)`
    : `The file is larger than the ${mb} MB limit`;
}

/** Read a file as a base64 string (no data-URL prefix). */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

async function fetchWithSession(path: string): Promise<Response> {
  const doFetch = () =>
    fetch(apiUrl(path), { headers: getAuthHeaders(), credentials: "include" });
  let res = await doFetch();
  if (res.status === 401 && (await refreshSession())) res = await doFetch();
  return res;
}

/** Filename from a Content-Disposition header (RFC 5987 form preferred), or null. */
export function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* fall through */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : null;
}

/**
 * Download a privately stored file through an authenticated route and hand it to
 * the browser as a save-as. Throws an Error carrying the server's message.
 */
export async function downloadAuthenticatedFile(path: string, fallbackName: string): Promise<void> {
  const res = await fetchWithSession(path);
  if (!res.ok) {
    let message = res.statusText || "Download failed";
    try {
      const json = await res.json();
      message = json?.message || message;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download =
      filenameFromContentDisposition(res.headers.get("content-disposition")) || fallbackName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
