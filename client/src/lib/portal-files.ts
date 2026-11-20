import { fetchPortalResource } from "./queryClient";

export async function downloadPortalFile(path: string, filename: string): Promise<boolean> {
  const response = await fetchPortalResource(path);
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
