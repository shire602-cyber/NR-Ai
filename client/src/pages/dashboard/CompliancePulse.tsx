import { useCountUp } from "./useCountUp";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "@/lib/i18n";
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

/**
 * Maps audit-readiness issue strings from /compliance/overview to the screen
 * where the user can resolve them. Strings must match the server exactly
 * (server/routes/compliance-dashboard.routes.ts).
 */
const ISSUE_ACTIONS: Record<
  string,
  { href: string; cta: string; issueKey: string; ctaKey: string }
> = {
  "No VAT returns filed": {
    href: "/vat-filing",
    cta: "File VAT 201",
    issueKey: "dashboard.checkNoVatReturns",
    ctaKey: "dashboard.actionFileVat",
  },
  "No chart of accounts configured": {
    href: "/chart-of-accounts",
    cta: "Set up accounts",
    issueKey: "dashboard.checkNoChartOfAccounts",
    ctaKey: "dashboard.actionSetupAccounts",
  },
  "No journal entries in the last 90 days": {
    href: "/journal",
    cta: "Post an entry",
    issueKey: "dashboard.checkNoJournalEntries",
    ctaKey: "dashboard.actionPostEntry",
  },
  "No bank reconciliation rules configured": {
    href: "/bank-reconciliation",
    cta: "Set up reconciliation",
    issueKey: "dashboard.checkNoReconRules",
    ctaKey: "dashboard.actionSetupRecon",
  },
  "Bank reconciliation not set up": {
    href: "/bank-reconciliation",
    cta: "Set up reconciliation",
    issueKey: "dashboard.checkReconNotSetUp",
    ctaKey: "dashboard.actionSetupRecon",
  },
  "No completed data backups": {
    href: "/backup-restore",
    cta: "Run a backup",
    issueKey: "dashboard.checkNoBackups",
    ctaKey: "dashboard.actionRunBackup",
  },
};

export function FixItRow({ issue }: { issue: string }) {
  const { t } = useTranslation();
  const action = ISSUE_ACTIONS[issue];
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-2.5">
      <div className="flex items-center gap-2.5 min-w-0">
        <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" />
        <span className="text-[13px] text-foreground/80 truncate">
          {(action && t[action.issueKey]) || issue}
        </span>
      </div>
      {action && (
        <Link href={action.href}>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-accent hover:text-accent shrink-0 -me-2"
          >
            {t[action.ctaKey] || action.cta} <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
          </Button>
        </Link>
      )}
    </div>
  );
}
