/**
 * Company logo for PDFs (S1, R14-13). The logo is uploaded once through
 * POST /api/companies/:id/logo and stored by fileStorage; only the key lives on
 * `companies.logo_path`. Documents read the stored bytes here instead of carrying an inline
 * data: URL. Legacy data: URLs (invoice templates, companies.logo_url) are a fallback only.
 *
 * PDFKit embeds PNG and JPEG; any other stored type (WebP, GIF) is skipped rather than
 * breaking the document. Nothing is fetched from the network except through fileStorage.
 */
import type { Company } from "../../shared/schema";
import { readReceiptImage } from "./fileStorage";

const PDF_RASTER = /^image\/(png|jpe?g)$/i;
const DATA_URL = /^data:image\/(png|jpe?g);base64,/i;

function isPng(b: Buffer): boolean {
  return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}
function isJpeg(b: Buffer): boolean {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

/** Decode a legacy raster data: URL (PNG/JPEG only); null otherwise. */
export function logoFromDataUrl(value: string | null | undefined): Buffer | null {
  if (!value || !DATA_URL.test(value)) return null;
  try {
    const buf = Buffer.from(value.slice(value.indexOf(",") + 1), "base64");
    return isPng(buf) || isJpeg(buf) ? buf : null;
  } catch {
    return null;
  }
}

/**
 * The logo bytes to print on a company's documents, or null.
 *   1. companies.logo_path (the uploaded, served logo) when it is PNG/JPEG;
 *   2. otherwise a legacy data: URL (`fallbackDataUrl`, e.g. an invoice template, then
 *      companies.logo_url).
 * `companies.invoice_show_logo = false` (or `show: false`) prints none.
 */
export async function loadCompanyLogo(
  company: Pick<Company, "logoPath" | "logoUrl"> & { invoiceShowLogo?: boolean | null },
  opts: { fallbackDataUrl?: string | null; show?: boolean | null } = {}
): Promise<Buffer | null> {
  if (opts.show === false || company.invoiceShowLogo === false) return null;
  if (company.logoPath) {
    try {
      const image = await readReceiptImage(company.logoPath);
      if (image && PDF_RASTER.test(image.contentType)) {
        if (isPng(image.buffer) || isJpeg(image.buffer)) return image.buffer;
      }
    } catch {
      // A missing or unreadable stored logo must never break a tax document.
    }
  }
  return logoFromDataUrl(opts.fallbackDataUrl) ?? logoFromDataUrl(company.logoUrl);
}

/** Served URL of the uploaded logo for the client (authenticated, company-scoped). */
export function companyLogoUrl(company: Pick<Company, "id" | "logoPath">): string | null {
  return company.logoPath ? `/api/companies/${company.id}/logo` : null;
}
