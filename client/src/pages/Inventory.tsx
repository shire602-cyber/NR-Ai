import { T } from "@/components/layout/T";
import {
  FormActions,
  FormErrorSummary,
  FormGrid,
  FormSection,
  formSpanFull,
} from "@/components/ui/form-layout";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { z } from "zod";
import {
  Package,
  Plus,
  Edit,
  Trash2,
  PackagePlus,
  AlertTriangle,
  ArrowDownUp,
  Search,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { DataTableCard } from "@/components/ui/data-table";
import { MoneyCell } from "@/components/ui/money";
import { RowActions, RowActionButton } from "@/components/ui/row-actions";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
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
  FormDescription,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { formatMessage, useTranslation, translateNow } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDate } from "@/lib/format";
import type { Product, InventoryMovement } from "@shared/schema";
import { isValidGtin, RCM_GOODS_TYPES } from "@shared/vat-classification";

// ─── Schemas ──────────────────────────────────────────────

const productFormSchema = z.object({
  name: z.string().min(1, "forms.errors.productNameRequired"),
  nameAr: z.string().optional().nullable(),
  sku: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  unitPrice: z.coerce.number().min(0, "forms.errors.unitPriceNonNegative"),
  costPrice: z.coerce.number().min(0, "forms.errors.costPriceNonNegative").optional().nullable(),
  vatRate: z.coerce.number().min(0).max(1, "forms.errors.vatRateRange"),
  unit: z.string().min(1, "forms.errors.unitRequired"),
  lowStockThreshold: z.coerce.number().int().min(0).optional().nullable(),
  productType: z.enum(["inventory", "service", "bundle"]).optional(),
  reorderPoint: z
    .preprocess(
      (v) => (v === "" || v === undefined ? null : v),
      z.coerce.number().int().min(0).nullable()
    )
    .optional(),
  // S1 (W4-C): e-invoicing identity for domestic reverse-charge goods (PINT AE).
  gtin: z
    .string()
    .trim()
    .optional()
    .nullable()
    .refine(
      (v) => !v || isValidGtin(v),
      "GTIN must be 8, 12, 13 or 14 digits with a valid check digit"
    ),
  rcmGoodsType: z.string().optional().nullable(),
});

type ProductFormData = z.infer<typeof productFormSchema>;

/** "none" in the goods-type picker means "not a reverse-charge good"; "" GTIN clears it. */
function productPayload<T extends Partial<ProductFormData>>(data: T): T {
  if (data.rcmGoodsType === undefined && data.gtin === undefined) return data;
  return {
    ...data,
    gtin: data.gtin ? data.gtin : null,
    rcmGoodsType: data.rcmGoodsType && data.rcmGoodsType !== "none" ? data.rcmGoodsType : null,
  };
}

const movementFormSchema = z
  .object({
    type: z.enum(["purchase", "sale", "adjustment", "return"]),
    // Adjustments are signed (stock-take correction); every other type is a positive quantity.
    quantity: z.coerce
      .number()
      .int()
      .refine((n) => n !== 0, "forms.errors.quantityNotZero"),
    unitCost: z.coerce.number().min(0).optional().nullable(),
    date: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  })
  .refine((v) => v.type === "adjustment" || v.quantity > 0, {
    message: "forms.errors.quantityPositive",
    path: ["quantity"],
  });

type MovementFormData = z.infer<typeof movementFormSchema>;

// ─── Component ────────────────────────────────────────────

