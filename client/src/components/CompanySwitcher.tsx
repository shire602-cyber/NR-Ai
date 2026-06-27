import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import type { Company } from "@shared/schema";
import { Briefcase, Building2, Check, ChevronsUpDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { switchActiveCompany } from "@/lib/activeCompany";
import { useToast } from "@/hooks/use-toast";
import { useActiveCompany } from "@/components/ActiveCompanyProvider";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { canAccessNraCenter } from "@shared/access";

/**
 * Switch which company the rest of the UI is scoped to. Hidden when the
 * user has 0 or 1 companies — there's nothing to switch between.
 *
 * Switching invalidates the entire query cache via `switchActiveCompany`
 * so previously-loaded panels (invoices, receipts, dashboards) re-fetch
 * for the new tenant instead of showing stale data.
 */
export function CompanySwitcher() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { company: active } = useDefaultCompany();
  const { isFirmContext, clearActiveClientCompany } = useActiveCompany();
  const { data: currentUser } = useCurrentUser();
  const { data: companies } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  const canReturnToFirm = canAccessNraCenter(currentUser);

  // Render when there's something to switch between, OR when an NRA-eligible
  // user is inside a client file and needs a way back to the firm workspace.
  if (!active || !companies || (companies.length <= 1 && !(canReturnToFirm && isFirmContext))) {
    return null;
  }

  const handleReturnToFirm = () => {
    if (!isFirmContext) return;
    clearActiveClientCompany();
    // Mirror the FirmContextBanner's "Back to Firm" action so both exits land
    // in the firm workspace rather than leaving the user on a client page.
    navigate("/firm/clients");
    toast({
      title: "Firm workspace",
      description: "Returned to the NRA firm workspace.",
    });
  };

  const handleSelect = async (companyId: string) => {
    if (companyId === active.id) return;
    try {
      await switchActiveCompany(companyId);
      const next = companies.find((c) => c.id === companyId);
      toast({
        title: "Company switched",
        description: next ? `Now viewing ${next.name}.` : "Active company updated.",
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Could not switch company",
        description: "Please try again.",
      });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-between h-8 text-xs font-medium"
          data-testid="button-company-switcher"
        >
          <span className="flex items-center gap-1.5 min-w-0">
            <Building2 className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{active.name}</span>
          </span>
          <ChevronsUpDown className="w-3 h-3 text-muted-foreground shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {canReturnToFirm && (
          <>
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
              NRA
            </DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={() => handleReturnToFirm()}
              disabled={!isFirmContext}
              className="flex items-center justify-between gap-2"
              data-testid="company-switcher-firm-workspace"
            >
              <span className="flex items-center gap-2 min-w-0">
                <Briefcase className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">Firm workspace</span>
              </span>
              {!isFirmContext && <Check className="w-3.5 h-3.5 text-primary" />}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Switch company
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {companies.map((c) => (
          <DropdownMenuItem
            key={c.id}
            onSelect={() => void handleSelect(c.id)}
            className="flex items-center justify-between gap-2"
            data-testid={`company-switcher-item-${c.id}`}
          >
            <span className="truncate">{c.name}</span>
            {c.id === active.id && <Check className="w-3.5 h-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
