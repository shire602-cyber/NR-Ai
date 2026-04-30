import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import {
  Building2,
  Plus,
  Edit,
  Trash2,
  Calculator,
  Ban,
  DollarSign,
  TrendingDown,
  BarChart3,
  PlayCircle,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { TableSkeleton, StatCardSkeleton } from '@/components/ui/loading-skeletons';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/lib/i18n';
import { useToast } from '@/hooks/use-toast';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { formatCurrency } from '@/lib/format';

// ─── Types ───────────────────────────────────────────────

interface FixedAsset {
  id: string;
  company_id: string;
  asset_name: string;
  asset_name_ar: string | null;
  asset_number: string | null;
  category: string;
  purchase_date: string;
  purchase_cost: string;
  salvage_value: string;
  useful_life_years: number;
  depreciation_method: string;
  accumulated_depreciation: string;
  net_book_value: string;
  location: string | null;
  serial_number: string | null;
  status: string;
  disposal_date: string | null;
  disposal_amount: string | null;
  notes: string | null;
  created_at: string;
}

interface AssetSummary {
  totalAssets: number;
  totalCost: number;
  totalAccumulatedDepreciation: number;
  totalNetBookValue: number;
  byCategory: {
    category: string;
    count: number;
    totalCost: number;
    totalAccumulatedDepreciation: number;
    totalNetBookValue: number;
  }[];
}

// ─── Schemas ─────────────────────────────────────────────

const CATEGORIES = ['Vehicles', 'Furniture', 'Equipment', 'Electronics', 'Building', 'Land', 'Other'] as const;

const assetFormSchema = z.object({
  assetName: z.string().min(1, 'Asset name is required'),
  assetNameAr: z.string().optional().nullable(),
  assetNumber: z.string().optional().nullable(),
  category: z.string().min(1, 'Category is required'),
  purchaseDate: z.string().min(1, 'Purchase date is required'),
  purchaseCost: z.coerce.number().min(0, 'Purchase cost must be >= 0'),
  salvageValue: z.coerce.number().min(0, 'Salvage value must be >= 0').optional().nullable(),
  usefulLifeYears: z.coerce.number().int().min(1, 'Useful life must be at least 1 year'),
  depreciationMethod: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  serialNumber: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

type AssetFormData = z.infer<typeof assetFormSchema>;

const disposeFormSchema = z.object({
  disposalDate: z.string().min(1, 'Disposal date is required'),
  disposalAmount: z.coerce.number().min(0, 'Disposal amount must be >= 0'),
  notes: z.string().optional().nullable(),
});

type DisposeFormData = z.infer<typeof disposeFormSchema>;

const depreciationRunSchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
});

type DepreciationRunData = z.infer<typeof depreciationRunSchema>;

// ─── Component ───────────────────────────────────────────

export default function FixedAssets() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();

  const [assetDialogOpen, setAssetDialogOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<FixedAsset | null>(null);
  const [disposeDialogOpen, setDisposeDialogOpen] = useState(false);
  const [disposingAsset, setDisposingAsset] = useState<FixedAsset | null>(null);
  const [depRunDialogOpen, setDepRunDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [assetToDelete, setAssetToDelete] = useState<string | null>(null);

  // ─── Queries ────────────────────────────────────────────

  const { data: assets = [], isLoading: isLoadingAssets } = useQuery<FixedAsset[]>({
    queryKey: [`/api/companies/${companyId}/fixed-assets`],
    enabled: !!companyId,
  });

  const { data: summary } = useQuery<AssetSummary>({
    queryKey: [`/api/companies/${companyId}/fixed-assets/summary`],
    enabled: !!companyId,
  });

  // ─── Forms ──────────────────────────────────────────────

  const assetForm = useForm<AssetFormData>({
    resolver: zodResolver(assetFormSchema),
    defaultValues: {
      assetName: '',
      assetNameAr: '',
      assetNumber: '',
      category: '',
      purchaseDate: '',
      purchaseCost: 0,
      salvageValue: 0,
      usefulLifeYears: 5,
      depreciationMethod: 'straight_line',
      location: '',
      serialNumber: '',
      notes: '',
    },
  });

  const disposeForm = useForm<DisposeFormData>({
    resolver: zodResolver(disposeFormSchema),
    defaultValues: {
      disposalDate: '',
      disposalAmount: 0,
      notes: '',
    },
  });

  const depRunForm = useForm<DepreciationRunData>({
    resolver: zodResolver(depreciationRunSchema),
    defaultValues: {
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear(),
    },
  });

  // ─── Mutations ──────────────────────────────────────────

  const createAssetMutation = useMutation({
    mutationFn: (data: AssetFormData) =>
      apiRequest('POST', `/api/companies/${companyId}/fixed-assets`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/fixed-assets`] });
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/fixed-assets/summary`] });
      toast({ title: 'Asset Created', description: 'The fixed asset has been added successfully.' });
      setAssetDialogOpen(false);
      assetForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const updateAssetMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<AssetFormData> }) =>
      apiRequest('PATCH', `/api/fixed-assets/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/fixed-assets`] });
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/fixed-assets/summary`] });
      toast({ title: 'Asset Updated', description: 'The fixed asset has been updated successfully.' });
      setAssetDialogOpen(false);
      setEditingAsset(null);
      assetForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const deleteAssetMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/fixed-assets/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/fixed-assets`] });
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/fixed-assets/summary`] });
      toast({ title: 'Asset Deleted', description: 'The fixed asset has been deleted.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const depreciateMutation = useMutation({
    mutationFn: (id: string) => apiRequest('POST', `/api/fixed-assets/${id}/depreciate`, {}),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/fixed-assets`] });
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/fixed-assets/summary`] });
      toast({
        title: 'Depreciation Recorded',
        description: `Monthly depreciation of ${formatCurrency(data.monthlyDepreciation, 'AED', locale)} recorded.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const disposeMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: DisposeFormData }) =>
      apiRequest('POST', `/api/fixed-assets/${id}/dispose`, data),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/fixed-assets`] });
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/fixed-assets/summary`] });
      const glType = data.gainLossType === 'gain' ? 'Gain' : 'Loss';
      toast({
        title: 'Asset Disposed',
        description: `${glType} on disposal: ${formatCurrency(Math.abs(data.gainLoss), 'AED', locale)}`,
      });
      setDisposeDialogOpen(false);
      setDisposingAsset(null);
      disposeForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const runDepreciationMutation = useMutation({
    mutationFn: (data: DepreciationRunData) =>
      apiRequest('POST', `/api/companies/${companyId}/fixed-assets/run-depreciation`, data),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/fixed-assets`] });
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/fixed-assets/summary`] });
      toast({
        title: 'Batch Depreciation Complete',
        description: `Processed ${data.assetsProcessed} assets for ${data.month}/${data.year}.`,
      });
      setDepRunDialogOpen(false);
      depRunForm.reset({ month: new Date().getMonth() + 1, year: new Date().getFullYear() });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  // ─── Handlers ───────────────────────────────────────────

  const handleOpenCreateDialog = () => {
    setEditingAsset(null);
    assetForm.reset({
      assetName: '',
      assetNameAr: '',
      assetNumber: '',
      category: '',
      purchaseDate: '',
      purchaseCost: 0,
      salvageValue: 0,
      usefulLifeYears: 5,
      depreciationMethod: 'straight_line',
      location: '',
      serialNumber: '',
      notes: '',
    });
    setAssetDialogOpen(true);
  };

  const handleOpenEditDialog = (asset: FixedAsset) => {
    setEditingAsset(asset);
    assetForm.reset({
      assetName: asset.asset_name,
      assetNameAr: asset.asset_name_ar || '',
      assetNumber: asset.asset_number || '',
      category: asset.category,
      purchaseDate: asset.purchase_date ? format(new Date(asset.purchase_date), 'yyyy-MM-dd') : '',
      purchaseCost: parseFloat(asset.purchase_cost),
      salvageValue: parseFloat(asset.salvage_value || '0'),
      usefulLifeYears: asset.useful_life_years,
      depreciationMethod: asset.depreciation_method || 'straight_line',
      location: asset.location || '',
      serialNumber: asset.serial_number || '',
      notes: asset.notes || '',
    });
    setAssetDialogOpen(true);
  };

  const handleOpenDisposeDialog = (asset: FixedAsset) => {
    setDisposingAsset(asset);
    disposeForm.reset({
      disposalDate: format(new Date(), 'yyyy-MM-dd'),
      disposalAmount: 0,
      notes: '',
    });
    setDisposeDialogOpen(true);
  };

  const handleAssetSubmit = (data: AssetFormData) => {
    if (editingAsset) {
      updateAssetMutation.mutate({ id: editingAsset.id, data });
    } else {
      createAssetMutation.mutate(data);
    }
  };

  const handleDisposeSubmit = (data: DisposeFormData) => {
    if (!disposingAsset) return;
    disposeMutation.mutate({ id: disposingAsset.id, data });
  };

  const handleDepRunSubmit = (data: DepreciationRunData) => {
    runDepreciationMutation.mutate(data);
  };

  // ─── Helpers ────────────────────────────────────────────

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <StatusBadge tone="success">Active</StatusBadge>;
      case 'disposed':
        return <StatusBadge tone="danger">Disposed</StatusBadge>;
      case 'fully_depreciated':
        return <StatusBadge tone="warning">Fully Depreciated</StatusBadge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const filteredAssets = assets.filter(asset => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      asset.asset_name.toLowerCase().includes(q) ||
      asset.category.toLowerCase().includes(q) ||
      (asset.asset_number && asset.asset_number.toLowerCase().includes(q)) ||
      (asset.serial_number && asset.serial_number.toLowerCase().includes(q)) ||
      (asset.asset_name_ar && asset.asset_name_ar.includes(q))
    );
  });

  // ─── Loading State ─────────────────────────────────────

  if (isLoadingCompany) {
    return (
      <div className="space-y-6">
        <StatCardSkeleton count={3} />
        <Card>
          <CardContent className="pt-6">
            <TableSkeleton rows={5} columns={7} />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!companyId) {
    return (
      <EmptyState
        icon={Building2}
        title="No company selected"
        description="Create or select a company before tracking fixed assets."
      />
    );
  }

  // ─── Render ─────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Building2 className="w-8 h-8" />
            Fixed Assets
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage fixed assets, depreciation, and disposals
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setDepRunDialogOpen(true)} className="flex items-center gap-2">
            <PlayCircle className="w-4 h-4" />
            Run Depreciation
          </Button>
          <Button onClick={handleOpenCreateDialog} className="flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Add Asset
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(summary.totalCost, 'AED', locale)}</div>
              <p className="text-xs text-muted-foreground">{summary.totalAssets} active asset{summary.totalAssets !== 1 ? 's' : ''}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Accumulated Depreciation</CardTitle>
              <TrendingDown className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(summary.totalAccumulatedDepreciation, 'AED', locale)}</div>
              <p className="text-xs text-muted-foreground">
                {summary.totalCost > 0
                  ? `${((summary.totalAccumulatedDepreciation / summary.totalCost) * 100).toFixed(1)}% depreciated`
                  : '0% depreciated'}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Net Book Value</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(summary.totalNetBookValue, 'AED', locale)}</div>
              <p className="text-xs text-muted-foreground">Current carrying value</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Category Breakdown */}
      {summary && summary.byCategory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Asset Category Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">Total Cost</TableHead>
                    <TableHead className="text-right">Accum. Depreciation</TableHead>
                    <TableHead className="text-right">Net Book Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.byCategory.map((cat) => (
                    <TableRow key={cat.category}>
                      <TableCell className="font-medium">{cat.category}</TableCell>
                      <TableCell className="text-right">{cat.count}</TableCell>
                      <TableCell className="text-right">{formatCurrency(cat.totalCost, 'AED', locale)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(cat.totalAccumulatedDepreciation, 'AED', locale)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(cat.totalNetBookValue, 'AED', locale)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Assets Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Fixed Assets</CardTitle>
              <CardDescription>
                {assets.length} asset{assets.length !== 1 ? 's' : ''} registered
              </CardDescription>
            </div>
          </div>
          <div className="mt-4">
            <Input
              placeholder="Search assets by name, category, number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="max-w-sm"
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingAssets ? (
            <TableSkeleton rows={5} columns={7} />
          ) : filteredAssets.length === 0 ? (
            searchQuery ? (
              <EmptyState
                icon={Building2}
                title="No matching assets"
                description={`No assets match "${searchQuery}". Try a different keyword or clear the search.`}
                action={{ label: 'Clear search', onClick: () => setSearchQuery(''), variant: 'outline' }}
                testId="empty-state-fixed-assets-search"
              />
            ) : (
              <EmptyState
                icon={Building2}
                title="No fixed assets yet"
                description="Track equipment, vehicles, and other depreciable assets to keep your books accurate."
                action={{ label: 'Add Asset', icon: Plus, onClick: handleOpenCreateDialog }}
                testId="empty-state-fixed-assets"
              />
            )
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Purchase Date</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Accum. Dep.</TableHead>
                    <TableHead className="text-right">NBV</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">{t.actions || 'Actions'}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAssets.map((asset) => (
                    <TableRow key={asset.id}>
                      <TableCell className="font-medium">
                        <div>
                          {asset.asset_name}
                          {asset.asset_name_ar && (
                            <div className="text-xs text-muted-foreground">{asset.asset_name_ar}</div>
                          )}
                          {asset.asset_number && (
                            <div className="text-xs text-muted-foreground">#{asset.asset_number}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{asset.category}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {asset.purchase_date ? format(new Date(asset.purchase_date), 'MMM dd, yyyy') : '-'}
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(parseFloat(asset.purchase_cost), 'AED', locale)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(parseFloat(asset.accumulated_depreciation || '0'), 'AED', locale)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatCurrency(parseFloat(asset.net_book_value || '0'), 'AED', locale)}</TableCell>
                      <TableCell>{getStatusBadge(asset.status)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {asset.status === 'active' && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => depreciateMutation.mutate(asset.id)}
                                title="Record Depreciation"
                                disabled={depreciateMutation.isPending}
                              >
                                <Calculator className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenEditDialog(asset)}
                                title="Edit"
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenDisposeDialog(asset)}
                                title="Dispose"
                                className="text-[hsl(var(--chart-4))] hover:text-[hsl(var(--chart-4))]"
                              >
                                <Ban className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setAssetToDelete(asset.id)}
                            title="Delete"
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Create/Edit Asset Dialog ──────────────────────── */}
      <Dialog open={assetDialogOpen} onOpenChange={setAssetDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingAsset ? 'Edit Fixed Asset' : 'Add Fixed Asset'}</DialogTitle>
            <DialogDescription>
              {editingAsset ? 'Update asset details.' : 'Register a new fixed asset.'}
            </DialogDescription>
          </DialogHeader>

          <Form {...assetForm}>
            <form onSubmit={assetForm.handleSubmit(handleAssetSubmit)} className="space-y-4">
              <FormField
                control={assetForm.control}
                name="assetName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Asset Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Toyota Hilux 2024" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={assetForm.control}
                name="assetNameAr"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Asset Name (Arabic)</FormLabel>
                    <FormControl>
                      <Input placeholder="اسم الأصل" dir="rtl" {...field} value={field.value || ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={assetForm.control}
                  name="assetNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Asset Number</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., FA-001" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={assetForm.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {CATEGORIES.map((cat) => (
                            <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={assetForm.control}
                  name="purchaseDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Purchase Date *</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={assetForm.control}
                  name="purchaseCost"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Purchase Cost (AED) *</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={assetForm.control}
                  name="salvageValue"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Salvage Value (AED)</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" {...field} value={field.value ?? 0} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={assetForm.control}
                  name="usefulLifeYears"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Useful Life (Years) *</FormLabel>
                      <FormControl>
                        <Input type="number" min="1" step="1" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={assetForm.control}
                name="depreciationMethod"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Depreciation Method</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || 'straight_line'}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select method" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="straight_line">Straight-Line</SelectItem>
                        <SelectItem value="declining_balance">Declining Balance</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={assetForm.control}
                  name="location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Location</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Dubai Office" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={assetForm.control}
                  name="serialNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Serial Number</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., SN-12345" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={assetForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Optional notes about this asset" {...field} value={field.value || ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setAssetDialogOpen(false)}>
                  {t.cancel || 'Cancel'}
                </Button>
                <Button
                  type="submit"
                  disabled={createAssetMutation.isPending || updateAssetMutation.isPending}
                >
                  {(createAssetMutation.isPending || updateAssetMutation.isPending)
                    ? (t.loading || 'Loading...')
                    : editingAsset
                      ? (t.save || 'Save')
                      : 'Add Asset'}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ─── Dispose Dialog ────────────────────────────────── */}
      <Dialog open={disposeDialogOpen} onOpenChange={setDisposeDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Dispose Asset</DialogTitle>
            <DialogDescription>
              {disposingAsset
                ? `Record disposal for "${disposingAsset.asset_name}" (NBV: ${formatCurrency(parseFloat(disposingAsset.net_book_value || '0'), 'AED', locale)})`
                : 'Record asset disposal'}
            </DialogDescription>
          </DialogHeader>

          <Form {...disposeForm}>
            <form onSubmit={disposeForm.handleSubmit(handleDisposeSubmit)} className="space-y-4">
              <FormField
                control={disposeForm.control}
                name="disposalDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Disposal Date *</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={disposeForm.control}
                name="disposalAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Disposal Amount (AED)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" min="0" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={disposeForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Reason for disposal" {...field} value={field.value || ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setDisposeDialogOpen(false)}>
                  {t.cancel || 'Cancel'}
                </Button>
                <Button type="submit" variant="destructive" disabled={disposeMutation.isPending}>
                  {disposeMutation.isPending ? (t.loading || 'Loading...') : 'Dispose Asset'}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ─── Run Depreciation Dialog ───────────────────────── */}
      <Dialog open={depRunDialogOpen} onOpenChange={setDepRunDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Run Monthly Depreciation</DialogTitle>
            <DialogDescription>
              Calculate and record depreciation for all active assets for the selected month.
            </DialogDescription>
          </DialogHeader>

          <Form {...depRunForm}>
            <form onSubmit={depRunForm.handleSubmit(handleDepRunSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={depRunForm.control}
                  name="month"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Month *</FormLabel>
                      <Select onValueChange={(v) => field.onChange(parseInt(v))} value={String(field.value)}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select month" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="1">January</SelectItem>
                          <SelectItem value="2">February</SelectItem>
                          <SelectItem value="3">March</SelectItem>
                          <SelectItem value="4">April</SelectItem>
                          <SelectItem value="5">May</SelectItem>
                          <SelectItem value="6">June</SelectItem>
                          <SelectItem value="7">July</SelectItem>
                          <SelectItem value="8">August</SelectItem>
                          <SelectItem value="9">September</SelectItem>
                          <SelectItem value="10">October</SelectItem>
                          <SelectItem value="11">November</SelectItem>
                          <SelectItem value="12">December</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={depRunForm.control}
                  name="year"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Year *</FormLabel>
                      <FormControl>
                        <Input type="number" min="2000" max="2100" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setDepRunDialogOpen(false)}>
                  {t.cancel || 'Cancel'}
                </Button>
                <Button type="submit" disabled={runDepreciationMutation.isPending}>
                  {runDepreciationMutation.isPending ? (t.loading || 'Loading...') : 'Run Depreciation'}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!assetToDelete} onOpenChange={(open) => { if (!open) setAssetToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Fixed Asset?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this asset record. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (assetToDelete) {
                  deleteAssetMutation.mutate(assetToDelete);
                  setAssetToDelete(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
