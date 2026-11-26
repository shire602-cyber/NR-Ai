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
import { useTranslation } from "@/lib/i18n";

const tr = (locale: string, en: string, ar: string) => (locale === "ar" ? ar : en);

const scopeLabel = (locale: string, fallback: "plan" | "all" | undefined) => {
  if (fallback === "plan")
    return tr(locale, "now uses the plan's cost centre", "يستخدم الآن مركز تكلفة الخطة");
  if (fallback === "all")
    return tr(locale, "now includes all cost centres", "يشمل الآن كل مراكز التكلفة");
  return tr(locale, "cost centre scope changed", "تغيّر نطاق مركز التكلفة");
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
            {isCopy
              ? tr(locale, "Budget copied: scope changed", "تم نسخ الموازنة: تغيّر النطاق")
              : tr(
                  locale,
                  "New version created: scope changed",
                  "تم إنشاء النسخة الجديدة: تغيّر النطاق"
                )}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {tr(
              locale,
              `The draft "${change?.planName ?? ""}" no longer filters by a deleted cost centre. Each affected line now uses either the plan's cost centre or all cost centres, as labelled below. Review these before you approve it:`,
              `المسودة "${change?.planName ?? ""}" لم تعد تُرشَّح بمركز تكلفة محذوف. يستخدم كل بند متأثر الآن إما مركز تكلفة الخطة أو كل مراكز التكلفة، كما هو موضح أدناه. راجع ما يلي قبل اعتمادها:`
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul
          className="max-h-[40vh] list-disc space-y-1 overflow-y-auto ps-5 text-sm"
          data-testid="budget-scope-list"
        >
          {change?.planCostCenterCleared && (
            <li>
              {tr(
                locale,
                "The plan itself (cost centre cleared)",
                "الخطة نفسها (تم مسح مركز التكلفة)"
              )}
            </li>
          )}
          {change?.lines.map((l, i) => (
            <li key={`${l.costCenterId}-${i}`}>
              {l.category
                ? `${budgetCategoryLabel(t, l.category)}${l.description ? ` - ${l.description}` : ""}`
                : tr(locale, "A budget line", "بند موازنة")}
              {`: ${scopeLabel(locale, l.fallback)}`}
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogAction onClick={onAcknowledge}>
            {tr(locale, "I understand, continue", "فهمت، متابعة")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
