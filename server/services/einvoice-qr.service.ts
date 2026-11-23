import QRCode from "qrcode";
import type { Invoice } from "../../shared/schema";
import { publicBaseUrl } from "./payments";

/** A PDF may point to an existing public share. Rendering never creates a share. */
export async function renderInvoiceShareQrPng(
  invoice: Pick<Invoice, "shareToken" | "shareTokenExpiresAt" | "status">
): Promise<Buffer | null> {
  if (
    !invoice.shareToken ||
    invoice.status === "draft" ||
    invoice.status === "cancelled" ||
    (invoice.shareTokenExpiresAt && new Date(invoice.shareTokenExpiresAt).getTime() <= Date.now())
  ) {
    return null;
  }
  const url = `${publicBaseUrl()}/view/invoice/${encodeURIComponent(invoice.shareToken)}`;
  return QRCode.toBuffer(url, { errorCorrectionLevel: "M", type: "png", margin: 4, width: 240 });
}
