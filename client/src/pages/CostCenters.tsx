import { PageHeader } from "@/components/ui/page-header";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Plus,
  Edit,
  Trash2,
  Search,
  Building2,
  TrendingUp,
  TrendingDown,
  DollarSign,
} from "lucide-react";
import { useSubscription } from "@/hooks/useSubscription";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";

// ─── Types ───────────────────────────────────────────────

interface CostCenter {
  id: string;
  companyId: string;
  code: string;
  name: string;
  description?: string | null;
  parentId?: string | null;
  isActive: boolean;
}

interface CostCenterReport {
  income: number;
  expenses: number;
  net: number;
}

// ─── Schemas ─────────────────────────────────────────────

const costCenterFormSchema = z.object({
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  parentId: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
});

type CostCenterFormData = z.infer<typeof costCenterFormSchema>;

// ─── Component ───────────────────────────────────────────

export default function CostCenters() {
  const { locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const { canAccess, getRequiredTier } = useSubscription();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCostCenter, setEditingCostCenter] = useState<CostCenter | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCostCenterId, setSelectedCostCenterId] = useState<string | null>(null);

  // ─── Queries ───────────────────────────────────────────

  const { data: costCenters = [], isLoading } = useQuery<CostCenter[]>({
    queryKey: [`/api/companies/${companyId}/cost-centers`],
    enabled: !!companyId,
  });

  const { data: report } = useQuery<CostCenterReport>({
    queryKey: [`/api/companies/${companyId}/cost-centers/${selectedCostCenterId}/report`],
    enabled: !!companyId && !!selectedCostCenterId,
  });

  // ─── Form ─────────────────────────────────────────────

  const form = useForm<CostCenterFormData>({
    resolver: zodResolver(costCenterFormSchema),
    defaultValues: {
      code: "",
      name: "",
      description: "",
      parentId: null,
      isActive: true,
    },
  });

  // ─── Mutations ────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (data: CostCenterFormData) =>
      apiRequest("POST", `/api/companies/${companyId}/cost-centers`, {
        ...data,
        parentId: data.parentId || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/cost-centers`] });
      toast({
        title: "Cost Center Created",
        description: "Cost center has been added successfully.",
      });
      setDialogOpen(false);
      form.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error?.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CostCenterFormData> }) =>
      apiRequest("PUT", `/api/cost-centers/${id}`, {
        ...data,
        parentId: data.parentId || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/cost-centers`] });
      toast({
        title: "Cost Center Updated",
        description: "Cost center details have been updated.",
      });
      setDialogOpen(false);
      setEditingCostCenter(null);
      form.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error?.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/cost-centers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/cost-centers`] });
      if (selectedCostCenterId) {
        setSelectedCostCenterId(null);
      }
      toast({ title: "Cost Center Deleted", description: "Cost center has been removed." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error?.message, variant: "destructive" });
    },
  });

  // ─── Handlers ─────────────────────────────────────────

  const handleOpenCreateDialog = () => {
    setEditingCostCenter(null);
    form.reset({
      code: "",
      name: "",
      description: "",
      parentId: null,
      isActive: true,
    });
    setDialogOpen(true);
  };

  const handleOpenEditDialog = (costCenter: CostCenter) => {
    setEditingCostCenter(costCenter);
    form.reset({
      code: costCenter.code,
      name: costCenter.name,
      description: costCenter.description || "",
      parentId: costCenter.parentId || null,
      isActive: costCenter.isActive,
    });
    setDialogOpen(true);
  };

  const handleSubmit = (data: CostCenterFormData) => {
    if (editingCostCenter) {
      updateMutation.mutate({ id: editingCostCenter.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  // ─── Helpers ──────────────────────────────────────────

  const getParentName = (parentId: string | null | undefined): string => {
    if (!parentId) return "-";
    const parent = costCenters.find((cc) => cc.id === parentId);
    return parent ? parent.name : "-";
  };

  const getAvailableParents = (): CostCenter[] => {
    if (!editingCostCenter) return costCenters;
    return costCenters.filter((cc) => cc.id !== editingCostCenter.id);
  };

  const filteredCostCenters = costCenters.filter((cc) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      cc.code.toLowerCase().includes(q) ||
      cc.name.toLowerCase().includes(q) ||
      (cc.description?.toLowerCase().includes(q) ?? false)
    );
  });

  const activeCount = costCenters.filter((cc) => cc.isActive).length;
  const inactiveCount = costCenters.filter((cc) => !cc.isActive).length;
  const selectedCostCenter = costCenters.find((cc) => cc.id === selectedCostCenterId);

  if (!canAccess("costCenters")) {
    return <UpgradePrompt feature="costCenters" requiredTier={getRequiredTier("costCenters")} />;
  }

  if (isLoadingCompany || isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        eyebrow="Accounting"
        title="Cost Centers"
        description="Manage cost centers for departmental accounting and P&L tracking"
        actions={
          <Button onClick={handleOpenCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            Add Cost Center
          </Button>
        }
      />

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cost Centers</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{costCenters.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{activeCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Inactive</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-500">{inactiveCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search cost centers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Parent</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCostCenters.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    {searchQuery
                      ? "No cost centers match your search"
                      : "No cost centers yet. Add your first cost center to get started."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredCostCenters.map((cc) => (
                  <TableRow
                    key={cc.id}
                    className={
                      selectedCostCenterId === cc.id
                        ? "bg-muted/50"
                        : "cursor-pointer hover:bg-muted/30"
                    }
                    onClick={() =>
                      setSelectedCostCenterId(cc.id === selectedCostCenterId ? null : cc.id)
                    }
                  >
                    <TableCell className="font-mono text-sm">{cc.code}</TableCell>
                    <TableCell className="font-medium">{cc.name}</TableCell>
                    <TableCell className="text-muted-foreground max-w-[200px] truncate">
                      {cc.description || "-"}
                    </TableCell>
                    <TableCell>{getParentName(cc.parentId)}</TableCell>
                    <TableCell>
                      {cc.isActive ? (
                        <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                          Active
                        </Badge>
                      ) : (
                        <Badge className="bg-gray-100 text-gray-800 hover:bg-gray-100">
                          Inactive
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenEditDialog(cc);
                          }}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (
                              window.confirm("Are you sure you want to delete this cost center?")
                            ) {
                              deleteMutation.mutate(cc.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Cost Center P&L Report */}
      {selectedCostCenter && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              P&L Summary — {selectedCostCenter.name} ({selectedCostCenter.code})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {report ? (
              <div className="grid gap-4 md:grid-cols-3">
                <Card className="bg-green-50 border-green-200">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-green-700">Income</CardTitle>
                    <TrendingUp className="h-4 w-4 text-green-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-700 font-mono">
                      {formatCurrency(report.income, "AED", locale)}
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-red-50 border-red-200">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-red-700">Expenses</CardTitle>
                    <TrendingDown className="h-4 w-4 text-red-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-red-700 font-mono">
                      {formatCurrency(report.expenses, "AED", locale)}
                    </div>
                  </CardContent>
                </Card>
                <Card
                  className={
                    report.net >= 0
                      ? "bg-blue-50 border-blue-200"
                      : "bg-orange-50 border-orange-200"
                  }
                >
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle
                      className={`text-sm font-medium ${report.net >= 0 ? "text-blue-700" : "text-orange-700"}`}
                    >
                      Net
                    </CardTitle>
                    <DollarSign
                      className={`h-4 w-4 ${report.net >= 0 ? "text-blue-600" : "text-orange-600"}`}
                    />
                  </CardHeader>
                  <CardContent>
                    <div
                      className={`text-2xl font-bold font-mono ${report.net >= 0 ? "text-blue-700" : "text-orange-700"}`}
                    >
                      {formatCurrency(report.net, "AED", locale)}
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                No report data available for this cost center.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingCostCenter ? "Edit Cost Center" : "Add Cost Center"}</DialogTitle>
            <DialogDescription>
              {editingCostCenter
                ? "Update cost center details below."
                : "Fill in the details to create a new cost center."}
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Code *</FormLabel>
                      <FormControl>
                        <Input placeholder="CC-001" {...field} />
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
                      <FormLabel>Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="Marketing" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Optional description for this cost center"
                        rows={3}
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
                name="parentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Parent Cost Center</FormLabel>
                    <Select
                      onValueChange={(value) => field.onChange(value === "_none" ? null : value)}
                      value={field.value || "_none"}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="None (top-level)" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="_none">None (top-level)</SelectItem>
                        {getAvailableParents().map((parent) => (
                          <SelectItem key={parent.id} value={parent.id}>
                            {parent.code} — {parent.name}
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
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel>Active</FormLabel>
                      <p className="text-sm text-muted-foreground">
                        Inactive cost centers cannot receive new transactions
                      </p>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {(createMutation.isPending || updateMutation.isPending) && (
                    <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  )}
                  {editingCostCenter ? "Update Cost Center" : "Add Cost Center"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
