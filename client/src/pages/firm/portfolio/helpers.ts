// ClientPortfolio module (W5-D split of ClientPortfolio.tsx; no behaviour change).
import { formatAedText } from "@/lib/format";
import { Calendar, Calculator, CheckCircle2, TrendingUp } from "lucide-react";
import { format } from "date-fns";
import {
  DEFAULT_CLIENT_SERVICE_CODES,
  clientHasService,
  type ClientServiceCode,
} from "@shared/client-services";
import type {
  BookkeeperClient,
  BookkeeperInterventionLevel,
  BookkeeperPriority,
  BookkeeperQueueKey,
  ClientWithStats,
} from "./types";
import { calendarDayKey, parseCalendarDate } from "@/lib/format-date";

export function formatAed(amount: number) {
  return formatAedText(amount);
}

export function formatDateShort(date: string | null | undefined) {
  if (!date) return "—";
  return format(parseCalendarDate(date), "MMM d");
}

export function formatPeriod(start: string | null | undefined, end: string | null | undefined) {
  if (!start || !end) return "No period";
  return `${formatDateShort(start)} - ${formatDateShort(end)}`;
}

export function formatDays(days: number | null | undefined) {
  if (days === null || days === undefined) return "No date";
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Due today";
  return `${days}d left`;
}

export function inputDate(date: string | null | undefined) {
  if (!date) return "";
  return calendarDayKey(date);
}

/** Today as a yyyy-MM-dd string for pre-filling date inputs (local time). */
export function todayInput() {
  return format(new Date(), "yyyy-MM-dd");
}

export function copyText(value: unknown) {
  void navigator.clipboard?.writeText(String(value ?? "0"));
}

export async function readFileAsBase64(file: File) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read evidence file"));
    reader.readAsDataURL(file);
  });
  return dataUrl.split(",")[1] ?? "";
}

export async function readEvidenceText(file: File) {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  const isTextLike =
    type.startsWith("text/") ||
    name.endsWith(".csv") ||
    name.endsWith(".txt") ||
    name.endsWith(".json");
  if (!isTextLike || file.size > 500_000) return "";
  return file.text();
}

export function priorityClass(priority: BookkeeperPriority | "filed") {
  if (priority === "filed" || priority === "on_track")
    return "bg-success-subtle text-success-subtle-foreground border-success/30";
  if (priority === "critical")
    return "bg-danger-subtle text-danger-subtle-foreground border-destructive/30";
  return "bg-warning-subtle text-warning-subtle-foreground border-warning/30";
}

export function priorityLabel(priority: BookkeeperPriority | "filed") {
  if (priority === "on_track") return "On track";
  if (priority === "attention") return "Attention";
  if (priority === "critical") return "Critical";
  return "Filed";
}

export function priorityScore(priority: BookkeeperPriority | "filed") {
  if (priority === "critical") return 3;
  if (priority === "attention") return 2;
  return 1;
}

export function servicesForClient(
  client: Pick<BookkeeperClient, "serviceScope"> | Pick<ClientWithStats, "serviceScope">
): ClientServiceCode[] {
  return client.serviceScope?.length ? client.serviceScope : DEFAULT_CLIENT_SERVICE_CODES;
}

export function hasClientService(
  client: Pick<BookkeeperClient, "serviceScope"> | Pick<ClientWithStats, "serviceScope">,
  service: ClientServiceCode
) {
  return clientHasService(servicesForClient(client), service);
}

export function interventionClass(level: BookkeeperInterventionLevel) {
  if (level === "high")
    return "bg-danger-subtle text-danger-subtle-foreground border-destructive/30";
  if (level === "medium")
    return "bg-warning-subtle text-warning-subtle-foreground border-warning/30";
  return "bg-success-subtle text-success-subtle-foreground border-success/30";
}

export function fallbackIntervention(
  client: BookkeeperClient
): NonNullable<BookkeeperClient["intervention"]> {
  const score = Math.min(
    100,
    priorityScore(client.priority) * 18 +
      (client.assignedStaff.length === 0 ? 12 : 0) +
      (client.bookkeeping.status !== "on_track" ? 12 : 0) +
      (client.vat.daysTilDue !== null && client.vat.daysTilDue <= 28 ? 10 : 0) +
      (client.corporateTax.daysTilDue !== null && client.corporateTax.daysTilDue <= 90 ? 6 : 0)
  );
  const level: BookkeeperInterventionLevel = score >= 65 ? "high" : score >= 35 ? "medium" : "low";
  const reasons = [
    client.assignedStaff.length === 0 ? "No owner assigned" : "",
    ...client.vat.blockers,
    ...client.corporateTax.blockers,
    ...client.bookkeeping.blockers,
    ...client.accounting.blockers,
  ].filter(Boolean);
  return {
    score,
    level,
    title: client.nextBestAction,
    reasons: (reasons.length > 0 ? reasons : ["No active intervention signals"]).slice(0, 5),
    ownerAction: client.nextBestAction,
    deadlineLabel: primaryDeadline(client).label,
    exposureAed: Math.round(Math.max(0, client.bookkeeping.openAr)),
  };
}

