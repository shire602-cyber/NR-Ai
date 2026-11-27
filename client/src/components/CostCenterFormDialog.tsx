import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { T } from "@/components/layout/T";
import {
  FormActions,
  FormErrorSummary,
  FormGrid,
  FormSection,
  formSpanFull,
} from "@/components/ui/form-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "@/lib/i18n";
import { zodResolver } from "@/lib/zod-resolver";
import { costCenterDisplayName } from "@/lib/cost-center-view";

export interface CostCenter {
  id: string;
  companyId: string;
  code: string;
  name: string;
  nameAr?: string | null;
  type?: "cost_centre" | "project" | "job";
  description?: string | null;
  parentId?: string | null;
  isActive: boolean;
}

const costCenterFormSchema = z.object({
  code: z.string().min(1, "forms.errors.codeRequired"),
  name: z.string().min(1, "forms.errors.nameRequired"),
  nameAr: z.string().optional().nullable(),
  type: z.enum(["cost_centre", "project", "job"]).default("cost_centre"),
  description: z.string().optional(),
  parentId: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
});

export type CostCenterFormData = z.infer<typeof costCenterFormSchema>;

const emptyValues: CostCenterFormData = {
  code: "",
  name: "",
  nameAr: "",
  type: "cost_centre",
  description: "",
  parentId: null,
  isActive: true,
};

/** Create/edit cost-center form; the page loads it on the first open. */
export function CostCenterFormDialog({
  open,
  onOpenChange,
  editing,
  parents,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: CostCenter | null;
  parents: CostCenter[];
  pending: boolean;
  onSubmit: (data: CostCenterFormData) => void;
}) {
  const { t, locale } = useTranslation();
  const form = useForm<CostCenterFormData>({
    resolver: zodResolver(costCenterFormSchema),
    defaultValues: emptyValues,
  });

  // Fresh values each time the dialog opens: the row being edited, or an empty form.
  useEffect(() => {
    if (!open) return;
    form.reset(
      editing
        ? {
            code: editing.code,
            name: editing.name,
            nameAr: editing.nameAr || "",
            type: editing.type ?? "cost_centre",
            description: editing.description || "",
            parentId: editing.parentId || null,
            isActive: editing.isActive,
          }
        : emptyValues
    );
  }, [open, editing, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="dialog-cost-center-form">
        <DialogHeader>
          <DialogTitle>
            {editing ? t["costCenters.editCostCenter"] : t["pageLabels.addCostCenter"]}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? t["costCenters.costCenterDialogEditDesc"]
              : t["costCenters.costCenterDialogNewDesc"]}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
            <FormErrorSummary />
            <FormSection title={t["forms.section.costCenter"]}>
              <FormGrid>
                <FormField
                  control={form.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t["costCenters.ccCode"]}</FormLabel>
                      <FormControl>
                        <Input ltr placeholder="CC-001" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t["costCenters.ccName"]}</FormLabel>
                      <FormControl>
                        <Input dir="auto" placeholder={t["costCenters.cc2Marketing"]} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="nameAr"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t["costCenters.ccNameAr"]}</FormLabel>
                      <FormControl>
                        <Input dir="rtl" {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t["costCenters.ccType"]}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? "cost_centre"}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="cost_centre">
                            {t["costCenters.ccTypeCostCentre"]}
                          </SelectItem>
                          <SelectItem value="project">{t["costCenters.ccTypeProject"]}</SelectItem>
                          <SelectItem value="job">{t["costCenters.ccTypeJob"]}</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="parentId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <T k="pageLabels.parentCostCenter" />
                      </FormLabel>
                      <Select
                        onValueChange={(value) => field.onChange(value === "_none" ? null : value)}
                        value={field.value || "_none"}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t["costCenters.cc2NoneTopLevel"]} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="_none">{t["costCenters.cc2NoneTopLevel"]}</SelectItem>
                          {parents
                            .filter((cc) => cc.id !== editing?.id)
                            .map((parent) => (
                              <SelectItem key={parent.id} value={parent.id}>
                                {parent.code} — {costCenterDisplayName(parent, locale)}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem className={formSpanFull}>
                      <FormLabel>
                        <T k="pages.description" />
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder={t["costCenters.cc2OptionalDescriptionForThisCostCenter"]}
                          rows={2}
                          {...field}
                          value={field.value || ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-full flex items-center justify-between gap-4 space-y-0 rounded-lg bg-surface-sunken/60 p-4">
                      <div className="space-y-0.5">
                        <FormLabel>
                          <T k="pages.active" />
                        </FormLabel>
                        <p className="text-caption text-muted-foreground">
                          <T k="pageLabels.inactiveCostCentersCannotReceiveNewTransactions" />
                        </p>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </FormGrid>
            </FormSection>

            <FormActions sticky>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                <T k="pages.cancel" />
              </Button>
              <Button type="submit" className="sm:min-w-32" disabled={pending}>
                {pending
                  ? t["forms.saving"]
                  : editing
                    ? t["forms.costCenter.update"]
                    : t["pageLabels.addCostCenter"]}
              </Button>
            </FormActions>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
