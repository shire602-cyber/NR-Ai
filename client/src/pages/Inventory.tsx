import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import {
  Package,
  Plus,
  Edit,
  Trash2,
  PackagePlus,
  AlertTriangle,
  ArrowDownUp,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import type { Product, InventoryMovement } from '@shared/schema';

// ─── Schemas ──────────────────────────────────────────────

const productFormSchema = z.object({
  name: z.string().min(1, 'Product name is required'),
  nameAr: z.string().optional().nullable(),
  sku: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  unitPrice: z.coerce.number().min(0, 'Unit price must be >= 0'),
  costPrice: z.coerce.number().min(0, 'Cost price must be >= 0').optional().nullable(),
  vatRate: z.coerce.number().min(0).max(1, 'VAT rate must be between 0 and 1'),
  unit: z.string().min(1, 'Unit is required'),
  lowStockThreshold: z.coerce.number().int().min(0).optional().nullable(),
});

type ProductFormData = z.infer<typeof productFormSchema>;

const movementFormSchema = z.object({
  type: z.enum(['purchase', 'adjustment', 'return']),
  quantity: z.coerce.number().int().min(1, 'Quantity must be at least 1'),
  unitCost: z.coerce.number().min(0).optional().nullable(),
  notes: z.string().optional().nullable(),
});

type MovementFormData = z.infer<typeof movementFormSchema>;

// ─── Component ────────────────────────────────────────────

export default function Inventory() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();

  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [addStockDialogOpen, setAddStockDialogOpen] = useState(false);
  const [stockProduct, setStockProduct] = useState<Product | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [productToDelete, setProductToDelete] = useState<string | null>(null);

  // ─── Queries ──────────────────────────────────────────

  const { data: productsList = [], isLoading: isLoadingProducts } = useQuery<Product[]>({
    queryKey: [`/api/companies/${companyId}/products`],
    enabled: !!companyId,
  });

  const { data: movementsList = [], isLoading: isLoadingMovements } = useQuery<InventoryMovement[]>({
    queryKey: [`/api/companies/${companyId}/inventory-movements`],
    enabled: !!companyId,
  });

  // ─── Forms ────────────────────────────────────────────

  const productForm = useForm<ProductFormData>({
    resolver: zodResolver(productFormSchema),
    defaultValues: {
      name: '',
      nameAr: '',
      sku: '',
      description: '',
      unitPrice: 0,
      costPrice: 0,
      vatRate: 0.05,
      unit: 'pcs',
      lowStockThreshold: 10,
    },
  });

  const movementForm = useForm<MovementFormData>({
    resolver: zodResolver(movementFormSchema),
    defaultValues: {
      type: 'purchase',
      quantity: 1,
      unitCost: 0,
      notes: '',
    },
  });

  // ─── Mutations ────────────────────────────────────────

  const createProductMutation = useMutation({
    mutationFn: (data: ProductFormData) =>
      apiRequest('POST', `/api/companies/${companyId}/products`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/products`] });
      toast({ title: 'Product Created', description: 'The product has been added successfully.' });
      setProductDialogOpen(false);
      productForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const updateProductMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ProductFormData> }) =>
      apiRequest('PATCH', `/api/products/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/products`] });
      toast({ title: 'Product Updated', description: 'The product has been updated successfully.' });
      setProductDialogOpen(false);
      setEditingProduct(null);
      productForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const deleteProductMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/products/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/products`] });
      toast({ title: 'Product Deleted', description: 'The product has been deleted.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const addMovementMutation = useMutation({
    mutationFn: ({ productId, data }: { productId: string; data: MovementFormData }) =>
      apiRequest('POST', `/api/products/${productId}/movements`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/products`] });
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/inventory-movements`] });
      toast({ title: 'Stock Updated', description: 'Inventory movement recorded successfully.' });
      setAddStockDialogOpen(false);
      setStockProduct(null);
      movementForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  // ─── Handlers ─────────────────────────────────────────

  const handleOpenCreateDialog = () => {
    setEditingProduct(null);
    productForm.reset({
      name: '',
      nameAr: '',
      sku: '',
      description: '',
      unitPrice: 0,
      costPrice: 0,
      vatRate: 0.05,
      unit: 'pcs',
      lowStockThreshold: 10,
    });
    setProductDialogOpen(true);
  };

  const handleOpenEditDialog = (product: Product) => {
    setEditingProduct(product);
    productForm.reset({
      name: product.name,
      nameAr: product.nameAr || '',
      sku: product.sku || '',
      description: product.description || '',
      unitPrice: product.unitPrice,
      costPrice: product.costPrice || 0,
      vatRate: product.vatRate,
      unit: product.unit,
      lowStockThreshold: product.lowStockThreshold || 10,
    });
    setProductDialogOpen(true);
  };

  const handleOpenAddStockDialog = (product: Product) => {
    setStockProduct(product);
    movementForm.reset({
      type: 'purchase',
      quantity: 1,
      unitCost: product.costPrice || 0,
      notes: '',
    });
    setAddStockDialogOpen(true);
  };

  const handleProductSubmit = (data: ProductFormData) => {
    if (editingProduct) {
      updateProductMutation.mutate({ id: editingProduct.id, data });
    } else {
      createProductMutation.mutate(data);
    }
  };

  const handleMovementSubmit = (data: MovementFormData) => {
    if (!stockProduct) return;
    addMovementMutation.mutate({ productId: stockProduct.id, data });
  };

  // ─── Helpers ──────────────────────────────────────────

  const getMovementTypeBadge = (type: string) => {
    switch (type) {
      case 'purchase':
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Purchase</Badge>;
      case 'sale':
        return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">Sale</Badge>;
      case 'adjustment':
        return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Adjustment</Badge>;
      case 'return':
        return <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-100">Return</Badge>;
      default:
        return <Badge variant="secondary">{type}</Badge>;
    }
  };

  const getProductName = (productId: string): string => {
    const product = productsList.find(p => p.id === productId);
    return product?.name || 'Unknown Product';
  };

  const filteredProducts = productsList.filter(product => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      product.name.toLowerCase().includes(q) ||
      (product.sku && product.sku.toLowerCase().includes(q)) ||
      (product.nameAr && product.nameAr.includes(q))
    );
  });

  // ─── Loading State ────────────────────────────────────

  if (isLoadingCompany) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">{t.loading || 'Loading...'}</div>
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Please create a company first.</div>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Package className="w-8 h-8" />
            {(t as any).inventory || 'Inventory'}
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage your products and track inventory movements
          </p>
        </div>
      </div>

      <Tabs defaultValue="products" className="space-y-4">
        <TabsList>
          <TabsTrigger value="products" className="flex items-center gap-2">
            <Package className="w-4 h-4" />
            Products
          </TabsTrigger>
          <TabsTrigger value="movements" className="flex items-center gap-2">
            <ArrowDownUp className="w-4 h-4" />
            Movements
          </TabsTrigger>
        </TabsList>

        {/* ─── Products Tab ──────────────────────────────── */}
        <TabsContent value="products">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Products</CardTitle>
                  <CardDescription>
                    {productsList.length} product{productsList.length !== 1 ? 's' : ''} in inventory
                  </CardDescription>
                </div>
                <Button onClick={handleOpenCreateDialog} className="flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  Add Product
                </Button>
              </div>
              <div className="mt-4">
                <Input
                  placeholder="Search products by name or SKU..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="max-w-sm"
                />
              </div>
            </CardHeader>
            <CardContent>
              {isLoadingProducts ? (
                <div className="text-center py-8 text-muted-foreground">{t.loading || 'Loading...'}</div>
              ) : filteredProducts.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {searchQuery ? 'No products match your search.' : 'No products yet. Add your first product to get started.'}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead className="text-right">Unit Price</TableHead>
                        <TableHead className="text-right">Cost Price</TableHead>
                        <TableHead className="text-right">Stock</TableHead>
                        <TableHead>Unit</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">{t.actions || 'Actions'}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredProducts.map((product) => {
                        const isLowStock = product.currentStock < (product.lowStockThreshold || 0);
                        return (
                          <TableRow key={product.id}>
                            <TableCell className="font-medium">
                              <div>
                                {product.name}
                                {product.nameAr && (
                                  <div className="text-xs text-muted-foreground">{product.nameAr}</div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground">{product.sku || '-'}</TableCell>
                            <TableCell className="text-right">{formatCurrency(product.unitPrice, 'AED', locale)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(product.costPrice || 0, 'AED', locale)}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                {product.currentStock}
                                {isLowStock && (
                                  <Badge variant="destructive" className="text-xs flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3" />
                                    Low
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>{product.unit}</TableCell>
                            <TableCell>
                              {product.isActive ? (
                                <Badge variant="secondary" className="bg-green-100 text-green-800">Active</Badge>
                              ) : (
                                <Badge variant="secondary">{t.inactive || 'Inactive'}</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleOpenEditDialog(product)}
                                  title="Edit"
                                >
                                  <Edit className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleOpenAddStockDialog(product)}
                                  title="Add Stock"
                                >
                                  <PackagePlus className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setProductToDelete(product.id)}
                                  title="Delete"
                                  className="text-destructive hover:text-destructive"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Movements Tab ─────────────────────────────── */}
        <TabsContent value="movements">
          <Card>
            <CardHeader>
              <CardTitle>Inventory Movements</CardTitle>
              <CardDescription>
                History of all inventory changes across products
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingMovements ? (
                <div className="text-center py-8 text-muted-foreground">{t.loading || 'Loading...'}</div>
              ) : movementsList.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No inventory movements yet. Add stock to a product to get started.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t.date || 'Date'}</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead>{t.type || 'Type'}</TableHead>
                        <TableHead className="text-right">{t.quantity || 'Quantity'}</TableHead>
                        <TableHead className="text-right">Unit Cost</TableHead>
                        <TableHead>{t.reference || 'Reference'}</TableHead>
                        <TableHead>Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {movementsList.map((movement) => (
                        <TableRow key={movement.id}>
                          <TableCell className="whitespace-nowrap">
                            {movement.createdAt
                              ? format(new Date(movement.createdAt), 'MMM dd, yyyy HH:mm')
                              : '-'}
                          </TableCell>
                          <TableCell className="font-medium">{getProductName(movement.productId)}</TableCell>
                          <TableCell>{getMovementTypeBadge(movement.type)}</TableCell>
                          <TableCell className="text-right font-mono">
                            {movement.type === 'sale' ? '-' : '+'}{Math.abs(movement.quantity)}
                          </TableCell>
                          <TableCell className="text-right">
                            {movement.unitCost != null ? formatCurrency(movement.unitCost, 'AED', locale) : '-'}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{movement.reference || '-'}</TableCell>
                          <TableCell className="text-muted-foreground max-w-[200px] truncate">
                            {movement.notes || '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ─── Product Create/Edit Dialog ──────────────────── */}
      <Dialog open={productDialogOpen} onOpenChange={setProductDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingProduct ? 'Edit Product' : 'Add Product'}</DialogTitle>
            <DialogDescription>
              {editingProduct ? 'Update product details.' : 'Add a new product to your inventory.'}
            </DialogDescription>
          </DialogHeader>

          <Form {...productForm}>
            <form onSubmit={productForm.handleSubmit(handleProductSubmit)} className="space-y-4">
              <FormField
                control={productForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="Product name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={productForm.control}
                name="nameAr"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name (Arabic)</FormLabel>
                    <FormControl>
                      <Input placeholder="اسم المنتج" dir="rtl" {...field} value={field.value || ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={productForm.control}
                  name="sku"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>SKU</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., PROD-001" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={productForm.control}
                  name="unit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unit *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select unit" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="pcs">Pieces (pcs)</SelectItem>
                          <SelectItem value="kg">Kilograms (kg)</SelectItem>
                          <SelectItem value="m">Meters (m)</SelectItem>
                          <SelectItem value="hr">Hours (hr)</SelectItem>
                          <SelectItem value="box">Box</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={productForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.description || 'Description'}</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Product description (optional)" {...field} value={field.value || ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={productForm.control}
                  name="unitPrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t.unitPrice || 'Unit Price'} *</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={productForm.control}
                  name="costPrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cost Price</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          {...field}
                          value={field.value ?? 0}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={productForm.control}
                  name="vatRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>VAT Rate</FormLabel>
                      <Select
                        onValueChange={(v) => field.onChange(parseFloat(v))}
                        value={String(field.value)}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select VAT rate" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="0">0% (Exempt)</SelectItem>
                          <SelectItem value="0.05">5% (Standard)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={productForm.control}
                  name="lowStockThreshold"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Low Stock Threshold</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          {...field}
                          value={field.value ?? 10}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setProductDialogOpen(false)}>
                  {t.cancel || 'Cancel'}
                </Button>
                <Button
                  type="submit"
                  disabled={createProductMutation.isPending || updateProductMutation.isPending}
                >
                  {(createProductMutation.isPending || updateProductMutation.isPending)
                    ? (t.loading || 'Loading...')
                    : editingProduct
                      ? (t.save || 'Save')
                      : 'Add Product'}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ─── Add Stock Dialog ────────────────────────────── */}
      <Dialog open={addStockDialogOpen} onOpenChange={setAddStockDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Stock</DialogTitle>
            <DialogDescription>
              {stockProduct ? `Record inventory movement for "${stockProduct.name}"` : 'Record inventory movement'}
            </DialogDescription>
          </DialogHeader>

          <Form {...movementForm}>
            <form onSubmit={movementForm.handleSubmit(handleMovementSubmit)} className="space-y-4">
              <FormField
                control={movementForm.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.type || 'Type'} *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="purchase">Purchase</SelectItem>
                        <SelectItem value="adjustment">Adjustment</SelectItem>
                        <SelectItem value="return">Return</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={movementForm.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.quantity || 'Quantity'} *</FormLabel>
                    <FormControl>
                      <Input type="number" min="1" step="1" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={movementForm.control}
                name="unitCost"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unit Cost</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={movementForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Optional notes" {...field} value={field.value || ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setAddStockDialogOpen(false)}>
                  {t.cancel || 'Cancel'}
                </Button>
                <Button type="submit" disabled={addMovementMutation.isPending}>
                  {addMovementMutation.isPending ? (t.loading || 'Loading...') : 'Record Movement'}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!productToDelete} onOpenChange={(open) => { if (!open) setProductToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Product?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this product from inventory. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (productToDelete) {
                  deleteProductMutation.mutate(productToDelete);
                  setProductToDelete(null);
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
