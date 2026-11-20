import type { ReactNode } from "react";

// ─── Section header ──────────────────────────────────────────────────────────

export function SectionHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h2 className="mt-1 text-h2 text-foreground">{title}</h2>
      </div>
      {action}
    </div>
  );
}
