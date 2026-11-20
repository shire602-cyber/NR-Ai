import { useState } from "react";
import { useLocation } from "wouter";
import type { Company } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/form-layout";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { switchActiveCompany } from "@/lib/activeCompany";
import { useTranslation } from "@/lib/i18n";

/**
 * Broken-path sweep: "create a second company" had no way in from the app (the switcher only
 * switched, and Settings offered "Create your company" only to users with none). This dialog
 * creates the company (POST /api/companies; the plan's company cap answers 403
 * COMPANY_LIMIT_REACHED, which the app-level PlanLimitDialog explains), switches to it and opens
 * onboarding for it.
 */
export function NewCompanyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t["components.newCompanyNameRequired"]);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const company = (await apiRequest("POST", "/api/companies", { name: trimmed })) as Company;
      onOpenChange(false);
      setName("");
      await switchActiveCompany(company.id);
      navigate("/onboarding");
    } catch (failure) {
      // A plan limit is explained by the PlanLimitDialog; close this one so it is visible.
      if (failure instanceof ApiError && (failure.status === 402 || failure.status === 403)) {
        onOpenChange(false);
      } else {
        setError(failure instanceof Error ? failure.message : t["components.switcherTryAgain"]);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-new-company">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{t["components.newCompanyTitle"]}</DialogTitle>
            <DialogDescription>{t["components.newCompanyBody"]}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Field
              id="new-company-name"
              label={t["components.newCompanyName"]}
              required
              error={error ?? undefined}
            >
              <Input
                id="new-company-name"
                dir="auto"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={error ? true : undefined}
                data-testid="input-new-company-name"
              />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t["components.newCompanyCancel"]}
            </Button>
            <Button type="submit" disabled={saving} data-testid="button-save-new-company">
              {t["components.newCompanyCreate"]}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
