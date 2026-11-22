/**
 * Backups (W5-B, R19-06, R19-07, R17-08, R17-22, R19-17).
 *
 * Full-company encrypted snapshots (server/services/backup.service.ts).
 * Every route needs the `backups.manage` permission in the backup's company
 * (owners and admins); viewers and other roles get 403, non-members 404.
 *
 *   GET    /api/companies/:companyId/backups              list (no snapshot payload)
 *   POST   /api/companies/:companyId/backups              create now
 *   GET    /api/companies/:companyId/backups/manifest     tables captured / excluded (with reasons)
 *   GET    /api/companies/:companyId/backups/schedule     schedule
 *   PUT    /api/companies/:companyId/backups/schedule     set schedule (daily | weekly | monthly | off)
 *   GET    /api/backups/:id                               details
 *   GET    /api/backups/:id/download                      decrypted JSON export (?format=encrypted for the sealed file)
 *   POST   /api/backups/:id/restore-preview               dry-run diff for a mode
 *   POST   /api/backups/:id/restore                       restore: mode merge | replace
 *   POST   /api/backups/:id/clone-preview                 S5: dry-run of loading this backup into
 *                                                         another (empty) company
 *   POST   /api/backups/:id/clone                         S5: load it there (backups.manage in both
 *                                                         companies, MFA enrolled + fresh step-up,
 *                                                         typed target name, audited in both)
 *   DELETE /api/backups/:id
 */
import type { Express, Request, Response } from "express";
import { parsedBody } from "../http/parsed-body";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { getCompanyRole, requirePermission } from "../middleware/companyRolePolicy";
import { strictBody } from "../http/strict-body";
import { DomainError } from "../errors";
import { roleHasAnyPermission } from "../../shared/permissions";
import { isNraFirmRole } from "../../shared/access";
import { zText, zUuid } from "../../shared/validators/primitives";
import { storage } from "../storage";
import { pq } from "../services/connectors/pq";
import { recordAudit } from "../services/audit.service";
import {
  BACKUP_EXCLUDED_TABLES,
  buildBackupManifest,
  companyScopedTables,
  createCompanyBackup,
  exclusionReason,
  exportSnapshot,
  restoreBackupIntoCompany,
  restoreCompanyBackup,
  runScheduledBackups,
} from "../services/backup.service";
import { listJobs, registerJob } from "../platform/job-registry";
import { hasRecentMfa } from "../services/security/policy";

const createBody = z
  .object({ name: zText(200).optional(), description: zText(1000).optional() })
  .strict();

const restoreBody = z
  .object({
    mode: z.enum(["merge", "replace"]),
    confirmRestore: z.literal(true),
    /** Replace mode only: the caller typed the backup name to confirm. */
    confirmName: zText(200).optional(),
  })
  .strict();

const previewBody = z.object({ mode: z.enum(["merge", "replace"]).default("replace") }).strict();

const clonePreviewBody = z.object({ targetCompanyId: zUuid }).strict();

const cloneBody = z
  .object({
    targetCompanyId: zUuid,
    confirmRestore: z.literal(true),
    /** The caller typed the TARGET company's name to confirm its data is replaced. */
    confirmTargetName: zText(300),
  })
  .strict();

const scheduleBody = z
  .object({
    frequency: z.enum(["daily", "weekly", "monthly", "off"]),
    retentionDays: z.number().int().min(7).max(3650).optional(),
  })
  .strict();

const BACKUP_COLUMNS = `id, company_id AS "companyId", name, description, backup_type AS "backupType",
  status, accounts_count AS "accountsCount", journal_entries_count AS "journalEntriesCount",
  invoices_count AS "invoicesCount", receipts_count AS "receiptsCount",
  vat_returns_count AS "vatReturnsCount", checksum, size_bytes AS "sizeBytes",
  table_counts AS "tableCounts", encrypted, format_version AS "formatVersion",
  last_restore_mode AS "lastRestoreMode", last_restored_at AS "lastRestoredAt",
  created_by AS "createdBy", created_at AS "createdAt", completed_at AS "completedAt",
  expires_at AS "expiresAt"`;

