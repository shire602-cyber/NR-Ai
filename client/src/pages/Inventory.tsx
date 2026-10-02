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
import { Switch } from "@/components/ui/switch";
import { unitLabel } from "@/lib/unit-label";
import { useTranslation } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import type { Product, InventoryMovement } from "@shared/schema";
import { messages as pageMessages } from "./Inventory.i18n";
import { messages as salesMessages } from "@/components/sales/SalesShared.i18n";
import { Link } from "wouter";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatDate } from "@/lib/format";
import { todayYmd } from "@/lib/calendar-date";
import { VAT_SUPPLY_CHOICES, vatChoiceOf, vatFieldsOf } from "@/lib/vat-choice";

// ─── Schemas ──────────────────────────────────────────────

const movementDay = (m: { movementDate?: string | Date | null; date?: string | Date | null; createdAt?: string | Date | null }) =>
  (m.movementDate ?? m.date ?? m.createdAt) as string | undefined;

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
  // 0% is two different things: zero-rated (box 4) or exempt (box 5). The rate alone cannot say which.
  vatSupplyType: z.enum(["standard_rated", "zero_rated", "exempt"]).default("standard_rated"),
  // Opening stock (new tracked products): what is on the shelf now and what it cost.
  openingQuantity: z.coerce.number().int().min(0).optional().nullable(),
  openingUnitCost: z.coerce.number().min(0).optional().nullable(),
  unit: z.string().min(1, pageMessages.marker("unitIsRequired")),
  lowStockThreshold: z.coerce.number().int().min(0).optional().nullable(),
  trackInventory: z.boolean(),
});

type ProductFormData = z.infer<typeof productFormSchema>;

const movementFormSchema = z
  .object({
    type: z.enum(["purchase", "adjustment", "return"]),
    // Only a stock adjustment may be negative (a count that came out lower, damaged or lost goods).
    quantity: z.coerce.number().int().refine((n) => n !== 0, pageMessages.marker("quantityMustBeAtLeast1")),
    unitCost: z.coerce.number().min(0).optional().nullable(),
    // The day the stock moved, as a calendar day (the GL date of the posting).
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    notes: z.string().optional().nullable(),
  })
  .refine((v) => v.type === "adjustment" || v.quantity > 0, {
    path: ["quantity"],
    message: pageMessages.marker("quantityMustBeAtLeast1"),
  });

type MovementFormData = z.infer<typeof movementFormSchema>;

// ─── Component ────────────────────────────────────────────

