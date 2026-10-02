import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useTranslation } from "@/lib/i18n";
import { CALENDAR_DATE_SHORT_FORMAT, formatCurrency, formatDate } from "@/lib/format";
import { apiRequest } from "@/lib/queryClient";
import { messages } from "./VendorCreditStockDialog.i18n";

interface Movement {
  id: string;
  type: string;
  quantity: number | string;
  totalCost?: number | string | null;
  reference?: string | null;
  createdAt: string;
  sourceVendorCreditId?: string | null;
}

interface StockRow {
  productId: string;
  name: string;
  onHand: number | string;
  movement: Movement;
}

interface Props {
  companyId: string;
  credit: { id: string; number: string; status: string } | null;
  onClose: () => void;
}

/** The stock the credit note moved: the movements of its product lines, read from each product's movement list. */
export function VendorCreditStockDialog({ companyId, credit, onClose }: Props) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const { data, isLoading, isError } = useQuery<StockRow[]>({
    queryKey: ["/api/companies", companyId, "vendor-credits", credit?.id, "stock-movement", credit?.status],
    enabled: !!credit,
    queryFn: async () => {
      const detail = await apiRequest("GET", `/api/companies/${companyId}/vendor-credits/${credit!.id}`);
      const productIds: string[] = [...new Set<string>((detail.lines ?? []).map((l: { product_id?: string | null }) => l.product_id).filter(Boolean) as string[])];
      const rows: StockRow[] = [];
      for (const productId of productIds) {
        const product = await apiRequest("GET", `/api/products/${productId}`);
        for (const movement of (product.movements ?? []) as Movement[]) {
          if (movement.sourceVendorCreditId === credit!.id) rows.push({ productId, name: locale === "ar" && product.nameAr ? product.nameAr : product.name, onHand: product.currentStock ?? product.quantityOnHand ?? product.stockOnHand ?? 0, movement });
        }
      }
      return rows;
    },
  });
  const num = (v: unknown) => Number(v) || 0;

  return (
    <Dialog open={!!credit} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl" data-testid="dialog-credit-stock">
        <DialogHeader>
          <DialogTitle>{tr("title", { number: credit?.number ?? "" })}</DialogTitle>
          <DialogDescription>{tr("description")}</DialogDescription>
        </DialogHeader>
        {credit?.status === "draft" && <p className="text-sm text-muted-foreground">{tr("draftNote")}</p>}
        {isLoading ? (
          <Skeleton className="h-24 w-full" aria-label={tr("loading")} />
        ) : isError ? (
          <p className="text-sm text-destructive" role="alert">{tr("loadFailed")}</p>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-credit-stock-none">{tr("none")}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border stack-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr("colItem")}</TableHead>
                  <TableHead>{tr("colDate")}</TableHead>
                  <TableHead className="text-end">{tr("colQuantity")}</TableHead>
                  <TableHead className="text-end">{tr("colValue")}</TableHead>
                  <TableHead>{tr("colReference")}</TableHead>
                  <TableHead className="text-end">{tr("colOnHand")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.movement.id} data-testid={`row-credit-stock-${r.movement.id}`}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{formatDate(r.movement.createdAt, locale, CALENDAR_DATE_SHORT_FORMAT)}</TableCell>
                    <TableCell className="text-end tabular-nums" data-testid="text-credit-stock-qty">{num(r.movement.quantity)}</TableCell>
                    <TableCell className="text-end tabular-nums">{formatCurrency(Math.abs(num(r.movement.totalCost)), "AED", locale)}</TableCell>
                    <TableCell>{r.movement.reference}</TableCell>
                    <TableCell className="text-end tabular-nums" data-testid="text-credit-stock-onhand">{num(r.onHand)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tr("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
