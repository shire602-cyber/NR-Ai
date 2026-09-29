import { PageHeader } from "@/components/ui/page-header";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useSubscription } from "@/hooks/useSubscription";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, Layout, Loader2, Check, Trash2, Edit, Star } from "lucide-react";
import { messages as pageMessages } from "./InvoiceTemplates.i18n";

const templateSchema = z.object({
  name: z.string().min(1, pageMessages.marker("templateNameIsRequired")),
  primaryColor: z.string().default("#1a56db"),
  accentColor: z.string().default("#e5edff"),
  layout: z.enum(["standard", "modern", "minimal"]).default("standard"),
  headerText: z.string().optional(),
  footerText: z.string().optional(),
  showLogo: z.boolean().default(true),
  showStamp: z.boolean().default(false),
});

type TemplateFormData = z.infer<typeof templateSchema>;

interface InvoiceTemplate {
  id: string;
  companyId: string;
  name: string;
  primaryColor: string;
  accentColor: string;
  layout: string;
  headerText?: string;
  footerText?: string;
  showLogo: boolean;
  showStamp: boolean;
  isDefault: boolean;
}

export default function InvoiceTemplates() {
  const tr = pageMessages.useT();

  const { toast } = useToast();
  const { company, companyId: selectedCompanyId } = useDefaultCompany();
  const { canAccess, getRequiredTier, isLoading: subLoading } = useSubscription();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<InvoiceTemplate | null>(null);

  const { data: templates, isLoading } = useQuery<InvoiceTemplate[]>({
    queryKey: ["/api/companies", selectedCompanyId, "invoice-templates"],
    enabled: !!selectedCompanyId,
  });

  const form = useForm<TemplateFormData>({
    resolver: zodResolver(templateSchema),
    defaultValues: {
      name: "",
      primaryColor: "#1a56db",
      accentColor: "#e5edff",
      layout: "standard",
      headerText: "",
      footerText: "",
      showLogo: true,
      showStamp: false,
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: TemplateFormData) =>
      apiRequest("POST", `/api/companies/${selectedCompanyId}/invoice-templates`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "invoice-templates"],
      });
      toast({
        title: tr("templateCreated"),
        description: tr("yourInvoiceTemplateHasBeenCreated"),
      });
      setDialogOpen(false);
      setEditingTemplate(null);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToCreateTemplate"),
        description: error?.message || tr("pleaseTryAgain"),
      });
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: TemplateFormData }) =>
      apiRequest("PUT", `/api/invoice-templates/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "invoice-templates"],
      });
      toast({
        title: tr("templateUpdated"),
        description: tr("yourInvoiceTemplateHasBeenUpdated"),
      });
      setDialogOpen(false);
      setEditingTemplate(null);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToUpdateTemplate"),
        description: error?.message || tr("pleaseTryAgain"),
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/invoice-templates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "invoice-templates"],
      });
      toast({ title: tr("templateDeleted"), description: tr("theTemplateHasBeenDeleted") });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToDeleteTemplate"),
        description: error?.message || tr("pleaseTryAgain"),
      });
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/invoice-templates/${id}/set-default`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "invoice-templates"],
      });
      toast({
        title: tr("defaultTemplateSet"),
        description: tr("thisTemplateWillBeUsedFor"),
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToSetDefault"),
        description: error?.message || tr("pleaseTryAgain"),
      });
    },
  });

  const resetForm = () => {
    form.reset({
      name: "",
      primaryColor: "#1a56db",
      accentColor: "#e5edff",
      layout: "standard",
      headerText: "",
      footerText: "",
      showLogo: true,
      showStamp: false,
    });
    setEditingTemplate(null);
  };

  const handleEditTemplate = (template: InvoiceTemplate) => {
    setEditingTemplate(template);
    form.reset({
      name: template.name,
      primaryColor: template.primaryColor || "#1a56db",
      accentColor: template.accentColor || "#e5edff",
      layout: template.layout as "standard" | "modern" | "minimal",
      headerText: template.headerText || "",
      footerText: template.footerText || "",
      showLogo: template.showLogo ?? true,
      showStamp: template.showStamp ?? false,
    });
    setDialogOpen(true);
  };

  const onSubmit = (data: TemplateFormData) => {
    if (editingTemplate) {
      editMutation.mutate({ id: editingTemplate.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const getLayoutLabel = (layout: string) => {
    switch (layout) {
      case "standard":
        return tr("standard");
      case "modern":
        return tr("modern");
      case "minimal":
        return tr("minimal");
      default:
        return layout;
    }
  };

  if (subLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!canAccess("invoiceTemplates")) {
    return (
      <div className="max-w-2xl mx-auto mt-16">
        <UpgradePrompt
          feature="invoiceTemplates"
          requiredTier={getRequiredTier("invoiceTemplates")}
          description={tr("customizeYourInvoiceAppearanceWithProfessional")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={tr("sales")}
        title={tr("invoiceTemplates")}
        description={tr("customizeTheLookAndFeelOf")}
      />

      <div className="flex items-center justify-end flex-wrap gap-4">
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 me-2" />
              {tr("createTemplate")}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingTemplate ? tr("editTemplate") : tr("createTemplate")}
              </DialogTitle>
              <DialogDescription>
                {editingTemplate
                  ? tr("updateYourInvoiceTemplateSettings")
                  : tr("designANewInvoiceTemplateWith")}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("templateName")}</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder={tr("eGProfessionalBlue")} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="primaryColor"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{tr("primaryColor")}</FormLabel>
                        <FormControl>
                          <div className="flex gap-2">
                            <Input
                              type="color"
                              {...field}
                              className="w-12 h-10 p-1 cursor-pointer"
                            />
                            <Input
                              value={field.value}
                              onChange={field.onChange}
                              className="font-mono flex-1"
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="accentColor"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{tr("accentColor")}</FormLabel>
                        <FormControl>
                          <div className="flex gap-2">
                            <Input
                              type="color"
                              {...field}
                              className="w-12 h-10 p-1 cursor-pointer"
                            />
                            <Input
                              value={field.value}
                              onChange={field.onChange}
                              className="font-mono flex-1"
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="layout"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("layout")}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={tr("selectALayout")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="standard">
                            {tr("standardCleanTraditionalLayout")}
                          </SelectItem>
                          <SelectItem value="modern">
                            {tr("modernSleekDesignWithAccentColors")}
                          </SelectItem>
                          <SelectItem value="minimal">
                            {tr("minimalSimpleAndDistractionFree")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="headerText"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("headerText")}</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder={tr("optionalCustomHeaderEGTax")} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="footerText"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("footerText")}</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder={tr("optionalFooterNoteEGPayment")}
                          rows={3}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="showLogo"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">{tr("showCompanyLogo")}</FormLabel>
                        <FormDescription>{tr("displayYourCompanyLogoOnThe")}</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="showStamp"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">{tr("showCompanyStamp")}</FormLabel>
                        <FormDescription>{tr("displayACompanyStampOrSeal")}</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <div className="flex gap-3 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDialogOpen(false)}
                    className="flex-1"
                  >
                    {tr("cancel")}
                  </Button>
                  <Button
                    type="submit"
                    disabled={createMutation.isPending || editMutation.isPending}
                    className="flex-1"
                  >
                    {createMutation.isPending || editMutation.isPending ? tr("saving") : tr("save")}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {templates && templates.length > 0 ? (
            templates.map((template) => (
              <Card
                key={template.id}
                className={`relative transition-all duration-200 hover:-translate-y-1 hover:shadow-lg ${
                  template.isDefault ? "border-primary ring-2 ring-primary/20" : ""
                }`}
              >
                {template.isDefault && (
                  <div className="absolute top-2 end-2">
                    <Badge className="bg-primary">
                      <Check className="w-3 h-3 me-1" />
                      {tr("default")}
                    </Badge>
                  </div>
                )}
                <CardHeader>
                  <div
                    className="w-full h-32 rounded-md flex items-center justify-center mb-2 relative overflow-hidden"
                    style={{ backgroundColor: template.accentColor || "#e5edff" }}
                  >
                    <div
                      className="absolute top-0 start-0 w-full h-2"
                      style={{ backgroundColor: template.primaryColor || "#1a56db" }}
                    />
                    <Layout
                      className="w-12 h-12"
                      style={{ color: template.primaryColor || "#1a56db" }}
                    />
                    <Badge variant="outline" className="absolute bottom-2 end-2 text-xs capitalize">
                      {getLayoutLabel(template.layout)}
                    </Badge>
                  </div>
                  <CardTitle className="text-base">{template.name}</CardTitle>
                  <CardDescription className="text-xs">
                    {template.headerText ||
                      tr("layoutTemplate", { getLayoutLabel: getLayoutLabel(template.layout) })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex gap-2">
                    {!template.isDefault && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => setDefaultMutation.mutate(template.id)}
                        disabled={setDefaultMutation.isPending}
                      >
                        <Star className="w-3 h-3 me-1" />
                        {tr("setDefault")}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEditTemplate(template)}
                    >
                      <Edit className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (window.confirm(tr("areYouSureYouWantTo"))) {
                          deleteMutation.mutate(template.id);
                        }
                      }}
                      disabled={template.isDefault || deleteMutation.isPending}
                    >
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : (
            <Card className="col-span-full">
              <CardContent className="text-center py-12 text-muted-foreground">
                <Layout className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>{tr("noTemplatesYetCreateYourFirst")}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
