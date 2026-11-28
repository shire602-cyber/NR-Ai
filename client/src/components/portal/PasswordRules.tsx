import { Check, Circle } from "lucide-react";
import { PASSWORD_RULES } from "@shared/validators/password-rules";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Live password checklist driven by the same rule list the server policy mirrors
 * (shared/validators/password-rules.ts). Linked to the password field with `aria-describedby`;
 * the summary is announced politely, each rule carries text (met / not met), never colour alone.
 */
export function PasswordRules({ password, id }: { password: string; id: string }) {
  const { t } = useTranslation();
  const met = PASSWORD_RULES.filter((r) => r.test(password)).length;
  return (
    <div id={id} data-testid="password-rules">
      <p className="sr-only" aria-live="polite">
        {`${met}/${PASSWORD_RULES.length}`}
      </p>
      <p className="mb-1.5 text-caption font-medium text-muted-foreground">
        {t["portal.join.rulesTitle"]}
      </p>
      <ul className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        {PASSWORD_RULES.map((rule) => {
          const ok = rule.test(password);
          return (
            <li
              key={rule.id}
              data-rule={rule.id}
              data-met={ok ? "true" : "false"}
              className={cn(
                "flex items-center gap-2 text-caption",
                ok ? "text-success" : "text-muted-foreground"
              )}
            >
              {ok ? (
                <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <Circle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
              <span>{t[`portal.join.rule.${rule.id}`]}</span>
              <span className="sr-only">
                {ok ? t["portal.join.ruleMet"] : t["portal.join.ruleNotMet"]}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
