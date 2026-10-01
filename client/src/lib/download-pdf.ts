import { apiUrl } from "@/lib/api";
import { ApiError } from "@/lib/queryClient";

/**
 * Fetch a server-rendered PDF with the session cookie and hand it to the
 * browser as a download. A failed request throws an ApiError carrying the
 * server's message (for a toast) instead of opening a tab full of JSON.
 */
export async function downloadPdf(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(apiUrl(path), { credentials: "include" });
  if (!res.ok) {
    let message = res.statusText;
    let code: string | undefined;
    try {
      const json = await res.json();
      message = json.message || json.error || message;
      if (typeof json.code === "string") code = json.code;
    } catch {
      /* body was not JSON */
    }
    throw new ApiError(message, res.status, code);
  }
  const blob = await res.blob();
  const match = res.headers.get("Content-Disposition")?.match(/filename="(.+?)"/);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = match?.[1] ?? fallbackName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
