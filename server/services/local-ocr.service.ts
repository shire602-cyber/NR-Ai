import { addAbortListener } from "node:events";
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

/** Tesseract language set: TESSERACT_LANGS (e.g. "eng+ara"); defaults to Arabic + English. */
export function ocrLanguages(env: Record<string, string | undefined> = process.env): string {
  const raw = (env.TESSERACT_LANGS || "eng+ara").trim();
  return /^[a-z_]{3,8}(\+[a-z_]{3,8})*$/i.test(raw) ? raw : "eng+ara";
}

function ocrTimeoutMs(): number {
  const raw = Number(process.env.TESSERACT_OCR_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 5_000 ? raw : DEFAULT_TIMEOUT_MS;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  let listener: ReturnType<typeof addAbortListener> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        if (signal) listener = addAbortListener(signal, () => reject(signal.reason));
        timeout = setTimeout(
          () => reject(new Error(`Local OCR timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    listener?.[Symbol.dispose]();
    if (timeout) clearTimeout(timeout);
  }
}

export async function extractReceiptWithLocalOcr(
  imageData: string,
  signal?: AbortSignal
): Promise<LocalReceiptOcrResult> {
  signal?.throwIfAborted();
  const buffer = decodeImageData(imageData);
  if (buffer.length === 0) {
    throw new Error("Image payload was empty");
  }

  const cachePath = process.env.TESSERACT_CACHE_PATH || path.join(os.tmpdir(), "muhasib-tesseract");
  const timeoutMs = ocrTimeoutMs();
  const startedAt = Date.now();

  const recognize = async (langs: string) => {
    let worker: Tesseract.Worker | undefined;
    let stopped = false;
    const run = async () => {
      worker = await Tesseract.createWorker(langs, Tesseract.OEM.LSTM_ONLY, {
        cachePath,
        logger: (message) => {
          if (message.status === "recognizing text" && message.progress >= 1) {
            log.debug({ elapsedMs: Date.now() - startedAt }, "Local OCR recognition completed");
          }
        },
        errorHandler: (err) => {
          log.warn({ err: err?.message || err }, "Local OCR worker error");
        },
      });
      // Worker startup cannot be cancelled through Tesseract's API.
      if (stopped) {
        await worker.terminate();
        throw new Error("Local OCR stopped during worker startup");
      }
      return worker.recognize(buffer);
    };
    try {
      return await withTimeout(run(), timeoutMs, signal);
    } finally {
      stopped = true;
      await worker?.terminate();
    }
  };

  // Arabic + English by default (R05-16). If the Arabic model cannot be loaded (offline,
  // blocked CDN) fall back to English only rather than failing the whole OCR path.
  const langs = ocrLanguages();
  let result;
  try {
    result = await recognize(langs);
  } catch (err) {
    signal?.throwIfAborted();
    if (langs === "eng") throw err;
    log.warn({ err: (err as Error)?.message, langs }, "Multi-language OCR failed; retrying eng");
    result = await recognize("eng");
  }

  signal?.throwIfAborted();
  const text = result.data.text || "";
  if (text.trim().length < MIN_TEXT_LENGTH) {
    throw new Error("Local OCR could not read enough text from the image");
  }

  return {
    ...parseReceiptOcrText(text),
    _ocrSource: "tesseract",
  };
}
