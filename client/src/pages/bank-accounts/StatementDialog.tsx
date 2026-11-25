/**
 * Reconciliation statement dialog. The frame (title, description, close) renders at once and stays
 * mounted; only the body is a separate chunk. A failed chunk load keeps the page and its cached
 * rows: no automatic reload (`reload: false`), the dialog offers a manual one instead.
 */
import { lazy, Suspense, useState, type ComponentType } from "react";
import { onlineManager } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslation } from "@/lib/i18n";
import { loadWithChunkRetry } from "@/lib/lazyWithReload";

function BodyLoadFailed() {
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

// A new lazy component per opening: React.lazy remembers its first result, failures included.
const lazyBody = () =>
  lazy(() =>
    loadWithChunkRetry<{ default: ComponentType<{ companyId: string; accountId: string }> }>(
      () => import("./StatementDialogBody"),
      { key: "bank-statement-dialog", reload: false }
    ).catch(() => ({ default: BodyLoadFailed }))
  );

export function StatementDialog({
  companyId,
  account,
  onClose,
}: {
  companyId: string;
  account: { id: string; nameEn: string };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [Body] = useState(lazyBody);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            {t["banking.statement.title"]} — {account.nameEn}
          </DialogTitle>
          <DialogDescription>{t["banking.statement.description"]}</DialogDescription>
        </DialogHeader>
        <Suspense
          fallback={
            <p role="status" className="text-small text-muted-foreground">
              {t["banking.common.loading"]}
            </p>
          }
        >
          <Body companyId={companyId} accountId={account.id} />
        </Suspense>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t["banking.common.close"]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
