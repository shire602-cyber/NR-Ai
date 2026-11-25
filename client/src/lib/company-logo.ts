/**
 * Company logo on the client (S1, R14-13). The logo is uploaded once to
 * POST /api/companies/:id/logo (magic-byte checked, 1 MB cap, stored by fileStorage) and shown
 * from GET /api/companies/:id/logo. Forms no longer put an inline data: URL into
 * companies.logo_url; a legacy logo_url is only displayed until a logo is uploaded.
 */
import { apiUrl } from "@/lib/api";
import { apiRequest } from "@/lib/queryClient";

/** Same cap as the server (LOGO_MAX_BYTES). */
export const COMPANY_LOGO_MAX_BYTES = 1024 * 1024;
export const COMPANY_LOGO_TYPES = /^image\/(png|jpe?g|gif|webp)$/;

export interface CompanyLogoFields {
  id: string;
  logoPath?: string | null;
  logoUrl?: string | null;
}

/** The image source to display for a company's logo, or null. */
export function companyLogoSrc(company: CompanyLogoFields | null | undefined): string | null {
  if (!company) return null;
  if (company.logoPath) {
    // The storage key changes on every upload, so it doubles as a cache buster.
    const v = encodeURIComponent(company.logoPath.slice(-16));
    return apiUrl(`/api/companies/${company.id}/logo?v=${v}`);
  }
  return company.logoUrl || null;
}

/** Validate a picked file; returns an error message or null. */
export function companyLogoFileError(file: { size: number; type: string }): string | null {
  if (!COMPANY_LOGO_TYPES.test(file.type)) return "Choose a PNG, JPEG, GIF or WebP image.";
  if (file.size > COMPANY_LOGO_MAX_BYTES) return "Choose an image of 1 MB or smaller.";
  return null;
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

/** Upload the logo; resolves with the stored key (companies.logo_path). */
export async function uploadCompanyLogo(companyId: string, file: Blob): Promise<string> {
  const imageData = await readAsDataUrl(file);
  const res = (await apiRequest("POST", `/api/companies/${companyId}/logo`, { imageData })) as {
    logoPath: string;
  };
  return res.logoPath;
}