export default function Inventory() {
  const { t, locale } = useTranslation();
  const c = INVENTORY_COPY[locale === "ar" ? "ar" : "en"];
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
      apiRequest("POST", `/api/companies/${companyId}/products`, productPayload(data)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/products`] });
      toast({
        title: translateNow("toasts.productCreated"),
        description: translateNow("toasts.theProductHasBeenAddedSuccessfully"),
      });
      setProductDialogOpen(false);
      productForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const updateProductMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ProductFormData> }) =>
      apiRequest("PATCH", `/api/products/${id}`, productPayload(data)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/products`] });
      toast({
        title: translateNow("toasts.productUpdated"),
        description: translateNow("toasts.theProductHasBeenUpdatedSuccessfully"),
      });
      setProductDialogOpen(false);
      setEditingProduct(null);
      productForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const deleteProductMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/products/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/products`] });
      toast({
        title: translateNow("toasts.productDeleted"),
        description: translateNow("toasts.theProductHasBeenDeleted"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const addMovementMutation = useMutation({
    mutationFn: ({ productId, data }: { productId: string; data: MovementFormData }) =>
      apiRequest("POST", `/api/products/${productId}/movements`, {
        type: data.type,
        quantity: data.quantity,
        unitCost: data.unitCost || null,
        date: data.date || undefined,
        notes: data.notes || null,
      }),
    onSuccess: (res: { warnings?: string[] }) => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/products`] });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/inventory-movements`],
      });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/inventory/valuation`],
      });
      toast({
        title: c.stockUpdated,
        description: res?.warnings?.includes("NEGATIVE_STOCK")
          ? c.negativeWarning
          : c.postedToLedger,
      });
      setAddStockDialogOpen(false);
      setStockProduct(null);
      movementForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
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
      gtin: product.gtin || "",
      rcmGoodsType: product.rcmGoodsType || "none",
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
          <Badge variant="outline">
            <T k="pages.purchase" />
          </Badge>
        );
      case "sale":
        return <Badge variant="outline">{t["screens.sale"]}</Badge>;
      case "adjustment":
        return (
          <Badge variant="outline">
            <T k="pages.adjustment" />
          </Badge>
        );
      case "return":
        return (
          <Badge variant="outline">
            <T k="pages.return" />
          </Badge>
        );
      default:
        return <Badge variant="outline">{type}</Badge>;
    }
  };

  const getProductName = (productId: string): string => {
    const product = productsList.find((p) => p.id === productId);
    return (
      (locale === "ar" && product?.nameAr ? product.nameAr : product?.name) ||
      t["screens.unknownProduct"]
    );
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
        <div className="text-muted-foreground">{t.loading || "Loading..."}</div>
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">
          <T k="pages.pleaseCreateACompanyFirst" />
        </div>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Purchases"
        title={(t as any).inventory || "Inventory"}
        description={t["pageLabels.manageYourProductsAndTrackInventoryMovements"]}
        actions={
          <Button onClick={handleOpenCreateDialog}>
            <Plus aria-hidden />
            <T k="pageLabels.addProduct" />
          </Button>
        }
      />

      <Tabs defaultValue="products" className="space-y-4">
        <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <TabsList>
            <TabsTrigger value="products">
              <Package aria-hidden />
              <T k="pages.products" />
            </TabsTrigger>
            <TabsTrigger value="movements">
              <ArrowDownUp aria-hidden />
              {c.movements}
            </TabsTrigger>
            <TabsTrigger value="valuation">{c.valuation}</TabsTrigger>
            <TabsTrigger value="warehouses">{c.warehouses}</TabsTrigger>
            <TabsTrigger value="stocktake">{c.stocktake}</TabsTrigger>
            <TabsTrigger value="settings">{c.settings}</TabsTrigger>
          </TabsList>
        </div>

        <InventoryAccountingTabs
          companyId={companyId}
          products={productsList}
          c={c}
          locale={locale}
        />

        {/* ─── Products Tab ──────────────────────────────── */}
        <TabsContent value="products" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="relative w-full sm:w-72">
              <Search
                className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                placeholder={t["screens.searchProducts"]}
                aria-label={t["screens.searchProducts"]}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 ps-9"
              />
            </div>
            <p className="text-small text-muted-foreground">
              {formatMessage(t["pages.inventoryProductCount"], { count: productsList.length })}
            </p>
          </div>
          <DataTableCard
            status={
              isLoadingProducts ? "loading" : filteredProducts.length === 0 ? "empty" : "ready"
            }
            columnLabels={[t["screens.product"], t["reportCenter.stock"], t.status]}
            empty={{
              icon: Package,
              title: searchQuery ? t["pages.inventoryNoMatch"] : t["pages.inventoryEmpty"],
              action: searchQuery
                ? undefined
                : { label: t["pageLabels.addProduct"], onClick: handleOpenCreateDialog },
            }}
          >
            <Table className="row-cards">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-full">{t["screens.product"]}</TableHead>
                  <TableHead>{t["screens.sku"]}</TableHead>
                  <TableHead data-numeric="">
                    <T k="pages.unitPrice" />
                  </TableHead>
                  <TableHead data-numeric="">
                    <T k="pages.costPrice" />
                  </TableHead>
                  <TableHead data-numeric="">
                    <T k="reportCenter.stock" />
                  </TableHead>
                  <TableHead>
                    <T k="pages.status" />
                  </TableHead>
                  <TableHead>
                    <span className="sr-only">{t.actions || "Actions"}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.map((product) => {
                  const isLowStock = product.currentStock < (product.lowStockThreshold || 0);
                  return (
                    <TableRow key={product.id}>
                      <TableCell data-truncate="" data-cell="title">
                        <span dir="auto" className="font-medium">
                          {locale === "ar" && product.nameAr ? product.nameAr : product.name}
                        </span>
                        {product.nameAr && locale !== "ar" && (
                          <span dir="rtl" className="ms-2 text-caption text-muted-foreground">
                            {product.nameAr}
                          </span>
                        )}
                      </TableCell>
                      <TableCell data-nowrap="" data-cell="meta" className="text-muted-foreground">
                        <span dir="ltr" className="[unicode-bidi:isolate]">
                          {product.sku || "—"}
                        </span>
                      </TableCell>
                      <MoneyCell amount={product.unitPrice} className="text-muted-foreground" />
                      <MoneyCell
                        amount={product.costPrice || 0}
                        className="text-muted-foreground"
                      />
                      <TableCell data-numeric="" data-cell="amount">
                        <span className={cn("font-medium", isLowStock && "text-warning")}>
                          {product.currentStock}
                        </span>{" "}
                        <span className="text-caption text-muted-foreground">{product.unit}</span>
                      </TableCell>
                      <TableCell data-nowrap="" data-cell="status">
                        {isLowStock ? (
                          <Badge variant="warning" dot>
                            <AlertTriangle className="h-3 w-3" aria-hidden />
                            {t["screens.lowStock"]}
                          </Badge>
                        ) : (
                          <StatusBadge status={product.isActive ? "active" : "inactive"} />
                        )}
                      </TableCell>
                      <TableCell data-cell="actions">
                        <RowActions
                          collapseOnMobile
                          menu={
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => setProductToDelete(product.id)}
                            >
                              <Trash2 aria-hidden />
                              {t.delete}
                            </DropdownMenuItem>
                          }
                        >
                          <RowActionButton
                            label={t["screens.addStock"]}
                            icon={PackagePlus}
                            onClick={() => handleOpenAddStockDialog(product)}
                          />
                          <RowActionButton
                            label={t.edit}
                            icon={Edit}
                            onClick={() => handleOpenEditDialog(product)}
                          />
                        </RowActions>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </DataTableCard>
        </TabsContent>

        {/* ─── Movements Tab ─────────────────────────────── */}
        <TabsContent value="movements" className="space-y-3">
          <div>
            <h2 className="text-h2 text-foreground">
              <T k="pageLabels.inventoryMovements" />
            </h2>
            <p className="mt-1 text-small text-muted-foreground">
              <T k="pageLabels.historyOfAllInventoryChangesAcrossProducts" />
            </p>
          </div>
          <DataTableCard
            status={isLoadingMovements ? "loading" : movementsList.length === 0 ? "empty" : "ready"}
            empty={{
              icon: ArrowDownUp,
              title: t["screens.noMovements"],
              description: t["screens.noMovementsBody"],
            }}
          >
            <Table className="row-cards">
              <TableHeader>
                <TableRow>
                  <TableHead>{t.date || "Date"}</TableHead>
                  <TableHead className="w-full">
                    <T k="pages.product" />
                  </TableHead>
                  <TableHead>{t.type || "Type"}</TableHead>
                  <TableHead data-numeric="">{t.quantity || "Quantity"}</TableHead>
                  <TableHead data-numeric="">
                    <T k="pages.unitCost" />
                  </TableHead>
                  <TableHead>{t.reference || "Reference"}</TableHead>
                  <TableHead>
                    <T k="pages.notes" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movementsList.map((movement) => (
                  <TableRow key={movement.id}>
                    <TableCell data-nowrap="" data-cell="meta" className="text-muted-foreground">
                      {movement.createdAt ? formatDate(movement.createdAt, locale) : "—"}
                    </TableCell>
                    <TableCell
                      data-truncate=""
                      data-cell="title"
                      dir="auto"
                      className="font-medium"
                    >
                      {getProductName(movement.productId)}
                    </TableCell>
                    <TableCell data-nowrap="" data-cell="status">
                      {getMovementTypeBadge(movement.type)}
                    </TableCell>
                    <TableCell data-numeric="" data-cell="amount" className="font-medium">
                      <span dir="ltr">
                        {movement.type === "sale" ? "−" : "+"}
                        {Math.abs(movement.quantity)}
                      </span>
                    </TableCell>
                    {movement.unitCost != null ? (
                      <MoneyCell amount={movement.unitCost} className="text-muted-foreground" />
                    ) : (
                      <TableCell data-numeric="" className="text-muted-foreground">
                        —
                      </TableCell>
                    )}
                    <TableCell data-nowrap="" data-cell="meta" className="text-muted-foreground">
                      <span dir="ltr" className="[unicode-bidi:isolate]">
                        {movement.reference || "—"}
                      </span>
                    </TableCell>
                    <TableCell data-truncate="" className="text-muted-foreground">
                      {movement.notes || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTableCard>
        </TabsContent>
      </Tabs>

      {/* ─── Product Create/Edit Dialog ──────────────────── */}
      <Dialog open={productDialogOpen} onOpenChange={setProductDialogOpen}>
        <DialogContent size="lg" data-testid="dialog-product-form">
          <DialogHeader>
            <DialogTitle>
              {editingProduct ? t["screens.editProduct"] : t["pageLabels.addProduct"]}
            </DialogTitle>
            <DialogDescription>
              {editingProduct ? t["forms.product.editDesc"] : t["forms.product.newDesc"]}
            </DialogDescription>
          </DialogHeader>

          <Form {...productForm}>
            <form
              onSubmit={productForm.handleSubmit(handleProductSubmit)}
              noValidate
              className="space-y-6"
            >
              <FormErrorSummary />
              <FormSection title={t["forms.section.item"]}>
                <FormGrid>
                  <FormField
                    control={productForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t["screens.invName"]}</FormLabel>
                        <FormControl>
                          <Input dir="auto" placeholder={t["screens.inv2ProductName"]} {...field} />
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
                        <FormLabel>{t["screens.inv2NameArabic"]}</FormLabel>
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
                  <FormField
                    control={productForm.control}
                    name="sku"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t["screens.invSku"]}</FormLabel>
                        <FormControl>
                          <Input ltr placeholder="PROD-001" {...field} value={field.value || ""} />
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
                        <FormLabel required>{t["screens.invUnit"]}</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={t["screens.inv2SelectUnit"]} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="pcs">{t["forms.product.unit.pcs"]}</SelectItem>
                            <SelectItem value="kg">{t["forms.product.unit.kg"]}</SelectItem>
                            <SelectItem value="m">{t["forms.product.unit.m"]}</SelectItem>
                            <SelectItem value="hr">{t["forms.product.unit.hr"]}</SelectItem>
                            <SelectItem value="box">{t["forms.product.unit.box"]}</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={productForm.control}
                    name="productType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{c.productType}</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value ?? "inventory"}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="inventory">{c.typeInventory}</SelectItem>
                            <SelectItem value="service">{c.typeService}</SelectItem>
                            <SelectItem value="bundle">{c.typeBundle}</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="hidden sm:block" aria-hidden />
                  <FormField
                    control={productForm.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem className={formSpanFull}>
                        <FormLabel>{t.description}</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder={t["screens.inv2ProductDescriptionOptional"]}
                            {...field}
                            value={field.value || ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </FormGrid>
              </FormSection>
              <FormSection title={t["forms.section.pricing"]}>
                <FormGrid>
                  <FormField
                    control={productForm.control}
                    name="unitPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t.unitPrice}</FormLabel>
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
                        <FormLabel>
                          <T k="pages.costPrice" />
                        </FormLabel>
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
                  <FormField
                    control={productForm.control}
                    name="vatRate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          <T k="pages.vatRate" />
                        </FormLabel>
                        <Select
                          onValueChange={(v) => field.onChange(parseFloat(v))}
                          value={String(field.value)}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={t["screens.inv2SelectVatRate"]} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="0">{t["forms.product.vat0"]}</SelectItem>
                            <SelectItem value="0.05">{t["forms.product.vat5"]}</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="hidden sm:block" aria-hidden />
                  <FormField
                    control={productForm.control}
                    name="reorderPoint"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{c.reorderPoint}</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            {...field}
                            value={field.value ?? ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={productForm.control}
                    name="lowStockThreshold"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          <T k="pageLabels.lowStockThreshold" />
                        </FormLabel>
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
                </FormGrid>
              </FormSection>
              <FormSection
                title={t["forms.product.einvoiceTitle"]}
                description={t["forms.product.einvoiceDesc"]}
              >
                <FormGrid>
                  <FormField
                    control={productForm.control}
                    name="gtin"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          <T k="pages.productGtin" />
                        </FormLabel>
                        <FormControl>
                          <Input
                            ltr
                            inputMode="numeric"
                            {...field}
                            value={field.value ?? ""}
                            data-testid="input-product-gtin"
                          />
                        </FormControl>
                        <FormDescription>{t["forms.product.gtinHelp"]}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={productForm.control}
                    name="rcmGoodsType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          <T k="pages.productRcmGoodsType" />
                        </FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || "none"}>
                          <FormControl>
                            <SelectTrigger data-testid="select-product-rcm-goods-type">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="none">{t["pages.productRcmNone"]}</SelectItem>
                            {RCM_GOODS_TYPES.map((code) => (
                              <SelectItem key={code} value={code}>
                                {code}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </FormGrid>
              </FormSection>

              <FormActions sticky>
                <Button type="button" variant="outline" onClick={() => setProductDialogOpen(false)}>
                  {t.cancel}
                </Button>
                <Button
                  type="submit"
                  className="sm:min-w-32"
                  disabled={createProductMutation.isPending || updateProductMutation.isPending}
                >
                  {createProductMutation.isPending || updateProductMutation.isPending
                    ? t["forms.saving"]
                    : editingProduct
                      ? t.save
                      : t["pageLabels.addProduct"]}
                </Button>
              </FormActions>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ─── Add Stock Dialog ────────────────────────────── */}
      <Dialog open={addStockDialogOpen} onOpenChange={setAddStockDialogOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>
              <T k="pageLabels.addStock" />
            </DialogTitle>
            <DialogDescription>
              {stockProduct
                ? `Record inventory movement for "${stockProduct.name}"`
                : t["inventory.recordInventoryMovement"]}
            </DialogDescription>
          </DialogHeader>

          <Form {...movementForm}>
            <form onSubmit={movementForm.handleSubmit(handleMovementSubmit)} className="space-y-4">
              <FormField
                control={movementForm.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.type || "Type"} *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t["screens.inv2SelectType"]} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="purchase">
                          <T k="pages.purchase" />
                        </SelectItem>
                        <SelectItem value="sale">{c.saleIssue}</SelectItem>
                        <SelectItem value="adjustment">
                          <T k="pages.adjustment" />
                        </SelectItem>
                        <SelectItem value="return">
                          <T k="pages.return" />
                        </SelectItem>
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
                    <FormLabel>{t.quantity || "Quantity"} *</FormLabel>
                    <FormControl>
                      <Input type="number" step="1" {...field} />
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
                    <FormLabel>
                      <T k="pages.unitCost" />
                    </FormLabel>
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
                    <FormLabel>
                      <T k="pages.notes" />
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={t["screens.inv2OptionalNotes"]}
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
                  {t.cancel || "Cancel"}
                </Button>
                <Button type="submit" disabled={addMovementMutation.isPending}>
                  {addMovementMutation.isPending
                    ? t.loading || "Loading..."
                    : t["inventory.recordMovement"]}
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
            <AlertDialogTitle>
              <T k="pageLabels.deleteProduct" />
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t["inventory.thisWillPermanentlyDeleteThis"]}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <T k="pages.cancel" />
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (productToDelete) {
                  deleteProductMutation.mutate(productToDelete);
                  setProductToDelete(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <T k="pages.delete" />
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── W4-B: inventory accounting (valuation vs GL, warehouses, stocktake, settings) ──────────

const INVENTORY_COPY = {
  en: {
    movements: "Movements",
    valuation: "Valuation",
    warehouses: "Warehouses",
    stocktake: "Stocktake",
    settings: "Settings",
    stockUpdated: "Stock updated",
    postedToLedger: "The movement and its journal entry were posted.",
    negativeWarning:
      "Recorded. Stock is now negative: the cost is an estimate until the next receipt.",
    saleIssue: "Issue / sale (no invoice)",
    productType: "Product type",
    typeInventory: "Stock item",
    typeService: "Service (no stock)",
    typeBundle: "Bundle / kit",
    reorderPoint: "Reorder point",
    product: "Product",
    quantity: "Quantity",
    unitCost: "Unit cost",
    value: "Value (AED)",
    total: "Total",
    glBalance: "General ledger (inventory accounts)",
    difference: "Difference",
    reconciled: "Reconciled to the ledger",
    notReconciled: "Does not reconcile — investigate",
    ageing: "Stock ageing (days on hand)",
    reorder: "Below reorder point",
    suggested: "Suggested order",
    none: "Nothing to show",
    code: "Code",
    name: "Name",
    nameAr: "Arabic name",
    addWarehouse: "Add warehouse",
    defaultWh: "Default",
    units: "Units",
    transfer: "Transfer stock",
    from: "From",
    to: "To",
    submit: "Submit",
    counted: "Counted",
    countDate: "Count date",
    createCount: "Create count",
    post: "Post",
    posted: "Posted",
    draft: "Draft",
    lines: "Lines",
    costingMethod: "Costing method",
    weightedAverage: "Weighted average",
    fifo: "FIFO (first in, first out)",
    allowNegative: "Allow negative stock (with a warning)",
    save: "Save",
    saved: "Saved",
    error: "Error",
  },
  ar: {
    movements: "الحركات",
    valuation: "التقييم",
    warehouses: "المستودعات",
    stocktake: "الجرد",
    settings: "الإعدادات",
    stockUpdated: "تم تحديث المخزون",
    postedToLedger: "تم ترحيل الحركة وقيدها المحاسبي.",
    negativeWarning: "تم التسجيل. المخزون الآن سالب: التكلفة تقديرية حتى الاستلام التالي.",
    saleIssue: "صرف / بيع (بدون فاتورة)",
    productType: "نوع المنتج",
    typeInventory: "صنف مخزني",
    typeService: "خدمة (بدون مخزون)",
    typeBundle: "حزمة / طقم",
    reorderPoint: "حد إعادة الطلب",
    product: "المنتج",
    quantity: "الكمية",
    unitCost: "تكلفة الوحدة",
    value: "القيمة (درهم)",
    total: "الإجمالي",
    glBalance: "دفتر الأستاذ (حسابات المخزون)",
    difference: "الفرق",
    reconciled: "مطابق لدفتر الأستاذ",
    notReconciled: "غير مطابق — يرجى المراجعة",
    ageing: "أعمار المخزون (أيام)",
    reorder: "أقل من حد إعادة الطلب",
    suggested: "الكمية المقترحة",
    none: "لا توجد بيانات",
    code: "الرمز",
    name: "الاسم",
    nameAr: "الاسم بالعربية",
    addWarehouse: "إضافة مستودع",
    defaultWh: "افتراضي",
    units: "الوحدات",
    transfer: "تحويل مخزون",
    from: "من",
    to: "إلى",
    submit: "إرسال",
    counted: "المعدود",
    countDate: "تاريخ الجرد",
    createCount: "إنشاء جرد",
    post: "ترحيل",
    posted: "مرحّل",
    draft: "مسودة",
    lines: "البنود",
    costingMethod: "طريقة التكلفة",
    weightedAverage: "المتوسط المرجح",
    fifo: "الوارد أولاً صادر أولاً",
    allowNegative: "السماح بالمخزون السالب (مع تحذير)",
    save: "حفظ",
    saved: "تم الحفظ",
    error: "خطأ",
  },
} as const;

type InventoryCopy = (typeof INVENTORY_COPY)["en"] | (typeof INVENTORY_COPY)["ar"];

interface ValuationReport {
  rows: Array<{
    productId: string;
    name: string;
    nameAr: string | null;
    sku: string | null;
    quantity: number;
    unitCost: string;
    value: string;
  }>;
  totalValue: string;
  glBalance: string;
  difference: string;
  reconciled: boolean;
}
interface AgeingReport {
  totals: Array<{ label: string; qty: number; value: string }>;
}
interface ReorderRow {
  productId: string;
  name: string;
  nameAr: string | null;
  currentStock: number;
  reorderPoint: number;
  suggestedOrderQty: number;
}
interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  name_ar: string | null;
  is_default: boolean;
  totalUnits: number;
}
interface StocktakeRow {
  id: string;
  count_date: string;
  status: string;
  lineCount: number;
}

function InventoryAccountingTabs({
  companyId,
  products,
  c,
  locale,
}: {
  companyId: string;
  products: Product[];
  c: InventoryCopy;
  locale: string;
}) {
  const { toast } = useToast();
  const base = `/api/companies/${companyId}`;
  const valuation = useQuery<ValuationReport>({ queryKey: [`${base}/inventory/valuation`] });
  const ageing = useQuery<AgeingReport>({ queryKey: [`${base}/inventory/ageing`] });
  const reorder = useQuery<ReorderRow[]>({ queryKey: [`${base}/inventory/reorder`] });
  const warehousesQ = useQuery<WarehouseRow[]>({ queryKey: [`${base}/warehouses`] });
  const stocktakesQ = useQuery<StocktakeRow[]>({ queryKey: [`${base}/stocktakes`] });
  const settingsQ = useQuery<{ costingMethod: string; allowNegativeStock: boolean }>({
    queryKey: [`${base}/inventory/settings`],
  });
  const stocked = products.filter(
    (p) => (p as Product & { productType?: string }).productType !== "service"
  );

  const fail = (e: Error) =>
    toast({ title: c.error, description: e?.message, variant: "destructive" });
  const refresh = () => {
    for (const k of [
      "inventory/valuation",
      "inventory/ageing",
      "inventory/reorder",
      "warehouses",
      "stocktakes",
      "products",
      "inventory-movements",
    ]) {
      queryClient.invalidateQueries({ queryKey: [`${base}/${k}`] });
    }
  };

  const [wh, setWh] = useState({ code: "", name: "", nameAr: "" });
  const addWarehouse = useMutation({
    mutationFn: () =>
      apiRequest("POST", `${base}/warehouses`, {
        code: wh.code,
        name: wh.name,
        nameAr: wh.nameAr || null,
      }),
    onSuccess: () => {
      setWh({ code: "", name: "", nameAr: "" });
      refresh();
    },
    onError: fail,
  });
  const [tr, setTr] = useState({
    productId: "",
    fromWarehouseId: "",
    toWarehouseId: "",
    quantity: 1,
  });
  const transfer = useMutation({
    mutationFn: () => apiRequest("POST", `${base}/inventory/transfers`, tr),
    onSuccess: () => {
      toast({ title: c.saved });
      refresh();
    },
    onError: fail,
  });
  const [count, setCount] = useState({
    productId: "",
    countedQty: 0,
    countDate: new Date().toISOString().slice(0, 10),
  });
  const createCount = useMutation({
    mutationFn: () =>
      apiRequest("POST", `${base}/stocktakes`, {
        countDate: count.countDate,
        lines: [{ productId: count.productId, countedQty: Number(count.countedQty) }],
      }),
    onSuccess: refresh,
    onError: fail,
  });
  const postCount = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `${base}/stocktakes/${id}/post`, {}),
    onSuccess: () => {
      toast({ title: c.posted });
      refresh();
    },
    onError: fail,
  });
  const saveSettings = useMutation({
    mutationFn: (body: { costingMethod?: string; allowNegativeStock?: boolean }) =>
      apiRequest("PUT", `${base}/inventory/settings`, body),
    onSuccess: () => {
      toast({ title: c.saved });
      queryClient.invalidateQueries({ queryKey: [`${base}/inventory/settings`] });
    },
    onError: fail,
  });
  const nameOf = (p: { name: string; nameAr?: string | null }) =>
    locale === "ar" && p.nameAr ? p.nameAr : p.name;
  const v = valuation.data;

  return (
    <>
      <TabsContent value="valuation" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{c.valuation}</CardTitle>
            {v && (
              <CardDescription>
                <Badge variant={v.reconciled ? "secondary" : "destructive"}>
                  {v.reconciled ? c.reconciled : c.notReconciled}
                </Badge>
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{c.product}</TableHead>
                  <TableHead data-numeric="">{c.quantity}</TableHead>
                  <TableHead data-numeric="">{c.unitCost}</TableHead>
                  <TableHead data-numeric="">{c.value}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(v?.rows ?? []).map((r) => (
                  <TableRow key={r.productId}>
                    <TableCell>{nameOf(r)}</TableCell>
                    <TableCell data-numeric="">{r.quantity}</TableCell>
                    <MoneyCell amount={Number(r.unitCost)} />
                    <MoneyCell amount={Number(r.value)} />
                  </TableRow>
                ))}
                {v && (
                  <>
                    <TableRow>
                      <TableCell className="font-semibold">{c.total}</TableCell>
                      <TableCell />
                      <TableCell />
                      <MoneyCell amount={Number(v.totalValue)} className="font-semibold" />
                    </TableRow>
                    <TableRow>
                      <TableCell>{c.glBalance}</TableCell>
                      <TableCell />
                      <TableCell />
                      <MoneyCell amount={Number(v.glBalance)} />
                    </TableRow>
                    <TableRow>
                      <TableCell>{c.difference}</TableCell>
                      <TableCell />
                      <TableCell />
                      <MoneyCell amount={Number(v.difference)} />
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{c.ageing}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableBody>
                  {(ageing.data?.totals ?? []).map((b) => (
                    <TableRow key={b.label}>
                      <TableCell>{b.label}</TableCell>
                      <TableCell data-numeric="">{b.qty}</TableCell>
                      <MoneyCell amount={Number(b.value)} />
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                {c.reorder}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(reorder.data ?? []).length === 0 ? (
                <p className="text-muted-foreground text-sm">{c.none}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{c.product}</TableHead>
                      <TableHead data-numeric="">{c.quantity}</TableHead>
                      <TableHead data-numeric="">{c.reorderPoint}</TableHead>
                      <TableHead data-numeric="">{c.suggested}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(reorder.data ?? []).map((r) => (
                      <TableRow key={r.productId}>
                        <TableCell>{nameOf(r)}</TableCell>
                        <TableCell data-numeric="">{r.currentStock}</TableCell>
                        <TableCell data-numeric="">{r.reorderPoint}</TableCell>
                        <TableCell data-numeric="">{r.suggestedOrderQty}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="warehouses" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{c.warehouses}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{c.code}</TableHead>
                  <TableHead>{c.name}</TableHead>
                  <TableHead data-numeric="">{c.units}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(warehousesQ.data ?? []).map((w) => (
                  <TableRow key={w.id}>
                    <TableCell>
                      {w.code} {w.is_default && <Badge variant="secondary">{c.defaultWh}</Badge>}
                    </TableCell>
                    <TableCell>{locale === "ar" && w.name_ar ? w.name_ar : w.name}</TableCell>
                    <TableCell data-numeric="">{w.totalUnits}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="grid gap-2 md:grid-cols-4">
              <Input
                aria-label={c.code}
                placeholder={c.code}
                value={wh.code}
                onChange={(e) => setWh({ ...wh, code: e.target.value })}
              />
              <Input
                aria-label={c.name}
                placeholder={c.name}
                value={wh.name}
                onChange={(e) => setWh({ ...wh, name: e.target.value })}
              />
              <Input
                aria-label={c.nameAr}
                placeholder={c.nameAr}
                dir="rtl"
                value={wh.nameAr}
                onChange={(e) => setWh({ ...wh, nameAr: e.target.value })}
              />
              <Button
                disabled={!wh.code || !wh.name || addWarehouse.isPending}
                onClick={() => addWarehouse.mutate()}
              >
                <Plus className="w-4 h-4" />
                {c.addWarehouse}
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{c.transfer}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 md:grid-cols-5">
            <Select value={tr.productId} onValueChange={(productId) => setTr({ ...tr, productId })}>
              <SelectTrigger aria-label={c.product}>
                <SelectValue placeholder={c.product} />
              </SelectTrigger>
              <SelectContent>
                {stocked.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {nameOf(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(["fromWarehouseId", "toWarehouseId"] as const).map((k) => (
              <Select key={k} value={tr[k]} onValueChange={(id) => setTr({ ...tr, [k]: id })}>
                <SelectTrigger aria-label={k === "fromWarehouseId" ? c.from : c.to}>
                  <SelectValue placeholder={k === "fromWarehouseId" ? c.from : c.to} />
                </SelectTrigger>
                <SelectContent>
                  {(warehousesQ.data ?? []).map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ))}
            <Input
              aria-label={c.quantity}
              type="number"
              min="1"
              value={tr.quantity}
              onChange={(e) => setTr({ ...tr, quantity: Number(e.target.value) })}
            />
            <Button
              disabled={
                !tr.productId || !tr.fromWarehouseId || !tr.toWarehouseId || transfer.isPending
              }
              onClick={() => transfer.mutate()}
            >
              {c.submit}
            </Button>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="stocktake" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{c.stocktake}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 md:grid-cols-4">
              <Select
                value={count.productId}
                onValueChange={(productId) => setCount({ ...count, productId })}
              >
                <SelectTrigger aria-label={c.product}>
                  <SelectValue placeholder={c.product} />
                </SelectTrigger>
                <SelectContent>
                  {stocked.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {nameOf(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                aria-label={c.counted}
                type="number"
                min="0"
                value={count.countedQty}
                onChange={(e) => setCount({ ...count, countedQty: Number(e.target.value) })}
              />
              <Input
                aria-label={c.countDate}
                type="date"
                value={count.countDate}
                onChange={(e) => setCount({ ...count, countDate: e.target.value })}
              />
              <Button
                disabled={!count.productId || createCount.isPending}
                onClick={() => createCount.mutate()}
              >
                {c.createCount}
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{c.countDate}</TableHead>
                  <TableHead>{c.lines}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(stocktakesQ.data ?? []).map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.count_date}</TableCell>
                    <TableCell>{s.lineCount}</TableCell>
                    <TableCell className="text-end">
                      {s.status === "draft" ? (
                        <Button
                          size="sm"
                          disabled={postCount.isPending}
                          onClick={() => postCount.mutate(s.id)}
                        >
                          {c.post}
                        </Button>
                      ) : (
                        <Badge variant="secondary">{c.posted}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="settings">
        <Card>
          <CardHeader>
            <CardTitle>{c.settings}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 max-w-md">
            <div className="space-y-2">
              <p className="text-sm font-medium">{c.costingMethod}</p>
              <Select
                value={settingsQ.data?.costingMethod ?? "weighted_average"}
                onValueChange={(costingMethod) => saveSettings.mutate({ costingMethod })}
              >
                <SelectTrigger aria-label={c.costingMethod}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weighted_average">{c.weightedAverage}</SelectItem>
                  <SelectItem value="fifo">{c.fifo}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settingsQ.data?.allowNegativeStock === true}
                onChange={(e) => saveSettings.mutate({ allowNegativeStock: e.target.checked })}
              />
              {c.allowNegative}
            </label>
          </CardContent>
        </Card>
      </TabsContent>
    </>
  );
}
