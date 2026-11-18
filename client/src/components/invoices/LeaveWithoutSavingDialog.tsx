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
import { useTranslation } from "@/lib/i18n";

/** WQ1 (7.24): "Leave without saving?" (paired with useUnsavedChangesGuard). */
export function LeaveWithoutSavingDialog({
  open,
  onStay,
  onLeave,
}: {
  open: boolean;
  onStay: () => void;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onStay()}>
      <AlertDialogContent data-testid="dialog-leave-without-saving" data-leave-guard-ignore="">
        <AlertDialogHeader>
          <AlertDialogTitle>{t["invoices.leave.title"]}</AlertDialogTitle>
          <AlertDialogDescription>{t["invoices.leave.body"]}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-stay-on-editor">
            {t["invoices.leave.stay"]}
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onLeave}
            data-testid="button-leave-without-saving"
          >
            {t["invoices.leave.leave"]}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
