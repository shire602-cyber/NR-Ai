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

const templateSchema = z.object({
  name: z.string().min(1, "Template name is required"),
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
        title: "Template created",
        description: "Your invoice template has been created successfully.",
      });
      setDialogOpen(false);
      setEditingTemplate(null);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to create template",
        description: error?.message || "Please try again.",
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
        title: "Template updated",
        description: "Your invoice template has been updated successfully.",
      });
      setDialogOpen(false);
      setEditingTemplate(null);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to update template",
        description: error?.message || "Please try again.",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/invoice-templates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "invoice-templates"],
      });
      toast({ title: "Template deleted", description: "The template has been deleted." });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to delete template",
        description: error?.message || "Please try again.",
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
        title: "Default template set",
        description: "This template will be used for new invoices.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to set default",
        description: error?.message || "Please try again.",
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
        return "Standard";
      case "modern":
        return "Modern";
      case "minimal":
        return "Minimal";
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
          description="Customize your invoice appearance with professional templates. Add your branding, colors, and layout preferences."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title="Invoice Templates"
        description="Customize the look and feel of your invoices"
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
              <Plus className="w-4 h-4 mr-2" />
              Create Template
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingTemplate ? "Edit Template" : "Create Template"}</DialogTitle>
              <DialogDescription>
                {editingTemplate
                  ? "Update your invoice template settings"
                  : "Design a new invoice template with custom branding"}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Template Name</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g., Professional Blue" />
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
                        <FormLabel>Primary Color</FormLabel>
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
                        <FormLabel>Accent Color</FormLabel>
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
                      <FormLabel>Layout</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a layout" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="standard">
                            Standard - Clean, traditional layout
                          </SelectItem>
                          <SelectItem value="modern">
                            Modern - Sleek design with accent colors
                          </SelectItem>
                          <SelectItem value="minimal">
                            Minimal - Simple and distraction-free
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
                      <FormLabel>Header Text</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="Optional custom header (e.g., Tax Invoice)"
                        />
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
                      <FormLabel>Footer Text</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="Optional footer note (e.g., payment terms, thank you message)"
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
                        <FormLabel className="text-base">Show Company Logo</FormLabel>
                        <FormDescription>Display your company logo on the invoice</FormDescription>
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
                        <FormLabel className="text-base">Show Company Stamp</FormLabel>
                        <FormDescription>
                          Display a company stamp or seal on the invoice
                        </FormDescription>
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
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={createMutation.isPending || editMutation.isPending}
                    className="flex-1"
                  >
                    {createMutation.isPending || editMutation.isPending ? "Saving..." : "Save"}
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
                  <div className="absolute top-2 right-2">
                    <Badge className="bg-primary">
                      <Check className="w-3 h-3 mr-1" />
                      Default
                    </Badge>
                  </div>
                )}
                <CardHeader>
                  <div
                    className="w-full h-32 rounded-md flex items-center justify-center mb-2 relative overflow-hidden"
                    style={{ backgroundColor: template.accentColor || "#e5edff" }}
                  >
                    <div
                      className="absolute top-0 left-0 w-full h-2"
                      style={{ backgroundColor: template.primaryColor || "#1a56db" }}
                    />
                    <Layout
                      className="w-12 h-12"
                      style={{ color: template.primaryColor || "#1a56db" }}
                    />
                    <Badge
                      variant="outline"
                      className="absolute bottom-2 right-2 text-xs capitalize"
                    >
                      {getLayoutLabel(template.layout)}
                    </Badge>
                  </div>
                  <CardTitle className="text-base">{template.name}</CardTitle>
                  <CardDescription className="text-xs">
                    {template.headerText || `${getLayoutLabel(template.layout)} layout template`}
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
                        <Star className="w-3 h-3 mr-1" />
                        Set Default
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
                        if (window.confirm("Are you sure you want to delete this template?")) {
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
                <p>No templates yet. Create your first template to customize your invoices.</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
