import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

// All uploaded receipt images land under <projectRoot>/uploads/receipts/
const receiptsDir = path.join(projectRoot, 'uploads', 'receipts');

async function ensureDir(): Promise<void> {
  await fs.mkdir(receiptsDir, { recursive: true });
}

/**
 * Save a base64-encoded image to disk.
 * Returns the relative path stored in the DB (e.g. "receipts/abc123.jpg").
 * Abstraction point: swap this function body for an S3/R2 upload when ready.
 */
export async function saveReceiptImage(base64Data: string, filename: string): Promise<string> {
  await ensureDir();
  const raw = base64Data.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(raw, 'base64');
  const safeName = filename.replace(/[^a-z0-9_\-\.]/gi, '_');
  const absPath = path.join(receiptsDir, safeName);
  await fs.writeFile(absPath, buffer);
  return `receipts/${safeName}`;
}

/**
 * Delete a receipt image by its relative DB path.
 * Silently ignores missing files.
 */
export async function deleteReceiptImage(imagePath: string): Promise<void> {
  try {
    const absPath = path.join(projectRoot, 'uploads', imagePath);
    await fs.unlink(absPath);
  } catch {
    // file already gone or never existed — not an error
  }
}

/**
 * Resolve a relative image_path from the DB to an absolute filesystem path.
 * Used by the image-serve route.
 */
export function resolveImagePath(imagePath: string): string {
  return path.join(projectRoot, 'uploads', imagePath);
}
