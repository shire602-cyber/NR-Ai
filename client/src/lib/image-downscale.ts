/**
 * Shrink phone photos before upload: a 12 MP receipt photo is 4-8 MB, which is
 * slow on mobile data and unnecessary for reading text. The long edge is capped
 * at 2000 px and the result is a JPEG. Anything that is not a plain raster
 * image (PDF, HEIC the browser cannot decode) is returned unchanged, so the
 * server still receives it.
 */

export const MAX_EDGE = 2000;
export const JPEG_QUALITY = 0.82;
/** Below this size, and already small enough, re-encoding only loses quality. */
export const SKIP_BELOW_BYTES = 600 * 1024;

export interface Size {
  width: number;
  height: number;
}

/** Scale so the long edge is at most `maxEdge`; never enlarges. Dimensions are whole pixels, at least 1. */
export function targetSize(width: number, height: number, maxEdge: number = MAX_EDGE): Size {
  if (!(width > 0) || !(height > 0)) return { width: 1, height: 1 };
  const long = Math.max(width, height);
  if (long <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxEdge / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

const RASTER = /^image\/(jpeg|png|webp)$/;

/** True when re-encoding is worth doing for this file and image size. */
export function shouldDownscale(file: { type: string; size: number }, width: number, height: number, maxEdge: number = MAX_EDGE): boolean {
  if (!RASTER.test(file.type)) return false;
  const fitsAlready = Math.max(width, height) <= maxEdge;
  return !(fitsAlready && file.size < SKIP_BELOW_BYTES);
}

/** "IMG_0042.HEIC" -> "IMG_0042.jpg" */
export function jpegName(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, "");
  return `${base || "photo"}.jpg`;
}

export async function downscaleImage(file: File, maxEdge: number = MAX_EDGE): Promise<File> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
  if (!RASTER.test(file.type)) return file;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    if (!shouldDownscale(file, bitmap.width, bitmap.height, maxEdge)) return file;
    const { width, height } = targetSize(bitmap.width, bitmap.height, maxEdge);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#ffffff"; // transparent PNGs become white, not black, in a JPEG
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    // Keep the original if the "smaller" result is not actually smaller.
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}
