import { useCallback, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { messages } from "./ConfirmDialog.i18n";

interface Pending {
  message: string;
  action: () => void;
  confirmLabel?: string;
  destructive?: boolean;
}

/**
 * The app's own confirmation, used instead of the browser's confirm(): embedded views and automated browsers cancel
 * a native confirm without asking, which made the action look dead.
 *
 *   const [askConfirm, confirmDialog] = useConfirmAction();
 *   <Button onClick={() => askConfirm(tr("sure"), () => mutation.mutate(id))} />
 *   {confirmDialog}
 */
export function useConfirmAction(): [(message: string, action: () => void, opts?: { confirmLabel?: string; destructive?: boolean }) => void, ReactNode] {
  const tr = messages.useT();
  const [pending, setPending] = useState<Pending | null>(null);
  const ask = useCallback((message: string, action: () => void, opts?: { confirmLabel?: string; destructive?: boolean }) => {
    setPending({ message, action, ...opts });
  }, []);
  const dialog = (
    <AlertDialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
      <AlertDialogContent data-testid="dialog-confirm">
        <AlertDialogHeader>
          <AlertDialogTitle>{tr("title")}</AlertDialogTitle>
          <AlertDialogDescription>{pending?.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-confirm-cancel">{tr("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className={pending?.destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
            onClick={() => {
              const action = pending?.action;
              setPending(null);
              action?.();
            }}
            data-testid="button-confirm-ok"
          >
            {pending?.confirmLabel ?? tr("confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return [ask, dialog];
}
