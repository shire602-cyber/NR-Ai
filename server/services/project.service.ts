// Projects, tasks, time entries, the timer, the unbilled view and profitability.
//
// Raw SQL on the pool for the joins; every query is scoped by company_id and every id that arrives from a
// request (contact, project, task, time entry) is re-checked against the company before it is used.

import { pool } from "../db";
import { AppError } from "../errors";
import { toCalendarYmd } from "../utils/date";
import {
  hoursOf,
  isEntryBillable,
  isUnbilled,
  minutesBetween,
  profitability,
  summarizeUnbilled,
  effectiveRate,
  type BillingProject,
  type BillingTask,
  type BillingTimeEntry,
} from "./project-billing";

export const err = (statusCode: number, code: string, message: string) => new AppError({ message, statusCode, code });

const PROJECT_COLUMNS = `p.id::text AS id, p.company_id::text AS "companyId", p.code, p.name, p.name_ar AS "nameAr",
  p.contact_id::text AS "contactId", c.name AS "contactName", p.status, p.billing_method AS "billingMethod",
  p.hourly_rate::float8 AS "hourlyRate", p.currency, p.budget_amount::float8 AS "budgetAmount",
  p.budget_hours::float8 AS "budgetHours", to_char(p.start_date, 'YYYY-MM-DD') AS "startDate",
  to_char(p.end_date, 'YYYY-MM-DD') AS "endDate", p.description, p.created_at AS "createdAt", p.updated_at AS "updatedAt"`;
const PROJECT_FROM = `FROM projects p LEFT JOIN customer_contacts c ON c.id = p.contact_id`;

export interface ProjectInput {
  name?: string;
  nameAr?: string | null;
  contactId?: string | null;
  status?: string;
  billingMethod?: string;
  hourlyRate?: number | null;
  currency?: string;
  budgetAmount?: number | null;
  budgetHours?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  description?: string | null;
}

/** A project of the company, or null. */
export async function getProject(companyId: string, projectId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return null;
  const r = await pool.query(`SELECT ${PROJECT_COLUMNS} ${PROJECT_FROM} WHERE p.id = $1 AND p.company_id = $2`, [projectId, companyId]);
  return r.rows[0] ?? null;
}

/** Resolve a project by id alone (routes under /api/projects/:id) and return it with its company. */
export async function findProject(projectId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return null;
  const r = await pool.query(`SELECT ${PROJECT_COLUMNS} ${PROJECT_FROM} WHERE p.id = $1`, [projectId]);
  return r.rows[0] ?? null;
}

async function assertCustomerContact(companyId: string, contactId: string | null | undefined) {
  if (!contactId) return;
  const r = await pool.query(`SELECT contact_type FROM customer_contacts WHERE id = $1 AND company_id = $2`, [contactId, companyId]);
  if (!r.rows[0]) throw err(422, "INVALID_CONTACT", "The customer does not belong to this company.");
  if (r.rows[0].contact_type === "vendor") throw err(422, "INVALID_CONTACT", "A vendor-only contact cannot be billed: choose a customer.");
}