export default function Inventory() {
  const tr = pageMessages.useT();

  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, company, isLoading: isLoadingCompany } = useDefaultCompany();
  const salesTr = salesMessages.useT();

  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [addStockDialogOpen, setAddStockDialogOpen] = useState(false);
  const [stockProduct, setStockProduct] = useState<Product | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [productToDelete, setProductToDelete] = useState<string | null>(null);
  const [postingPromptOpen, setPostingPromptOpen] = useState(false);

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
      vatSupplyType: "standard_rated",
      openingQuantity: 0,
      openingUnitCost: 0,
      unit: "pcs",
      lowStockThreshold: 10,
      trackInventory: false,
    },
  });

  const movementForm = useForm<MovementFormData>({
    resolver: zodResolver(movementFormSchema),
    defaultValues: {
      type: "purchase",
      quantity: 1,
      unitCost: null,
      date: todayYmd(),
      notes: "",
    },
  });

  // ─── Mutations ────────────────────────────────────────

  const createProductMutation = useMutation({
    mutationFn: (data: Partial<ProductFormData> & { currentStock?: number }) =>
      apiRequest("POST", `/api/companies/${companyId}/products`, data),
    onSuccess: (_created, vars) => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/products`] });
      toast({ title: tr("productCreated"), description: tr("theProductHasBeenAddedSuccessfully") });
      // A tracked product with the ledger switch off would hold stock the books never see: ask once, right now.
      if (vars.trackInventory && !company?.inventoryCostingEnabled) setPostingPromptOpen(true);
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
    onSuccess: (_updated, vars) => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/products`] });
      if (vars.data.trackInventory && !company?.inventoryCostingEnabled) setPostingPromptOpen(true);
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

  const enablePostingMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/companies/${companyId}`, { inventoryCostingEnabled: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: salesTr("inventoryPostingOn") });
      setPostingPromptOpen(false);
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
      vatSupplyType: "standard_rated",
      openingQuantity: 0,
      openingUnitCost: 0,
      unit: "pcs",
      lowStockThreshold: 10,
      trackInventory: false,
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
      vatSupplyType: vatChoiceOf(product.vatRate, (product as { vatSupplyType?: string | null }).vatSupplyType),
      openingQuantity: 0,
      openingUnitCost: 0,
      unit: product.unit,
      lowStockThreshold: product.lowStockThreshold || 10,
      trackInventory: product.trackInventory ?? false,
    });
    setProductDialogOpen(true);
  };

  const handleOpenAddStockDialog = (product: Product) => {
    setStockProduct(product);
    // The unit cost starts empty: stock leaves at the running average cost, and a purchase without a cost uses the item's cost price.
    movementForm.reset({
      type: "purchase",
      quantity: 1,
      unitCost: null,
      date: todayYmd(),
      notes: "",
    });
    setAddStockDialogOpen(true);
  };

  const handleProductSubmit = (data: ProductFormData) => {
    // Opening stock only applies to a new tracked product.
    const { openingQuantity, openingUnitCost, ...rest } = data;
    if (editingProduct) {
      updateProductMutation.mutate({ id: editingProduct.id, data: rest });
    } else {
      createProductMutation.mutate(
        data.trackInventory && Number(openingQuantity) > 0
          ? {
              ...rest,
              // The server brings stock in at the cost price: quantity is currentStock, the opening cost is the cost price.
              currentStock: Number(openingQuantity),
              costPrice: Number(openingUnitCost ?? 0) > 0 ? Number(openingUnitCost) : rest.costPrice,
            }
          : rest
      );
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
    return (locale === "ar" && product?.nameAr ? product.nameAr : product?.name) || tr("unknownProduct");
  };

  const hasTrackedProducts = productsList.some((p) => p.trackInventory);
  const negativeStock = productsList.filter((p) => p.trackInventory && p.currentStock < 0);

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

      {hasTrackedProducts && !company?.inventoryCostingEnabled && (
        <Alert data-testid="banner-inventory-ledger-off">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{salesTr("inventoryLedgerOffTitle")}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{salesTr("inventoryLedgerOffBody")}</p>
            <Button asChild size="sm" variant="outline">
              <Link href="/settings/company#inventory-posting" data-testid="link-inventory-setting">
                {salesTr("inventoryLedgerOffLink")}
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {negativeStock.length > 0 && (
        <Alert variant="destructive" data-testid="banner-negative-stock">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{salesTr("negativeStockTitle")}</AlertTitle>
          <AlertDescription>{salesTr("negativeStockBody", { names: negativeStock.map((p) => (locale === "ar" && p.nameAr ? p.nameAr : p.name)).join(", ") })}</AlertDescription>
        </Alert>
      )}

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
                        <TableHead>{salesTr("skuLabel")}</TableHead>
                        <TableHead className="text-end">{tr("unitPrice")}</TableHead>
                        <TableHead className="text-end">{tr("costPrice")}</TableHead>
                        <TableHead className="text-end">{tr("averageCost")}</TableHead>
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
                            <TableCell className="text-end" data-testid={`text-average-cost-${product.id}`}>
                              {product.trackInventory
                                ? formatCurrency(product.averageCost || 0, "AED", locale)
                                : "-"}
                            </TableCell>
                            <TableCell className="text-end">
                              <div className="flex items-center justify-end gap-2">
                                <span className={product.currentStock < 0 ? "font-semibold text-destructive" : undefined} dir="ltr">
                                  {product.currentStock}
                                </span>
                                {product.trackInventory && product.currentStock < 0 && (
                                  <Badge variant="destructive" className="text-xs flex items-center gap-1" data-testid={`badge-negative-stock-${product.id}`}>
                                    <AlertTriangle className="w-3 h-3" />
                                    {salesTr("negativeStockBadge")}
                                  </Badge>
                                )}
                                {isLowStock && product.currentStock >= 0 && (
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
                            <TableCell>{unitLabel(product.unit, locale)}</TableCell>
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
                            {/* The day the stock moved (movementDate), not the day it was typed in. */}
                            {movementDay(movement)
                              ? formatDate(movementDay(movement) as string, locale)
                              : "-"}
                          </TableCell>
                          <TableCell className="font-medium">
                            {getProductName(movement.productId)}
                          </TableCell>
                          <TableCell>{getMovementTypeBadge(movement.type)}</TableCell>
                          <TableCell className="text-end font-mono">
                            <span dir="ltr">
                              {movement.type === "sale" || movement.quantity < 0 ? "-" : "+"}
                              {Math.abs(movement.quantity)}
                            </span>
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
                      <FormLabel>{salesTr("skuLabel")}</FormLabel>
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
                  name="vatSupplyType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("vatRate")}</FormLabel>
                      <Select
                        onValueChange={(v) => {
                          field.onChange(v);
                          productForm.setValue("vatRate", vatFieldsOf(v as (typeof VAT_SUPPLY_CHOICES)[number]).vatRate);
                        }}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-product-vat">
                            <SelectValue placeholder={tr("selectVatRate")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="standard_rated">{tr("n5Standard")}</SelectItem>
                          <SelectItem value="zero_rated">{salesTr("vatZeroRated")}</SelectItem>
                          {/* Products store a rate only: exempt is chosen on the document line, where it is kept. */}
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

                <FormField
                  control={productForm.control}
                  name="trackInventory"
                  render={({ field }) => (
                    <FormItem className="col-span-2 flex items-center justify-between rounded-md border p-3">
                      <div className="space-y-0.5">
                        <FormLabel>{tr("trackInventory")}</FormLabel>
                        <p className="text-xs text-muted-foreground">{tr("trackInventoryHint")}</p>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="switch-track-inventory"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {productForm.watch("trackInventory") && !company?.inventoryCostingEnabled && (
                  <p className="col-span-2 text-xs text-warning" data-testid="hint-product-ledger-off">
                    {salesTr("productLedgerOffHint")}{" "}
                    <Link href="/settings/company#inventory-posting" className="underline">
                      {salesTr("inventoryLedgerOffLink")}
                    </Link>
                  </p>
                )}

                {productForm.watch("trackInventory") && !editingProduct && (
                  <>
                    <FormField
                      control={productForm.control}
                      name="openingQuantity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{salesTr("openingQuantity")}</FormLabel>
                          <FormControl>
                            <Input type="number" min="0" step="1" dir="ltr" {...field} value={field.value ?? ""} data-testid="input-opening-quantity" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={productForm.control}
                      name="openingUnitCost"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{salesTr("openingUnitCost")}</FormLabel>
                          <FormControl>
                            <Input type="number" min="0" step="0.01" dir="ltr" {...field} value={field.value ?? ""} data-testid="input-opening-unit-cost" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <p className="col-span-2 text-xs text-muted-foreground">{salesTr("openingStockHelp")}</p>
                  </>
                )}
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
                ? tr("recordInventoryMovementFor", { name: locale === "ar" && stockProduct.nameAr ? stockProduct.nameAr : stockProduct.name })
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

              <p className="text-xs text-muted-foreground" data-testid="text-movement-ledger-help">
                {movementForm.watch("type") === "purchase"
                  ? tr("movementPurchaseLedgerHelp")
                  : tr("movementLedgerHelp")}
              </p>

              <FormField
                control={movementForm.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.quantity || tr("quantity")} *</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={movementForm.watch("type") === "adjustment" ? undefined : "1"}
                        step="1"
                        dir="ltr"
                        {...field}
                        data-testid="input-movement-quantity"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {movementForm.watch("type") === "adjustment" && (
                <p className="text-xs text-muted-foreground" data-testid="hint-negative-adjustment">
                  {salesTr("negativeAdjustmentHint")}
                </p>
              )}

              <FormField
                control={movementForm.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{salesTr("movementDate")}</FormLabel>
                    <FormControl>
                      <Input type="date" dir="ltr" max={todayYmd()} {...field} data-testid="input-movement-date" />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">{salesTr("movementDateHelp")}</p>
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
                        dir="ltr"
                        placeholder={
                          stockProduct?.trackInventory && Number(stockProduct.averageCost) > 0
                            ? salesTr("averageCostPlaceholder", { cost: Number(stockProduct.averageCost).toFixed(2) })
                            : undefined
                        }
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">{salesTr("unitCostLeaveEmpty")}</p>
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

      <Dialog open={postingPromptOpen} onOpenChange={setPostingPromptOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-inventory-posting">
          <DialogHeader>
            <DialogTitle>{salesTr("inventoryPromptTitle")}</DialogTitle>
            <DialogDescription>{salesTr("inventoryPromptBody")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setPostingPromptOpen(false)}>
              {salesTr("inventoryPromptLater")}
            </Button>
            <Button onClick={() => enablePostingMutation.mutate()} disabled={enablePostingMutation.isPending} data-testid="button-enable-inventory-posting">
              {salesTr("inventoryPromptEnable")}
            </Button>
          </div>
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
