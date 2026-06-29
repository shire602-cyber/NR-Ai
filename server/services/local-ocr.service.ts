import os from "node:os";
import path from "node:path";
import Tesseract from "tesseract.js";
import { parseReceiptOcrText, type ParsedReceiptOcr } from "@shared/receipt-ocr-parser";
import { createLogger } from "../config/logger";

const log = createLogger("local-ocr");

const DEFAULT_TIMEOUT_MS = 45_000;
const MIN_TEXT_LENGTH = 10;

export type LocalReceiptOcrResult = ParsedReceiptOcr & {
  _ocrSource: "tesseract";
};

function decodeImageData(imageData: string): Buffer {
  const dataUrlMatch = String(imageData).match(/^data:([^;]+);base64,(.+)$/s);
  const base64 = dataUrlMatch ? dataUrlMatch[2] : String(imageData);
  return Buffer.from(base64, "base64");
}

function ocrTimeoutMs(): number {
  const raw = Number(process.env.TESSERACT_OCR_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 5_000 ? raw : DEFAULT_TIMEOUT_MS;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Local OCR timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function extractReceiptWithLocalOcr(
  imageData: string
): Promise<LocalReceiptOcrResult> {
  const buffer = decodeImageData(imageData);
  if (buffer.length === 0) {
    throw new Error("Image payload was empty");
  }

  const cachePath = process.env.TESSERACT_CACHE_PATH || path.join(os.tmpdir(), "muhasib-tesseract");
  const timeoutMs = ocrTimeoutMs();
  const startedAt = Date.now();

  const result = await withTimeout(
    Tesseract.recognize(buffer, "eng", {
      cachePath,
      logger: (message) => {
        if (message.status === "recognizing text" && message.progress >= 1) {
          log.debug({ elapsedMs: Date.now() - startedAt }, "Local OCR recognition completed");
        }
      },
      errorHandler: (err) => {
        log.warn({ err: err?.message || err }, "Local OCR worker error");
      },
    }),
    timeoutMs
  );

  const text = result.data.text || "";
  if (text.trim().length < MIN_TEXT_LENGTH) {
    throw new Error("Local OCR could not read enough text from the image");
  }

  return {
    ...parseReceiptOcrText(text),
    _ocrSource: "tesseract",
  };
}