export async function listProjects(companyId: string, filters: { status?: string; limit: number; offset: number }) {
  const params: unknown[] = [companyId];
  let where = "p.company_id = $1";
  if (filters.status && filters.status !== "all") {
    params.push(filters.status);
    where += ` AND p.status = $${params.length}`;
  }
  params.push(filters.limit, filters.offset);
  const r = await pool.query(
    `SELECT ${PROJECT_COLUMNS} ${PROJECT_FROM} WHERE ${where} ORDER BY p.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return r.rows;
}

export async function createProject(companyId: string, userId: string, input: ProjectInput & { name: string }) {
  await assertCustomerContact(companyId, input.contactId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`project-code:${companyId}`]);
    const next = await client.query(
      `SELECT COALESCE(MAX(substring(code from 3)::int), 0) + 1 AS n FROM projects WHERE company_id = $1 AND code ~ '^P-[0-9]+$'`,
      [companyId]
    );
    const code = `P-${String(next.rows[0].n).padStart(4, "0")}`;
    const ins = await client.query(
      `INSERT INTO projects (company_id, code, name, name_ar, contact_id, status, billing_method, hourly_rate, currency,
                             budget_amount, budget_hours, start_date, end_date, description, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id::text`,
      [
        companyId, code, input.name, input.nameAr ?? null, input.contactId ?? null, input.status ?? "active",
        input.billingMethod ?? "hourly", input.hourlyRate ?? null, (input.currency ?? "AED").toUpperCase(),
        input.budgetAmount ?? null, input.budgetHours ?? null, input.startDate ?? null, input.endDate ?? null,
        input.description ?? null, userId,
      ]
    );
    await client.query("COMMIT");
    return await getProject(companyId, ins.rows[0].id);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

const UPDATABLE: Array<[keyof ProjectInput, string]> = [
  ["name", "name"], ["nameAr", "name_ar"], ["contactId", "contact_id"], ["status", "status"], ["billingMethod", "billing_method"],
  ["hourlyRate", "hourly_rate"], ["currency", "currency"], ["budgetAmount", "budget_amount"], ["budgetHours", "budget_hours"],
  ["startDate", "start_date"], ["endDate", "end_date"], ["description", "description"],
];

export async function updateProject(companyId: string, projectId: string, input: ProjectInput) {
  if (input.contactId !== undefined) await assertCustomerContact(companyId, input.contactId);
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, column] of UPDATABLE) {
    if (input[key] === undefined) continue;
    params.push(key === "currency" ? String(input[key]).toUpperCase() : input[key]);
    sets.push(`${column} = $${params.length}`);
  }
  if (sets.length === 0) return await getProject(companyId, projectId);
  params.push(projectId, companyId);
  const r = await pool.query(
    `UPDATE projects SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $${params.length - 1} AND company_id = $${params.length} RETURNING id`,
    params
  );
  if (!r.rows[0]) return null;
  return await getProject(companyId, projectId);
}

/** A project with any time, cost, posting or invoice line cannot be deleted (409 PROJECT_HAS_ACTIVITY). */
export async function deleteProject(companyId: string, projectId: string): Promise<boolean> {
  const used = await pool.query(
    `SELECT (SELECT COUNT(*) FROM time_entries WHERE project_id = $1)
          + (SELECT COUNT(*) FROM project_expenses WHERE project_id = $1)
          + (SELECT COUNT(*) FROM journal_lines WHERE project_id = $1)
          + (SELECT COUNT(*) FROM invoice_lines WHERE project_id = $1)
          + (SELECT COUNT(*) FROM bill_line_items WHERE project_id = $1)
          + (SELECT COUNT(*) FROM expense_claim_items WHERE project_id = $1) AS n`,
    [projectId]
  );
  if (Number(used.rows[0].n) > 0) throw err(409, "PROJECT_HAS_ACTIVITY", "This project has time, costs or postings and cannot be deleted. Mark it completed or cancelled instead.");
  const r = await pool.query(`DELETE FROM projects WHERE id = $1 AND company_id = $2`, [projectId, companyId]);
  return (r.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

const TASK_COLUMNS = `t.id::text AS id, t.project_id::text AS "projectId", t.name, t.hourly_rate::float8 AS "hourlyRate", t.is_billable AS "isBillable", t.status, t.created_at AS "createdAt"`;

export async function listTasks(companyId: string, projectId: string) {
  const r = await pool.query(`SELECT ${TASK_COLUMNS} FROM project_tasks t WHERE t.company_id = $1 AND t.project_id = $2 ORDER BY t.created_at`, [companyId, projectId]);
  return r.rows;
}

export async function createTask(companyId: string, projectId: string, input: { name: string; hourlyRate?: number | null; isBillable?: boolean }) {
  const r = await pool.query(
    `INSERT INTO project_tasks (company_id, project_id, name, hourly_rate, is_billable) VALUES ($1,$2,$3,$4,$5) RETURNING id::text`,
    [companyId, projectId, input.name, input.hourlyRate ?? null, input.isBillable ?? true]
  );
  const t = await pool.query(`SELECT ${TASK_COLUMNS} FROM project_tasks t WHERE t.id = $1`, [r.rows[0].id]);
  return t.rows[0];
}

export async function findTask(taskId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) return null;
  const r = await pool.query(`SELECT ${TASK_COLUMNS}, t.company_id::text AS "companyId" FROM project_tasks t WHERE t.id = $1`, [taskId]);
  return r.rows[0] ?? null;
}

export async function updateTask(taskId: string, input: { name?: string; hourlyRate?: number | null; isBillable?: boolean; status?: string }) {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, column] of [["name", "name"], ["hourlyRate", "hourly_rate"], ["isBillable", "is_billable"], ["status", "status"]] as const) {
    if ((input as any)[key] === undefined) continue;
    params.push((input as any)[key]);
    sets.push(`${column} = $${params.length}`);
  }
  if (sets.length > 0) {
    params.push(taskId);
    await pool.query(`UPDATE project_tasks SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
  }
  return findTask(taskId);
}

export async function deleteTask(taskId: string): Promise<void> {
  await pool.query(`DELETE FROM project_tasks WHERE id = $1`, [taskId]);
}

// ---------------------------------------------------------------------------
// Time entries and the timer
// ---------------------------------------------------------------------------

const ENTRY_COLUMNS = `te.id::text AS id, te.project_id::text AS "projectId", p.code AS "projectCode", p.name AS "projectName",
  te.task_id::text AS "taskId", t.name AS "taskName", te.user_id::text AS "userId", u.name AS "userName",
  to_char(te.entry_date, 'YYYY-MM-DD') AS "entryDate", te.minutes, te.started_at AS "startedAt", te.ended_at AS "endedAt",
  te.is_billable AS "isBillable", te.rate::float8 AS rate, te.notes, te.billed_invoice_id::text AS "billedInvoiceId",
  bi.status AS "billedInvoiceStatus", bi.number AS "billedInvoiceNumber",
  (te.started_at IS NOT NULL AND te.ended_at IS NULL) AS running,
  CASE WHEN te.started_at IS NULL THEN NULL ELSE GREATEST(0, floor(extract(epoch FROM (COALESCE(te.ended_at, now()) - te.started_at))))::int END AS "elapsedSeconds",
  te.created_at AS "createdAt"`;
const ENTRY_FROM = `FROM time_entries te
  JOIN projects p ON p.id = te.project_id
  LEFT JOIN project_tasks t ON t.id = te.task_id
  LEFT JOIN users u ON u.id = te.user_id
  LEFT JOIN invoices bi ON bi.id = te.billed_invoice_id`;

function shapeEntry(row: any) {
  const billed = !isUnbilled(row.billedInvoiceId, row.billedInvoiceStatus);
  return { ...row, hours: hoursOf(row.minutes), billed };
}

export async function getTimeEntry(timeEntryId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(timeEntryId)) return null;
  const r = await pool.query(`SELECT ${ENTRY_COLUMNS}, te.company_id::text AS "companyId" ${ENTRY_FROM} WHERE te.id = $1`, [timeEntryId]);
  return r.rows[0] ? shapeEntry(r.rows[0]) : null;
}

