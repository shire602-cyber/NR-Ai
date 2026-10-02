// Client side of per-report scheduled delivery (Phase 8 D4): the contract of server/routes/report-schedules.routes.ts.

import { apiRequest } from "./queryClient";
import { isNraFirmRole } from "@shared/access";
import type { AsOfPreset, RangePreset } from "./report-presets";

export type ScheduleFormat = "pdf" | "csv" | "xlsx";
export type ScheduleCadence = "daily" | "weekly" | "monthly";
export type ScheduleComparison = "none" | "priorPeriod" | "priorYear";

/** What a schedule stores: presets, not days, so every run resolves them in Dubai time. */
export interface ScheduleParams {
  rangePreset?: RangePreset;
  asOfPreset?: AsOfPreset;
  compare?: ScheduleComparison;
  filters?: Record<string, string>;
}

export interface ReportScheduleDto {
  id: string;
  companyId: string;
  reportId: string;
  params: ScheduleParams;
  format: ScheduleFormat;
  lang: "en" | "ar";
  cadence: ScheduleCadence;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  hourDubai: number;
  recipientUserIds: string[];
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: ScheduleRunStatus | null;
  createdAt: string | null;
}

export type ScheduleRunStatus = "running" | "sent" | "skipped" | "failed";

export interface ReportScheduleRunDto {
  id: string;
  slotKey: string;
  trigger: "schedule" | "manual";
  status: ScheduleRunStatus;
  reason: string | null;
  resolvedParams: Record<string, unknown>;
  rowCount: number | null;
  byteSize: number | null;
  sha256: string | null;
  recipientsSent: number;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ScheduleInput {
  reportId: string;
  params: ScheduleParams;
  format: ScheduleFormat;
  lang: "en" | "ar";
  cadence: ScheduleCadence;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  hourDubai: number;
  recipientUserIds: string[];
}

export const MAX_SCHEDULE_RECIPIENTS = 20;
export const SENSITIVE_SCHEDULE_ROLES = ["owner", "accountant", "cfo"] as const;

const base = (companyId: string) => `/api/companies/${companyId}/report-schedules`;
export const schedulesQueryKey = (companyId: string | undefined) =>
  [base(companyId ?? "none")] as const;
export const scheduleRunsQueryKey = (companyId: string, scheduleId: string) =>
  [base(companyId), scheduleId, "runs"] as const;

export const listSchedules = (companyId: string): Promise<ReportScheduleDto[]> =>
  apiRequest("GET", base(companyId));
export const createSchedule = (
  companyId: string,
  input: ScheduleInput
): Promise<ReportScheduleDto> => apiRequest("POST", base(companyId), input);
export const updateSchedule = (
  companyId: string,
  id: string,
  input: Partial<ScheduleInput> & { enabled?: boolean }
): Promise<ReportScheduleDto> => apiRequest("PATCH", `${base(companyId)}/${id}`, input);
export const deleteSchedule = (companyId: string, id: string): Promise<null> =>
  apiRequest("DELETE", `${base(companyId)}/${id}`);
export const runScheduleNow = (companyId: string, id: string): Promise<{ runId: string }> =>
  apiRequest("POST", `${base(companyId)}/${id}/run-now`, {});
export const listScheduleRuns = (companyId: string, id: string): Promise<ReportScheduleRunDto[]> =>
  apiRequest("GET", `${base(companyId)}/${id}/runs`);

/** Mirrors the server: owner, accountant and CFO of the company, or firm staff, may change schedules. */
export function canManageSchedules(
  user: { isAdmin?: boolean | null; firmRole?: string | null } | null | undefined,
  memberRole: string | null | undefined
): boolean {
  if (!user) return false;
  if (user.isAdmin === true || isNraFirmRole(user.firmRole)) return true;
  return (SENSITIVE_SCHEDULE_ROLES as readonly string[]).includes(memberRole ?? "");
}

export const DAYS_OF_WEEK = [0, 1, 2, 3, 4, 5, 6] as const;
export const HOURS_OF_DAY = Array.from({ length: 24 }, (_, i) => i);
export const DAYS_OF_MONTH = Array.from({ length: 28 }, (_, i) => i + 1);

export const pad2 = (n: number) => String(n).padStart(2, "0");
export const hourLabel = (hour: number) => `${pad2(hour)}:00`;

/** A UTC timestamp from the server as a Dubai wall-clock "YYYY-MM-DD HH:mm". */
export function dubaiDateTime(utcIso: string | null | undefined): string {
  if (!utcIso) return "";
  const t = Date.parse(utcIso);
  if (Number.isNaN(t)) return "";
  return new Date(t + 4 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
}
