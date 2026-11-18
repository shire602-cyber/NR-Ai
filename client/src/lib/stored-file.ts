// Stored-file helpers: read a file the server holds (document vault) as a Blob, and turn a picked
// File into a base64 data URL for the JSON upload contract. Used by the admin documents page.
import { apiUrl } from "./api";
import { getAuthHeaders } from "./auth";
import { triggerBlobDownload } from "./export";

export class StoredFileError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

function filenameFrom(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;
  const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  if (!match) return fallback;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/** GET a stored file with the session credentials; throws StoredFileError when it is missing. */
export async function fetchStoredFile(
  url: string,
  fallbackName = "document"
): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(apiUrl(url), { credentials: "include", headers: getAuthHeaders() });
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      const json = await res.json();
      message = json.message || message;
    } catch {
      /* not JSON */
    }
    throw new StoredFileError(message, res.status);
  }
  return {
    blob: await res.blob(),
    filename: filenameFrom(res.headers.get("Content-Disposition"), fallbackName),
  };
}

/** Download a stored file through the browser's save flow. */
export async function downloadStoredFile(url: string, fallbackName?: string): Promise<void> {
  const { blob, filename } = await fetchStoredFile(url, fallbackName);
  await triggerBlobDownload(blob, filename);
}

/** Open a stored file in a new tab (the browser renders PDFs and images inline). */
export async function openStoredFile(url: string): Promise<void> {
  const { blob } = await fetchStoredFile(url);
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}
