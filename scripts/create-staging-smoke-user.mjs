#!/usr/bin/env node

import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import process from 'node:process';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const { Client } = pg;

const dbUrl =
  process.env.STAGING_DATABASE_URL ||
  process.env.DATABASE_PUBLIC_URL ||
  (process.env.SMOKE_ALLOW_DATABASE_URL === 'true' ? process.env.DATABASE_URL : '');
const dbUrlSource = process.env.STAGING_DATABASE_URL
  ? 'STAGING_DATABASE_URL'
  : process.env.DATABASE_PUBLIC_URL
    ? 'DATABASE_PUBLIC_URL'
    : process.env.SMOKE_ALLOW_DATABASE_URL === 'true'
      ? 'DATABASE_URL'
      : null;

if (!dbUrl) {
  console.error(
    'STAGING_DATABASE_URL or DATABASE_PUBLIC_URL is required. To intentionally use DATABASE_URL, set SMOKE_ALLOW_DATABASE_URL=true.',
  );
  process.exit(1);
}

const email = (process.env.SMOKE_EMAIL || 'firm-smoke@muhasib.ai').trim().toLowerCase();
const name = (process.env.SMOKE_NAME || 'Staging Smoke').trim();
const firmRole = process.env.SMOKE_FIRM_ROLE || 'firm_owner';
const assignmentRole = process.env.SMOKE_ASSIGNMENT_ROLE || 'accountant';
const providedPassword = process.env.SMOKE_PASSWORD;
const password = providedPassword || randomBytes(24).toString('base64url');
const generatedPassword = !providedPassword;

if (!email || !email.includes('@')) {
  console.error('SMOKE_EMAIL must be a valid email address.');
  process.exit(1);
}

if (!name) {
  console.error('SMOKE_NAME cannot be empty.');
  process.exit(1);
}

if (!['firm_owner', 'firm_admin'].includes(firmRole)) {
  console.error('SMOKE_FIRM_ROLE must be firm_owner or firm_admin.');
  process.exit(1);
}

if (password.length < 12) {
  console.error('SMOKE_PASSWORD must be at least 12 characters.');
  process.exit(1);
}

const companyIds = (process.env.SMOKE_COMPANY_IDS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

if (firmRole === 'firm_admin' && companyIds.length === 0) {
  console.error('SMOKE_COMPANY_IDS is required when SMOKE_FIRM_ROLE=firm_admin.');
  process.exit(1);
}

const client = new Client({
  connectionString: dbUrl,
  ssl:
    process.env.DATABASE_SSL === 'false'
      ? false
      : {
          rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'true',
        },
});

const passwordHash = await bcrypt.hash(password, 10);

await client.connect();

try {
  await client.query('BEGIN');

  const existingUser = await client.query(
    `
      SELECT id, email
      FROM users
      WHERE lower(email) = lower($1)
      FOR UPDATE
    `,
    [email],
  );

  let user;
  let action;

  if (existingUser.rowCount) {
    action = 'updated';
    const updated = await client.query(
      `
        UPDATE users
        SET
          email = $2,
          name = $3,
          password_hash = $4,
          is_admin = true,
          user_type = 'admin',
          firm_role = $5,
          email_verified = true
        WHERE id = $1
        RETURNING id, email, name, user_type, firm_role, is_admin, email_verified
      `,
      [existingUser.rows[0].id, email, name, passwordHash, firmRole],
    );
    user = updated.rows[0];
  } else {
    action = 'created';
    const inserted = await client.query(
      `
        INSERT INTO users (
          email,
          name,
          password_hash,
          is_admin,
          user_type,
          firm_role,
          email_verified
        )
        VALUES ($1, $2, $3, true, 'admin', $4, true)
        RETURNING id, email, name, user_type, firm_role, is_admin, email_verified
      `,
      [email, name, passwordHash, firmRole],
    );
    user = inserted.rows[0];
  }

  for (const companyId of companyIds) {
    await client.query(
      `
        INSERT INTO firm_staff_assignments (user_id, company_id, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, company_id)
        DO UPDATE SET role = EXCLUDED.role
      `,
      [user.id, companyId, assignmentRole],
    );
  }

  const access = await client.query(
    firmRole === 'firm_owner'
      ? 'SELECT count(*)::int AS count FROM companies'
      : `
        SELECT count(*)::int AS count
        FROM firm_staff_assignments
        WHERE user_id = $1
      `,
    firmRole === 'firm_owner' ? [] : [user.id],
  );

  await client.query('COMMIT');

  console.log(
    JSON.stringify(
      {
        action,
        dbUrlSource,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          userType: user.user_type,
          firmRole: user.firm_role,
          isAdmin: user.is_admin,
          emailVerified: user.email_verified,
          accessibleCompanyCount: access.rows[0]?.count ?? 0,
        },
      },
      null,
      2,
    ),
  );

  console.log(`SMOKE_EMAIL=${email}`);
  if (generatedPassword) {
    console.log(`SMOKE_PASSWORD=${password}`);
    console.warn('Generated SMOKE_PASSWORD was printed once. Store it in the staging secret store.');
  } else {
    console.log('SMOKE_PASSWORD was set from the environment and was not printed.');
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}

if (process.exitCode) process.exit(process.exitCode);
