/**
 * Reconciliation statement dialog. The frame (title, description, close) renders at once and stays
 * mounted; only the body and its `bankStatement` catalog are separate chunks. A failed chunk load
 * keeps the page and its cached rows: no automatic reload (`reload: false`), the dialog offers a
 * manual one instead.
 */
import { lazy, Suspense, useState, type ComponentType } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { loadNamespaces, useI18n, useTranslation } from "@/lib/i18n";
import { loadWithChunkRetry } from "@/lib/lazyWithReload";
import { BodyLoadFailed } from "./BodyLoadFailed";
import { STATEMENT_NAMESPACES } from "./statement-namespaces";

// A new lazy component per opening: React.lazy remembers its first result, failures included.
const lazyBody = () =>
  lazy(() =>
    loadWithChunkRetry<{
      default: ComponentType<{ companyId: string; accountId: string; currency?: string }>;
    }>(
      async () => {
        const [body] = await Promise.all([
          import("./StatementDialogBody"),
          loadNamespaces(useI18n.getState().locale, STATEMENT_NAMESPACES),
        ]);
        return body;
      },
      { key: "bank-statement-dialog", reload: false }
    ).catch(() => ({ default: BodyLoadFailed }))
  );

export function StatementDialog({
  companyId,
  account,
  onClose,
}: {
  companyId: string;
  account: { id: string; nameEn: string; currency?: string };
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
          <Body companyId={companyId} accountId={account.id} currency={account.currency} />
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
