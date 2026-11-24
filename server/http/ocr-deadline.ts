import { addAbortListener } from "node:events";
import type { Request, RequestHandler, Response } from "express";
import { asyncHandler } from "../middleware/errorHandler";

// Leave 20 seconds of the Vercel function budget for cold start and the response.
const OCR_REQUEST_TIMEOUT_MS = 40_000;

const ocrPaths = [
  /^\/api\/ocr\/process\/?$/i,
  /^\/api\/firm\/bulk\/ocr\/?$/i,
  /^\/api\/companies\/[^/]+\/bills\/capture\/?$/i,
];

const pendingDeadlines = new WeakMap<Request, { signal: AbortSignal; release: () => void }>();

export const ocrTimeoutBody = {
  code: "OCR_TIMEOUT",
  message: "Receipt reading took too long. Please try again.",
};

export const startOcrDeadline: RequestHandler = (req, res, next) => {
  if (req.method !== "POST" || !ocrPaths.some((path) => path.test(req.path))) return next();

  const signal = AbortSignal.timeout(OCR_REQUEST_TIMEOUT_MS);
  const listener = addAbortListener(signal, () => {
    if (!res.headersSent && !res.destroyed) res.status(504).json(ocrTimeoutBody);
  });
  const release = () => {
    listener[Symbol.dispose]();
    res.off("close", release);
  };
  pendingDeadlines.set(req, { signal, release });
  res.once("close", release);
  next();
};

export function withOcrDeadline(
  handle: (
    req: Request,
    res: Response,
    signal: AbortSignal,
    waitForStep: <T>(work: Promise<T>) => Promise<T>
  ) => Promise<unknown>
) {
  return asyncHandler(async (req, res) => {
    if (res.headersSent || res.destroyed) return;
    // The handler owns timeout responses from here so bulk OCR can include saved receipts.
    const deadline = pendingDeadlines.get(req);
    deadline?.release();
    const signal = deadline?.signal ?? AbortSignal.timeout(OCR_REQUEST_TIMEOUT_MS);
    const waitForStep = async <T>(work: Promise<T>): Promise<T> => {
      let listener: ReturnType<typeof addAbortListener> | undefined;
      try {
        return await Promise.race([
          work,
          new Promise<never>((_, reject) => {
            listener = addAbortListener(signal, () => reject(signal.reason));
          }),
        ]);
      } finally {
        listener?.[Symbol.dispose]();
      }
    };
    try {
      signal.throwIfAborted();
      await handle(req, res, signal, waitForStep);
    } catch (err) {
      if (!signal.aborted) throw err;
      if (!res.headersSent && !res.destroyed) res.status(504).json(ocrTimeoutBody);
    }
  });
}
