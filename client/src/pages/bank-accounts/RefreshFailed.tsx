import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";
import { RotateCw } from "lucide-react";

export function RefreshFailed({
  message,
  onRetry,
  testId,
}: {
  message: string;
  onRetry: () => void;
  testId: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      data-testid={testId}
      className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-sunken/60 px-3 py-2 text-small text-muted-foreground"
    >
      <span>{message}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCw aria-hidden />
        {t["components.errorRetry"]}
      </Button>
    </div>
  );
}
