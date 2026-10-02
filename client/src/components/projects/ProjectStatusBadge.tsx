import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import type { ProjectStatus } from "@/lib/purchasing-hr";
import { messages } from "./ProjectFormDialog.i18n";

const TONES: Record<ProjectStatus, StatusTone> = { active: "success", on_hold: "warning", completed: "info", cancelled: "neutral" };

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const tr = messages.useT();
  const label = status === "active" ? tr("statusActive") : status === "on_hold" ? tr("statusOnHold") : status === "completed" ? tr("statusCompleted") : tr("statusCancelled");
  return <StatusBadge tone={TONES[status]}>{label}</StatusBadge>;
}
