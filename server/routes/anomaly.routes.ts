import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { DomainError } from "../errors";
import { storage } from "../storage";
import { pool } from "../db";
import { createLogger } from "../config/logger";
import { listJobs, registerJob } from "../platform/job-registry";
import { assertReportAccess } from "../reporting/http";
import { detectAnomalies, type Anomaly } from "../services/anomaly-detection.service";
import { describeAnomalyText } from "../../shared/server-copy";
import { zText, zUuid } from "../../shared/validators/primitives";

const log = createLogger("anomalies");

type AnomalyUiSeverity = "critical" | "warning" | "info";

const severityMap: Record<string, "low" | "medium" | "high" | "critical"> = {
  info: "low",
  warning: "medium",
  critical: "critical",
};

const uiSeverityMap: Record<string, AnomalyUiSeverity> = {
  critical: "critical",
  high: "warning",
  medium: "warning",
  warning: "warning",
  low: "info",
  info: "info",
};

function toUiSeverity(severity: string | null | undefined): AnomalyUiSeverity {
  return severity ? (uiSeverityMap[severity] ?? "warning") : "warning";
}

const typeMap: Record<string, string> = {
  duplicate_amount: "duplicate",
  duplicate_vendor: "duplicate",
  duplicate_supplier_invoice: "duplicate",
  unusual_amount: "unusual_amount",
  cross_period_baseline: "unusual_amount",
  weekend_transaction: "unusual_timing",
  round_number: "unusual_amount",
  vat_rate_mismatch: "unusual_category",
  trn_missing: "unusual_category",
  trn_malformed: "unusual_category",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const noteBody = z.object({ note: zText(1000).optional() }).strict();

/**
 * Persist the anomalies of one scan. Idempotent: alerts are keyed by
 * (company, dedupeKey); pre-W3-E alerts without a key are backfilled rather
 * than duplicated. Returns how many alerts were new.
 */
export async function persistAnomalies(companyId: string, anomalies: Anomaly[]) {
  const existing = await storage.getAnomalyAlertsByCompanyId(companyId);
  const legacy = new Map(
    existing
      .filter((a) => !a.dedupeKey && a.relatedEntityId)
      .map((a) => [`${a.type}:${a.relatedEntityId}`, a])
  );
  let created = 0;
  for (const anomaly of anomalies) {
    const dbType = typeMap[anomaly.rule] ?? "unusual_amount";
    const relatedId =
      anomaly.relatedId && UUID_RE.test(anomaly.relatedId) ? anomaly.relatedId : null;
    const facts = {
      amount: anomaly.amount,
      transactionDate: anomaly.date,
      rule: anomaly.rule,
      dedupeKey: anomaly.dedupeKey,
    };
    const old = relatedId ? legacy.get(`${dbType}:${relatedId}`) : undefined;
    if (old) {
      await storage.updateAnomalyAlert(old.id, facts);
      legacy.delete(`${dbType}:${relatedId}`);
      continue;
    }
    const inserted = await storage.createAnomalyAlertIfNew({
      companyId,
      type: dbType,
      severity: severityMap[anomaly.severity] ?? "medium",
      title: anomaly.rule.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      description: anomaly.description,
      relatedEntityType: anomaly.relatedType,
      relatedEntityId: relatedId,
      // A deterministic rules engine has no model confidence to report.
      aiConfidence: null,
      isResolved: false,
      ...facts,
    });
    if (inserted) created++;
  }
  return { created };
}

function registerAnomalyJobs(): void {
  const names = new Set(listJobs().map((j) => j.name));
  if (names.has("anomalies.scan")) return;
  registerJob({
    name: "anomalies.scan",
    cron: "47 3 * * *",
    description: "Scan every company for rule-based accounting anomalies",
    run: async () => {
      const { rows } = await pool.query(`SELECT id FROM companies`);
      const { runForCompany } = await import("../platform/company-automations");
      for (const row of rows as Array<{ id: string }>) {
        try {
          // WQ7: skipped for companies that switched "Anomaly checks" off in Automations.
          await runForCompany(
            "anomalyChecks",
            row.id,
            async () => {
              const result = await detectAnomalies(row.id);
              await persistAnomalies(row.id, result.anomalies);
              return result.anomalies.length;
            },
            (found) => ({ found })
          );
        } catch (err) {
          log.error({ companyId: row.id, err: (err as Error).message }, "anomaly scan failed");
        }
      }
    },
  });
}

async function listUnresolved(companyId: string) {
  const unresolved = await storage.getUnresolvedAnomalyAlerts(companyId);
  const anomalies = unresolved.map((alert) => ({
    id: alert.id,
    type: alert.type,
    rule: alert.rule ?? null,
    severity: toUiSeverity(alert.severity),
    description: alert.description,
    // Same sentence as key + params (rows stored before D4 are mapped back on read).
    message: describeAnomalyText(alert.description),
    // Real transaction facts; alerts raised before W3-E have no amount/date on record.
    amount: alert.amount ?? null,
    date: alert.transactionDate ?? alert.createdAt.toISOString(),
    detectedAt: alert.createdAt.toISOString(),
    relatedId: alert.relatedEntityId,
    relatedType: alert.relatedEntityType,
  }));
  return {
    anomalies,
    summary: {
      total: anomalies.length,
      critical: anomalies.filter((a) => a.severity === "critical").length,
      warning: anomalies.filter((a) => a.severity === "warning").length,
      info: anomalies.filter((a) => a.severity === "info").length,
    },
  };
}

export function registerAnomalyRoutes(app: Express) {
  registerAnomalyJobs();

  /**
   * GET /api/companies/:companyId/anomalies
   * Read-only: returns the unresolved alerts already recorded by POST /scan or
   * the scheduled `anomalies.scan` job. It never writes.
   */
  app.get(
    "/api/companies/:companyId/anomalies",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertReportAccess(req, companyId);
      const lastScan = await pool.query(
        `SELECT MAX(created_at) AS at FROM anomaly_alerts WHERE company_id = $1`,
        [companyId]
      );
      res.json({
        ...(await listUnresolved(companyId)),
        scannedAt: lastScan.rows[0]?.at ? new Date(lastScan.rows[0].at).toISOString() : null,
      });
    })
  );

  /**
   * POST /api/companies/:companyId/anomalies/scan
   * Run the rules now, record new alerts, return the unresolved list.
   */
  app.post(
    "/api/companies/:companyId/anomalies/scan",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertReportAccess(req, companyId);
      const result = await detectAnomalies(companyId);
      const { created } = await persistAnomalies(companyId, result.anomalies);
      res.json({
        ...(await listUnresolved(companyId)),
        scannedAt: result.scannedAt,
        newAlerts: created,
      });
    })
  );

  const resolve = async (req: Request, res: Response, shape: "dismiss" | "resolve") => {
    const { companyId, id } = req.params;
    const userId = req.user!.id as string;
    await assertReportAccess(req, companyId);
    if (!zUuid.safeParse(id).success)
      throw new DomainError("ANOMALY_NOT_FOUND", 404, undefined, "Anomaly not found");
    const alert = await storage.getAnomalyAlertById(id);
    if (!alert || alert.companyId !== companyId) {
      throw new DomainError("ANOMALY_NOT_FOUND", 404, undefined, "Anomaly not found");
    }
    const { note } = parsedBody<z.infer<typeof noteBody>>(req);
    const resolved = await storage.resolveAnomalyAlert(id, userId, note);
    res.json(shape === "dismiss" ? { message: "Anomaly dismissed", id } : resolved);
  };

  app.post(
    "/api/companies/:companyId/anomalies/:id/dismiss",
    authMiddleware,
    requireCustomer,
    strictBody(noteBody),
    asyncHandler((req, res) => resolve(req, res, "dismiss"))
  );

  app.post(
    "/api/companies/:companyId/anomalies/:id/resolve",
    authMiddleware,
    requireCustomer,
    strictBody(noteBody),
    asyncHandler((req, res) => resolve(req, res, "resolve"))
  );
}
