import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { Package, Plus, Edit, Trash2, PackagePlus, AlertTriangle, ArrowDownUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import type { Product, InventoryMovement } from "@shared/schema";
import { messages as pageMessages } from "./Inventory.i18n";

// ─── Schemas ──────────────────────────────────────────────

const productFormSchema = z.object({
  name: z.string().min(1, pageMessages.marker("productNameIsRequired")),
  nameAr: z.string().optional().nullable(),
  sku: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  unitPrice: z.coerce.number().min(0, pageMessages.marker("unitPriceMustBe0")),
  costPrice: z.coerce
    .number()
    .min(0, pageMessages.marker("costPriceMustBe0"))
    .optional()
    .nullable(),
  vatRate: z.coerce.number().min(0).max(1, pageMessages.marker("vatRateMustBeBetween0")),
  unit: z.string().min(1, pageMessages.marker("unitIsRequired")),
  lowStockThreshold: z.coerce.number().int().min(0).optional().nullable(),
});

type ProductFormData = z.infer<typeof productFormSchema>;

const movementFormSchema = z.object({
  type: z.enum(["purchase", "adjustment", "return"]),
  quantity: z.coerce.number().int().min(1, pageMessages.marker("quantityMustBeAtLeast1")),
  unitCost: z.coerce.number().min(0).optional().nullable(),
  notes: z.string().optional().nullable(),
});

type MovementFormData = z.infer<typeof movementFormSchema>;

// ─── Component ────────────────────────────────────────────

export default function Inventory() {
  const tr = pageMessages.useT();

  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();

  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [addStockDialogOpen, setAddStockDialogOpen] = useState(false);
  const [stockProduct, setStockProduct] = useState<Product | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [productToDelete, setProductToDelete] = useState<string | null>(null);

  // ─── Queries ──────────────────────────────────────────

  const { data: productsList = [], isLoading: isLoadingProducts } = useQuery<Product[]>({
    queryKey: [`/api/companies/${companyId}/products`],
    enabled: !!companyId,
  });

  const { data: movementsList = [], isLoading: isLoadingMovements } = useQuery<InventoryMovement[]>(
    {
      queryKey: [`/api/companies/${companyId}/inventory-movements`],
      enabled: !!companyId,
    }
  );

  // ─── Forms ────────────────────────────────────────────

  const productForm = useForm<ProductFormData>({
    resolver: zodResolver(productFormSchema),
    defaultValues: {
      name: "",
      nameAr: "",
      sku: "",
      description: "",
      unitPrice: 0,
      costPrice: 0,
      vatRate: 0.05,
      unit: "pcs",
      lowStockThreshold: 10,
    },
  });

  const movementForm = useForm<MovementFormData>({
    resolver: zodResolver(movementFormSchema),
    defaultValues: {
      type: "purchase",
      quantity: 1,
      unitCost: 0,
      notes: "",
    },
  });

  // ─── Mutations ────────────────────────────────────────

  const createProductMutation = useMutation({
    mutationFn: (data: ProductFormData) =>
      apiRequest("POST", `/api/companies/${companyId}/products`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/products`] });
      toast({ title: tr("productCreated"), description: tr("theProductHasBeenAddedSuccessfully") });
      setProductDialogOpen(false);
      productForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
    },
  });

  const updateProductMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ProductFormData> }) =>
      apiRequest("PATCH", `/api/products/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/products`] });
      toast({
        title: tr("productUpdated"),
        description: tr("theProductHasBeenUpdatedSuccessfully"),
      });
      setProductDialogOpen(false);
      setEditingProduct(null);
      productForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
    },
  });

  const deleteProductMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/products/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/products`] });
      toast({ title: tr("productDeleted"), description: tr("theProductHasBeenDeleted") });
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
    },
  });

  const addMovementMutation = useMutation({
    mutationFn: ({ productId, data }: { productId: string; data: MovementFormData }) =>
      apiRequest("POST", `/api/products/${productId}/movements`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/products`] });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/inventory-movements`],
      });
      toast({
        title: tr("stockUpdated"),
        description: tr("inventoryMovementRecordedSuccessfully"),
      });
      setAddStockDialogOpen(false);
      setStockProduct(null);
      movementForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
    },
  });

  // ─── Handlers ─────────────────────────────────────────

  const handleOpenCreateDialog = () => {
    setEditingProduct(null);
    productForm.reset({
      name: "",
      nameAr: "",
      sku: "",
      description: "",
      unitPrice: 0,
      costPrice: 0,
      vatRate: 0.05,
      unit: "pcs",
      lowStockThreshold: 10,
    });
    setProductDialogOpen(true);
  };

  const handleOpenEditDialog = (product: Product) => {
    setEditingProduct(product);
    productForm.reset({
      name: product.name,
      nameAr: product.nameAr || "",
      sku: product.sku || "",
      description: product.description || "",
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
      type: "purchase",
      quantity: 1,
      unitCost: product.costPrice || 0,
      notes: "",
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
      case "purchase":
        return (
          <Badge className="bg-success-subtle text-success-subtle-foreground hover:bg-success-subtle">
            {tr("purchase")}
          </Badge>
        );
      case "sale":
        return (
          <Badge className="bg-info-subtle text-info-subtle-foreground hover:bg-info-subtle">
            {tr("sale")}
          </Badge>
        );
      case "adjustment":
        return (
          <Badge className="bg-warning-subtle text-warning-subtle-foreground hover:bg-warning-subtle">
            {tr("adjustment")}
          </Badge>
        );
      case "return":
        return (
          <Badge className="bg-chart-5/10 text-chart-5 hover:bg-chart-5/10">{tr("return")}</Badge>
        );
      default:
        return <Badge variant="secondary">{type}</Badge>;
    }
  };

  const getProductName = (productId: string): string => {
    const product = productsList.find((p) => p.id === productId);
    return product?.name || tr("unknownProduct");
  };

  const filteredProducts = productsList.filter((product) => {
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
        <div className="text-muted-foreground">{t.loading || tr("loading")}</div>
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">{tr("pleaseCreateACompanyFirst")}</div>
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
            {(t as any).inventory || tr("inventory")}
          </h1>
          <p className="text-muted-foreground mt-1">{tr("manageYourProductsAndTrackInventory")}</p>
        </div>
      </div>

      <Tabs defaultValue="products" className="space-y-4">
        <TabsList>
          <TabsTrigger value="products" className="flex items-center gap-2">
            <Package className="w-4 h-4" />
            {tr("products")}
          </TabsTrigger>
          <TabsTrigger value="movements" className="flex items-center gap-2">
            <ArrowDownUp className="w-4 h-4" />
            {tr("movements")}
          </TabsTrigger>
        </TabsList>

        {/* ─── Products Tab ──────────────────────────────── */}
        <TabsContent value="products">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{tr("products")}</CardTitle>
                  <CardDescription>
                    {tr.plural("productsInInventory", productsList.length)}
                  </CardDescription>
                </div>
                <Button onClick={handleOpenCreateDialog} className="flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  {tr("addProduct")}
                </Button>
              </div>
              <div className="mt-4">
                <Input
                  placeholder={tr("searchProductsByNameOrSku")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="max-w-sm"
                />
              </div>
            </CardHeader>
            <CardContent>
              {isLoadingProducts ? (
                <div className="text-center py-8 text-muted-foreground">
                  {t.loading || tr("loading")}
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {searchQuery ? tr("noProductsMatchYourSearch") : tr("noProductsYetAddYourFirst")}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tr("name")}</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead className="text-end">{tr("unitPrice")}</TableHead>
                        <TableHead className="text-end">{tr("costPrice")}</TableHead>
                        <TableHead className="text-end">{tr("stock")}</TableHead>
                        <TableHead>{tr("unit")}</TableHead>
                        <TableHead>{tr("status")}</TableHead>
                        <TableHead className="text-end">{t.actions || tr("actions")}</TableHead>
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
                                  <div className="text-xs text-muted-foreground">
                                    {product.nameAr}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {product.sku || "-"}
                            </TableCell>
                            <TableCell className="text-end">
                              {formatCurrency(product.unitPrice, "AED", locale)}
                            </TableCell>
                            <TableCell className="text-end">
                              {formatCurrency(product.costPrice || 0, "AED", locale)}
                            </TableCell>
                            <TableCell className="text-end">
                              <div className="flex items-center justify-end gap-2">
                                {product.currentStock}
                                {isLowStock && (
                                  <Badge
                                    variant="destructive"
                                    className="text-xs flex items-center gap-1"
                                  >
                                    <AlertTriangle className="w-3 h-3" />
                                    {tr("low")}
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>{product.unit}</TableCell>
                            <TableCell>
                              {product.isActive ? (
                                <Badge
                                  variant="secondary"
                                  className="bg-success-subtle text-success-subtle-foreground"
                                >
                                  {tr("active")}
                                </Badge>
                              ) : (
                                <Badge variant="secondary">{t.inactive || tr("inactive")}</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-end">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleOpenEditDialog(product)}
                                  title={tr("edit")}
                                >
                                  <Edit className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleOpenAddStockDialog(product)}
                                  title={tr("addStock")}
                                >
                                  <PackagePlus className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setProductToDelete(product.id)}
                                  title={tr("delete")}
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
              <CardTitle>{tr("inventoryMovements")}</CardTitle>
              <CardDescription>{tr("historyOfAllInventoryChangesAcross")}</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingMovements ? (
                <div className="text-center py-8 text-muted-foreground">
                  {t.loading || tr("loading")}
                </div>
              ) : movementsList.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {tr("noInventoryMovementsYetAddStock")}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t.date || tr("date")}</TableHead>
                        <TableHead>{tr("product")}</TableHead>
                        <TableHead>{t.type || tr("type")}</TableHead>
                        <TableHead className="text-end">{t.quantity || tr("quantity")}</TableHead>
                        <TableHead className="text-end">{tr("unitCost")}</TableHead>
                        <TableHead>{t.reference || tr("reference")}</TableHead>
                        <TableHead>{tr("notes")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {movementsList.map((movement) => (
                        <TableRow key={movement.id}>
                          <TableCell className="whitespace-nowrap">
                            {movement.createdAt
                              ? format(new Date(movement.createdAt), "MMM dd, yyyy HH:mm")
                              : "-"}
                          </TableCell>
                          <TableCell className="font-medium">
                            {getProductName(movement.productId)}
                          </TableCell>
                          <TableCell>{getMovementTypeBadge(movement.type)}</TableCell>
                          <TableCell className="text-end font-mono">
                            {movement.type === "sale" ? "-" : "+"}
                            {Math.abs(movement.quantity)}
                          </TableCell>
                          <TableCell className="text-end">
                            {movement.unitCost != null
                              ? formatCurrency(movement.unitCost, "AED", locale)
                              : "-"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {movement.reference || "-"}
                          </TableCell>
                          <TableCell className="text-muted-foreground max-w-[200px] truncate">
                            {movement.notes || "-"}
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
            <DialogTitle>{editingProduct ? tr("editProduct") : tr("addProduct")}</DialogTitle>
            <DialogDescription>
              {editingProduct ? tr("updateProductDetails") : tr("addANewProductToYour")}
            </DialogDescription>
          </DialogHeader>

          <Form {...productForm}>
            <form onSubmit={productForm.handleSubmit(handleProductSubmit)} className="space-y-4">
              <FormField
                control={productForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tr("name2")}</FormLabel>
                    <FormControl>
                      <Input placeholder={tr("productName")} {...field} />
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
                    <FormLabel>{tr("nameArabic")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="اسم المنتج"
                        dir="rtl"
                        {...field}
                        value={field.value || ""}
                      />
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
                        <Input placeholder="e.g., PROD-001" {...field} value={field.value || ""} />
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
                      <FormLabel>{tr("unit2")}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={tr("selectUnit")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="pcs">{tr("piecesPcs")}</SelectItem>
                          <SelectItem value="kg">{tr("kilogramsKg")}</SelectItem>
                          <SelectItem value="m">{tr("metersM")}</SelectItem>
                          <SelectItem value="hr">{tr("hoursHr")}</SelectItem>
                          <SelectItem value="box">{tr("box")}</SelectItem>
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
                    <FormLabel>{t.description || tr("description")}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={tr("productDescriptionOptional")}
                        {...field}
                        value={field.value || ""}
                      />
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
                      <FormLabel>{t.unitPrice || tr("unitPrice")} *</FormLabel>
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
                      <FormLabel>{tr("costPrice")}</FormLabel>
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
                      <FormLabel>{tr("vatRate")}</FormLabel>
                      <Select
                        onValueChange={(v) => field.onChange(parseFloat(v))}
                        value={String(field.value)}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={tr("selectVatRate")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="0">{tr("n0Exempt")}</SelectItem>
                          <SelectItem value="0.05">{tr("n5Standard")}</SelectItem>
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
                      <FormLabel>{tr("lowStockThreshold")}</FormLabel>
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
                  {t.cancel || tr("cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={createProductMutation.isPending || updateProductMutation.isPending}
                >
                  {createProductMutation.isPending || updateProductMutation.isPending
                    ? t.loading || tr("loading")
                    : editingProduct
                      ? t.save || tr("save")
                      : tr("addProduct")}
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
            <DialogTitle>{tr("addStock")}</DialogTitle>
            <DialogDescription>
              {stockProduct
                ? tr("recordInventoryMovementFor", { name: stockProduct.name })
                : tr("recordInventoryMovement")}
            </DialogDescription>
          </DialogHeader>

          <Form {...movementForm}>
            <form onSubmit={movementForm.handleSubmit(handleMovementSubmit)} className="space-y-4">
              <FormField
                control={movementForm.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.type || tr("type")} *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={tr("selectType")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="purchase">{tr("purchase")}</SelectItem>
                        <SelectItem value="adjustment">{tr("adjustment")}</SelectItem>
                        <SelectItem value="return">{tr("return")}</SelectItem>
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
                    <FormLabel>{t.quantity || tr("quantity")} *</FormLabel>
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
                    <FormLabel>{tr("unitCost")}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        {...field}
                        value={field.value ?? ""}
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
                    <FormLabel>{tr("notes")}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={tr("optionalNotes")}
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAddStockDialogOpen(false)}
                >
                  {t.cancel || tr("cancel")}
                </Button>
                <Button type="submit" disabled={addMovementMutation.isPending}>
                  {addMovementMutation.isPending
                    ? t.loading || tr("loading")
                    : tr("recordMovement")}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!productToDelete}
        onOpenChange={(open) => {
          if (!open) setProductToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("deleteProduct")}</AlertDialogTitle>
            <AlertDialogDescription>
              {tr("thisWillPermanentlyDeleteThisProduct")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (productToDelete) {
                  deleteProductMutation.mutate(productToDelete);
                  setProductToDelete(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {tr("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
