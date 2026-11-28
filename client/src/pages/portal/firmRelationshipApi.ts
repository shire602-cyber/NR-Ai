/** Client-side firm relationship helpers (S4): vault upload and request filters. */
import { apiUrl } from "@/lib/api";
import { getAuthHeaders } from "@/lib/auth";
import { withCsrfHeader } from "@/lib/csrf";

export interface DocumentRequest {
  id: string;
  firmName: string;
  listName: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  status: "requested" | "uploaded" | "accepted" | "rejected" | "cancelled";
  reviewNote: string | null;
}

/** Upload a file into the company's document vault; returns the documents row id. */
export async function uploadCompanyDocument(companyId: string, file: File): Promise<string> {
  const form = new FormData();
  form.append("name", file.name.replace(/\.[^.]+$/, ""));
  form.append("category", "other");
  form.append("file", file, file.name);
  let headers: Record<string, string> = { ...getAuthHeaders() };
  if (!headers.Authorization) headers = await withCsrfHeader("POST", headers);
  const res = await fetch(apiUrl(`/api/companies/${companyId}/documents`), {
    method: "POST",
    headers,
    body: form,
    credentials: "include",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
  return body.id as string;
}

/** Requests the client can still answer (open or sent back by the firm). */
export function openRequests(requests: DocumentRequest[]): DocumentRequest[] {
  return requests.filter((r) => r.status === "requested" || r.status === "rejected");
}