interface BackupRow {
  id: string;
  companyId: string;
  name: string;
  status: string;
  tableCounts: string | null;
  [k: string]: unknown;
}

function present(row: BackupRow) {
  const counts: Record<string, number> | null = row.tableCounts
    ? JSON.parse(row.tableCounts)
    : null;
  return {
    ...row,
    tableCounts: counts
      ? Object.fromEntries(Object.entries(counts).filter(([table]) => !exclusionReason(table)))
      : null,
  };
}

/** Load a backup and require backups.manage in its company (404 for non-members). */
async function backupFor(req: Request): Promise<BackupRow> {
  const id = req.params.id;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new DomainError("NOT_FOUND", 404);
  const { rows } = await pq<BackupRow>(`SELECT ${BACKUP_COLUMNS} FROM backups WHERE id = $1`, [id]);
  const backup = rows[0];
  if (!backup) throw new DomainError("NOT_FOUND", 404, undefined, "Backup not found");
  const user = req.user!;
  if (!user.isAdmin && !isNraFirmRole(user.firmRole)) {
    const role = await getCompanyRole(user.id, backup.companyId);
    if (!role) throw new DomainError("NOT_FOUND", 404, undefined, "Backup not found");
    if (!roleHasAnyPermission(role, ["backups.manage"])) {
      throw new DomainError("PERMISSION_DENIED", 403, { permission: "backups.manage", role });
    }
  }
  return backup;
}

/** backups.manage in the clone target too (404 for non-members). Returns the target's name. */
async function cloneTargetFor(req: Request, targetCompanyId: string): Promise<{ name: string }> {
  const company = await storage.getCompany(targetCompanyId);
  if (!company) throw new DomainError("NOT_FOUND", 404, undefined, "Company not found");
  const user = req.user!;
  if (!user.isAdmin && !isNraFirmRole(user.firmRole)) {
    const role = await getCompanyRole(user.id, targetCompanyId);
    if (!role) throw new DomainError("NOT_FOUND", 404, undefined, "Company not found");
    if (!roleHasAnyPermission(role, ["backups.manage"])) {
      throw new DomainError("PERMISSION_DENIED", 403, { permission: "backups.manage", role });
    }
  }
  return { name: company.name };
}

/**
 * Loading one company's books into another is the most sensitive data move in the product:
 * the caller must have MFA enrolled (not just "MFA if enabled") and have verified a code within
 * the step-up window.
 */
async function requireFreshMfaEnrolled(req: Request): Promise<void> {
  const { rows } = await pq<{ mfa_enabled: boolean }>(
    `SELECT mfa_enabled FROM users WHERE id = $1`,
    [req.user!.id]
  );
  if (!rows[0]?.mfa_enabled) {
    throw new DomainError(
      "MFA_ENROLLMENT_REQUIRED",
      403,
      { enrollUrl: "/api/auth/mfa/enroll" },
      "Turn on two-factor authentication before loading a backup into another company."
    );
  }
  if (!hasRecentMfa(req)) {
    throw new DomainError(
      "MFA_STEP_UP_REQUIRED",
      403,
      { stepUpUrl: "/api/auth/mfa/step-up" },
      "Confirm this action with your authenticator code."
    );
  }
}

