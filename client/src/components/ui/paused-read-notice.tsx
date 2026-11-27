import { T } from "@/components/layout/T";

export function PausedReadNotice({ cached, testId }: { cached?: boolean; testId: string }) {
  return (
    <p className="text-sm text-muted-foreground" role="status" data-testid={testId}>
      <T k={cached ? "banking.query.pausedCached" : "banking.query.paused"} />
    </p>
  );
}
