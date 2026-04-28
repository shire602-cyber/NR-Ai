import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { isUnsafePath } from '../../shared/validators';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

// All uploaded receipt images land under <projectRoot>/uploads/receipts/
const uploadsDir = path.join(projectRoot, 'uploads');
const receiptsDir = path.join(uploadsDir, 'receipts');

async function ensureDir(): Promise<void> {
  await fs.mkdir(receiptsDir, { recursive: true });
}

// Rejects names that, after sanitization, could escape the receipts directory.
// `path.join` does not stop `..` segments, so we must do it ourselves.
function sanitizeReceiptFilename(filename: string): string {
  const safe = filename.replace(/[^a-z0-9_\-\.]/gi, '_');
  if (!safe || safe === '.' || safe === '..' || isUnsafePath(safe)) {
    throw new Error('Invalid filename');
  }
  return safe;
}

// Resolves a relative DB path against `uploadsDir`, then verifies the result
// is still inside `uploadsDir`. Defends against poisoned DB rows or callers
// that forget to validate the input.
function resolveUploadPath(relPath: string): string {
  if (isUnsafePath(relPath)) {
    throw new Error('Invalid upload path');
  }
  const abs = path.resolve(uploadsDir, relPath);
  const rel = path.relative(uploadsDir, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Invalid upload path');
  }
  return abs;
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
  const safeName = sanitizeReceiptFilename(filename);
  const absPath = resolveUploadPath(path.join('receipts', safeName));
  await fs.writeFile(absPath, buffer);
  return `receipts/${safeName}`;
}

/**
 * Delete a receipt image by its relative DB path.
 * Silently ignores missing files.
 */
export async function deleteReceiptImage(imagePath: string): Promise<void> {
  try {
    const absPath = resolveUploadPath(imagePath);
    await fs.unlink(absPath);
  } catch {
    // file already gone, never existed, or path rejected — not an error
  }
}

/**
 * Resolve a relative image_path from the DB to an absolute filesystem path.
 * Used by the image-serve route. Throws if the path escapes the uploads dir.
 */
export function resolveImagePath(imagePath: string): string {
  return resolveUploadPath(imagePath);
}
