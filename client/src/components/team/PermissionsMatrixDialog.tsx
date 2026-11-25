import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTranslation } from "@/lib/i18n";
import { COMPANY_ROLES, COMPANY_ROLE_LABELS, roleHasPermission, type Permission } from "@/lib/auth";
import { Check, X } from "lucide-react";

type Bilingual = { en: string; ar: string };

/** Shown in the permissions matrix; keys come from shared/permissions.ts. */
const PERMISSION_LABELS: Record<Permission, Bilingual> = {
  "reports.read": { en: "View records and reports", ar: "عرض السجلات والتقارير" },
  "documents.write": { en: "Create and edit documents", ar: "إنشاء المستندات وتعديلها" },
  "documents.approve": { en: "Approve documents", ar: "اعتماد المستندات" },
  "ledger.post": { en: "Post to the ledger", ar: "الترحيل إلى دفتر الأستاذ" },
  "payments.release": { en: "Release payments", ar: "إصدار المدفوعات" },
  "payroll.manage": { en: "Manage payroll", ar: "إدارة الرواتب" },
  "payroll.approve": { en: "Approve payroll", ar: "اعتماد الرواتب" },
  "tax.submit": { en: "Submit tax returns", ar: "تقديم الإقرارات الضريبية" },
  "settings.company": { en: "Company settings", ar: "إعدادات الشركة" },
  "company.delete": { en: "Delete the company", ar: "حذف الشركة" },
  "team.manage": { en: "Manage team members", ar: "إدارة أعضاء الفريق" },
  "billing.manage": { en: "Manage billing", ar: "إدارة الفوترة" },
  "backups.manage": { en: "Backups and restore", ar: "النسخ الاحتياطي والاستعادة" },
  "period.lock": { en: "Lock periods", ar: "إقفال الفترات" },
  "period.unlock": { en: "Unlock periods", ar: "فتح الفترات المقفلة" },
};

/** Role-by-permission matrix; loaded on demand the first time the dialog is opened. */
export default function PermissionsMatrixDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, locale } = useTranslation();
  const tr = (b: Bilingual) => (locale === "ar" ? b.ar : b.en);
  const roleLabel = (role: (typeof COMPANY_ROLES)[number]) =>
    tr(COMPANY_ROLE_LABELS[role] ?? COMPANY_ROLE_LABELS.employee);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t["pages.teamPermissionsMatrix"]}</DialogTitle>
          <DialogDescription>{t["pages.teamAvailablePermissionsForEachRole"]}</DialogDescription>
        </DialogHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{locale === "ar" ? "الصلاحية" : "Permission"}</TableHead>
                {COMPANY_ROLES.map((role) => (
                  <TableHead key={role} className="text-center">
                    {roleLabel(role)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(Object.keys(PERMISSION_LABELS) as Permission[]).map((permission) => (
                <TableRow key={permission}>
                  <TableCell className="font-medium">{tr(PERMISSION_LABELS[permission])}</TableCell>
                  {COMPANY_ROLES.map((role) => (
                    <TableCell key={role} className="text-center">
                      {roleHasPermission(role, permission) ? (
                        <Check className="w-4 h-4 mx-auto text-success" />
                      ) : (
                        <X className="w-4 h-4 mx-auto text-muted-foreground" />
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {locale === "ar" ? "إغلاق" : "Close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
