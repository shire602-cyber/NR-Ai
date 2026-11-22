import { apiUrl } from "./api";
import { getAuthHeaders } from "./auth";
import { triggerBlobDownload } from "./export";

export async function downloadPortalFile(
  path: string,
  filename: string,
  accountId?: string
): Promise<boolean> {
  const headers = accountId ? { "X-Portal-Account": accountId } : getAuthHeaders();
  const res = await fetch(apiUrl(path), { credentials: "include", headers });
  if (!res.ok) return false;
  await triggerBlobDownload(await res.blob(), filename);
  return true;
}
