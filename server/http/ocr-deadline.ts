import { addAbortListener } from "node:events";
import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/errorHandler";

// Leave 20 seconds of the Vercel function budget for setup and the response.
const OCR_REQUEST_TIMEOUT_MS = 40_000;

export const ocrTimeoutBody = {
  code: "OCR_TIMEOUT",
  message: "Receipt reading took too long. Please try again.",
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
    const signal = AbortSignal.timeout(OCR_REQUEST_TIMEOUT_MS);
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
      await handle(req, res, signal, waitForStep);
    } catch (err) {
      if (!signal.aborted) throw err;
      res.status(504).json(ocrTimeoutBody);
    }
  });
}
