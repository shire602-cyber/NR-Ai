/** The element id named by a URL hash; a malformed escape (`#%`) names nothing instead of throwing. */
export function fragmentId(hash: string): string {
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return "";
  }
}
