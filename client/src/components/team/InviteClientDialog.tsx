import { T } from "@/components/layout/T";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Send } from "lucide-react";
import type { Company } from "@shared/schema";

interface InviteClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  emailError: string | null;
  onEmailChange: () => void;
  clients: Company[];
  selectedCompanyId: string;
  onCompanyChange: (companyId: string) => void;
  isPending: boolean;
}

/** Client invitation form; loaded on demand the first time the dialog is opened. */
export default function InviteClientDialog({
  open,
  onOpenChange,
  onSubmit,
  emailError,
  onEmailChange,
  clients,
  selectedCompanyId,
  onCompanyChange,
  isPending,
}: InviteClientDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <T k="pageLabels.sendClientInvitation" />
          </DialogTitle>
          <DialogDescription>
            <T k="portal.inviteDescription" />
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t["adminConsole.inviteEmail"]}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="client@example.com"
              required
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? "invite-email-error" : undefined}
              onChange={onEmailChange}
              data-testid="input-invite-email"
            />
            {emailError && (
              <p id="invite-email-error" role="alert" className="text-small text-danger">
                {emailError}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="company">{t["adminConsole.inviteAssignClient"]}</Label>
            <Select
              value={selectedCompanyId || "none"}
              onValueChange={(value) => onCompanyChange(value === "none" ? "" : value)}
            >
              <SelectTrigger data-testid="select-invite-company">
                <SelectValue placeholder={t["portal.inviteSelectCompany"]} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">
                  <T k="pageLabels.noCompanyAssigned" />
                </SelectItem>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              <T k="pageLabels.ifAssignedTheUserWillHave" />
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="userType">{t["adminConsole.inviteUserType"]}</Label>
            <Select name="userType" defaultValue="client">
              <SelectTrigger data-testid="select-invite-usertype">
                <SelectValue placeholder={t["portal.inviteSelectUserType"]} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="client">{t["adminConsole.userTypeClient"]}</SelectItem>
                <SelectItem value="customer">{t["adminConsole.userTypeCustomer"]}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t["firmOps.inviteUserTypeHint"]}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="role">
              <T k="pageLabels.accessLevel" />
            </Label>
            <Select name="role" defaultValue="client">
              <SelectTrigger data-testid="select-invite-role">
                <SelectValue placeholder={t["portal.inviteSelectAccess"]} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="client">{t["portal.invitations.roleStandard"]}</SelectItem>
                <SelectItem value="staff">{t["portal.invitations.roleStaff"]}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              <T k="pages.cancel" />
            </Button>
            <Button type="submit" disabled={isPending} data-testid="button-submit-invite">
              <Send className="w-4 h-4 me-2" />
              {isPending ? t["portal.inviteSending"] : t["pageLabels.sendInvitation"]}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
