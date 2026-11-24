import type { Request } from "express";
import { LOCALE_COOKIE } from "../../shared/firm-boot";
import { MAX_UPLOAD_BYTES } from "../../shared/upload-limits";
import en from "../../client/src/locales/en/serverErrors.json";
import ar from "../../client/src/locales/ar/serverErrors.json";
import { DomainError } from "../errors";

type SizeErrorCode = "FILE_TOO_LARGE" | "PAYLOAD_TOO_LARGE" | "CONTACT_IMPORT_TOO_LARGE";

export function sizeErrorBody(req: Request, code: SizeErrorCode) {
  const locale =
    req.headers.cookie?.match(new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=(en|ar)(?:;|$)`))?.[1] ??
    req.acceptsLanguages("en", "ar");
  const catalog = locale === "ar" ? ar : en;
  return { code, message: catalog[`serverErrors.${code}`] };
}

export function assertUploadSize(bytes: number): void {
  if (bytes > MAX_UPLOAD_BYTES) {
    throw new DomainError(
      "FILE_TOO_LARGE",
      413,
      { maxBytes: MAX_UPLOAD_BYTES },
      en["serverErrors.FILE_TOO_LARGE"]
    );
  }
}
