import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useCompanyRole } from "@/hooks/useCompanyRole";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { queryClient } from "@/lib/queryClient";
import { setRequireTwoFactor } from "@/lib/security-api";
import { messages as pageMessages } from "./TwoFactorCard.i18n";

/** Company-level policy: owners, accountants and CFOs must use 2FA. Visible to everyone, switchable by the owner. */
export function RequireTwoFactorCard() {
  const tr = pageMessages.useT();
  const { toast } = useToast();
  const { company, companyId } = useDefaultCompany();
  const { isOwner } = useCompanyRole();
  const enabled = (company as { requireTwoFactor?: boolean } | undefined)?.requireTwoFactor === true;

  const mutation = useMutation({
    mutationFn: (value: boolean) => setRequireTwoFactor(companyId!, value),
    onSuccess: (_data, value) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: value ? tr("policyOn") : tr("policyOff") });
    },
    onError: () => toast({ variant: "destructive", title: tr("errGeneric") }),
  });

  if (!companyId) return null;

  return (
    <Card data-testid="card-require-2fa">
      <CardHeader>
        <CardTitle className="text-lg">
          <h2>{tr("policyTitle")}</h2>
        </CardTitle>
        <CardDescription>{tr("policyBody", { company: company?.name ?? "" })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-3">
          <Switch id="require-2fa" checked={enabled} disabled={!isOwner || mutation.isPending} onCheckedChange={(v) => mutation.mutate(v)} data-testid="switch-require-2fa" />
          <label htmlFor="require-2fa" className="text-sm font-medium">
            {tr("policyLabel")}
          </label>
        </div>
        {!isOwner && <p className="text-xs text-muted-foreground">{tr("ownerOnly")}</p>}
      </CardContent>
    </Card>
  );
}
