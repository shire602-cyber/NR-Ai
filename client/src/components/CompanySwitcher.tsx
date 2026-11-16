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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { switchActiveCompany } from "@/lib/activeCompany";
import { useToast } from "@/hooks/use-toast";
import { useActiveCompany } from "@/components/ActiveCompanyProvider";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { canAccessNraCenter } from "@shared/access";
import { useTranslation } from "@/lib/i18n";

/**
 * Switch which company the rest of the UI is scoped to. Hidden when the
 * user has 0 or 1 companies — there's nothing to switch between.
 *
 * Switching invalidates the entire query cache via `switchActiveCompany`
 * so previously-loaded panels (invoices, receipts, dashboards) re-fetch
 * for the new tenant instead of showing stale data.
 */
export function CompanySwitcher({
  variant = "sidebar",
}: {
  /** sidebar: full-width outline button. compact: the mobile top-bar company name button. */
  variant?: "sidebar" | "compact";
} = {}) {
  const { toast } = useToast();
  const { t } = useTranslation();
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
  const canSwitch = Boolean(
    active && companies && (companies.length > 1 || (canReturnToFirm && isFirmContext))
  );
  if (!active || !companies) return null;
  if (!canSwitch) {
    // Nothing to switch between: the compact top bar still shows which company this is.
    return variant === "compact" ? (
      <span
        className="min-w-0 truncate text-sm font-semibold text-foreground"
        dir="auto"
        data-testid="text-active-company"
      >
        {active.name}
      </span>
    ) : null;
  }

  const handleReturnToFirm = () => {
    if (!isFirmContext) return;
    clearActiveClientCompany();
    // Mirror the FirmContextBanner's "Back to Firm" action so both exits land
    // in the firm workspace rather than leaving the user on a client page.
    navigate("/firm/clients");
    toast({
      title: t["components.switcherFirmWorkspace"],
      description: t["components.switcherReturnedToFirm"],
    });
  };

  const handleSelect = async (companyId: string) => {
    if (companyId === active.id) return;
    try {
      await switchActiveCompany(companyId);
      const next = companies.find((c) => c.id === companyId);
      toast({
        title: t["components.switcherSwitchedTitle"],
        description: next
          ? t["components.switcherNowViewing"].replace("{name}", next.name)
          : t["components.switcherUpdated"],
      });
    } catch {
      toast({
        variant: "destructive",
        title: t["components.switcherFailedTitle"],
        description: t["components.switcherTryAgain"],
      });
    }
  };

  const compact = variant === "compact";
  const trigger = compact ? (
    <Button
      variant="ghost"
      size="sm"
      className="h-9 min-w-0 max-w-full justify-start gap-1 px-1.5 text-sm font-semibold text-foreground"
      aria-label={`${t["components.switcherSwitchCompany"]}: ${active.name}`}
      data-testid="button-company-switcher-compact"
    >
      <span className="truncate" dir="auto">
        {active.name}
      </span>
      <ChevronsUpDown className="!size-3.5 shrink-0 text-muted-foreground" aria-hidden />
    </Button>
  ) : (
    <Button
      variant="outline"
      size="sm"
      className="h-10 w-full justify-between gap-2 px-2 text-small font-medium"
      data-testid="button-company-switcher"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-secondary text-caption font-semibold text-secondary-foreground"
        >
          {active.name.trim().charAt(0).toUpperCase() || <Building2 className="!size-3.5" />}
        </span>
        <span className="truncate" dir="auto">
          {active.name}
        </span>
      </span>
      <ChevronsUpDown className="!size-3.5 shrink-0 text-muted-foreground" aria-hidden />
    </Button>
  );

  return (
    <DropdownMenu>
      {compact ? (
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      ) : (
        // The sidebar truncates long names, so the full name is one hover away (CTO 12).
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start">
            <span dir="auto">{active.name}</span>
          </TooltipContent>
        </Tooltip>
      )}
      <DropdownMenuContent
        align="start"
        className={cn(
          "min-w-64",
          compact ? "max-w-[calc(100vw-2rem)]" : "w-[var(--radix-dropdown-menu-trigger-width)]"
        )}
      >
        {canReturnToFirm && (
          <>
            <DropdownMenuLabel>NRA</DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={() => handleReturnToFirm()}
              disabled={!isFirmContext}
              className="flex items-center justify-between gap-2"
              data-testid="company-switcher-firm-workspace"
            >
              <span className="flex items-center gap-2 min-w-0">
                <Briefcase className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{t["components.switcherFirmWorkspace"]}</span>
              </span>
              {!isFirmContext && <Check className="w-3.5 h-3.5 text-primary" />}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel>{t["components.switcherSwitchCompany"]}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {companies.map((c) => (
          <DropdownMenuItem
            key={c.id}
            onSelect={() => void handleSelect(c.id)}
            className="flex items-center justify-between gap-2"
            data-testid={`company-switcher-item-${c.id}`}
          >
            <span className="truncate" dir="auto">
              {c.name}
            </span>
            {c.id === active.id && <Check className="w-3.5 h-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