export async function listTimeEntries(
  companyId: string,
  f: { projectId?: string; userId?: string; from?: string; to?: string; billed?: "billed" | "unbilled"; limit: number; offset: number }
) {
  const params: unknown[] = [companyId];
  const where = ["te.company_id = $1"];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace("?", `$${params.length}`)); };
  if (f.projectId) add("te.project_id = ?", f.projectId);
  if (f.userId) add("te.user_id = ?", f.userId);
  if (f.from) add("te.entry_date >= ?::date", f.from);
  if (f.to) add("te.entry_date <= ?::date", f.to);
  if (f.billed === "billed") where.push(`te.billed_invoice_id IS NOT NULL AND COALESCE(bi.status, '') NOT IN ('void', 'cancelled')`);
  if (f.billed === "unbilled") where.push(`(te.billed_invoice_id IS NULL OR bi.status IN ('void', 'cancelled'))`);
  params.push(f.limit, f.offset);
  const r = await pool.query(
    `SELECT ${ENTRY_COLUMNS} ${ENTRY_FROM} WHERE ${where.join(" AND ")} ORDER BY te.entry_date DESC, te.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return r.rows.map(shapeEntry);
}

async function assertTaskOfProject(companyId: string, projectId: string, taskId: string | null | undefined) {
  if (!taskId) return null;
  const r = await pool.query(`SELECT id FROM project_tasks WHERE id = $1 AND project_id = $2 AND company_id = $3`, [taskId, projectId, companyId]);
  if (!r.rows[0]) throw err(422, "INVALID_TASK", "The task does not belong to this project.");
  return taskId;
}

function assertOpen(project: { status: string }) {
  if (project.status === "cancelled" || project.status === "completed") {
    throw err(409, "PROJECT_CLOSED", `This project is ${project.status}; time cannot be added to it.`);
  }
}

export async function createTimeEntry(
  companyId: string,
  userId: string,
  input: { projectId: string; taskId?: string | null; entryDate: string; minutes: number; isBillable?: boolean; rate?: number | null; notes?: string | null }
) {
  const project = await getProject(companyId, input.projectId);
  if (!project) throw err(422, "INVALID_PROJECT", "The project does not belong to this company.");
  assertOpen(project);
  await assertTaskOfProject(companyId, input.projectId, input.taskId);
  const r = await pool.query(
    `INSERT INTO time_entries (company_id, project_id, task_id, user_id, entry_date, minutes, is_billable, rate, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id::text`,
    [companyId, input.projectId, input.taskId ?? null, userId, input.entryDate, input.minutes, input.isBillable ?? true, input.rate ?? null, input.notes ?? null]
  );
  return await getTimeEntry(r.rows[0].id);
}

export async function updateTimeEntry(
  entry: { id: string; companyId: string; projectId: string },
  input: { projectId?: string; taskId?: string | null; entryDate?: string; minutes?: number; isBillable?: boolean; rate?: number | null; notes?: string | null }
) {
  const projectId = input.projectId ?? entry.projectId;
  if (input.projectId) {
    const project = await getProject(entry.companyId, input.projectId);
    if (!project) throw err(422, "INVALID_PROJECT", "The project does not belong to this company.");
    assertOpen(project);
  }
  if (input.taskId !== undefined) await assertTaskOfProject(entry.companyId, projectId, input.taskId);
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, column] of [["projectId", "project_id"], ["taskId", "task_id"], ["entryDate", "entry_date"], ["minutes", "minutes"], ["isBillable", "is_billable"], ["rate", "rate"], ["notes", "notes"]] as const) {
    if ((input as any)[key] === undefined) continue;
    params.push((input as any)[key]);
    sets.push(`${column} = $${params.length}`);
  }
  if (sets.length > 0) {
    params.push(entry.id, entry.companyId);
    await pool.query(`UPDATE time_entries SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $${params.length - 1} AND company_id = $${params.length}`, params);
  }
  return await getTimeEntry(entry.id);
}

export async function deleteTimeEntry(entry: { id: string; companyId: string }) {
  await pool.query(`DELETE FROM time_entries WHERE id = $1 AND company_id = $2`, [entry.id, entry.companyId]);
}

export async function getRunningTimer(companyId: string, userId: string) {
  const r = await pool.query(
    `SELECT ${ENTRY_COLUMNS} ${ENTRY_FROM} WHERE te.company_id = $1 AND te.user_id = $2 AND te.started_at IS NOT NULL AND te.ended_at IS NULL`,
    [companyId, userId]
  );
  return r.rows[0] ? shapeEntry(r.rows[0]) : null;
}

export async function startTimer(companyId: string, userId: string, input: { projectId: string; taskId?: string | null; notes?: string | null; isBillable?: boolean }) {
  const project = await getProject(companyId, input.projectId);
  if (!project) throw err(422, "INVALID_PROJECT", "The project does not belong to this company.");
  assertOpen(project);
  await assertTaskOfProject(companyId, input.projectId, input.taskId);
  try {
    const r = await pool.query(
      `INSERT INTO time_entries (company_id, project_id, task_id, user_id, entry_date, minutes, started_at, is_billable, notes)
       VALUES ($1,$2,$3,$4,$5,0,now(),$6,$7) RETURNING id::text`,
      [companyId, input.projectId, input.taskId ?? null, userId, toCalendarYmd(new Date()), input.isBillable ?? true, input.notes ?? null]
    );
    return await getTimeEntry(r.rows[0].id);
  } catch (e: any) {
    // The unique partial index allows one running timer per user and company; two starts at once land here.
    if (e?.code === "23505") throw err(409, "TIMER_ALREADY_RUNNING", "A timer is already running. Stop it before starting another.");
    throw e;
  }
}

export async function stopTimer(companyId: string, userId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query(
      `SELECT id::text, started_at FROM time_entries WHERE company_id = $1 AND user_id = $2 AND started_at IS NOT NULL AND ended_at IS NULL FOR UPDATE`,
      [companyId, userId]
    );
    const row = cur.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      throw err(404, "NO_RUNNING_TIMER", "No timer is running.");
    }
    // Both instants are timestamptz: the span is exact whatever the server's or the database's time zone.
    const span = await client.query(
      `SELECT (extract(epoch FROM started_at) * 1000)::bigint AS start_ms, (extract(epoch FROM now()) * 1000)::bigint AS now_ms
         FROM time_entries WHERE id = $1`,
      [row.id]
    );
    const minutes = minutesBetween(new Date(Number(span.rows[0].start_ms)), new Date(Number(span.rows[0].now_ms)));
    await client.query(`UPDATE time_entries SET ended_at = now(), minutes = $2, updated_at = NOW() WHERE id = $1`, [row.id, minutes]);
    await client.query("COMMIT");
    return await getTimeEntry(row.id);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Unbilled and profitability
// ---------------------------------------------------------------------------

const toBillingProject = (p: any): BillingProject => ({ id: p.id, billingMethod: p.billingMethod, hourlyRate: p.hourlyRate, currency: p.currency });

/** Billable, unbilled, stopped time entries of a project, with their effective rate, and the unbilled costs. */
export async function loadUnbilled(companyId: string, project: any, opts: { lockTx?: any; timeEntryIds?: string[]; expenseIds?: string[] } = {}) {
  const q = opts.lockTx ?? pool;
  const lock = opts.lockTx ? " FOR UPDATE OF te" : "";
  const params: unknown[] = [companyId, project.id];
  let idFilter = "";
  if (opts.timeEntryIds) {
    params.push(opts.timeEntryIds);
    idFilter = ` AND te.id = ANY($${params.length}::uuid[])`;
  }
  const entries = await q.query(
    `SELECT ${ENTRY_COLUMNS}, t.hourly_rate::float8 AS "taskRate", COALESCE(t.is_billable, true) AS "taskBillable"
       ${ENTRY_FROM}
      WHERE te.company_id = $1 AND te.project_id = $2 ${idFilter}
        AND (te.billed_invoice_id IS NULL OR bi.status IN ('void', 'cancelled'))
        AND NOT (te.started_at IS NOT NULL AND te.ended_at IS NULL)
      ORDER BY te.entry_date, te.created_at${lock}`,
    params
  );
  const bp = toBillingProject(project);
  const time = entries.rows
    .map(shapeEntry)
    .map((e: any) => {
      const task: BillingTask | null = e.taskId ? { hourlyRate: e.taskRate, isBillable: e.taskBillable } : null;
      return { entry: e, task };
    })
    .filter(({ entry, task }: any) => isEntryBillable(entry as BillingTimeEntry, task, bp))
    .map(({ entry, task }: any) => ({ ...entry, rate: effectiveRate(entry, task, bp), amount: Math.round(hoursOf(entry.minutes) * effectiveRate(entry, task, bp) * 100) / 100 }));

  const eParams: unknown[] = [companyId, project.id];
  let eFilter = "";
  if (opts.expenseIds) {
    eParams.push(opts.expenseIds);
    eFilter = ` AND pe.id = ANY($${eParams.length}::uuid[])`;
  }
  const expenses = await q.query(
    `SELECT pe.id::text AS id, pe.source_type AS "sourceType", to_char(pe.expense_date, 'YYYY-MM-DD') AS "expenseDate",
            pe.description, pe.amount_aed::float8 AS "amountAed", pe.billed_invoice_id::text AS "billedInvoiceId"
       FROM project_expenses pe LEFT JOIN invoices bi ON bi.id = pe.billed_invoice_id
      WHERE pe.company_id = $1 AND pe.project_id = $2 AND pe.is_billable ${eFilter}
        AND (pe.billed_invoice_id IS NULL OR bi.status IN ('void', 'cancelled'))
      ORDER BY pe.expense_date, pe.created_at${opts.lockTx ? " FOR UPDATE OF pe" : ""}`,
    eParams
  );
  return { time, expenses: expenses.rows as Array<{ id: string; sourceType: string; expenseDate: string; description: string; amountAed: number }> };
}

export async function unbilledSummary(companyId: string, project: any) {
  const { time, expenses } = await loadUnbilled(companyId, project);
  // The entries are already filtered and carry their effective rate, so the shared maths adds them up.
  const { unbilledHours, unbilledAmount } = summarizeUnbilled(time, () => null, toBillingProject(project));
  const expenseTotal = expenses.reduce((s, e) => s + e.amountAed, 0);
  return {
    timeEntries: time,
    expenses,
    unbilledHours,
    unbilledAmount,
    unbilledExpenses: Math.round(expenseTotal * 100) / 100,
  };
}

export async function projectProfitability(companyId: string, project: any, range: { from?: string; to?: string }) {
  const params: unknown[] = [companyId, project.id];
  let dateFilter = "";
  if (range.from) { params.push(range.from); dateFilter += ` AND je.date::date >= $${params.length}::date`; }
  if (range.to) { params.push(range.to); dateFilter += ` AND je.date::date <= $${params.length}::date`; }
  const ledger = await pool.query(
    `SELECT COALESCE(SUM(jl.credit - jl.debit) FILTER (WHERE a.type = 'income'), 0)::float8 AS revenue,
            COALESCE(SUM(jl.debit - jl.credit) FILTER (WHERE a.type = 'expense'), 0)::float8 AS costs
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND jl.project_id = $2 ${dateFilter}`,
    params
  );
  const tParams: unknown[] = [companyId, project.id];
  let tFilter = "";
  if (range.from) { tParams.push(range.from); tFilter += ` AND te.entry_date >= $${tParams.length}::date`; }
  if (range.to) { tParams.push(range.to); tFilter += ` AND te.entry_date <= $${tParams.length}::date`; }
  const entries = await pool.query(
    `SELECT ${ENTRY_COLUMNS}, COALESCE(t.is_billable, true) AS "taskBillable", t.hourly_rate::float8 AS "taskRate"
       ${ENTRY_FROM} WHERE te.company_id = $1 AND te.project_id = $2 AND NOT (te.started_at IS NOT NULL AND te.ended_at IS NULL) ${tFilter}`,
    tParams
  );
  const bp = toBillingProject(project);
  let total = 0, billable = 0, billed = 0, unbilled = 0;
  for (const raw of entries.rows) {
    const e: any = shapeEntry(raw);
    const task: BillingTask | null = e.taskId ? { hourlyRate: e.taskRate, isBillable: e.taskBillable } : null;
    total += e.minutes;
    if (isEntryBillable(e, task, bp)) {
      billable += e.minutes;
      if (e.billed) billed += e.minutes; else unbilled += e.minutes;
    }
  }
  const h = (m: number) => Math.round((m / 60) * 100) / 100;
  return profitability({
    revenue: ledger.rows[0].revenue,
    costs: ledger.rows[0].costs,
    hours: { total: h(total), billable: h(billable), billed: h(billed), unbilled: h(unbilled) },
    budgetAmount: project.budgetAmount,
    budgetHours: project.budgetHours,
  });
}

// ---------------------------------------------------------------------------
// Costs reaching a project (bill lines and expense-claim items tagged with project_id)
// ---------------------------------------------------------------------------

/** Every project id of a request must belong to the company (422 INVALID_PROJECT); blank ids are fine. */
export async function assertProjectsOfCompany(companyId: string, ids: Array<string | null | undefined>): Promise<void> {
  const wanted = [...new Set(ids.filter((v): v is string => !!v))];
  if (wanted.length === 0) return;
  if (wanted.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) throw err(422, "INVALID_PROJECT", "A project id is not valid.");
  const r = await pool.query(`SELECT COUNT(*)::int AS n FROM projects WHERE company_id = $1 AND id = ANY($2::uuid[])`, [companyId, wanted]);
  if (r.rows[0].n !== wanted.length) throw err(422, "INVALID_PROJECT", "A project does not belong to this company.");
}

/** True when every project id belongs to the company (blank ids are fine). */
export async function projectsBelongToCompany(companyId: string, ids: Array<string | null | undefined>): Promise<boolean> {
  try {
    await assertProjectsOfCompany(companyId, ids);
    return true;
  } catch {
    return false;
  }
}

/** At a bill's final approval: one project_expenses row per tagged line (net, in AED). Idempotent. */
export async function recordProjectExpensesForBill(billId: string): Promise<void> {
  await pool.query(
    `INSERT INTO project_expenses (company_id, project_id, source_type, bill_line_item_id, expense_date, description, amount_aed, is_billable)
     SELECT b.company_id, bl.project_id, 'bill_line', bl.id, b.bill_date::date, bl.description,
            ROUND(bl.amount * COALESCE(NULLIF(b.exchange_rate, 0), 1), 2), bl.is_billable
       FROM bill_line_items bl JOIN vendor_bills b ON b.id = bl.bill_id
      WHERE bl.bill_id = $1 AND bl.project_id IS NOT NULL
     ON CONFLICT DO NOTHING`,
    [billId]
  );
}

/** At a claim's final approval: one project_expenses row per tagged item. Idempotent. */
export async function recordProjectExpensesForClaim(claimId: string): Promise<void> {
  await pool.query(
    `INSERT INTO project_expenses (company_id, project_id, source_type, expense_claim_item_id, expense_date, description, amount_aed, is_billable)
     SELECT c.company_id, ci.project_id, 'expense_claim_item', ci.id, ci.expense_date::date, ci.description, ci.amount, ci.is_billable
       FROM expense_claim_items ci JOIN expense_claims c ON c.id = ci.claim_id
      WHERE ci.claim_id = $1 AND ci.project_id IS NOT NULL
     ON CONFLICT DO NOTHING`,
    [claimId]
  );
}
