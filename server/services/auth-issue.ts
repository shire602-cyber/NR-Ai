/**
 * The single point where a login becomes tokens: mints an access + refresh
 * pair that share a `sid`, writes the session row, sets the cookies and (for
 * real sign-ins) tells the user about a device they have not used before.
 */
import type { Request, Response } from "express";

import { generateRefreshToken, generateToken } from "../middleware/auth";
import { setAuthCookies } from "./auth-cookies.service";
import { createSession, newSessionId } from "./sessions";
import { needsTwoFactorEnrolment } from "./two-factor";
import { notifyNewDevice } from "./new-device";

export interface IssuedTokens {
  token: string;
  refreshToken: string;
  sid: string;
  /** True when a company requires 2FA from this user and they have none: the token is confined to /api/auth/*. */
  twoFactorEnrolmentRequired: boolean;
}

export async function issueSessionTokens(
  req: Request,
  res: Response,
  user: { id: string; email: string; name?: string | null; isAdmin?: boolean; userType?: string; firmRole?: string | null },
  opts: { notifyNewDevice?: boolean } = {}
): Promise<IssuedTokens> {
  const sid = newSessionId();
  const enrolRequired = await needsTwoFactorEnrolment(user.id);
  const token = generateToken(user, { sid, scope: enrolRequired ? "2fa_enrol" : undefined });
  const refreshToken = generateRefreshToken(user, { sid });
  const created = await createSession({ sid, userId: user.id, refreshToken, req });
  setAuthCookies(res, token, refreshToken);
  if (opts.notifyNewDevice && created.isNewDevice) void notifyNewDevice(user, req);
  return { token, refreshToken, sid, twoFactorEnrolmentRequired: enrolRequired };
}
