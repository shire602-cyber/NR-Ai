#!/usr/bin/env -S npx tsx
// Opt-in grant / revoke of the platform owner role (is_admin + user_type admin + NR
// firm_owner). This replaces migration 0054, which used to promote one hardcoded personal
// account in every database that ran the chain (S-H3). 0054 is now a no-op; nothing in the
// migration chain grants admin to anyone.
//
// Default: READ ONLY (prints the account's current state). Changing anything needs both the
// action flag and --confirm repeating the email.
//
// Usage:
//   DATABASE_URL=... npx tsx scripts/ops/platform-owner.ts --email <email>
//   DATABASE_URL=... npx tsx scripts/ops/platform-owner.ts --email <email> --grant  --confirm <email>
//   DATABASE_URL=... npx tsx scripts/ops/platform-owner.ts --email <email> --revoke --confirm <email>
//
// The account must already exist (sign up first); no user or password is created. Take a
// backup first and run it once per environment. See docs/release/PLATFORM-OWNER.md.

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? null) : null;
};

const email = value("--email");
const confirm = value("--confirm") ?? "";
const grant = flag("--grant");
const revoke = flag("--revoke");
if (!email) {
  console.error("--email is required");
  process.exit(2);
}
if (grant && revoke) {
  console.error("choose one of --grant or --revoke");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}

const svc = await import("../../server/services/platform-owner.service");
const { closePool, db, rowsFromResult } = await import("../../server/db");

try {
  if (!grant && !revoke) {
    const { sql } = await import("drizzle-orm");
    const rows = await db.execute(
      sql`SELECT u.id, u.email, u.is_admin, u.user_type, u.firm_role, fm.role AS nr_firm_member_role
            FROM users u
            LEFT JOIN firm_members fm ON fm.user_id = u.id AND fm.firm_id = '00000000-0000-4000-8000-000000000001'
           WHERE lower(trim(u.email)) = lower(trim(${email}))`
    );
    console.log(JSON.stringify(rowsFromResult(rows), null, 2));
    console.log("read only: pass --grant or --revoke with --confirm <email> to change it");
  } else {
    const result = grant
      ? await svc.grantPlatformOwner(email, { confirm })
      : await svc.revokePlatformOwner(email, { confirm });
    if (!result.ok) {
      console.error(`refused: ${result.code}`);
      process.exitCode = 1;
    } else {
      const memberships = await svc.countCompanyMemberships(result.before.userId);
      console.log(
        JSON.stringify(
          { action: grant ? "grant" : "revoke", changed: result.changed, ...result, memberships },
          null,
          2
        )
      );
      if (revoke && memberships > 0) {
        console.log(
          `note: ${memberships} company membership(s) left in place; remove them per tenant if they are not wanted.`
        );
      }
    }
  }
} finally {
  await closePool();
}
