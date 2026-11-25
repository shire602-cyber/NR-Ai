import { T } from "@/components/layout/T";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** Failed statement fetch: an announced error with a retry, never a silent zero statement. */
export function StatementLoadError({
  messageKey,
  onRetry,
  retrying,
}: {
  messageKey: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 text-destructive"
        >
          <p>
            <T k={messageKey} />
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={(event) => {
              const button = event.currentTarget;
              if (button.ownerDocument.activeElement === button) {
                // The error card can unmount as soon as the retry starts.
                button.closest<HTMLElement>('[role="tabpanel"]')?.focus({ preventScroll: true });
              }
              onRetry();
            }}
            disabled={retrying}
          >
            <T k="statements.retry" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
