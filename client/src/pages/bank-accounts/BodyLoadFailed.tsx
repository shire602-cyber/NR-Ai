import { onlineManager } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";

/** Stands in for the statement dialog body when its chunk or catalog could not load. */
export function BodyLoadFailed() {
  const { t } = useTranslation();
  return (
    <p role="alert" className="text-small text-muted-foreground">
      {onlineManager.isOnline()
        ? t["components.errorSectionCouldNotLoad"]
        : `${t["banking.common.offline"]}. ${t["banking.common.offlineBody"]}`}{" "}
      <Button variant="link" size="sm" onClick={() => window.location.reload()}>
        {t["components.errorRetry"]}
      </Button>
    </p>
  );
}
