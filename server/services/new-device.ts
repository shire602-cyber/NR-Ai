/**
 * New-device sign-in email (D5). Sent only when the email provider is
 * configured; silent (and logged) otherwise.
 */
import type { Request } from "express";
import { createLogger } from "../config/logger";
import { hasEmailProvider, sendGenericEmail } from "./email.service";
import { bilingualSubject, bilingualText, localized } from "./email-i18n";
import { parseUserAgent } from "./sessions";

const log = createLogger("new-device");

export function describeDevice(userAgent: string | null | undefined): string {
  const { browser, os } = parseUserAgent(userAgent);
  const b = browser === "other" ? "an unknown browser" : browser.replace(/\d+$/, "");
  const o = os === "other" ? "an unknown system" : os;
  return `${b} on ${o}`;
}

export async function notifyNewDevice(user: { id: string; email: string; name?: string | null }, req: Request | undefined): Promise<void> {
  if (!hasEmailProvider()) {
    log.info({ userId: user.id }, "New device sign-in: email provider not configured, notification skipped");
    return;
  }
  const ua = (req?.headers["user-agent"] as string | undefined) ?? null;
  const ip = req?.ip || req?.socket?.remoteAddress || "unknown";
  try {
    // Bilingual (Arabic, then English): the device description is the same text in both blocks.
    const name = user.name ? " " + user.name : "";
    await sendGenericEmail(
      user.email,
      bilingualSubject(localized("newDeviceSubject")),
      bilingualText(localized("newDeviceBody", { name, device: describeDevice(ua), ip })),
      "Muhasib.ai"
    );
  } catch (err) {
    log.warn({ err, userId: user.id }, "New device email failed");
  }
}
