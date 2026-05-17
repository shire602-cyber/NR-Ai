import 'dotenv/config';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;

const BACKDOOR_EMAILS = ['nra.test.owner@testmail.com', 'test_firm_owner@nra.ae'];
const isCi = process.env.CI === 'true';

function skipOrFail(message) {
  if (isCi) {
    console.error(message);
    process.exit(1);
  }
  console.warn(`skipped: ${message}`);
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  skipOrFail('DATABASE_URL is required.');
}

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === 'false'
      ? false
      : {
          rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'true',
        },
});

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

await client.connect();

try {
  const users = await client.query(
    `
      SELECT id, email, password_hash, firm_role, is_admin, last_login_at
      FROM users
      WHERE email = ANY($1::text[])
      ORDER BY email
    `,
    [BACKDOOR_EMAILS],
  );

  const companyAccess = await client.query(
    `
      SELECT u.email, count(cu.*)::int AS company_access_count
      FROM users u
      LEFT JOIN company_users cu ON cu.user_id = u.id
      WHERE u.email = ANY($1::text[])
      GROUP BY u.email
      ORDER BY u.email
    `,
    [BACKDOOR_EMAILS],
  );

  const auditUsage = await client.query(
    `
      SELECT u.email, count(a.*)::int AS audit_log_count, max(a.created_at) AS last_audit_at
      FROM users u
      LEFT JOIN audit_logs a ON a.user_id = u.id
      WHERE u.email = ANY($1::text[])
      GROUP BY u.email
      ORDER BY u.email
    `,
    [BACKDOOR_EMAILS],
  );

  const accessByEmail = new Map(companyAccess.rows.map((row) => [row.email, row.company_access_count]));
  const auditByEmail = new Map(auditUsage.rows.map((row) => [row.email, row]));

  for (const row of users.rows) {
    const accessCount = accessByEmail.get(row.email) ?? 0;
    const audit = auditByEmail.get(row.email) ?? { audit_log_count: 0, last_audit_at: null };

    console.log(
      JSON.stringify({
        email: row.email,
        revokedPassword: String(row.password_hash).startsWith('$revoked$'),
        firmRole: row.firm_role,
        isAdmin: row.is_admin,
        companyAccessCount: accessCount,
        lastLoginAt: row.last_login_at,
        auditLogCount: audit.audit_log_count,
        lastAuditAt: audit.last_audit_at,
      }),
    );

    if (!String(row.password_hash).startsWith('$revoked$')) {
      fail(`${row.email} password_hash is not revoked.`);
    }
    if (row.firm_role !== null) {
      fail(`${row.email} still has firm_role=${row.firm_role}.`);
    }
    if (row.is_admin) {
      fail(`${row.email} still has is_admin=true.`);
    }
    if (accessCount !== 0) {
      fail(`${row.email} still has ${accessCount} company_users rows.`);
    }
  }

  if (users.rows.length !== BACKDOOR_EMAILS.length) {
    const found = new Set(users.rows.map((row) => row.email));
    for (const email of BACKDOOR_EMAILS) {
      if (!found.has(email)) {
        console.log(JSON.stringify({ email, status: 'not_present' }));
      }
    }
  }

  if (process.env.JWT_SECRET_ROTATED_AFTER_BACKDOOR !== 'true') {
    console.warn(
      'JWT_SECRET_ROTATED_AFTER_BACKDOOR is not true. Rotate JWT_SECRET in production and set this acknowledgement for the verification run.',
    );
  }
} finally {
  await client.end();
}

if (process.exitCode) process.exit(process.exitCode);
console.log('Production security verification passed.');
