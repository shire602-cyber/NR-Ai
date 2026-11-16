// ClientPortfolio module (W5-D split of ClientPortfolio.tsx; no behaviour change).
import { T } from "@/components/layout/T";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import {
  CLIENT_SERVICE_OPTIONS,
  DEFAULT_CLIENT_SERVICE_CODES,
  serviceLabels,
  type ClientServiceCode,
} from "@shared/client-services";
import type { BookkeeperPriority, ClientWithStats } from "./types";
import { priorityClass, priorityLabel } from "./helpers";

export function PriorityBadge({ priority }: { priority: BookkeeperPriority | "filed" }) {
  return <Badge className={priorityClass(priority)}>{priorityLabel(priority)}</Badge>;
}

export function ServiceScopeBadges({
  services,
  compact = false,
}: {
  services?: readonly ClientServiceCode[];
  compact?: boolean;
}) {
  const activeServices = services?.length ? [...services] : DEFAULT_CLIENT_SERVICE_CODES;
  const labels = compact
    ? serviceLabels(activeServices)
    : activeServices.map(
        (service) =>
          CLIENT_SERVICE_OPTIONS.find((option) => option.code === service)?.label ?? service
      );

  return (
    <div className="flex flex-wrap gap-1">
      {labels.map((label) => (
        <Badge key={label} variant="outline" className="text-caption">
          {label}
        </Badge>
      ))}
    </div>
  );
}

export function VatStatusBadge({ vatStatus }: { vatStatus: ClientWithStats["vatStatus"] }) {
  if (!vatStatus)
    return (
      <Badge variant="outline">
        <T k="pages.noVat" />
      </Badge>
    );
  const due = new Date(vatStatus.dueDate);
  const now = new Date();
  const daysUntilDue = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (vatStatus.status === "filed" || vatStatus.status === "submitted") {
    return (
      <Badge className="bg-success-subtle text-success-subtle-foreground border-success/30">
        <T k="pages.filed" />
      </Badge>
    );
  }
  if (daysUntilDue < 0) {
    return (
      <Badge variant="destructive">
        <T k="pages.overdue" />
      </Badge>
    );
  }
  if (daysUntilDue <= 14) {
    return (
      <Badge className="bg-warning-subtle text-warning-subtle-foreground border-warning/30">
        Due {format(due, "MMM d")}
      </Badge>
    );
  }
  return <Badge variant="outline">Due {format(due, "MMM d")}</Badge>;
}

export function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge className="bg-success-subtle text-success-subtle-foreground border-success/30">
      <T k="pages.active" />
    </Badge>
  ) : (
    <Badge variant="secondary">
      <T k="pages.inactive" />
    </Badge>
  );
}