export function registerBackupRoutes(app: Express) {
  if (!listJobs().some((j) => j.name === "backups.scheduled")) {
    registerJob({
      name: "backups.scheduled",
      cron: "17 22 * * *", // 02:17 UAE
      description: "Run due scheduled company backups and expire old scheduled ones",
      run: async () => {
        await runScheduledBackups();
      },
    });
  }

  const manage = [authMiddleware, requirePermission("backups.manage")];

  app.get(
    "/api/companies/:companyId/backups",
    ...manage,
    asyncHandler(async (req: Request, res: Response) => {
      const { rows } = await pq<BackupRow>(
        `SELECT ${BACKUP_COLUMNS} FROM backups WHERE company_id = $1 ORDER BY created_at DESC`,
        [req.params.companyId]
      );
      res.json(rows.map(present));
    })
  );

  app.post(
    "/api/companies/:companyId/backups",
    ...manage,
    strictBody(createBody),
    asyncHandler(async (req: Request, res: Response) => {
      const body = parsedBody<z.output<typeof createBody>>(req);
      const backup = await createCompanyBackup({
        companyId: req.params.companyId,
        userId: req.user!.id,
        name: body.name,
        description: body.description,
        backupType: "manual",
      });
      await storage.createActivityLog({
        companyId: req.params.companyId,
        userId: req.user!.id,
        action: "create",
        entityType: "backup",
        entityId: backup.id,
        description: `Created encrypted full backup: ${backup.name}`,
      });
      const { rows } = await pq<BackupRow>(`SELECT ${BACKUP_COLUMNS} FROM backups WHERE id = $1`, [
        backup.id,
      ]);
      res.status(201).json(present(rows[0]));
    })
  );

  app.get(
    "/api/companies/:companyId/backups/manifest",
    ...manage,
    asyncHandler(async (_req: Request, res: Response) => {
      const manifest = await buildBackupManifest();
      const all = await companyScopedTables();
      res.json({
        captured: manifest.tables.map((t) => ({
          table: t.name,
          scope: t.scope,
          appendOnly: t.appendOnly,
        })),
        excluded: all
          .filter((t) => exclusionReason(t))
          .map((t) => ({ table: t, reason: exclusionReason(t) })),
        exclusionPolicy: BACKUP_EXCLUDED_TABLES,
        pointInTimeRecovery: {
          status: "requires_external",
          note: "Point-in-time recovery is a database-host setting (WAL archiving / PITR on the managed Postgres).",
        },
      });
    })
  );

  app.get(
    "/api/companies/:companyId/backups/schedule",
    ...manage,
    asyncHandler(async (req: Request, res: Response) => {
      const { rows } = await pq(
        `SELECT frequency, retention_days AS "retentionDays", is_active AS "isActive",
                last_run_at AS "lastRunAt" FROM backup_schedules WHERE company_id = $1`,
        [req.params.companyId]
      );
      res.json(
        rows[0] ?? { frequency: "off", retentionDays: 90, isActive: false, lastRunAt: null }
      );
    })
  );

  app.put(
    "/api/companies/:companyId/backups/schedule",
    ...manage,
    strictBody(scheduleBody),
    asyncHandler(async (req: Request, res: Response) => {
      const body = parsedBody<z.output<typeof scheduleBody>>(req);
      const active = body.frequency !== "off";
      const { rows } = await pq(
        `INSERT INTO backup_schedules (company_id, frequency, retention_days, is_active, created_by)
              VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (company_id) DO UPDATE
               SET frequency = EXCLUDED.frequency, retention_days = EXCLUDED.retention_days,
                   is_active = EXCLUDED.is_active
         RETURNING frequency, retention_days AS "retentionDays", is_active AS "isActive",
                   last_run_at AS "lastRunAt"`,
        [
          req.params.companyId,
          active ? body.frequency : "weekly",
          body.retentionDays ?? 90,
          active,
          req.user!.id,
        ]
      );
      res.json(active ? rows[0] : { ...rows[0], frequency: "off" });
    })
  );

  app.get(
    "/api/backups/:id",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(present(await backupFor(req)));
    })
  );

  app.get(
    "/api/backups/:id/download",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const backup = await backupFor(req);
      const { rows } = await pq<{ data_snapshot: string | null; checksum: string | null }>(
        `SELECT data_snapshot, checksum FROM backups WHERE id = $1`,
        [backup.id]
      );
      const stored = rows[0]?.data_snapshot;
      if (backup.status !== "completed" || !stored) {
        throw new DomainError("BACKUP_NOT_COMPLETE", 409, undefined, "Backup is not complete");
      }
      const encrypted = req.query.format === "encrypted";
      const { body, contentDigest } = exportSnapshot(stored, rows[0].checksum, encrypted);
      await storage.createActivityLog({
        companyId: backup.companyId,
        userId: req.user!.id,
        action: "view",
        entityType: "backup",
        entityId: backup.id,
        description: `Downloaded backup (${encrypted ? "encrypted" : "decrypted"}): ${backup.name}`,
      });
      const safe = backup.name.replace(/[^a-z0-9]/gi, "_").slice(0, 80);
      res.setHeader("Content-Type", encrypted ? "application/octet-stream" : "application/json");
      if (contentDigest) {
        res.setHeader("Content-Digest", contentDigest);
        // The digest covers the exported bytes. Keep compression from changing them.
        res.append("Cache-Control", "no-transform");
      }
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${safe}_${backup.id.slice(0, 8)}.${encrypted ? "muhbak" : "json"}"`
      );
      res.send(body);
    })
  );

  app.post(
    "/api/backups/:id/restore-preview",
    authMiddleware,
    strictBody(previewBody),
    asyncHandler(async (req: Request, res: Response) => {
      const backup = await backupFor(req);
      const { mode } = parsedBody<z.output<typeof previewBody>>(req);
      const result = await restoreCompanyBackup({
        backupId: backup.id,
        companyId: backup.companyId,
        userId: req.user!.id,
        mode,
        dryRun: true,
      });
      res.json({
        backup: { id: backup.id, name: backup.name, createdAt: backup.createdAt },
        ...result,
        warning:
          mode === "replace"
            ? "Replace makes this company's data match the backup exactly: records created after the backup are deleted and edited records are reverted. A pre-restore backup is taken automatically."
            : "Merge only adds records that are missing. Edited records keep their current values and nothing is deleted.",
      });
    })
  );

  app.post(
    "/api/backups/:id/restore",
    authMiddleware,
    strictBody(restoreBody),
    asyncHandler(async (req: Request, res: Response) => {
      const backup = await backupFor(req);
      const body = parsedBody<z.output<typeof restoreBody>>(req);
      if (body.mode === "replace" && body.confirmName !== backup.name) {
        throw new DomainError(
          "CONFIRMATION_REQUIRED",
          400,
          { fields: { confirmName: ["Type the backup name to confirm a replace restore"] } },
          "Type the backup name to confirm a replace restore"
        );
      }
      const result = await restoreCompanyBackup({
        backupId: backup.id,
        companyId: backup.companyId,
        userId: req.user!.id,
        mode: body.mode,
        dryRun: false,
      });
      // Written only after the restore transaction committed (R19-07).
      await pq(
        `UPDATE backups SET last_restore_mode = $2, last_restored_at = now() WHERE id = $1`,
        [backup.id, body.mode]
      );
      await storage.createActivityLog({
        companyId: backup.companyId,
        userId: req.user!.id,
        action: "update",
        entityType: "backup",
        entityId: backup.id,
        description: `Restored from backup "${backup.name}" in ${body.mode} mode (inserted ${result.totals.insert}, updated ${result.totals.update}, deleted ${result.totals.delete})`,
        metadata: JSON.stringify({
          mode: body.mode,
          totals: result.totals,
          preRestoreBackupId: result.preRestoreBackupId,
        }),
      });
      await recordAudit({
        userId: req.user!.id,
        companyId: backup.companyId,
        action: "backup.restore",
        entityType: "backup",
        entityId: backup.id,
        before: { preRestoreBackupId: result.preRestoreBackupId },
        after: { mode: body.mode, totals: result.totals },
        req,
      });
      res.json({
        success: true,
        message:
          body.mode === "replace"
            ? "Restore complete: company data now matches the backup."
            : `Merge complete: ${result.totals.insert} missing record(s) added from the backup.`,
        ...result,
      });
    })
  );

  app.post(
    "/api/backups/:id/clone-preview",
    authMiddleware,
    strictBody(clonePreviewBody),
    asyncHandler(async (req: Request, res: Response) => {
      const backup = await backupFor(req);
      const { targetCompanyId } = parsedBody<z.output<typeof clonePreviewBody>>(req);
      const target = await cloneTargetFor(req, targetCompanyId);
      const result = await restoreBackupIntoCompany({
        backupId: backup.id,
        sourceCompanyId: backup.companyId,
        targetCompanyId,
        userId: req.user!.id,
        dryRun: true,
      });
      res.json({
        backup: { id: backup.id, name: backup.name, createdAt: backup.createdAt },
        target: { id: targetCompanyId, name: target.name },
        ...result,
        warning:
          "The target company's chart, settings and other company data are replaced by this backup's (with new record ids). The source company is not changed. A pre-restore backup of the target is taken automatically.",
      });
    })
  );

  app.post(
    "/api/backups/:id/clone",
    authMiddleware,
    strictBody(cloneBody),
    asyncHandler(async (req: Request, res: Response) => {
      const backup = await backupFor(req);
      const body = parsedBody<z.output<typeof cloneBody>>(req);
      const target = await cloneTargetFor(req, body.targetCompanyId);
      await requireFreshMfaEnrolled(req);
      if (body.confirmTargetName !== target.name) {
        throw new DomainError(
          "CONFIRMATION_REQUIRED",
          400,
          { fields: { confirmTargetName: ["Type the target company's name to confirm"] } },
          "Type the target company's name to confirm"
        );
      }
      const result = await restoreBackupIntoCompany({
        backupId: backup.id,
        sourceCompanyId: backup.companyId,
        targetCompanyId: body.targetCompanyId,
        userId: req.user!.id,
        dryRun: false,
      });
      // Written only after the clone transaction committed, in both companies.
      const detail = `inserted ${result.totals.insert} row(s), replaced ${result.totals.replacedTargetRows}`;
      await storage.createActivityLog({
        companyId: body.targetCompanyId,
        userId: req.user!.id,
        action: "update",
        entityType: "backup",
        entityId: backup.id,
        description: `Loaded backup "${backup.name}" from another company (${detail})`,
        metadata: JSON.stringify({
          sourceCompanyId: backup.companyId,
          totals: result.totals,
          preRestoreBackupId: result.preRestoreBackupId,
        }),
      });
      await storage.createActivityLog({
        companyId: backup.companyId,
        userId: req.user!.id,
        action: "export",
        entityType: "backup",
        entityId: backup.id,
        description: `Backup "${backup.name}" was loaded into company "${target.name}"`,
        metadata: JSON.stringify({ targetCompanyId: body.targetCompanyId }),
      });
      for (const companyId of [body.targetCompanyId, backup.companyId]) {
        await recordAudit({
          userId: req.user!.id,
          companyId,
          action: "backup.clone",
          entityType: "backup",
          entityId: backup.id,
          before: { preRestoreBackupId: result.preRestoreBackupId },
          after: {
            sourceCompanyId: backup.companyId,
            targetCompanyId: body.targetCompanyId,
            totals: result.totals,
            skippedTables: result.skippedTables.map((t) => t.table),
          },
          req,
        });
      }
      res.json({
        success: true,
        message: `Backup loaded into ${target.name}: ${detail}.`,
        ...result,
      });
    })
  );

  app.delete(
    "/api/backups/:id",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const backup = await backupFor(req);
      await pq(`DELETE FROM backups WHERE id = $1`, [backup.id]);
      await storage.createActivityLog({
        companyId: backup.companyId,
        userId: req.user!.id,
        action: "delete",
        entityType: "backup",
        entityId: backup.id,
        description: `Deleted backup: ${backup.name}`,
      });
      res.json({ message: "Backup deleted successfully" });
    })
  );
}