export function clientIntervention(client: BookkeeperClient) {
  return client.intervention ?? fallbackIntervention(client);
}

export function blockerPreview(blockers: string[]) {
  if (blockers.length === 0) return "No blockers";
  if (blockers.length === 1) return blockers[0];
  return `${blockers[0]} +${blockers.length - 1}`;
}

export const queueConfig: Record<BookkeeperQueueKey, { label: string; icon: typeof Calendar }> = {
  vat: { label: "VAT", icon: Calendar },
  corporateTax: { label: "Corporate Tax", icon: Calculator },
  bookkeeping: { label: "Bookkeeping", icon: TrendingUp },
  accounting: { label: "Accounting", icon: CheckCircle2 },
};

export function ownerPreview(names: string[]) {
  if (names.length === 0) return "Unassigned";
  if (names.length === 1) return names[0];
  return `${names[0]} +${names.length - 1}`;
}

export function primaryDeadline(client: BookkeeperClient) {
  const candidates = [
    hasClientService(client, "vat") && client.vat.status !== "filed"
      ? {
          label: "VAT",
          dueDate: client.vat.dueDate,
          daysTilDue: client.vat.daysTilDue,
          metric:
            client.vat.payableTax !== null
              ? formatAed(client.vat.payableTax)
              : client.vat.cohortLabel,
        }
      : null,
    hasClientService(client, "corporate_tax") && client.corporateTax.status !== "filed"
      ? {
          label: "CT",
          dueDate: client.corporateTax.dueDate,
          daysTilDue: client.corporateTax.daysTilDue,
          metric:
            client.corporateTax.taxPayable !== null
              ? formatAed(client.corporateTax.taxPayable)
              : "Readiness",
        }
      : null,
  ].filter(Boolean) as Array<{
    label: string;
    dueDate: string | null;
    daysTilDue: number | null;
    metric: string;
  }>;

  candidates.sort((a, b) => (a.daysTilDue ?? 99999) - (b.daysTilDue ?? 99999));
  const fallbackLabel = hasClientService(client, "bookkeeping")
    ? "Close"
    : hasClientService(client, "accounting")
      ? "Accounting"
      : "Profile";
  return (
    candidates[0] ?? {
      label: fallbackLabel,
      dueDate: client.vat.dueDate,
      daysTilDue: client.vat.daysTilDue,
      metric: `${client.bookkeeping.closeProgress}% close-ready`,
    }
  );
}

export function productionItem(client: BookkeeperClient, labelOverride?: string) {
  const deadline = primaryDeadline(client);
  return {
    client,
    label: labelOverride ?? deadline.label,
    dueDate: deadline.dueDate,
    daysTilDue: deadline.daysTilDue,
    metric:
      labelOverride === "Close"
        ? `${client.bookkeeping.closeProgress}% close-ready`
        : deadline.metric,
  };
}

export function sortProductionItems(items: ReturnType<typeof productionItem>[]) {
  return items.sort((a, b) => {
    const priorityDelta =
      (b.client.priority === "critical" ? 3 : b.client.priority === "attention" ? 2 : 1) -
      (a.client.priority === "critical" ? 3 : a.client.priority === "attention" ? 2 : 1);
    if (priorityDelta !== 0) return priorityDelta;
    return (a.daysTilDue ?? 99999) - (b.daysTilDue ?? 99999);
  });
}

export function clientNeedsAttention(c: ClientWithStats): boolean {
  // Mirror /api/firm/overview: a client needs attention if AR is outstanding
  // OR the latest VAT return is past its due date and not yet filed/submitted.
  // The list endpoint doesn't expose per-invoice due dates, so outstandingAr>0
  // is used as the AR proxy (slightly broader than server's overdue-only count).
  if (c.outstandingAr > 0) return true;
  if (c.vatStatus && c.vatStatus.status !== "filed" && c.vatStatus.status !== "submitted") {
    const due = new Date(c.vatStatus.dueDate);
    if (due < new Date()) return true;
  }
  return false;
}

export function vatDueSoon(c: ClientWithStats): boolean {
  if (!c.vatStatus) return false;
  if (c.vatStatus.status === "filed" || c.vatStatus.status === "submitted") return false;
  const due = new Date(c.vatStatus.dueDate);
  const now = new Date();
  const days = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  return days >= 0 && days <= 30;
}
