import { fetchPortalResource } from "./queryClient";

import { portalRequestHeaders } from "./portal-state";

export async function downloadPortalFile(
  path: string,
  filename: string,
  supplier: string
): Promise<boolean> {
  const response = await fetchPortalResource(path, { headers: portalRequestHeaders(supplier) });
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return true;
}
