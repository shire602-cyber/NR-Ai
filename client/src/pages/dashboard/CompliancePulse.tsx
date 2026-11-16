import { useCountUp } from "./useCountUp";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "@/lib/i18n";
import { CHECK_ACTIONS, auditCheckExplanation, type AuditReadinessCheck } from "./auditChecks";
import { ArrowRight } from "lucide-react";
import { Link } from "wouter";

// ─── Compliance pulse ────────────────────────────────────────────────────────

export function ScoreRing({ score }: { score: number }) {
  const animated = useCountUp(score, 1200);
  const r = 26;
  const c = 2 * Math.PI * r;
  const color =
    score >= 80
      ? "hsl(var(--success))"
      : score >= 50
        ? "hsl(var(--warning))"
        : "hsl(var(--destructive))";
  return (
    <div
      className="relative w-16 h-16 shrink-0"
      role="img"
      aria-label={`Audit readiness score ${score} out of 100`}
    >
      <svg viewBox="0 0 64 64" className="w-16 h-16 -rotate-90">
        <circle cx={32} cy={32} r={r} fill="none" stroke="hsl(var(--border))" strokeWidth={5} />
        <circle
          cx={32}
          cy={32}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (Math.min(100, Math.max(0, animated)) / 100) * c}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center font-mono font-semibold tabular-nums text-[15px] text-foreground">
        {Math.round(animated)}
      </div>
    </div>
  );
}

export function FilingStatusBadge({
  status,
  t,
}: {
  status?: "up_to_date" | "due_soon" | "overdue";
  t: Record<string, string>;
}) {
  if (status === "overdue")
    return (
      <Badge variant="danger" dot>
        {t.overdue ?? "Overdue"}
      </Badge>
    );
  if (status === "due_soon")
    return (
      <Badge variant="warning" dot>
        {t.dueSoon ?? "Due soon"}
      </Badge>
    );
  return (
    <Badge variant="success" dot>
      {t.onTrack ?? "On track"}
    </Badge>
  );
}

export function FixItRow({ check }: { check: AuditReadinessCheck }) {
  const { t } = useTranslation();
  const catalog = t as unknown as Record<string, string>;
  const action = CHECK_ACTIONS[check.key]?.(check);
  const explanation = auditCheckExplanation(check, catalog);
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-2.5">
      <div className="flex items-center gap-2.5 min-w-0">
        <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" />
        <span className="text-[13px] text-foreground/80 truncate" title={explanation}>
          {explanation}
        </span>
      </div>
      {action && (
        <Link href={action.href}>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-accent hover:text-accent shrink-0 -me-2"
          >
            {catalog[action.ctaKey]} <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
          </Button>
        </Link>
      )}
    </div>
  );
}
