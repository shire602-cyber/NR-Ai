import { type Express, Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { authMiddleware } from "../middleware/auth";
import { createLogger } from "../config/logger";
import { registerFirmWorkflowJobs } from "../services/firm/workflow.service";
import { requireFirmAccess, requireFirmPermission } from "../middleware/rbac";
import { strictBody } from "../http/strict-body";
import { assignStaffSchema, createClientSchema, updateClientSchema } from "./firm/shared";
import {
  handleGetFirmClients,
  handleGetFirmClientsSummary,
  handlePostFirmClients,
  handlePutFirmClients,
  handlePostFirmClientsAssignStaff,
  handleGetFirmStaff,
  handlePostFirmClientsSwitch,
  handleDeleteFirmClients,
  handlePostFirmClientsImport,
} from "./firm/clients";
import { handleGetFirmBookkeeperDashboard } from "./firm/bookkeeper-dashboard";
import {
  handleGetFirmHealth,
  handleGetFirmHealthDeadlines,
  handleGetFirmOverview,
} from "./firm/health";

const logger = createLogger("firm-routes");

export function registerFirmRoutes(app: Express): void {
  const router = Router();

  // Scope to /firm prefix so unrelated /api/* paths don't get 403
  router.use("/firm", authMiddleware);
  // Multi-firm practice tools (R15-12): any approved firm; every handler is
  // scoped to the caller's firm through getAccessibleCompanyIds / firm scope.
  router.use("/firm", requireFirmAccess());

  // W5-D: recurring practice tasks job (routes live in firm-practice.routes.ts).
  registerFirmWorkflowJobs();

  // ─── GET /api/firm/clients ─────────────────────────────────────────────────
  router.get("/firm/clients", asyncHandler(handleGetFirmClients));

  // ─── GET /api/firm/clients/:companyId/summary ──────────────────────────────
  router.get("/firm/clients/:companyId/summary", asyncHandler(handleGetFirmClientsSummary));

  // ─── POST /api/firm/clients ────────────────────────────────────────────────
  router.post(
    "/firm/clients",
    requireFirmPermission("firm.clients.create"),
    strictBody(createClientSchema),
    asyncHandler(handlePostFirmClients)
  );

  // ─── PUT /api/firm/clients/:companyId ──────────────────────────────────────
  router.put(
    "/firm/clients/:companyId",
    requireFirmPermission("firm.clients.write"),
    strictBody(updateClientSchema),
    asyncHandler(handlePutFirmClients)
  );

  // ─── POST /api/firm/clients/:companyId/assign-staff ───────────────────────
  // R15-03: delegates to the one assignment service (staff.service.ts). Only
  // roles holding firm.staff.manage (firm_owner) may assign; the client must
  // be in the caller's firm and the staff member must hold a firm role in the
  // same firm (never isAdmin-based).
  router.post(
    "/firm/clients/:companyId/assign-staff",
    requireFirmPermission("firm.staff.manage"),
    strictBody(assignStaffSchema),
    asyncHandler(handlePostFirmClientsAssignStaff)
  );

  // ─── GET /api/firm/staff ───────────────────────────────────────────────────
  // R15-03: firm staff = users with a firm role in the caller's firm.
  router.get("/firm/staff", asyncHandler(handleGetFirmStaff));

  // ─── GET /api/firm/bookkeeper-dashboard ───────────────────────────────────
  // Operational production board for NRA bookkeepers. It groups clients by
  // their VAT close months and surfaces corporate tax, bookkeeping close, and
  // accounting-review blockers before a staff member opens an individual file.
  router.get("/firm/bookkeeper-dashboard", asyncHandler(handleGetFirmBookkeeperDashboard));

  // ─── GET /api/firm/health ─────────────────────────────────────────────────
  router.get("/firm/health", asyncHandler(handleGetFirmHealth));

  // ─── GET /api/firm/health/deadlines ──────────────────────────────────────
  router.get("/firm/health/deadlines", asyncHandler(handleGetFirmHealthDeadlines));

  // ─── POST /api/firm/clients/:companyId/switch ──────────────────────────────
  // Switch the firm staff member's active workspace to this client's company.
  // The frontend persists the selection client-side; this endpoint validates
  // access and returns the company so the UI can update immediately.
  router.post("/firm/clients/:companyId/switch", asyncHandler(handlePostFirmClientsSwitch));

  // ─── DELETE /api/firm/clients/:companyId ───────────────────────────────────
  // Soft-delete a client (FTA 5-year retention rules require we never hard-
  // delete). The company is hidden from listings via deletedAt.
  router.delete(
    "/firm/clients/:companyId",
    // Only roles with firm.clients.archive (firm_owner) may archive a client.
    requireFirmPermission("firm.clients.archive"),
    asyncHandler(handleDeleteFirmClients)
  );

  // ─── POST /api/firm/clients/import ─────────────────────────────────────────
  // Bulk-create clients from a parsed CSV/Excel payload. Each row becomes a
  // company entity (companyType=client) plus a seeded chart of accounts. Rows
  // with missing names or duplicate company names are returned as errors so
  // the user can correct and resubmit. Supports two input forms:
  //   - { rows: [{...}, {...}] }      already-parsed JSON rows
  //   - { fileData: <base64 CSV/XLSX> } raw file (server-parsed)
  router.post(
    "/firm/clients/import",
    requireFirmPermission("firm.clients.create"),
    asyncHandler(handlePostFirmClientsImport)
  );

  // ─── GET /api/firm/overview ────────────────────────────────────────────────
  // Top-level summary cards for the firm dashboard: total clients, VAT
  // returns due in next 30 days, total overdue receivables, attention count.
  router.get("/firm/overview", asyncHandler(handleGetFirmOverview));

  app.use("/api", router);
  logger.info("Firm routes registered at /api/firm/*");
}
