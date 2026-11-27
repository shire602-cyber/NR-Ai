import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { budgetCategoryLabel } from "@/lib/budget-categories";
import type { BudgetScopeChange } from "@/lib/budget-scope";
import { formatMessage, useTranslation } from "@/lib/i18n";

type Catalog = Record<string, string>;

const scopeLabel = (t: Catalog, fallback: "plan" | "all" | undefined) => {
  if (fallback === "plan") return t["budgets.scopePlan"];
  if (fallback === "all") return t["budgets.scopeAll"];
  return t["budgets.scopeChanged"];
};

/**
 * Shown instead of the plain success toast when a copy / new version had to clear a cost centre
 * that no longer exists. Closing it is an explicit acknowledgment; the caller then shows success.
 */
export function BudgetScopeChangeDialog({
  change,
  locale,
  onAcknowledge,
}: {
  change: BudgetScopeChange | null;
  locale: string;
  onAcknowledge: () => void;
}) {
  const { t } = useTranslation();
  const isCopy = change?.action === "copy";
  return (
    <AlertDialog open={change !== null}>
      <AlertDialogContent dir={locale === "ar" ? "rtl" : "ltr"} data-testid="budget-scope-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isCopy ? t["budgets.scopeTitleCopy"] : t["budgets.scopeTitleVersion"]}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {formatMessage(t["budgets.scopeDescription"], { name: change?.planName ?? "" })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul
          className="max-h-[40vh] list-disc space-y-1 overflow-y-auto ps-5 text-sm"
          data-testid="budget-scope-list"
        >
          {change?.planCostCenterCleared && <li>{t["budgets.scopePlanItself"]}</li>}
          {change?.lines.map((l, i) => (
            <li key={`${l.costCenterId}-${i}`}>
              {formatMessage(t["budgets.scopeLineDetail"], {
                line: l.category
                  ? l.description
                    ? formatMessage(t["budgets.scopeLineNamed"], {
                        category: budgetCategoryLabel(t, l.category),
                        description: l.description,
                      })
                    : budgetCategoryLabel(t, l.category)
                  : t["budgets.scopeLineUnnamed"],
                scope: scopeLabel(t, l.fallback),
              })}
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogAction onClick={onAcknowledge}>
            {t["budgets.scopeAcknowledge"]}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
