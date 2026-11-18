/**
 * File names for generated downloads (Fable P-f). A customer called "مؤسسة النور" produced
 * `statement-_-2026-11-18.pdf` because every non-ASCII character became "_". Names keep
 * letters and digits of any script (Arabic stays Arabic), turn everything else into single
 * hyphens, and drop a part that ends up empty, so the file is never named after "_".
 */

/** One readable file-name segment: Unicode letters/digits kept, other runs become "-". */
export function fileNamePart(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFC")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** `prefix-part-part.ext` from the non-empty parts. */
export function downloadFileName(
  prefix: string,
  parts: Array<string | null | undefined>,
  ext: string
): string {
  const segments = [prefix, ...parts.map(fileNamePart)].filter(Boolean);
  return `${segments.join("-")}.${ext}`;
}

/**
 * `Content-Disposition` for a download: the UTF-8 name in `filename*` (every current browser
 * uses it) and an ASCII `filename` fallback built from the ASCII parts only, so an Arabic
 * name falls back to `statement-2026-11-18.pdf`, not `statement-_-2026-11-18.pdf`.
 */
export function attachmentDisposition(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : "";
  const asciiStem = stem
    .split("-")
    .map((segment) => segment.replace(/[^A-Za-z0-9_.]+/g, ""))
    .filter(Boolean)
    .join("-");
  const ascii = `${asciiStem || "download"}${ext}`;
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
