/**
 * Projects: tasks, time entries and the timer, the unbilled view, invoice-from-unbilled and profitability.
 * A Professional feature (requireFeature("projects")). Business rules live in project.service.ts and
 * project-invoice.service.ts; every id from a request is re-checked against the company there.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireFeature } from "../middleware/featureGate";
import { validate } from "../middleware/validate";
import { storage } from "../storage";
import { recordAudit } from "../services/audit.service";
import { resolveActor } from "../services/approval-gate.service";
import { ROLE_RANK } from "../services/approval-rules";
import {
  createProject,
  createTask,
  createTimeEntry,
  deleteProject,
  deleteTask,
  deleteTimeEntry,
  err,
  findProject,
  findTask,
  getRunningTimer,
  getTimeEntry,
  listProjects,
  listTasks,
  listTimeEntries,
  projectProfitability,
  startTimer,
  stopTimer,
  unbilledSummary,
  updateProject,
  updateTask,
  updateTimeEntry,
} from "../services/project.service";
import { createProjectInvoice } from "../services/project-invoice.service";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine((v) => new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v, "Not a real date");
const money = z.coerce.number().min(0).max(1_000_000_000);
const uuid = z.string().uuid();

const projectBody = {
  name: z.string().trim().min(1).max(200),
  nameAr: z.string().trim().max(200).nullable().optional(),
  contactId: uuid.nullable().optional(),
  status: z.enum(["active", "on_hold", "completed", "cancelled"]).optional(),
  billingMethod: z.enum(["hourly", "non_billable"]).optional(),
  hourlyRate: money.nullable().optional(),
  currency: z.string().length(3).optional(),
  budgetAmount: money.nullable().optional(),
  budgetHours: z.coerce.number().min(0).max(1_000_000).nullable().optional(),
  startDate: ymd.nullable().optional(),
  endDate: ymd.nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
};
const projectCreateSchema = z.object(projectBody);
const projectUpdateSchema = z.object(projectBody).partial();

const taskCreateSchema = z.object({ name: z.string().trim().min(1).max(200), hourlyRate: money.nullable().optional(), isBillable: z.boolean().optional() });
const taskUpdateSchema = taskCreateSchema.partial().extend({ status: z.enum(["open", "done"]).optional() });

const durationFields = {
  minutes: z.coerce.number().int().min(1).max(1440).optional(),
  hours: z.coerce.number().min(0.01).max(24).optional(),
};
const entryCreateSchema = z
  .object({
    projectId: uuid,
    taskId: uuid.nullable().optional(),
    entryDate: ymd,
    ...durationFields,
    isBillable: z.boolean().optional(),
    rate: money.nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
  })
  .refine((b) => b.minutes !== undefined || b.hours !== undefined, { message: "minutes or hours is required", path: ["minutes"] });
const entryUpdateSchema = z.object({
  projectId: uuid.optional(),
  taskId: uuid.nullable().optional(),
  entryDate: ymd.optional(),
  ...durationFields,
  isBillable: z.boolean().optional(),
  rate: money.nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

const timerStartSchema = z.object({ projectId: uuid, taskId: uuid.nullable().optional(), notes: z.string().max(1000).nullable().optional(), isBillable: z.boolean().optional() });

const invoiceSchema = z.object({
  timeEntryIds: z.array(uuid).max(500).optional(),
  expenseIds: z.array(uuid).max(500).optional(),
  date: ymd.optional(),
  dueDate: ymd.nullable().optional(),
  vatRate: z.union([z.literal(0), z.literal(5)]).optional(),
});

const paging = { limit: z.coerce.number().int().min(1).max(200).optional(), offset: z.coerce.number().int().min(0).optional() };

const minutesOf = (b: { minutes?: number; hours?: number }): number | undefined =>
  b.minutes !== undefined ? b.minutes : b.hours !== undefined ? Math.min(1440, Math.max(1, Math.round(b.hours * 60))) : undefined;

export function registerProjectRoutes(app: Express) {
  const gate = requireFeature("projects");
  const base = [authMiddleware, requireCustomer, gate] as const;

  async function companyAccess(req: Request, res: Response): Promise<boolean> {
    if (await storage.hasCompanyAccess(req.user!.id, req.params.companyId)) return true;
    res.status(403).json({ message: "Access denied" });
    return false;
  }

  /** A project of a company the caller can use; a stranger's project is a plain 404. */
  async function projectForUser(req: Request, res: Response) {
    const project = await findProject(req.params.id);
    if (!project || !(await storage.hasCompanyAccess(req.user!.id, project.companyId))) {
      res.status(404).json({ message: "Project not found" });
      return null;
    }
    return project;
  }

  app.get(
    "/api/companies/:companyId/projects",
    ...base,
    validate({ query: z.object({ status: z.enum(["active", "on_hold", "completed", "cancelled", "all"]).optional(), ...paging }) }),
    asyncHandler(async (req: Request, res: Response) => {
      if (!(await companyAccess(req, res))) return;
      const q = req.query as any;
      res.json(await listProjects(req.params.companyId, { status: q.status, limit: q.limit ?? 100, offset: q.offset ?? 0 }));
    })
  );

  app.post(
    "/api/companies/:companyId/projects",
    ...base,
    validate({ body: projectCreateSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      if (!(await companyAccess(req, res))) return;
      const project = await createProject(req.params.companyId, req.user!.id, req.body);
      await recordAudit({ userId: req.user!.id, companyId: req.params.companyId, action: "project.create", entityType: "project", entityId: project.id, after: { code: project.code, name: project.name }, req });
      res.status(201).json(project);
    })
  );

  app.get("/api/projects/:id", ...base, asyncHandler(async (req: Request, res: Response) => {
    const project = await projectForUser(req, res);
    if (project) res.json(project);
  }));

  app.patch(
    "/api/projects/:id",
    ...base,
    validate({ body: projectUpdateSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const project = await projectForUser(req, res);
      if (!project) return;
      const updated = await updateProject(project.companyId, project.id, req.body);
      await recordAudit({ userId: req.user!.id, companyId: project.companyId, action: "project.update", entityType: "project", entityId: project.id, before: { status: project.status }, after: { status: updated?.status }, req });
      res.json(updated);
    })
  );

  app.delete("/api/projects/:id", ...base, asyncHandler(async (req: Request, res: Response) => {
    const project = await projectForUser(req, res);
    if (!project) return;
    await deleteProject(project.companyId, project.id);
    await recordAudit({ userId: req.user!.id, companyId: project.companyId, action: "project.delete", entityType: "project", entityId: project.id, before: { code: project.code }, req });
    res.json({ message: "Project deleted" });
  }));

  // ---- tasks
  app.get("/api/projects/:id/tasks", ...base, asyncHandler(async (req: Request, res: Response) => {
    const project = await projectForUser(req, res);
    if (project) res.json(await listTasks(project.companyId, project.id));
  }));

  app.post(
    "/api/projects/:id/tasks",
    ...base,
    validate({ body: taskCreateSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const project = await projectForUser(req, res);
      if (project) res.status(201).json(await createTask(project.companyId, project.id, req.body));
    })
  );

  async function taskForUser(req: Request, res: Response) {
    const task = await findTask(req.params.id);
    if (!task || !(await storage.hasCompanyAccess(req.user!.id, task.companyId))) {
      res.status(404).json({ message: "Task not found" });
      return null;
    }
    return task;
  }

  app.patch("/api/project-tasks/:id", ...base, validate({ body: taskUpdateSchema }), asyncHandler(async (req: Request, res: Response) => {
    const task = await taskForUser(req, res);
    if (task) res.json(await updateTask(task.id, req.body));
  }));

  app.delete("/api/project-tasks/:id", ...base, asyncHandler(async (req: Request, res: Response) => {
    const task = await taskForUser(req, res);
    if (!task) return;
    await deleteTask(task.id);
    res.json({ message: "Task deleted" });
  }));

  // ---- time entries
  app.get(
    "/api/companies/:companyId/time-entries",
    ...base,
    validate({
      query: z.object({ projectId: uuid.optional(), userId: uuid.optional(), from: ymd.optional(), to: ymd.optional(), billed: z.enum(["billed", "unbilled"]).optional(), ...paging }),
    }),
    asyncHandler(async (req: Request, res: Response) => {
      if (!(await companyAccess(req, res))) return;
      const q = req.query as any;
      res.json(await listTimeEntries(req.params.companyId, { projectId: q.projectId, userId: q.userId, from: q.from, to: q.to, billed: q.billed, limit: q.limit ?? 100, offset: q.offset ?? 0 }));
    })
  );

  app.post(
    "/api/companies/:companyId/time-entries",
    ...base,
    validate({ body: entryCreateSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      if (!(await companyAccess(req, res))) return;
      const entry = await createTimeEntry(req.params.companyId, req.user!.id, { ...req.body, minutes: minutesOf(req.body)! });
      res.status(201).json(entry);
    })
  );

  /** An entry of a company the caller can use; employees change their own entries only, accountants and up anyone's. */
  async function entryForWrite(req: Request, res: Response) {
    const entry = await getTimeEntry(req.params.id);
    if (!entry || !(await storage.hasCompanyAccess(req.user!.id, entry.companyId))) {
      res.status(404).json({ message: "Time entry not found" });
      return null;
    }
    const actor = await resolveActor(req.user!, entry.companyId);
    if (entry.userId !== req.user!.id && actor.rank < ROLE_RANK.accountant) {
      res.status(403).json({ message: "You can change only your own time entries.", code: "ROLE_REQUIRED" });
      return null;
    }
    if (entry.billed) throw err(409, "TIME_ENTRY_BILLED", "This time is on an invoice and can no longer be changed. Delete or void the invoice first.");
    if (entry.running) throw err(409, "TIMER_RUNNING", "Stop the timer before changing this entry.");
    return entry;
  }

  app.patch(
    "/api/time-entries/:id",
    ...base,
    validate({ body: entryUpdateSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const entry = await entryForWrite(req, res);
      if (!entry) return;
      const { hours: _hours, minutes: _minutes, ...rest } = req.body;
      const minutes = minutesOf(req.body);
      res.json(await updateTimeEntry(entry, { ...rest, ...(minutes !== undefined ? { minutes } : {}) }));
    })
  );

  app.delete("/api/time-entries/:id", ...base, asyncHandler(async (req: Request, res: Response) => {
    const entry = await entryForWrite(req, res);
    if (!entry) return;
    await deleteTimeEntry(entry);
    res.json({ message: "Time entry deleted" });
  }));

  // ---- timer
  app.get("/api/companies/:companyId/timer", ...base, asyncHandler(async (req: Request, res: Response) => {
    if (!(await companyAccess(req, res))) return;
    res.json({ running: await getRunningTimer(req.params.companyId, req.user!.id) });
  }));

  app.post(
    "/api/companies/:companyId/timer/start",
    ...base,
    validate({ body: timerStartSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      if (!(await companyAccess(req, res))) return;
      res.status(201).json(await startTimer(req.params.companyId, req.user!.id, req.body));
    })
  );

  app.post("/api/companies/:companyId/timer/stop", ...base, asyncHandler(async (req: Request, res: Response) => {
    if (!(await companyAccess(req, res))) return;
    res.json(await stopTimer(req.params.companyId, req.user!.id));
  }));

  // ---- billing and profitability
  app.get("/api/projects/:id/unbilled", ...base, asyncHandler(async (req: Request, res: Response) => {
    const project = await projectForUser(req, res);
    if (project) res.json(await unbilledSummary(project.companyId, project));
  }));

  app.post(
    "/api/projects/:id/invoice",
    ...base,
    validate({ body: invoiceSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const project = await projectForUser(req, res);
      if (!project) return;
      const result = await createProjectInvoice({ companyId: project.companyId, project, userId: req.user!.id, input: req.body });
      await recordAudit({
        userId: req.user!.id,
        companyId: project.companyId,
        action: "project.invoice_draft",
        entityType: "project",
        entityId: project.id,
        after: { invoiceId: result.invoice.id, invoiceNumber: result.invoice.number, lines: result.lineCount },
        req,
      });
      res.status(201).json({ ...result.invoice, projectId: project.id, lineCount: result.lineCount });
    })
  );

  app.get(
    "/api/projects/:id/profitability",
    ...base,
    validate({ query: z.object({ from: ymd.optional(), to: ymd.optional() }) }),
    asyncHandler(async (req: Request, res: Response) => {
      const project = await projectForUser(req, res);
      if (!project) return;
      const q = req.query as any;
      res.json(await projectProfitability(project.companyId, project, { from: q.from, to: q.to }));
    })
  );
}
