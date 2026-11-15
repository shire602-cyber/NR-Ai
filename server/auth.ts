import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { storage } from "./storage";
import { createLogger } from "./config/logger";

const log = createLogger("auth-policy");

// ─── Password policy (R01-08) ──────────────────────────────────────────────
//
// 8-256 characters, upper + lower case + digit, and not on the offline list of
// the 10,000 most common passwords (server/assets/common-passwords.txt). The
// list is compared case-insensitively, so "Password1" is rejected because
// "password1" is on it.

const FALLBACK_COMMON = [
  "password",
  "password1",
  "password123",
  "123456",
  "12345678",
  "123456789",
  "qwerty",
  "qwerty123",
  "letmein",
  "welcome",
  "welcome1",
  "admin",
  "admin123",
  "iloveyou",
  "abc123",
];

let commonPasswords: Set<string> | null = null;

function commonPasswordFileCandidates(): string[] {
  const out: string[] = [];
  if (process.env.COMMON_PASSWORDS_FILE) out.push(process.env.COMMON_PASSWORDS_FILE);
  out.push(path.resolve(process.cwd(), "server/assets/common-passwords.txt"));
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    out.push(path.resolve(here, "assets/common-passwords.txt"));
    out.push(path.resolve(here, "../server/assets/common-passwords.txt"));
  } catch {
    // import.meta.url unavailable (CJS bundle); cwd candidate is enough.
  }
  return out;
}

export function loadCommonPasswords(): Set<string> {
  if (commonPasswords) return commonPasswords;
  for (const file of commonPasswordFileCandidates()) {
    try {
      if (!fs.existsSync(file)) continue;
      const set = new Set<string>();
      for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const v = line.trim().toLowerCase();
        if (v && !v.startsWith("#")) set.add(v);
      }
      commonPasswords = set;
      return set;
    } catch (err) {
      log.warn({ err, file }, "Could not read common-password list");
    }
  }
  log.warn("Common-password list not found; using the built-in short list");
  commonPasswords = new Set(FALLBACK_COMMON);
  return commonPasswords;
}

export function isCommonPassword(password: string): boolean {
  return loadCommonPasswords().has(password.trim().toLowerCase());
}

export const COMMON_PASSWORD_MESSAGE =
  "This password is too common. Choose one that is not on lists of frequently used passwords.";

export const passwordPolicySchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(256, "Password must be at most 256 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one digit")
  .refine((p) => !isCommonPassword(p), { message: COMMON_PASSWORD_MESSAGE });

// ─── Placeholder accounts (R01-04) ─────────────────────────────────────────
//
// The old /team/invite created users with an empty password hash; 0092
// converts them into invitations and marks any row it could not delete with
// a "$placeholder$" hash. Such a row has no usable credential, so the real
// owner of the address may claim it through registration.
export function isPlaceholderPasswordHash(hash: string | null | undefined): boolean {
  return !hash || hash.startsWith("$placeholder$");
}

// Configure passport-local strategy
passport.use(
  new LocalStrategy(
    {
      usernameField: "email",
      passwordField: "password",
    },
    async (email, password, done) => {
      try {
        const user = await storage.getUserByEmail(email);
        if (!user || isPlaceholderPasswordHash(user.passwordHash)) {
          return done(null, false, { message: "Invalid credentials" });
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) {
          return done(null, false, { message: "Invalid credentials" });
        }

        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }
  )
);

// Serialize user for session
passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

// Deserialize user from session
passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await storage.getUser(id);
    done(null, user || null);
  } catch (error) {
    done(error);
  }
});

// Session-based authentication middleware
export const sessionAuthMiddleware = (req: any, res: any, next: any) => {
  if (req.isAuthenticated()) {
    return next();
  }
  return res.status(401).json({ message: "Unauthorized" });
};
